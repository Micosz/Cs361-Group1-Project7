const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/assets/script.js', 'utf8');
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
    return { load: () => context.fetchPartnersData(), nodes };
}
const response = rows => ({ ok: true, json: async () => rows });
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
test('additional API outage labels live results as incomplete', async () => {
    const app = harness(async url => {
        if (url === '/api/public/records') throw new Error('unavailable');
        return response([{ id: 'p1', name: 'Example', visibility: 'public' }]);
    }, true);
    assert.equal((await app.load()).length, 1);
    assert.equal(app.nodes.get('partialDataNotice').hidden, false);
    assert.match(app.nodes.get('partialDataNotice').textContent, /โหลดข้อมูลได้ไม่ครบ/);
});
