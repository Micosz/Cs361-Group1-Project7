/* Shared #74/#80 Session client. Credentials stay in HttpOnly cookies. */
(() => {
    'use strict';
    let state = null;
    const enabled = () => window.CSTU_AUTH_CONFIG?.enabled === true;
    async function request(path, options = {}) {
        const { timeoutMs = 15000, ...fetchOptions } = options;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const external = fetchOptions.signal;
        const abort = () => controller.abort();
        external?.addEventListener('abort', abort, { once: true });
        if (external?.aborted) controller.abort();
        try {
            const response = await fetch('/api' + path, {
                ...fetchOptions, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
                headers: { ...(typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData ? {} : {'Content-Type': 'application/json'}), ...(fetchOptions.headers || {}) }
            });
            let data;
            const responseText = await response.text();
            try { data = responseText ? JSON.parse(responseText) : {}; }
            catch {
                const contentType = response.headers.get('content-type')?.split(';')[0].trim();
                const details = ['HTTP ' + response.status, contentType].filter(Boolean).join(', ');
                const error = new Error('คำตอบจากระบบไม่ถูกต้อง (' + details + ')');
                error.status = response.status;
                error.contentType = contentType;
                throw error;
            }
            if (!response.ok) {
                const error = new Error(data.error?.code || 'ระบบไม่พร้อมใช้งาน');
                error.status = response.status;
                if (response.status === 401 && state?.user) { state = null; notify(); }
                throw error;
            }
            return data;
        } finally { clearTimeout(timer); external?.removeEventListener('abort', abort); }
    }
    function validate(data) {
        if (!data || !Array.isArray(data.grants) || !Array.isArray(data.capabilities)
                || typeof data.csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.csrfToken)
                || data.grants.some(g => !g || !['student', 'coordinator', 'staff', 'executive'].includes(g.role) || typeof g.scopeId !== 'string' || !g.scopeId)
                || data.capabilities.some(c => !c || c.name !== 'manageRoles' || typeof c.scopeId !== 'string' || !c.scopeId) || (data.user !== null &&
                (!data.user || typeof data.user.id !== 'string'))) {
            state = null;
            throw new Error('คำตอบ Session ไม่ถูกต้อง');
        }
        return data;
    }
    async function refresh(options = {}) {
        if (!enabled()) return null;
        // Anonymous state must be bootstrapped again after an expired cookie.
        try { state = validate(await request('/auth/session', options)); }
        catch (error) {
            if (error.status !== 401) { state = null; throw error; }
            state = validate(await request('/auth/session', options));
        }
        return state;
    }
    async function login(username, password, options = {}) {
        await refresh(options);
        state = validate(await request('/auth/login', { ...options, method: 'POST',
            headers: { 'X-CSRF-Token': state.csrfToken },
            body: JSON.stringify({ username, password }) }));
        notify();
        return state;
    }
    async function mutate(path, body, version) {
        const current = await refresh();
        if (!current?.user) throw new Error('AUTH_REQUIRED');
        return request(path, { method: 'PATCH', headers: {
            'X-CSRF-Token': current.csrfToken, 'If-Match': '"' + version + '"'
        }, body: JSON.stringify(body) });
    }
    async function remove(path, version) {
        const current = await refresh();
        if (!current?.user) throw new Error('AUTH_REQUIRED');
        return request(path, { method: 'DELETE', headers: {
            'X-CSRF-Token': current.csrfToken, 'If-Match': '"' + version + '"'
        }, body: '{}' });
    }
    async function create(path, body, idempotencyKey) {
        // The form owns this key: retain it for retries of the SAME submission.
        if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
            throw new Error('INVALID_IDEMPOTENCY_KEY');
        }
        const current = await refresh();
        if (!current?.user) throw new Error('AUTH_REQUIRED');
        return request(path, { method: 'POST', headers: {
            'X-CSRF-Token': current.csrfToken, 'Idempotency-Key': idempotencyKey
        }, body: JSON.stringify(body) });
    }
    async function createPublicFeedback(path, body, idempotencyKey) {
        if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) throw new Error('INVALID_IDEMPOTENCY_KEY');
        const current = await refresh();
        if (!current?.csrfToken) throw new Error('SESSION_UNAVAILABLE');
        return request(path, {method:'POST', headers:{'X-CSRF-Token':current.csrfToken,
            'Idempotency-Key':idempotencyKey}, body:JSON.stringify(body)});
    }
    async function logout() {
        const current = await refresh();
        if (current) await request('/auth/logout', { method: 'POST',
            headers: { 'X-CSRF-Token': current.csrfToken }, body: '{}' });
        state = null;
        notify();
    }
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cstuhub-auth') : null;
    function notify() {
        // BroadcastChannel reaches other tabs; dispatch locally so this tab also clears protected UI.
        window.dispatchEvent(new Event('authchange'));
        channel?.postMessage('changed');
    }
    channel?.addEventListener('message', () => window.dispatchEvent(new Event('authchange')));
    window.CstuAuth = { state: () => state, enabled, refresh, login, logout, request, mutate, remove, create, createPublicFeedback,
        roles: data => [...new Set((data?.grants || []).map(g => g.role))],
        managedScopes: data => [...new Set([
            ...(data?.capabilities || []).filter(c => c.active !== false && c.name === 'manageRoles').map(c => c.scopeId),
            ...(data?.grants || []).filter(g => g.active !== false && g.role === 'executive').map(g => g.scopeId)
        ].filter(Boolean))] };
})();
