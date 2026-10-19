// Offline checks against actual source; every AWS/TU dependency is a test double.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const directory = path.join(__dirname, '../backend/lambda');
const silentConsole = { error() {}, log() {} };

async function load(name, options = {}) {
  const filename = name === 'getPublicPartners' ? 'index.cjs' : 'index.mjs';
  const source = fs.readFileSync(path.join(directory, name, filename), 'utf8');
  class DynamoDBClient {}
  class ScanCommand { constructor(input) { this.input = input; } }
  let scanPage = 0;
  const DynamoDBDocumentClient = { from() { return { send: async command => {
    assert.equal(command.input.TableName, 'Partner');
    if (options.failure) throw new Error('synthetic AWS outage');
    if (options.pages) return options.pages[scanPage++];
    return { Items: options.items || [] };
  } }; } };
  const context = vm.createContext({ console: options.console || silentConsole, URL, AbortController, setTimeout, clearTimeout, process: { env: options.env || {} },
                                    fetch: options.fetch || (() => { throw new Error('Unexpected network call'); }) });
  if (filename.endsWith('.cjs')) {
    context.exports = {};
    context.require = name => {
      if (name === '@aws-sdk/client-dynamodb') return { DynamoDBClient };
      if (name === '@aws-sdk/lib-dynamodb') return { DynamoDBDocumentClient, ScanCommand };
      throw new Error('Unexpected dependency');
    };
    vm.runInContext(source, context, { filename });
    return context.exports.handler;
  }
  const module = new vm.SourceTextModule(source, { context, identifier: filename });
  await module.link(async specifier => {
    const exports = specifier === '@aws-sdk/client-dynamodb' ? { DynamoDBClient }
                  : specifier === '@aws-sdk/lib-dynamodb' ? { DynamoDBDocumentClient, ScanCommand }
                  : null;
    if (!exports) throw new Error('Unexpected dependency');
    return new vm.SyntheticModule(Object.keys(exports), function() {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return options.factory ? module.namespace.createHandler(options.factory) : module.namespace.handler;
}

test('fetchPartnersData retains existing publication filter, response and CORS', async () => {
  const handler = await load('fetchPartnersData', { items: [
    { id: 'p1', access_level: 'public' }, { id: 'a1', visibility: 'public' }, { id: 'private' },
  ] });
  const result = await handler({});
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body).map(r => r.id), ['p1', 'a1']);
  assert.equal(result.headers['Access-Control-Allow-Methods'], 'OPTIONS,GET');
});

const publicPartner = (id, extra = {}) => ({ id, entityType: 'partner', schemaVersion: 3,
  scopeId: 'scope-a', name: id, publication: 'public', ...extra });
const publicActivity = (extra = {}) => ({ id: 'activity-a', entityType: 'activity', schemaVersion: 3,
  scopeId: 'scope-a', title: 'Public event', publication: 'public', partnerId: 'host',
  partnerName: 'stale-private-label', co_hosts: ['stale-private-cohost'], ...extra });

test('public catalog hides an activity after its primary partner becomes private', async () => {
  for (const host of [publicPartner('host', { publication: 'internal' }),
    publicPartner('host', { scopeId: 'scope-b' }), publicPartner('host', { source_state: 'retired' }), null]) {
    const handler = await load('fetchPartnersData', { items: [publicActivity(), ...(host ? [host] : [])] });
    const rows = JSON.parse((await handler({})).body);
    assert.equal(rows.some(row => row.id === 'activity-a'), false);
    assert.equal(JSON.stringify(rows).includes('stale-private'), false);
  }
});

test('public catalog rebuilds host labels and excludes private cohosts and nested values', async () => {
  const handler = await load('fetchPartnersData', { items: [
    publicPartner('host', { name: 'Current public host' }), publicPartner('visible'),
    publicPartner('hidden', { publication: 'internal' }),
    publicPartner('other-scope', { scopeId: 'scope-b' }),
    publicActivity({ coHostPartnerIds: ['visible', 'hidden', 'other-scope', 'missing'],
      summary: { internalNote: 'private-object' }, coordinators: [{ email: 'private-email' }],
      agreementIds: ['private-agreement'], responsibleUserIds: ['private-user'] }),
  ] });
  const rows = JSON.parse((await handler({})).body);
  const event = rows.find(row => row.id === 'activity-a');
  assert.equal(event.partnerName, 'Current public host');
  assert.deepEqual(event.co_hosts, ['visible']);
  for (const field of ['summary', 'coordinators', 'agreementIds', 'responsibleUserIds']) {
    assert.equal(event[field], undefined);
  }
  assert.equal(JSON.stringify(rows).includes('stale-private'), false);
});

test('public catalog keeps valid legacy host links but never trusts cached cohost names', async () => {
  const handler = await load('fetchPartnersData', { items: [
    { id: 'host', name: 'Legacy public host', access_level: 'public' },
    { id: 'legacy-event', partnerId: 'host', visibility: 'public', co_hosts: ['unverified'] },
    publicPartner('retired', { source_state: 'retired' }),
    { id: 'wrong-kind', entityType: 'contact', publication: 'public', name: 'Private contact' },
  ] });
  const rows = JSON.parse((await handler({})).body);
  assert.deepEqual(rows.map(row => row.id), ['host', 'legacy-event']);
  assert.deepEqual(rows[1].co_hosts, []);
  assert.equal(rows[1].partnerName, 'Legacy public host');
});

test('public catalog fails closed for ambiguous partners and malformed v3 links', async () => {
  for (const items of [
    [publicPartner('host'), publicPartner('host', { publication: 'internal' }), publicActivity()],
    [publicPartner('host'), publicActivity({ scopeId: undefined })],
    [publicPartner('host'), publicActivity({ coHostPartnerIds: ['visible', 'visible'] })],
  ]) {
    const rows = JSON.parse((await (await load('fetchPartnersData', { items }))({})).body);
    assert.equal(rows.some(row => row.id === 'activity-a'), false);
  }
});

test('both data functions retain their error response', async () => {
  for (const name of ['fetchPartnersData', 'getPublicPartners']) {
    const result = await (await load(name, { failure: true }))({});
    assert.equal(result.statusCode, 500);
    assert.deepEqual(JSON.parse(result.body), { message: 'Internal Server Error' });
  }
});

test('getPublicPartners loads as CommonJS and retains original field mapping', async () => {
  const result = await (await load('getPublicPartners', { items: [
    { id: 'p1', name: 'Demo', access_level: 'public', coordinators: ['demo'], hidden: 'omit' },
  ] }))({});
  assert.equal(result.statusCode, 200);
  const data = JSON.parse(result.body);
  // Preserve current mapping behavior; changing its publication rule is outside CI/CD.
  assert.equal(data[0].access_level, 'public');
  assert.deepEqual(data[0].coordinators, ['demo']);
  assert.equal(data[0].hidden, undefined);
  assert.equal(result.headers['Access-Control-Allow-Methods'], 'GET');
});

const tuEnv = { TU_APP_KEY: 'fixture-key', TU_AUTH_URL: 'https://restapi.tu.ac.th/api/v1/auth/Ad/verify2' };
const request = { httpMethod: 'POST', body: JSON.stringify({ UserName: 'fixture', PassWord: 'fixture-password' }) };
const provider = (body, status = 200, retryAfter = null) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => retryAfter }, json: async () => body,
});

