const { test } = require('node:test');
const assert = require('node:assert/strict');
const code = import('../../../backend/lambda/tuAuthLogin/index.mjs');
const env = { TU_APP_KEY: 'synthetic-key' };
const input = { UserName: 'student', PassWord: 'synthetic-password' };
const response = (data, status = 200, retry = null) => ({ status, ok: status >= 200 && status < 300, json: async () => data, headers: { get: () => retry } });
const event = body => ({ httpMethod: 'POST', body: JSON.stringify(body) });
test('verified TU profile is allowlisted and credentials go only to official endpoint', async () => {
    const { createHandler } = await code;
    let request;
    const handler = createHandler({ env, fetchImpl: async (url, options) => {
        request = { url, options };
        return response({ status: true, type: 'student', email: 'demo@example.test', roles: ['admin'], secret: 'hidden' });
    } });
    const result = await handler(event(input)), body = JSON.parse(result.body);
    assert.equal(result.statusCode, 200);
    assert.equal(new URL(request.url).origin, 'https://restapi.tu.ac.th');
    assert.equal(request.options.redirect, 'error');
    assert.deepEqual(JSON.parse(request.options.body), input);
    assert.equal(request.options.headers['Application-Key'], env.TU_APP_KEY);
    assert.deepEqual(Object.keys(body.user).sort(), ['displayname_en','displayname_th','email','type','username']);
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.ok(!result.body.includes(input.PassWord));
});
test('invalid input, methods, preflight and unsafe config do not call TU', async () => {
    const { createHandler } = await code;
    const fetchImpl = async () => { throw Error('must not call'); };
    const handler = createHandler({ env, fetchImpl });
    assert.equal((await handler({ httpMethod:'OPTIONS' })).statusCode, 200);
    assert.equal((await handler({ httpMethod:'GET' })).statusCode, 405);
    assert.equal((await handler({ httpMethod:'POST',body:'{' })).statusCode, 400);
    for (const body of [null, {}, { ...input, PassWord:'' }, { ...input, UserName:'x'.repeat(129) }]) assert.equal((await handler(event(body))).statusCode,400);
    for (const badEnv of [{}, { ...env, TU_AUTH_URL:'https://example.test/steal' },{TU_APP_KEY:'bad\nkey'}]) {
        const result = await createHandler({ env:badEnv, fetchImpl })(event(input));
        assert.equal(result.statusCode,503);
    }
});
test('TU denial, malformed profile and upstream errors map to stable responses', async () => {
    const { createHandler } = await code;
    for (const [reply, status, expected] of [
        [response({status:false}),401,'INVALID_CREDENTIALS'],
        [response({status:true,type:'admin'}),502,'AUTH_PROVIDER_INVALID_RESPONSE'],
        [response({},401),503,'AUTH_CONFIGURATION_UNAVAILABLE'],
        [response({},500),503,'AUTH_PROVIDER_UNAVAILABLE'],
        [{...response({}),json:async()=>{throw Error('private provider response');}},502,'AUTH_PROVIDER_INVALID_RESPONSE']
    ]) {
        const result = await createHandler({env,fetchImpl:async()=>reply})(event(input));
        assert.equal(result.statusCode,status); assert.equal(JSON.parse(result.body).code,expected);
        assert.ok(!result.body.includes('private provider'));
    }
});
test('rate limit clamps retry and timeout aborts without hanging', async () => {
    const { createHandler,createTuAuthenticator } = await code;
    const result = await createHandler({env,fetchImpl:async()=>response({},429,'9999')})(event(input));
    assert.equal(result.statusCode,429); assert.equal(result.headers['Retry-After'],'300');
    let signal;
    const auth = createTuAuthenticator({env,timeoutMs:5,fetchImpl:async(_url,options)=>{signal=options.signal;return new Promise(()=>{});}});
    await assert.rejects(auth(input), error=>error.code==='AUTH_PROVIDER_UNAVAILABLE');
    assert.equal(signal.aborted,true);
});
