const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/assets/script.js', 'utf8');

function harness(controls = {}) {
    const nodes = new Map(Object.entries(controls));
    const context = vm.createContext({
        AbortController, setTimeout, clearTimeout, Intl,
        console: { warn() {}, error() {} },
        window: { addEventListener() {} },
        document: { addEventListener() {}, getElementById: id => nodes.get(id) }
    });
    vm.runInContext(source, context);
    return context;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('known span comes only from stored dates; unknown stays unknown', () => {
    const app = harness();
    assert.deepEqual(plain(app.activityDateRange({ period_date: '2022-09-09', period_end_date: '2022-09-17' })),
        { start: '2022-09-09', end: '2022-09-17' });
    assert.deepEqual(plain(app.activityDateRange({ periodDate: '2026-07-09' })), { start: '2026-07-09', end: '2026-07-09' });
    // An end before the start is ignored rather than trusted.
    assert.deepEqual(plain(app.activityDateRange({ period_date: '2026-07-09', period_end_date: '2026-07-01' })),
        { start: '2026-07-09', end: '2026-07-09' });
    assert.deepEqual(plain(app.activityDateRange({ date_precision: 'month', period: 'ต.ค. 2563' })),
        { start: '2020-10-01', end: '2020-10-31' });
    assert.deepEqual(plain(app.activityDateRange({ date_precision: 'month', period: 'ก.พ. 2567' })),
        { start: '2024-02-01', end: '2024-02-29' });
    for (const undated of [{}, { period_date: '2026-02-30' }, { date_precision: 'unknown', period: 'รอยืนยันช่วงวันที่' },
        { period: 'ต.ค. 2563' }, { date_precision: 'month', period: 'ปลายปี' }]) {
        assert.equal(app.activityDateRange(undated), null);
    }
});

test('dates are shown in Buddhist years, with ranges and month precision', () => {
    const app = harness();
    assert.equal(app.formatActivityDate({ period_date: '2026-07-09' }), '9 ก.ค. 69');
    assert.equal(app.formatActivityDate({ period_date: '2022-09-09', period_end_date: '2022-09-17' }), '9 ก.ย. 65 – 17 ก.ย. 65');
    assert.equal(app.formatActivityDate({ date_precision: 'month', period: 'ต.ค. 2563' }), 'ต.ค. 63');
    assert.equal(app.formatActivityDate({ date_precision: 'unknown', period: 'รอยืนยันช่วงวันที่' }), 'ไม่ระบุวันที่');
});

test('ended records are classified without deleting or guessing', () => {
    const app = harness();
    const today = '2026-11-10';
    assert.equal(app.isPastRecord({ period_date: '2026-11-09' }, 'activity', today), true);
    assert.equal(app.isPastRecord({ period_date: '2026-11-10' }, 'activity', today), false);
    assert.equal(app.isPastRecord({ period_date: '2026-11-01', period_end_date: '2026-11-30' }, 'activity', today), false);
    assert.equal(app.isPastRecord({ date_precision: 'month', period: 'ต.ค. 2563' }, 'activity', today), true);
    assert.equal(app.isPastRecord({ date_precision: 'unknown' }, 'activity', today), false);
    assert.equal(app.isPastRecord({ status: 'expired' }, 'agreement', today), true);
    assert.equal(app.isPastRecord({ status: 'terminated', endDate: '2030-01-01' }, 'agreement', today), true);
    assert.equal(app.isPastRecord({ status: 'active', endDate: '2026-11-09' }, 'agreement', today), true);
    assert.equal(app.isPastRecord({ status: 'active', endDate: '2027-01-01' }, 'agreement', today), false);
    assert.equal(app.isPastRecord({ status: 'draft' }, 'agreement', today), false);
});

test('date filter matches overlapping spans and hides undated records unless asked', () => {
    const rows = [
        { id: 'range', title: 'A', type: 'research', period_date: '2022-06-26', period_end_date: '2022-08-27' },
        { id: 'day', title: 'B', type: 'event', period_date: '2020-02-24' },
        { id: 'month', title: 'C', type: 'event', date_precision: 'month', period: 'ต.ค. 2563' },
        { id: 'undated', title: 'D', type: 'event', date_precision: 'unknown' }
    ];
    const ids = (start, end, includeUndated = false) => plain(harness({
        filterEvent: { value: 'all' }, filterEventDate: { value: start }, filterEventDateEnd: { value: end },
        filterEventIncludeUndated: { checked: includeUndated }
    }).filterBrowseRecords(rows, 'title', 'filterEvent', '').map(row => row.id));
    assert.deepEqual(ids('', ''), ['range', 'day', 'month', 'undated']);
    // A July window overlaps the June–August programme although it starts earlier.
    assert.deepEqual(ids('2022-07-01', '2022-07-31'), ['range']);
    assert.deepEqual(ids('2020-10-15', ''), ['range', 'month']);
    assert.deepEqual(ids('', '2020-12-31'), ['day', 'month']);
    assert.deepEqual(ids('', '2020-12-31', true), ['day', 'month', 'undated']);
});

test('type and status codes are shown in Thai; unknown codes stay readable', () => {
    const app = harness();
    assert.equal(app.typeLabel('research_institute'), 'สถาบันวิจัย');
    assert.equal(app.typeLabel('company'), 'บริษัท');
    assert.equal(app.typeLabel('academic_activity', 'activity'), 'กิจกรรมวิชาการ');
    assert.equal(app.typeLabel('internship', 'activity'), 'ฝึกงานและสหกิจศึกษา');
    assert.equal(app.typeLabel('new_code'), 'new_code');
    assert.equal(app.typeLabel(undefined), 'ไม่ระบุประเภท');
    assert.equal(app.window.CstuLabels.status('terminated'), 'ยุติแล้ว');
    assert.equal(app.window.CstuLabels.status('completed'), 'เสร็จสิ้น');
});

test('ended view sorts latest first; current view sorts soonest first with undated last', () => {
    const app = harness();
    const rows = [{ id: 'u' }, { id: 'b', period_date: '2026-12-20' }, { id: 'a', period_date: '2026-12-01' }];
    assert.deepEqual(plain(app.sortActivitiesForView(rows, 'current').map(row => row.id)), ['a', 'b', 'u']);
    assert.deepEqual(plain(app.sortActivitiesForView(rows.slice(1), 'past').map(row => row.id)), ['b', 'a']);
});

test('published records are requested alongside the catalogue, not after it', async () => {
    const started = [];
    let release;
    const context = vm.createContext({
        AbortController, setTimeout, clearTimeout, Intl, console: { warn() {}, error() {} },
        window: { CSTU_AUTH_CONFIG: { enabled: true }, addEventListener() {} },
        document: { addEventListener() {}, getElementById: () => undefined,
            createElement: () => ({ style: {}, setAttribute() {} }), body: { prepend() {} } },
        fetch: url => {
            started.push(url);
            const rows = url === '/fetchPartnersData' ? [{ id: 'p1', name: 'One', visibility: 'public' }]
                : [{ id: 'p2', name: 'Two', visibility: 'public' }];
            const reply = { ok: true, json: async () => rows };
            return url === '/fetchPartnersData' ? new Promise(resolve => { release = () => resolve(reply); }) : Promise.resolve(reply);
        }
    });
    vm.runInContext(source, context);
    const loading = context.fetchPartnersData();
    await new Promise(resolve => setTimeout(resolve, 0));
    // Both requests are in flight before the first one answers.
    assert.deepEqual(started.sort(), ['/api/public/records', '/fetchPartnersData']);
    release();
    assert.deepEqual(plain((await loading).map(row => row.id)), ['p1', 'p2']);
});
