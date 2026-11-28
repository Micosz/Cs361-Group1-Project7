const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/assets/script.js', 'utf8');
const authSource = fs.readFileSync('public/assets/auth-client.js', 'utf8');
function harness(fetch, enabled = false) {
    const nodes = new Map();
    const context = vm.createContext({
        fetch, AbortController, setTimeout, clearTimeout,
        console: { warn() {}, error() {} },
        window: { CSTU_AUTH_CONFIG: { enabled }, addEventListener() {} },
        document: {
            addEventListener() {}, getElementById: id => nodes.get(id),
            createElement: () => ({ style: {}, setAttribute() {} }),
            body: { prepend: node => nodes.set(node.id, node) }
        }
    });
    vm.runInContext(source, context);
    return {
        load: () => context.fetchPartnersData(),
        detail: (type, id) => context.fetchPublicDetail(type, id),
        invalidate: () => context.window.invalidatePublicData(),
        nodes
    };
}
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
test('API failure rejects without static requests; next attempt recovers and caches success', async () => {
    const urls = [];
    let failed = true;
    const app = harness(async url => {
        urls.push(url);
        if (failed) throw new Error('offline');
        return response([{ id: 'p1', name: 'Example', visibility: 'public' }]);
    });
    await assert.rejects(app.load(), /offline/);
    assert.deepEqual(urls, ['/fetchPartnersData']);
    failed = false;
    assert.equal((await app.load())[0].id, 'p1');
    await app.load();
    assert.deepEqual(urls, ['/fetchPartnersData', '/fetchPartnersData']);
});
test('empty API result is successful and does not request a backup', async () => {
    const urls = [];
    const app = harness(async url => { urls.push(url); return response([]); });
    assert.equal((await app.load()).length, 0);
    assert.deepEqual(urls, ['/fetchPartnersData']);
});
test('Welcome loads a single unified card-list API and fetches full detail only on demand', async () => {
    const urls = [];
    const app = harness(async url => {
        urls.push(url);
        if (url === '/api/public/records?view=cards') {
            return response([
                { id: 'p1', name: 'Partner One', type: 'company', summary: 'Card summary', visibility: 'public' },
                { id: 'a1', title: 'Activity One', type: 'event', partnerId: 'p1', partnerName: 'Partner One', visibility: 'public' }
            ]);
        }
        if (url === '/api/public/partners/p1') {
            return response({ data: { id: 'p1', name: 'Partner One', full_description: 'Loaded on click', website_url: 'https://one.example', visibility: 'public' } });
        }
        if (url === '/api/public/activities/a1') {
            return response({ error: { code: 'NOT_FOUND' } }, 404);
        }
        throw new Error('Unexpected URL: ' + url);
    }, true);
    const partners = await app.load();
    assert.equal(partners.length, 1);
    assert.equal(partners[0].collaborations.length, 1);
    // Strictly one list API call; no /fetchPartnersData and no detail call on initial load.
    assert.deepEqual(urls, ['/api/public/records?view=cards']);

    // Opening a card fetches detail once and caches it until invalidated.
    const detail = await app.detail('partner', 'p1');
    assert.equal(detail.full_description, 'Loaded on click');
    assert.equal(detail.website_url, 'https://one.example');
    await app.detail('partner', 'p1');
    assert.deepEqual(urls, ['/api/public/records?view=cards', '/api/public/partners/p1']);

    // Unpublished record detail rejects with 404 rather than silently returning stale content.
    await assert.rejects(app.detail('activity', 'a1'), err => err.status === 404);

    // Invalidating public data clears both list and detail caches.
    app.invalidate();
    await app.detail('partner', 'p1');
    assert.equal(urls.filter(u => u === '/api/public/partners/p1').length, 2);
});
test('CstuAuth.refresh deduplicates concurrent startup calls without caching stale sessions', async () => {
    let calls = 0;
    let releaseFirst;
    const csrf = 'a'.repeat(64);
    const context = vm.createContext({
        AbortController, setTimeout, clearTimeout,
        Event: class { constructor(type) { this.type = type; } },
        window: { CSTU_AUTH_CONFIG: { enabled: true }, dispatchEvent() {} },
        fetch: async url => {
            calls++;
            assert.equal(url, '/api/auth/session');
            if (calls === 1) await new Promise(resolve => { releaseFirst = resolve; });
            return {
                ok: true, status: 200,
                headers: { get: () => 'application/json' },
                text: async () => JSON.stringify({ user: null, grants: [], capabilities: [], csrfToken: csrf })
            };
        }
    });
    vm.runInContext(authSource, context);
    const simultaneous = Promise.all([
        context.window.CstuAuth.refresh(),
        context.window.CstuAuth.refresh(),
        context.window.CstuAuth.refresh(),
        context.window.CstuAuth.refresh()
    ]);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls, 1);
    releaseFirst();
    const results = await simultaneous;
    assert.equal(results.length, 4);
    assert.equal(results[0].csrfToken, csrf);
    // Subsequent refresh after completion still hits the server freshly.
    await context.window.CstuAuth.refresh();
    assert.equal(calls, 2);
});
