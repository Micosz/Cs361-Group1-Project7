// #265: Overview agreement selector, per-agreement answer panel and matching CSV.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const overviewSource = fs.readFileSync('public/assets/overview.js', 'utf8');
const workNavSource = fs.readFileSync('public/assets/work-navigation.js', 'utf8');

function element(tag = 'div') {
    let ownText = '';
    const classes = new Set();
    const node = {
        tagName: String(tag).toUpperCase(), name: '', type: '', value: '', hidden: false, disabled: false,
        isConnected: true, dataset: {}, style: {}, children: [], listeners: {},
        get className() { return [...classes].join(' '); },
        set className(val) { classes.clear(); String(val || '').split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
        classList: {
            add(...n) { n.forEach(c => classes.add(c)); }, remove(...n) { n.forEach(c => classes.delete(c)); },
            toggle(n, f) { const on = f === undefined ? !classes.has(n) : Boolean(f); if (on) classes.add(n); else classes.delete(n); return on; },
            contains(n) { return classes.has(n); }
        },
        get textContent() { return ownText + this.children.map(c => c.textContent).join(''); },
        set textContent(val) { this.children = []; ownText = String(val ?? ''); },
        setAttribute() {}, getAttribute() { return null; },
        appendChild(child) { child.parentNode = node; this.children.push(child); return child; },
        append(...items) { items.forEach(item => this.appendChild(item)); },
        replaceChildren(...items) { this.children = []; ownText = ''; items.forEach(item => this.appendChild(item)); },
        remove() { this.isConnected = false; },
        addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
        dispatchEvent(event) { (this.listeners[event.type] || []).forEach(fn => fn(event)); },
        findAll(predicate, acc = []) {
            for (const child of this.children) { if (predicate(child)) acc.push(child); child.findAll?.(predicate, acc); }
            return acc;
        }
    };
    return node;
}

const agreementList = {data: [
    {id: 'MOU1', title: '[V7] MoU 1', agreementType: 'MoU'},
    {id: 'MOA2', title: '=[V7] MoA 2', agreementType: 'MoA'}
], count: 2, page: {limit: 100, nextCursor: null}};

function payload(filters, overrides = {}) {
    return {
        role: 'staff', filters,
        stakeholders: {count: 1, byType: {}}, partners: {count: 1, byType: {}},
        activities: {count: 0, byType: {}}, agreements: {count: 1, statuses: {active: 1}},
        exchanges: {count: 1, statuses: {ongoing: 1}, confirmedStudents: 2, awaitingConfirmation: 1},
        feedback: {count: 0, bySource: {}, withImprovement: 0, latest: []}, outcomes: {count: 0, records: []},
        agreementSummary: [{id: 'MOA2', title: '=[V7] MoA 2', agreementType: 'MoA', status: 'active',
            activityCount: 0, exchangeCount: 1, confirmedStudents: 2, awaitingConfirmation: 1,
            commentCount: 0, batchCount: 1, responseCount: 2}],
        formFeedback: {batchCount: 1, responseCount: 2, bySource: {}, byAgreement: [], batches: [],
            unspecifiedAgreement: {label: 'ยังไม่ระบุข้อตกลง', batchCount: 1, responseCount: 3, commentCount: 1}},
        ...overrides
    };
}

async function setup(makePayload = payload) {
    const requests = [];
    let csv = '', fileName = '';
    class CaptureBlob { constructor(parts) { csv = parts.join(''); } }
    const body = element('body');
    const document = {
        createElement: tag => {
            const node = element(tag);
            if (tag === 'a') node.click = () => { fileName = node.download; };
            return node;
        },
        body
    };
    const window = {
        CstuAuth: {
            request: async path => {
                requests.push(path);
                if (path.startsWith('/agreements?')) return agreementList;
                if (path.startsWith('/overview')) {
                    const query = Object.fromEntries(new URLSearchParams(path.split('?')[1] || ''));
                    return {data: makePayload(query)};
                }
                throw Object.assign(Error('missing'), {status: 404});
            }
        },
        URL: {createObjectURL: () => 'blob:csv', revokeObjectURL() {}}
    };
    const context = vm.createContext({window, document, URLSearchParams, URL: window.URL, Blob: CaptureBlob,
        location: {origin: 'http://localhost', replace() {}}, setTimeout, clearTimeout, Error, Promise, Map, Number});
    vm.runInContext(workNavSource, context);
    vm.runInContext(overviewSource, context);
    const container = element('div');
    window.CstuOverview.render(container, {user: {id: 'u-staff'}, grants: [{role: 'staff', scopeId: 'cs-demo', active: true}]});
    await new Promise(resolve => setImmediate(resolve));
    const root = container.children[0];
    const form = root.findAll(el => el.tagName === 'FORM')[0];
    const field = name => form.findAll(el => el.name === name)[0];
    return {root, form, field, requests, csv: () => csv, fileName: () => fileName};
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('agreement selector lists permitted agreements and sends agreementId with the period', async () => {
    const {form, field, requests} = await setup();
    assert.ok(requests.includes('/agreements?limit=100'));
    const select = field('agreementId');
    assert.deepEqual(select.children.map(o => o.value), ['', 'MOA2', 'MOU1'], 'sorted by title');
    assert.match(select.children[1].textContent, /MoA · =\[V7\] MoA 2/);
    select.value = 'MOA2';
    field('startDate').value = '2026-11-01';
    field('endDate').value = '2027-03-31';
    form.dispatchEvent({type: 'submit', preventDefault() {}});
    await flush();
    const last = requests.filter(p => p.startsWith('/overview')).at(-1);
    assert.equal(last, '/overview?agreementId=MOA2&startDate=2026-11-01&endDate=2027-03-31');
});

test('answer panel shows activities, confirmed students, awaiting students and Feedback per agreement', async () => {
    const {root} = await setup();
    const panel = root.findAll(el => el.classList?.contains('overview-agreement-report'))[0];
    assert.ok(panel, 'agreement report panel rendered');
    assert.match(panel.textContent, /นักศึกษายืนยันสิทธิ์ 2 คน/);
    const rows = panel.findAll(el => el.tagName === 'TR' && el.dataset.agreementId === 'MOA2');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].children.map(c => c.textContent), ['MoA · =[V7] MoA 2', '0', '2', '1', '0', '1 · 2']);
    const unspecified = panel.findAll(el => el.tagName === 'TR' && el.dataset.agreementStatus === 'unspecified')[0];
    assert.deepEqual(unspecified.children.map(c => c.textContent), ['ยังไม่ระบุข้อตกลง', '—', '—', '—', '1', '1 · 3']);
});