test('tuAuthLogin validates input/config before calling TU; preflight stays available', async () => {
  const handler = await load('tuAuthLogin');
  assert.equal((await handler({ httpMethod: 'OPTIONS' })).statusCode, 200);
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 405);
  for (const body of [undefined, '{}', 'malformed', 'null', '{"UserName":1,"PassWord":"x"}']) {
    assert.equal((await handler({ body })).statusCode, 400);
  }
  for (const env of [{}, { TU_AUTH_URL: tuEnv.TU_AUTH_URL },
    { ...tuEnv, TU_AUTH_URL: 'https://example.invalid/auth' },
    { ...tuEnv, TU_AUTH_URL: tuEnv.TU_AUTH_URL + '?key=unsafe' }]) {
    const result = await (await load('tuAuthLogin', { env }))(request);
    assert.equal(result.statusCode, 503);
    assert.equal(JSON.parse(result.body).code, 'AUTH_CONFIGURATION_UNAVAILABLE');
  }
});

test('TU student/employee succeeds using server config and ignores browser roles/type/id', async () => {
  for (const [type, env, expectedUrl] of [
    ['student', { TU_APP_KEY: tuEnv.TU_APP_KEY }, tuEnv.TU_AUTH_URL],
    ['student', { ...tuEnv, TU_AUTH_URL: '' }, tuEnv.TU_AUTH_URL],
    ['employee', { ...tuEnv, TU_AUTH_URL: 'https://restapi.tu.ac.th/test-fixture-auth' },
      'https://restapi.tu.ac.th/test-fixture-auth'],
  ]) {
    let calls = 0;
    const handler = await load('tuAuthLogin', { env,
      fetch: async (url, init) => {
        calls++;
        assert.equal(url, expectedUrl);
        assert.equal(init.method, 'POST');
        assert.equal(init.redirect, 'error');
        assert.equal(init.headers['Content-Type'], 'application/json');
        assert.equal(init.headers['Application-Key'], 'fixture-key');
        assert.deepEqual(JSON.parse(init.body), { UserName: 'fixture', PassWord: 'fixture-password' });
        return provider({ status: true, type, displayname_th: 'ชื่อ', email: 'fixture@tu.ac.th',
          department: 'Executive', password: 'provider-private', role: 'executive' });
      } });
    const result = await handler({ ...request, body: JSON.stringify({ ...JSON.parse(request.body),
      type: 'student', role: 'executive', userId: 'forged' }) });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), { success: true, message: 'Login successful', user: {
      username: 'fixture', type, displayname_th: 'ชื่อ', displayname_en: '', email: 'fixture@tu.ac.th',
    } });
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(calls, 1);
  }
});

