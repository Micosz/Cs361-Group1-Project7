const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('public/assets/auth-client.js', 'utf8');
function setup(fetch, enabled = true) {
    const window = new EventTarget();
    window.CSTU_AUTH_CONFIG = { enabled };
    vm.runInNewContext(source, { window, fetch, AbortController, setTimeout, clearTimeout, Event,
        localStorage: { setItem() { throw Error('Credential storage forbidden'); } },
        sessionStorage: { setItem() { throw Error('Credential storage forbidden'); } } });
    return window.CstuAuth;
}
const state = user => ({ user, grants: user ? [{role:'student',scopeId:'cs-demo'}] : [],
    capabilities: [], csrfToken: 'a'.repeat(64) });
const ok = data => ({ ok: true, json: async () => data });
test('disabled auth makes no API requests and keeps existing site available', async () => {
    const auth = setup(() => { throw Error('Unexpected request'); }, false);
    assert.equal(auth.enabled(), false);
    assert.equal(await auth.refresh(), null);
});
test('login/logout use same-origin cookie and in-memory CSRF; no token/profile storage', async () => {
    const calls = [];
    const auth = setup(async (url, options) => {
        calls.push({url,options});
        return ok(url.endsWith('/login') ? state({id:'u1'}) : url.endsWith('/logout') ? {ok:true} : state(null));
    });
    const result = await auth.login('fixture', 'synthetic-password');
    assert.equal(result.user.id, 'u1');
    assert.deepEqual(Array.from(auth.roles(result)), ['student']);
    const login = calls.find(c => c.url.endsWith('/login'));
    assert.equal(login.options.credentials, 'same-origin');
    assert.equal(login.options.headers['X-CSRF-Token'], 'a'.repeat(64));
    assert.deepEqual(JSON.parse(login.options.body), {username:'fixture',password:'synthetic-password'});
    assert.equal(login.options.headers.Authorization, undefined);
    await auth.logout();
    assert.equal(calls.at(-1).url, '/api/auth/logout');
});
test('malformed session never becomes authenticated; pagehide abort cancels login request', async () => {
    const invalid = setup(async () => ok({success:true,user:{id:'forged'}}));
    await assert.rejects(() => invalid.refresh(), /Session/);
    const controller = new AbortController();
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const auth = setup(async (url, options) => {
        if (url.endsWith('/session')) return ok(state(null));
        started();
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => {
            const error = new Error('Aborted'); error.name = 'AbortError'; reject(error);
        }));
    });
    const pending = auth.login('fixture','synthetic-password',{signal:controller.signal});
    await ready; controller.abort();
    await assert.rejects(pending, {name:'AbortError'});
});
