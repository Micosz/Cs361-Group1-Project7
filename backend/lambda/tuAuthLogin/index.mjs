// #75: server-side TU adapter. Never log requests, provider bodies or exceptions.
const TIMEOUT_MS = 8000;
const MESSAGES = {
  INVALID_REQUEST: 'Username and Password are required in a valid JSON body',
  INVALID_CREDENTIALS: 'Invalid TU credentials',
  AUTH_CONFIGURATION_UNAVAILABLE: 'Server authentication config unavailable',
  AUTH_PROVIDER_INVALID_RESPONSE: 'Invalid authentication service response',
  AUTH_PROVIDER_UNAVAILABLE: 'TU Authentication service unavailable',
  RATE_LIMITED: 'Too many login requests. Please try again later',
};

export class TuAuthError extends Error {
  constructor(code, statusCode, retryAfter) {
    super(MESSAGES[code]);
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}

function validateInput(input) {
  // Application limits, not claims about TU's password policy. Preserve exact input.
  if (!input || typeof input.UserName !== 'string' || !input.UserName.trim()
      || input.UserName.length > 128 || typeof input.PassWord !== 'string'
      || !input.PassWord || input.PassWord.length > 512) {
    throw new TuAuthError('INVALID_REQUEST', 400);
  }
}

function readConfig(env) {
  if (typeof env.TU_APP_KEY !== 'string' || !env.TU_APP_KEY.trim()
      || /[\r\n]/.test(env.TU_APP_KEY)) {
    throw new TuAuthError('AUTH_CONFIGURATION_UNAVAILABLE', 503);
  }
  let endpoint;
  try {
    endpoint = new URL(env.TU_AUTH_URL);
  } catch {
    throw new TuAuthError('AUTH_CONFIGURATION_UNAVAILABLE', 503);
  }
  // Credentials must only go to the official TU origin, never a configured proxy.
  if (endpoint.origin !== 'https://restapi.tu.ac.th' || endpoint.username
      || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname === '/') {
    throw new TuAuthError('AUTH_CONFIGURATION_UNAVAILABLE', 503);
  }
  return { endpoint: endpoint.href, key: env.TU_APP_KEY };
}

function retryDelay(response) {
  const value = response.headers?.get('retry-after');
  return /^\d+$/.test(value || '') ? Math.max(1, Math.min(300, Number(value))) : 60;
}

function verifiedProfile(data, username) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || typeof data.status !== 'boolean') {
    throw new TuAuthError('AUTH_PROVIDER_INVALID_RESPONSE', 502);
  }
  if (data.status === false) throw new TuAuthError('INVALID_CREDENTIALS', 401);
  if (!['student', 'employee'].includes(data.type)
      || ['displayname_th', 'displayname_en', 'email'].some(
        field => data[field] !== undefined && typeof data[field] !== 'string')) {
    throw new TuAuthError('AUTH_PROVIDER_INVALID_RESPONSE', 502);
  }
  // Allowlisted display fields only. type is an account category, never a role.
  return {
    username,
    type: data.type,
    displayname_th: data.displayname_th || '',
    displayname_en: data.displayname_en || '',
    email: data.email || '',
  };
}

// Trusted backend integration point for #76. Do not accept a browser-supplied profile.
export function createTuAuthenticator({ env = process.env, fetchImpl = globalThis.fetch,
                                       timeoutMs = TIMEOUT_MS } = {}) {
  return async function authenticateTu(input) {
    validateInput(input);
    const { endpoint, key } = readConfig(env);
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new TuAuthError('AUTH_PROVIDER_UNAVAILABLE', 503));
        controller.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          redirect: 'error', // Never forward the Application-Key/password via redirects.
          headers: { 'Content-Type': 'application/json', 'Application-Key': key },
          body: JSON.stringify({ UserName: input.UserName, PassWord: input.PassWord }),
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          throw new TuAuthError('AUTH_CONFIGURATION_UNAVAILABLE', 503);
        }
        if (response.status === 429) {
          throw new TuAuthError('RATE_LIMITED', 429, retryDelay(response));
        }
        if (!response.ok) {
          throw new TuAuthError(response.status >= 500
            ? 'AUTH_PROVIDER_UNAVAILABLE' : 'AUTH_PROVIDER_INVALID_RESPONSE',
          response.status >= 500 ? 503 : 502);
        }
        let data;
        try {
          data = await response.json();
        } catch {
          throw new TuAuthError('AUTH_PROVIDER_INVALID_RESPONSE', 502);
        }
        return verifiedProfile(data, input.UserName);
      })()]);
    } catch (error) {
      if (error instanceof TuAuthError) throw error;
      throw new TuAuthError('AUTH_PROVIDER_UNAVAILABLE', 503);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createHandler(options) {
  const authenticateTu = createTuAuthenticator(options);
  return async (event) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'OPTIONS,POST',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    };
    const method = event.requestContext?.http?.method || event.httpMethod;
    if (method === 'OPTIONS') {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'OK' }) };
    }
    if (method && method !== 'POST') {
      return { statusCode: 405, headers: { ...headers, Allow: 'OPTIONS,POST' },
        body: JSON.stringify({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }) };
    }
    try {
      let input;
      try {
        input = JSON.parse(event.body);
      } catch {
        throw new TuAuthError('INVALID_REQUEST', 400);
      }
      const user = await authenticateTu(input);
      return { statusCode: 200, headers,
        body: JSON.stringify({ success: true, message: 'Login successful', user }) };
    } catch (error) {
      const failure = error instanceof TuAuthError ? error
        : new TuAuthError('AUTH_PROVIDER_UNAVAILABLE', 503);
      if (failure.statusCode >= 500) console.error('TU authentication failure:', failure.code);
      if (failure.retryAfter !== undefined) headers['Retry-After'] = String(failure.retryAfter);
      return { statusCode: failure.statusCode, headers,
        body: JSON.stringify({ success: false, code: failure.code, message: failure.message }) };
    }
  };
}

export const handler = createHandler();
