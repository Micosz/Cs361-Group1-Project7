const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(kind = 'exchange') {
    const node = tag => ({tag, children: [], attributes: {}, value: '', disabled: false, isConnected: true,
        append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); return item; },
        replaceChildren(...items) { this.children = items; }, setAttribute(key, value) { this.attributes[key] = value; }});
    const container = node('section'), calls = [], payloads = [], keys = [];
    let uuid = 0;
    class MockFormData {
        constructor() { this.entries = []; payloads.push(this); }
        append(...args) { this.entries.push(args); }
    }
    const auth = {
        request: async (path, options) => {
            calls.push([path, options]);
            if (options?.method === 'POST') { keys.push(options.headers['Idempotency-Key']); return {data: {id: 'd1'}}; }
            return {data: [], page: {nextCursor: null}};
        },
        refresh: async () => ({csrfToken: 'csrf', grants: [{role: 'staff', scopeId: 'cs-demo'}]})
    };
    const context = {
        document: {createElement: node, createTextNode: text => ({tag: '#text', textContent: text, children: []})},
        window: {CstuAuth: auth, URL: {createObjectURL: () => 'blob:preview', revokeObjectURL() {}}},
        FormData: MockFormData, crypto: {randomUUID: () => `key-${++uuid}`}
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('public/assets/documents.js', 'utf8'), context);
    return {container, calls, payloads, keys, context, kind};
}

const walk = node => [node, ...(node.children || []).flatMap(walk)];
const file = (name, type = 'application/pdf', size = 1024, lastModified = 1) => ({name, type, size, lastModified});

test('Exchange queues multiple files as private by default and submits each file audience independently', async () => {
    const s = setup();
    await s.context.window.DocumentComponent.mount(s.container, s.kind, {id: 'ex1', scopeId: 'cs-demo'});
    const nodes = walk(s.container), chooser = nodes.find(n => n.tag === 'input' && n.type === 'file');
    assert.equal(chooser.multiple, true);
    chooser.files = [file('internal.pdf'), file('participants.png', 'image/png', 2048, 2)];
    chooser.onchange();
    let rows = walk(s.container).filter(n => n.className === 'document-upload-item');
    assert.equal(rows.length, 2);
    const selects = rows.map(row => walk(row).find(n => n.tag === 'select'));
    assert.deepEqual(selects.map(select => select.value), ['internal', 'internal']);
    assert.ok(walk(rows[0]).some(n => n.textContent === 'internal.pdf'));
    assert.ok(walk(rows[1]).some(n => n.tag === 'img' && n.src === 'blob:preview'));

    selects[1].value = 'participants'; selects[1].onchange();
    const personal = walk(rows[1]).find(n => n.tag === 'input' && n.type === 'checkbox');
    assert.equal(personal.disabled, false);
    personal.checked = true; personal.onchange();
    selects[1].value = 'internal'; selects[1].onchange();
    assert.equal(personal.checked, false);
    assert.equal(personal.disabled, true);
    selects[1].value = 'participants'; selects[1].onchange();
    personal.checked = true; personal.onchange();
    const form = walk(s.container).find(n => n.tag === 'form');
    await form.onsubmit({preventDefault() {}});
    const posts = s.calls.filter(([, options]) => options?.method === 'POST');
    assert.equal(posts.length, 2);
    assert.deepEqual(s.payloads.map(body => Object.fromEntries(body.entries.map(([key, value]) => [key, key === 'file' ? value.name : value]))), [
        {file: 'internal.pdf', displayName: 'internal.pdf', audience: 'internal', containsPersonal: 'false'},
        {file: 'participants.png', displayName: 'participants.png', audience: 'participants', containsPersonal: 'true'}
    ]);
    assert.equal(new Set(s.keys).size, 2);
    assert.equal(walk(s.container).filter(n => n.className === 'document-upload-item').length, 0);
});

test('Agreement documents keep an internal-only audience choice', async () => {
    const s = setup('agreement');
    await s.context.window.DocumentComponent.mount(s.container, s.kind, {id: 'ag1', scopeId: 'cs-demo'});
    const chooser = walk(s.container).find(n => n.tag === 'input' && n.type === 'file');
    chooser.files = [file('agreement.pdf')]; chooser.onchange();
    const select = walk(s.container).find(n => n.tag === 'select');
    assert.deepEqual(walk(select).filter(n => n.tag === 'option').map(option => option.value), ['internal']);
});