test('CSV uses the same filters and numbers as the panel, guards formulas, and names the file by filter', async () => {
    const {root, form, field, csv, fileName} = await setup();
    field('agreementId').value = 'MOA2';
    field('startDate').value = '2026-11-01';
    field('endDate').value = '2027-03-31';
    form.dispatchEvent({type: 'submit', preventDefault() {}});
    await flush();
    root.findAll(el => el.classList?.contains('overview-btn-export'))[0].onclick();
    const text = csv();
    assert.match(text, /"ตัวกรอง","ข้อตกลง","'=\[V7\] MoA 2"/);
    assert.match(text, /"ตัวกรอง","ตั้งแต่วันที่","2026-11-01"/);
    assert.match(text, /"ภาพรวม","นักศึกษายืนยันสิทธิ์ Exchange","2"/);
    assert.match(text, /"ภาพรวม","ผ่านแต่ยังไม่ยืนยันสิทธิ์ \(ไม่นับรวม\)","1"/);
    assert.match(text, /"ข้อตกลง: MoA '?=\[V7\] MoA 2","นักศึกษายืนยันสิทธิ์ Exchange","2"/);
    assert.match(text, /"ข้อตกลง: MoA =\[V7\] MoA 2","Feedback คำตอบจากแบบฟอร์ม","2"/);
    assert.match(text, /"ยังไม่ระบุข้อตกลง","Feedback ความคิดเห็น","1"/);
    assert.equal(fileName(), 'cstuhub-overview-MOA2_2026-11-01_2027-03-31.csv');
});

test('unavailable admission data is shown as — rather than zero', async () => {
    const {root} = await setup(filters => {
        const data = payload(filters);
        data.exchanges.confirmedStudents = null;
        data.agreementSummary[0].confirmedStudents = null;
        return data;
    });
    const panel = root.findAll(el => el.classList?.contains('overview-agreement-report'))[0];
    assert.match(panel.textContent, /นักศึกษายืนยันสิทธิ์ — คน/);
});
