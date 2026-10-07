const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require.resolve('../assets/filter-presentation.js'), 'utf8');
function setup() {
    const elements = [];
    class Element {
        constructor(id = '') {
            this.id = id; this.value = ''; this.attributes = {}; this.events = {}; this.children = [];
            this.classList = { add() {}, remove() {} }; elements.push(this);
        }
        closest() { return this.wrapper; }
        setAttribute(name, value) { this.attributes[name] = value; }
        getAttribute(name) { return this.attributes[name]; }
        removeAttribute(name) { delete this.attributes[name]; }
        before(...children) { this.beforeNodes = children; }
        append(...children) { this.children.push(...children); }
        remove() {}
        addEventListener(name, handler) { (this.events[name] ||= []).push(handler); }
        dispatchEvent(event) { this.events[event.type]?.forEach(handler => handler(event)); }
        setCustomValidity(message) { this.validationMessage = message; }
        reportValidity() { this.reported = true; }
        focus() { this.focused = true; }
    }
    const get = id => elements.find(element => element.id === id);
    for (const id of ['filterCollab', 'filterEvent']) {
        const select = new Element(id); select.wrapper = new Element();
        const date = new Element(`${id}Date`); date.setAttribute('aria-label', 'วันที่เริ่มต้น');
        const end = new Element(`${id}DateEnd`); end.setAttribute('aria-label', 'วันที่สิ้นสุด');
        const clear = new Element(`${id}DateClear`);
        let calls = 0;
        date.addEventListener('change', () => { calls++; });
        date.calls = () => calls;
        clear.addEventListener('click', () => { date.value = ''; end.value = ''; });
    }
    vm.runInNewContext(source, {
        AbortController, Event, document: { readyState: 'complete', getElementById: get,
            createElement: () => new Element(), createTextNode: text => text },
        window: { addEventListener() {} }
    });
    return { get, change(id, value) { const input = get(`${id}DateDisplay`); input.value = value; input.dispatchEvent(new Event('change')); return input; } };
}
test('Buddhist dates convert to ISO once and render back in Buddhist years', () => {
    const p = setup(); const text = p.change('filterEvent', '17/08/2563');
    assert.equal(p.get('filterEventDate').value, '2020-08-17');
    assert.equal(text.value, '17/08/2563');
    assert.equal(p.get('filterEventDate').calls(), 1);
    assert.equal(p.get('filterEventDateClear').hidden, false);
});
test('Thai digits and leap years are validated without replacing a valid filter on invalid input', () => {
    const p = setup(); p.change('filterCollab', '๒๙/๐๒/๒๕๖๗');
    assert.equal(p.get('filterCollabDate').value, '2024-02-29');
    const bad = p.change('filterCollab', '29/02/2566');
    assert.ok(bad.validationMessage); assert.equal(bad.reported, true);
    assert.equal(p.get('filterCollabDate').value, '2024-02-29');
    assert.equal(p.get('filterCollabDate').calls(), 1);
});
test('Native date selection syncs Buddhist display; clear hides trash and clears display', () => {
    const p = setup(); const date = p.get('filterEventDate');
    date.value = '2023-08-01'; date.dispatchEvent(new Event('change'));
    assert.equal(p.get('filterEventDateDisplay').value, '01/08/2566');
    p.get('filterEventDateClear').dispatchEvent(new Event('click'));
    assert.equal(p.get('filterEventDateDisplay').value, '');
    assert.equal(p.get('filterEventDateClear').hidden, true);
    assert.equal(p.get('filterEventDateClear').disabled, true);
});
test('Empty text clears only its date and does not change the other tab', () => {
    const p = setup(); p.change('filterCollab', '11/11/2569'); p.change('filterEvent', '17/08/2563');
    p.change('filterEvent', '');
    assert.equal(p.get('filterEventDate').value, '');
    assert.equal(p.get('filterCollabDate').value, '2026-11-11');
    assert.equal(p.get('filterEventDateClear').hidden, true);
});

test('Eight typed digits format immediately and commit as the existing ISO calendar day', () => {
    const p = setup(); const text = p.get('filterEventDateDisplay');
    text.value = '01012549'; text.dispatchEvent(new Event('input'));
    assert.equal(text.value, '01/01/2549');
    assert.equal(p.get('filterEventDate').calls(), 0);
    text.dispatchEvent(new Event('change'));
    assert.equal(p.get('filterEventDate').value, '2006-01-01');
    assert.equal(p.get('filterEventDate').calls(), 1);
});
test('Compact pasted Thai digits and whitespace normalize on commit', () => {
    const p = setup(); const text = p.change('filterCollab', ' ๑๗๐๘๒๕๖๓ ');
    assert.equal(text.value, '17/08/2563');
    assert.equal(p.get('filterCollabDate').value, '2020-08-17');
});
test('Partial typing stays editable and invalid compact dates preserve the applied filter', () => {
    const p = setup(); p.change('filterEvent', '01012549');
    const text = p.get('filterEventDateDisplay');
    text.value = '01012'; text.dispatchEvent(new Event('input'));
    assert.equal(text.value, '01012');
    p.change('filterEvent', '31022549');
    assert.ok(text.validationMessage);
    assert.equal(p.get('filterEventDate').value, '2006-01-01');
    assert.equal(p.get('filterEventDate').calls(), 1);
});
test('Compact dates validate leap days after Buddhist-to-Gregorian conversion', () => {
    const p = setup(); p.change('filterCollab', '29022567');
    assert.equal(p.get('filterCollabDate').value, '2024-02-29');
    p.change('filterCollab', '29022566');
    assert.ok(p.get('filterCollabDateDisplay').validationMessage);
    assert.equal(p.get('filterCollabDate').value, '2024-02-29');
});

test('End date uses the Buddhist adapter and keeps clear visible for either bound', () => {
    const p = setup(); const end = p.get('filterEventDateEndDisplay');
    end.value = '31122569'; end.dispatchEvent(new Event('input')); end.dispatchEvent(new Event('change'));
    assert.equal(end.value, '31/12/2569');
    assert.equal(p.get('filterEventDateEnd').value, '2026-12-31');
    assert.equal(p.get('filterEventDateClear').hidden, false);
    p.get('filterEventDateClear').dispatchEvent(new Event('click'));
    assert.equal(p.get('filterEventDateDisplay').value, '');
    assert.equal(end.value, '');
    assert.equal(p.get('filterEventDateClear').hidden, true);
});
