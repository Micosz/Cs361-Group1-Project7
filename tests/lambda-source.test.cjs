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
  const DynamoDBDocumentClient = { from() { return { send: async command => {
    assert.equal(command.input.TableName, 'Partner');
    if (options.failure) throw new Error('synthetic AWS outage');
    return { Items: options.items || [] };
  } }; } };
  const context = vm.createContext({ console: silentConsole, process: { env: options.env || {} },
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
  return module.namespace.handler;
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

test('both data functions retain their error response', async () => {
  for (const name of ['fetchPartnersData', 'getPublicPartners']) {
    const result = await (await load(name, { failure: true }))({});
    assert.equal(result.statusCode, 500);
    assert.deepEqual(JSON.parse(result.body), { message: 'Internal Server Error' });
  }
});

test('getPublicPartners loads as CommonJS and retains original field mapping', async () => {
  const result = await (await load('getPublicPartners', { items: [
    { id: 'p1', name: 'Demo', access_level: 'internal', coordinators: ['demo'], hidden: 'omit' },
  ] }))({});
  assert.equal(result.statusCode, 200);
  const data = JSON.parse(result.body);
  // Preserve current mapping behavior; changing its publication rule is outside CI/CD.
  assert.equal(data[0].access_level, 'internal');
  assert.deepEqual(data[0].coordinators, ['demo']);
  assert.equal(data[0].hidden, undefined);
  assert.equal(result.headers['Access-Control-Allow-Methods'], 'GET');
});

test('tuAuthLogin OPTIONS and input failures make no TU requests', async () => {
  const handler = await load('tuAuthLogin');
  assert.equal((await handler({ httpMethod: 'OPTIONS' })).statusCode, 200);
  assert.equal((await handler({})).statusCode, 400);
  assert.equal((await handler({ body: '{}' })).statusCode, 400);
  assert.equal((await handler({ body: 'malformed' })).statusCode, 500);
  assert.equal((await handler({ body: JSON.stringify({ UserName: 'fixture', PassWord: 'fixture' }) })).statusCode, 500);
});

test('tuAuthLogin checks provider body status and never returns input password/key', async () => {
  const request = { body: JSON.stringify({ UserName: 'fixture', PassWord: 'fixture-password' }) };
  for (const status of [true, false, 'true']) {
    const handler = await load('tuAuthLogin', { env: { TU_APP_KEY: 'fixture-key' },
      fetch: async (url, init) => {
        assert.equal(url, 'https://restapi.tu.ac.th/api/v1/auth/Ad/verify2');
        assert.equal(init.headers['Application-Key'], 'fixture-key');
        return { ok: true, json: async () => ({ status, type: 'student' }) };
      } });
    const result = await handler(request);
    assert.equal(result.statusCode, status === true ? 200 : 401);
    assert.equal(result.body.includes('fixture-password'), false);
    assert.equal(result.body.includes('fixture-key'), false);
  }
});

test('tuAuthLogin retains provider unavailable behavior', async () => {
  const handler = await load('tuAuthLogin', { env: { TU_APP_KEY: 'fixture-key' },
    fetch: async () => ({ ok: false }) });
  const result = await handler({ body: JSON.stringify({ UserName: 'fixture', PassWord: 'fixture' }) });
  assert.equal(result.statusCode, 502);
});