test('TU false rejects credentials; malformed status/type/profile never authenticates', async () => {
  const cases = [
    [{ status: false, message: 'provider-private' }, 401, 'INVALID_CREDENTIALS'],
    ...[null, [], {}, { status: 'true', type: 'student' }, { status: true },
      { status: true, type: 'unknown' }, { status: true, type: 'employee', email: {} }]
      .map(body => [body, 502, 'AUTH_PROVIDER_INVALID_RESPONSE']),
  ];
  for (const [body, status, code] of cases) {
    const result = await (await load('tuAuthLogin', { env: tuEnv, fetch: async () => provider(body) }))(request);
    assert.equal(result.statusCode, status);
    assert.deepEqual(JSON.parse(result.body).success, false);
    assert.equal(JSON.parse(result.body).code, code);
    assert.equal(JSON.parse(result.body).user, undefined);
    assert.equal(result.body.includes('provider-private'), false);
  }
});

test('TU HTTP/config/quota/network/JSON errors are bounded, sanitized and never retried', async () => {
  const cases = [
    [async () => provider({}, 401), 503, 'AUTH_CONFIGURATION_UNAVAILABLE'],
    [async () => provider({}, 403), 503, 'AUTH_CONFIGURATION_UNAVAILABLE'],
    [async () => provider({}, 400), 502, 'AUTH_PROVIDER_INVALID_RESPONSE'],
    [async () => provider({}, 503), 503, 'AUTH_PROVIDER_UNAVAILABLE'],
    [async () => provider({}, 429, '99999'), 429, 'RATE_LIMITED', '300'],
    [async () => provider({}, 429, 'unsafe'), 429, 'RATE_LIMITED', '60'],
    [async () => { throw new Error('fixture-key fixture-password provider-private'); }, 503, 'AUTH_PROVIDER_UNAVAILABLE'],
    [async () => ({ ok: true, status: 200, json: async () => { throw new Error('provider-private'); } }),
      502, 'AUTH_PROVIDER_INVALID_RESPONSE'],
  ];
  for (const [fetchImpl, status, code, retryAfter] of cases) {
    let calls = 0;
    const logs = [];
    const result = await (await load('tuAuthLogin', { env: tuEnv,
      console: { error: (...args) => logs.push(args.join(' ')) },
      fetch: (...args) => { calls++; return fetchImpl(...args); } }))(request);
    assert.equal(result.statusCode, status);
    assert.equal(JSON.parse(result.body).code, code);
    assert.equal(result.headers['Retry-After'], retryAfter);
    assert.equal(calls, 1);
    for (const secret of ['fixture-key', 'fixture-password', 'provider-private']) {
      assert.equal(JSON.stringify([result, logs]).includes(secret), false);
    }
  }
});

test('TU deadline covers fetching and body reading, aborts and does not retry', async () => {
  for (const hangOnBody of [false, true]) {
    let signal, calls = 0;
    const handler = await load('tuAuthLogin', { factory: { env: tuEnv, timeoutMs: 10,
      fetchImpl: async (_, init) => {
        calls++;
        signal = init.signal;
        if (hangOnBody) return { ok: true, status: 200, json: () => new Promise(() => {}) };
        return new Promise(() => {});
      } } });
    const result = await handler(request);
    assert.equal(result.statusCode, 503);
    assert.equal(JSON.parse(result.body).code, 'AUTH_PROVIDER_UNAVAILABLE');
    assert.equal(signal.aborted, true);
    assert.equal(calls, 1);
  }
});


test('public relationships resolve partners across all DynamoDB scan pages', async () => {
  const handler = await load('fetchPartnersData', { pages: [
    { Items: [publicActivity()], LastEvaluatedKey: { id: 'cursor' } },
    { Items: [publicPartner('host', { name: 'Host on next page' })] },
  ] });
  const rows = JSON.parse((await handler({})).body);
  assert.equal(rows.find(row => row.id === 'activity-a').partnerName, 'Host on next page');
});


test('retired composite-key predecessor does not hide the active partner relationships', async () => {
  for (const reversed of [false, true]) {
    const hosts = [publicPartner('host', { source_state: 'retired', name: 'Retired name' }),
      publicPartner('host', { name: 'Active name' })];
    if (reversed) hosts.reverse();
    const rows = JSON.parse((await (await load('fetchPartnersData', {
      items: [...hosts, publicActivity()],
    }))({})).body);
    assert.equal(rows.find(row => row.id === 'activity-a').partnerName, 'Active name');
    assert.equal(rows.filter(row => row.id === 'host').length, 1);
  }
});
