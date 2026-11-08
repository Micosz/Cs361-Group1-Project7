const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/assets/feedback.js', 'utf8');
function harness() {
    const calls = [];
    const window = { CstuPublicFeedback: { mount: (...args) => calls.push(args) } };
    vm.runInNewContext(source, { window });
    return { window, calls };
}
// The old private composer was replaced by the shared scoped-comment component.
// Actual create/edit/delete permissions are covered in comment-edit-delete and backend tests.
test('signed-in parent views delegate to scoped comments and preserve hideCreate', async () => {
    for (const kind of ['partners', 'activities', 'exchanges']) {
        const h = harness(), container = {}, parent = { id: 'demo' };
        await h.window.CstuFeedback.mount(container, parent, kind, { user: { id: 'student' } }, { hideCreate: true });
        assert.equal(h.calls.length, 1);
        assert.equal(h.calls[0][0], container);
        assert.equal(h.calls[0][1], parent);
        assert.equal(h.calls[0][2], kind);
        assert.equal(h.calls[0][3].scoped, true);
        assert.equal(h.calls[0][3].hideCreate, true);
    }
});
test('anonymous and unsupported parent views never mount scoped comments', async () => {
    const h = harness();
    await h.window.CstuFeedback.mount({}, { id: 'demo' }, 'exchanges', { user: null });
    await h.window.CstuFeedback.mount({}, { id: 'demo' }, 'unknown', { user: { id: 'staff' } });
    assert.equal(h.calls.length, 0);
});
test('normal scoped view allows the shared component to decide creation permissions', async () => {
    const h = harness();
    await h.window.CstuFeedback.mount({}, { id: 'demo' }, 'activities', { user: { id: 'student' } });
    assert.equal(h.calls[0][3].scoped, true);
    assert.equal(h.calls[0][3].hideCreate, undefined);
});
