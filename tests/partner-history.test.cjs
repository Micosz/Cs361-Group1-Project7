const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup() {
    const ctx = {window: {}, document: {addEventListener() {}, createElement(tag) {
        return {tag, children: [], append(...nodes) {this.children.push(...nodes);}, appendChild(node) {this.children.push(node);}, addEventListener(event, handler) {this[event] = handler;}};
    }}};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(require.resolve('../public/assets/script.js'), 'utf8'), ctx);
    return ctx;
}
const event = (id, date, extra = {}) => ({id, title: id, partnerId: 'p1', visibility: 'public', period_date: date, ...extra});
test('history orders real dates, ties by ID, deduplicates and leaves invalid/unknown dates last', () => {
    const ctx = setup();
    const rows = [event('z', null), event('b', '2026-10-11'), event('a', '2026-10-11'), event('old', '2025-08-28'), event('bad', '2026-02-30'), event('a', '2026-10-11')];
    const result = ctx.buildPartnerActivityHistory('p1', rows);
    assert.deepEqual(Array.from(result, x => x.sourceId), ['a','b','old','bad','z']);
    assert.equal(result[2].dateLabel, '28 ส.ค. 68');
    assert.equal(result[3].date, null);
    assert.deepEqual(Array.from(ctx.buildPartnerActivityHistory('p1', [])), []);
    assert.equal(rows.length, 6);
});
test('history uses stable primary/co-host IDs and rejects private/conflicting/unclassified/agreement sources', () => {
    const ctx = setup();
    const rows = [event('primary', '2026-01-01'), event('cohost', null, {partnerId:'p2', coHostPartnerIds:['p1']}),
        event('name-only', null, {partnerId:'p2', co_hosts:['p1']}), event('substring', null, {partnerId:'p2', coHostPartnerIds:'p1-extra'}),
        event('private', null, {visibility:'private'}), event('conflicting', null, {publication:'internal'}),
        event('unknown', null, {visibility:undefined}), event('agreement', null, {entityType:'agreement'})];
    assert.deepEqual(Array.from(ctx.buildPartnerActivityHistory('p1', rows), x => x.sourceId), ['primary','cohost']);
});
test('rendered history uses text and existing detail action; empty history has a clear message', () => {
    const ctx = setup();
    const container = ctx.document.createElement('section');
    let opened;
    ctx.openModal = (id, kind) => {opened = {id, kind};};
    ctx.renderPartnerActivityHistory(container, 'p1', [event('x', '2026-10-11', {title:'<img onerror=alert(1)>'})]);
    const row = container.children[1].children[0];
    assert.equal(row.children[0].dateTime, '2026-10-11');
    assert.equal(row.children[1].textContent, '<img onerror=alert(1)>');
    assert.equal(row.children[1].innerHTML, undefined);
    row.children[1].click();
    assert.deepEqual(opened, {id:'x', kind:'activity'});
    const empty = ctx.document.createElement('section');
    ctx.renderPartnerActivityHistory(empty, 'p1', []);
    assert.match(empty.children[1].textContent, /ยังไม่มี/);
});
