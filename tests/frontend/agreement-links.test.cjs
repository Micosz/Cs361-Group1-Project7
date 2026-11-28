// #263: partner -> agreements -> activities/Exchanges navigation component.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/assets/agreement-links.js', 'utf8');
const recordsSource = fs.readFileSync('public/assets/records.js', 'utf8');
const indexSource = fs.readFileSync('public/index.html', 'utf8');

function element(tag) {
    const node = {
        tagName: tag.toUpperCase(), children: [], dataset: {}, isConnected: true, textContent: '', className: '',
        setAttribute(key, value) { this[key] = String(value); },
        appendChild(child) { this.children.push(child); return child; },
        append(...items) { items.forEach(item => this.appendChild(item)); },
        replaceChildren(...items) { this.children = []; this.textContent = ''; items.forEach(item => this.appendChild(item)); },
    };
    return node;
}
const walk = (node, out = []) => { for (const child of node.children) { out.push(child); walk(child, out); } return out; };
const text = node => [node.textContent, ...node.children.map(text)].join('');
const buttons = node => walk(node).filter(child => child.tagName === 'BUTTON');

function load(responses) {
    const calls = [];
    const window = {
        CstuAuth: {
            request: async path => {
                calls.push(path);
                const key = Object.keys(responses).find(prefix => path.startsWith(prefix));
                const value = responses[key];
                if (value instanceof Error) throw value;
                if (value === undefined) throw Object.assign(Error('missing'), {status: 404});
                return value;
            }
        }
    };
    vm.runInContext(source, vm.createContext({window, document: {createElement: element}, Error, Promise, Map}));
    return {window, calls};
}

const list = rows => ({data: rows, count: rows.length, page: {limit: 100, nextCursor: null}});

test('partner detail lists its agreements with type, status and period, and opens each one', async () => {
    const {window, calls} = load({
        '/agreements?partnerId=P1': list([
            {id: 'MOA2', title: 'MoA 2', agreementType: 'MoA', status: 'active', startDate: '2026-10-01', endDate: '2027-09-30'},
            {id: 'MOU1', title: 'MoU 1', agreementType: 'MoU', status: 'draft', startDate: '2026-09-01', endDate: '2027-09-30'},
        ])
    });
    const opened = [];
    const host = element('section');
    await window.CstuAgreementLinks.partnerAgreements(host, {id: 'P1'}, {open: (...args) => opened.push(args.slice(0, 2))});
    assert.equal(calls[0], '/agreements?partnerId=P1&limit=100');
    const links = buttons(host);
    assert.deepEqual(links.map(b => b.textContent), ['MoU 1', 'MoA 2'], 'sorted by start date');
    assert.match(text(host), /ฉบับร่าง · 2026-09-01 – 2027-09-30/);
    assert.match(text(host), /มีผลบังคับใช้ · 2026-10-01 – 2027-09-30/);
    links[1].onclick();
    assert.deepEqual(opened, [['agreements', 'MOA2']]);
});

test('agreement detail shows only its own work and links back to the partner', async () => {
    const {window, calls} = load({
        '/activities?agreementId=MOU1': list([
            {id: 'A2', title: 'A2', type: 'event', periodDate: '2027-02-15'},
            {id: 'A1', title: 'A1', type: 'academic_activity', periodDate: '2026-12-10'},
        ]),
        '/exchanges?agreementId=MOU1': list([]),
        '/partners/P1': {data: {id: 'P1', name: 'Partner One'}},
        '/partners/P-hidden': Object.assign(Error('no'), {status: 404}),
        '/selection-users': {data: [{id: 'u1', displayName: 'Staff Name'}]},
    });
    const opened = [];
    const host = element('section');
    await window.CstuAgreementLinks.agreementWork(host,
        {id: 'MOU1', scopeId: 'c1', partnerIds: ['P1', 'P-hidden'], responsibleUserIds: ['u1', 'u-unknown']},
        {identity: {grants: [{role: 'staff', scopeId: 'c1'}]}, open: (...args) => opened.push(args.slice(0, 2))});
    assert.ok(calls.includes('/activities?agreementId=MOU1&limit=100'));
    assert.ok(calls.includes('/exchanges?agreementId=MOU1&limit=100'));
    const labels = buttons(host).map(b => b.textContent);
    assert.deepEqual(labels, ['Partner One', 'A1', 'A2'], 'hidden partner omitted, activities by date');
    assert.ok(!text(host).includes('P-hidden'));
    assert.match(text(host), /กิจกรรม 2 งาน · Exchange 0 โครงการ/);
    assert.match(text(host), /ยังไม่มี Exchange ภายใต้ข้อตกลงนี้/);
    assert.match(text(host), /ผู้รับผิดชอบ: Staff Name, u-unknown/);
    buttons(host)[0].onclick();
    assert.deepEqual(opened, [['partners', 'P1']]);
});

test('coordinator sees responsible IDs without a name lookup', async () => {
    const {window, calls} = load({
        '/activities?agreementId=MOA2': list([]),
        '/exchanges?agreementId=MOA2': list([{id: 'X1', title: 'X1', status: 'ongoing', startDate: '2027-01-05', endDate: '2027-03-20'}]),
    });
    const host = element('section');
    await window.CstuAgreementLinks.agreementWork(host, {id: 'MOA2', scopeId: 'c1', responsibleUserIds: ['coord']},
        {identity: {grants: [{role: 'coordinator', scopeId: 'c1'}]}, open: () => {}});
    assert.ok(!calls.some(path => path.startsWith('/selection-users')));
    assert.match(text(host), /ผู้รับผิดชอบ: coord/);
    assert.match(text(host), /กำลังดำเนินการ · 2027-01-05 – 2027-03-20/);
    assert.match(text(host), /ยังไม่มีกิจกรรมภายใต้ข้อตกลงนี้/);
});

test('permission errors show a message instead of partial lists', async () => {
    const {window} = load({'/agreements?partnerId=P1': Object.assign(Error('denied'), {status: 403})});
    const host = element('section');
    await window.CstuAgreementLinks.partnerAgreements(host, {id: 'P1'}, {open: () => {}});
    assert.equal(buttons(host).length, 0);
    assert.match(text(host), /คุณไม่มีสิทธิ์ดูรายการที่เชื่อมโยง/);
});

test('records.js mounts the links for internal roles and can open agreements in place', () => {
    assert.match(recordsSource, /CstuAgreementLinks\.agreementWork\(links, record/);
    assert.match(recordsSource, /CstuAgreementLinks\.partnerAgreements\(agreements, record/);
    assert.match(recordsSource, /\['partners','activities','agreements','exchanges'\]\.includes\(resourceKind\)/);
    assert.ok(indexSource.indexOf('assets/agreement-links.js') < indexSource.indexOf('assets/records.js'),
        'component loads before records.js');
});
