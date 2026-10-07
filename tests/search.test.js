const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../assets/script.js'), 'utf8');
const fixture = [
    // Co-host comes first to catch accidental primary partnerId replacement.
    { id: 'beta', name: 'Beta University', type: 'university', access_level: 'public', summary: 'summary-only', location: 'Bangkok' },
    { id: 'alpha', name: 'Alpha Company', type: 'company', visibility: 'public', summary: 'summary-only' },
    { id: 'hidden', name: 'Private Partner', type: 'company', visibility: 'private' },
    { id: 'joint', title: 'Alpha Workshop', type: 'event', partnerId: 'alpha', visibility: 'public', co_hosts: ['Beta', 'Alpha'], period: '2026', period_date: '2026-11-11' },
    { id: 'related', title: 'Research Day', type: 'research', partnerId: 'alpha', visibility: 'public', period_date: '2020-08-17' },
    { id: 'legacy', title: 'Beta Talk', type: 'event', partnerId: 'beta', visibility: 'public' },
    { id: 'secret', title: 'Private Event', type: 'event', partnerId: 'alpha', visibility: 'private' },
    { id: 'hidden-event', title: 'Private Host Event', type: 'event', partnerId: 'hidden', visibility: 'public' }
];
const response = (data = fixture) => ({ ok: true, json: async () => structuredClone(data) });
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

// Minimal DOM/timer mocks run the production script, including its startup listeners.
// These tests do not contact AWS and are separate from the real-browser verification.
function page(fetchImpl = async () => response()) {
    const elements = new Set();
    const listeners = new Map();
    const timeouts = new Map();
    const intervals = new Map();
    let timerId = 0, now = 0, requests = 0;
    class Element {
        constructor(id = '') {
            this.id = id;
            this.style = {};
            this.value = '';
            this.children = [];
            this.writes = 0;
            this.html = '';
            this.textContent = '';
            this.events = {};
            this.classList = { add() {}, remove() {} };
            elements.add(this);
        }
        set innerHTML(html) { this.html = html; this.children = []; this.writes++; }
        get innerHTML() { return this.html; }
        replaceChildren(...children) { this.children = children; this.html = ''; this.writes++; }
        appendChild(child) { this.children.push(child); }
        prepend(child) { this.children.unshift(child); }
        removeChild(child) { this.children = this.children.filter(item => item !== child); }
        setAttribute() {}
        addEventListener(name, fn) { this.events[name] = fn; }
        insertAdjacentElement() {}
        getBoundingClientRect() { return { width: 100 }; }
        contains(target) { return target.insideSearch === true; }
    }
    const ids = ['searchInput', 'searchSuggestions', 'filterCollab', 'filterEvent', 'filterEventDate', 'filterEventDateClear', 'filterCollabDate', 'filterCollabDateClear', 'filterEventDateEnd', 'filterCollabDateEnd', 'filterEventDateError', 'filterCollabDateError',
        'collaboratorGrid', 'eventGrid', 'detailModal', 'modalTitle', 'modalName',
        'modalInfo', 'modalImage', 'modalDetails', 'tabCollab', 'tabEvent',
        'sectionCollaborator', 'sectionEvent'];
    for (let i = 1; i <= 3; i++) ids.push(`heroTitle${i}`, `heroDesc${i}`, `heroCard${i}`);
    ids.forEach(id => new Element(id));
    const get = id => [...elements].find(el => el.id === id) || null;
    ['filterCollab', 'filterEvent'].forEach(id => {
        get(id).value = 'all';
        get(id).selectedIndex = 0;
        get(id).options = [{ text: 'all' }];
    });
    get('searchSuggestions').style.display = 'none';
    const wrapper = new Element();
    const document = {
        getElementById: get,
        querySelector: () => wrapper,
        createElement: () => new Element(),
        body: new Element(),
        addEventListener: (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn])
    };
    const context = vm.createContext({
        document, window: { getComputedStyle: () => ({}) },
        console: { error() {}, warn() {} }, AbortController,
        fetch: (...args) => { requests++; return fetchImpl(...args); },
        setTimeout: (fn, delay) => { timeouts.set(++timerId, { fn, due: now + delay }); return timerId; },
        clearTimeout: id => timeouts.delete(id),
        setInterval: fn => { intervals.set(++timerId, fn); return timerId; }
    });
    vm.runInContext(source, context);
    return {
        context, get, timeouts, intervals,
        get requests() { return requests; },
        input(value) { get('searchInput').value = value; context.scheduleSearch(); },
        dispatch(name, event) { (listeners.get(name) || []).forEach(fn => fn(event)); },
        async advance(ms) {
            now += ms;
            for (const [id, timer] of [...timeouts]) {
                if (timer.due <= now) { timeouts.delete(id); timer.fn(); }
            }
            await settle();
        }
    };
}

test('startup shares one request, writes each grid once, and starts one ticker', async () => {
    const load = deferred();
    const p = page((url, options) => {
        assert.match(url, /execute-api\.us-east-1\.amazonaws\.com/);
        assert.equal(options.cache, 'no-store', 'page reload must request fresh API data');
        return load.promise;
    });
    p.dispatch('DOMContentLoaded');
    assert.equal(p.requests, 1);
    const shared = p.context.fetchPartnersData();
    assert.equal(shared, p.context.fetchPartnersData());
    load.resolve(response());
    await shared;
    await settle();
    assert.equal(p.get('collaboratorGrid').writes, 1);
    assert.equal(p.get('eventGrid').writes, 1);
    assert.equal(p.intervals.size, 1);
    assert.match(p.get('heroTitle1').textContent, /Alpha|Beta/);
});

test('search, filters, modal, and ticker reuse the successful API snapshot', async () => {
    const p = page();
    p.dispatch('DOMContentLoaded');
    await settle();
    p.input('Alpha');
    await p.advance(250);
    p.get('filterCollab').value = 'company';
    await p.context.applyCollabFilters();
    p.get('filterEvent').value = 'event';
    await p.context.applyEventFilters();
    await p.context.openModal('alpha', 'partner');
    await p.context.openModal('joint', 'activity');
    for (const tick of p.intervals.values()) tick();
    assert.equal(p.requests, 1);
    const freshPage = page();
    freshPage.dispatch('DOMContentLoaded');
    await settle();
    assert.equal(freshPage.requests, 1, 'a new page loads a new snapshot');
});

test('name/title search and type filters agree in both grids and suggestions', async () => {
    const p = page();
    p.get('filterCollab').value = 'company';
    p.get('filterEvent').value = 'event';
    p.get('searchInput').value = ' ALPHA ';
    await p.context.handleSearch();
    await p.context.showSuggestions();
    assert.match(p.get('collaboratorGrid').innerHTML, /Alpha Company/);
    assert.doesNotMatch(p.get('collaboratorGrid').innerHTML, /Beta University/);
    assert.match(p.get('eventGrid').innerHTML, /Alpha Workshop/);
    assert.doesNotMatch(p.get('eventGrid').innerHTML, /Research Day/);
    assert.match(p.get('searchSuggestions').innerHTML, /Alpha Company|Alpha Workshop/);
    p.get('searchInput').value = 'summary-only';
    await p.context.handleSearch();
    await p.context.showSuggestions();
    assert.match(p.get('collaboratorGrid').innerHTML, /ไม่พบ/);
    assert.equal(p.get('searchSuggestions').children.length, 1);
    p.get('searchInput').value = 'Alpha';
    p.get('filterCollab').value = 'university';
    p.get('filterEvent').value = 'research';
    await p.context.handleSearch();
    await p.context.showSuggestions();
    assert.match(p.get('collaboratorGrid').innerHTML, /ไม่พบ/);
    assert.match(p.get('eventGrid').innerHTML, /ไม่พบ/);
    assert.equal(p.get('searchSuggestions').children.length, 1);
});

test('rapid typing waits 250ms and renders only the latest query', async () => {
    const p = page();
    p.input('A');
    await p.advance(100);
    p.input('Al');
    await p.advance(100);
    p.input('Alpha');
    await p.advance(249);
    assert.equal(p.requests, 0);
    await p.advance(1);
    assert.equal(p.requests, 1);
    assert.equal(p.get('collaboratorGrid').writes, 1);
    assert.match(p.get('collaboratorGrid').innerHTML, /Alpha Company/);
    assert.doesNotMatch(p.get('collaboratorGrid').innerHTML, /Beta University/);
});

test('Search runs immediately, cancels debounce, and keeps suggestions closed', async () => {
    const p = page();
    p.input('Alpha');
    await p.context.handleSearch();
    assert.equal(p.timeouts.size, 0);
    assert.match(p.get('eventGrid').innerHTML, /Alpha Workshop/);
    await p.advance(250);
    assert.equal(p.get('eventGrid').writes, 1);
    assert.equal(p.get('searchSuggestions').style.display, 'none');
});

test('clearing during loading restores selected filters without old suggestions', async () => {
    const load = deferred();
    const p = page(() => load.promise);
    p.get('filterCollab').value = 'university';
    p.get('filterEvent').value = 'research';
    p.input('Alpha');
    await p.advance(250);
    p.input('');
    load.resolve(response());
    await settle();
    assert.match(p.get('collaboratorGrid').innerHTML, /Beta University/);
    assert.doesNotMatch(p.get('collaboratorGrid').innerHTML, /Alpha Company/);
    assert.match(p.get('eventGrid').innerHTML, /Research Day/);
    assert.equal(p.get('filterCollab').value, 'university');
    assert.equal(p.get('filterEvent').value, 'research');
    assert.equal(p.get('searchSuggestions').style.display, 'none');
    assert.equal(p.get('collaboratorGrid').writes, 1, 'stale render is discarded');
});

test('older suggestions resolving after the latest query cannot overwrite it', async () => {
    const p = page();
    const old = deferred(), latest = deferred();
    let calls = 0;
    p.context.getPublicPartners = () => (++calls === 1 ? old.promise : latest.promise);
    p.context.getPublicActivities = async () => [];
    p.get('searchInput').value = 'Alpha';
    const first = p.context.showSuggestions();
    p.get('searchInput').value = 'Beta';
    const second = p.context.showSuggestions();
    latest.resolve(structuredClone(fixture.slice(0, 2)));
    await second;
    old.resolve(structuredClone(fixture.slice(0, 2)));
    await first;
    assert.match(p.get('searchSuggestions').innerHTML, /Beta University/);
    assert.doesNotMatch(p.get('searchSuggestions').innerHTML, /Alpha Company/);
    assert.equal(p.get('searchSuggestions').writes, 1);
});

for (const [getter, renderer, grid, field] of [
    ['getPublicPartners', 'renderCollaboratorCards', 'collaboratorGrid', 'name'],
    ['getPublicActivities', 'renderEventCards', 'eventGrid', 'title']
]) {
    test(`${renderer} retains its version guard when the older render finishes last`, async () => {
        const p = page();
        const old = deferred(), latest = deferred();
        let calls = 0;
        p.context[getter] = () => (++calls === 1 ? old.promise : latest.promise);
        const first = p.context[renderer]();
        const second = p.context[renderer]();
        latest.resolve([{ id: 'latest', [field]: 'Latest result', type: 'company' }]);
        await second;
        old.resolve([{ id: 'old', [field]: 'Old result', type: 'company' }]);
        await first;
        assert.match(p.get(grid).innerHTML, /Latest result/);
        assert.doesNotMatch(p.get(grid).innerHTML, /Old result/);
        assert.equal(p.get(grid).writes, 1);
    });
}

for (const action of ['outside click', 'Search', 'selection', 'filter']) {
    test(`${action} prevents a pending suggestion from reopening the dropdown`, async () => {
        const load = deferred();
        const p = page(() => load.promise);
        p.input('Alpha');
        await p.advance(250);
        let pending;
        if (action === 'outside click') p.dispatch('click', { target: {} });
        if (action === 'Search') pending = p.context.handleSearch();
        if (action === 'selection') pending = p.context.selectSuggestion('alpha', 'partner');
        if (action === 'filter') pending = p.context.applyCollabFilters();
        load.resolve(response());
        await pending;
        await settle();
        assert.equal(p.get('searchSuggestions').style.display, 'none');
        assert.equal(p.get('searchSuggestions').writes, 0);
        assert.equal(p.requests, 1);
        if (action === 'selection') assert.equal(p.get('modalTitle').textContent, 'Alpha Company');
    });
}

test('outside click before debounce hides suggestions but still applies the search', async () => {
    const p = page();
    p.input('Beta');
    p.dispatch('click', { target: {} });
    await p.advance(250);
    assert.match(p.get('collaboratorGrid').innerHTML, /Beta University/);
    assert.equal(p.get('searchSuggestions').style.display, 'none');
});

test('public visibility, primary host, co-host links, and related modal cards survive caching', async () => {
    const p = page();
    const partners = await p.context.getPublicPartners();
    const activities = await p.context.getPublicActivities();
    assert.equal(partners.length, 2);
    assert.equal(activities.length, 3);
    const joint = activities.find(item => item.id === 'joint');
    assert.equal(joint.partnerId, 'alpha');
    assert.equal(joint.partnerName, 'Alpha Company');
    assert.deepEqual(Array.from(joint.co_hosts), ['Beta', 'Alpha']);
    assert.equal(await p.context.getPublicPartnerById('hidden'), null);
    assert.equal(await p.context.getPublicActivityById('secret'), null);
    await p.context.openModal('beta', 'partner');
    assert.match(p.get('modalDetails').innerHTML, /Alpha Workshop|Beta Talk/);
    assert.doesNotMatch(p.get('modalDetails').innerHTML, /Private/);
    await p.context.openModal('joint', 'activity');
    assert.equal(p.get('modalName').textContent, 'Beta และ Alpha');
    assert.match(p.get('modalDetails').innerHTML, /Research Day/);
    assert.doesNotMatch(p.get('modalDetails').innerHTML, /Private|Beta Talk/);
    p.context.closeModal();
    assert.equal(p.get('detailModal').style.display, 'none');
});

for (const failure of ['HTTP', 'network', 'invalid JSON', 'invalid shape']) {
    test(`${failure} is handled by all UI callers and a later Search retries successfully`, async () => {
        let calls = 0;
        const p = page(async () => {
            if (++calls > 2) return response();
            if (failure === 'HTTP') return { ok: false, status: 503 };
            if (failure === 'network') throw new Error('Offline');
            if (failure === 'invalid JSON') return { ok: true, json: async () => { throw new SyntaxError('JSON'); } };
            return response({ error: 'Bad shape' });
        });
        p.dispatch('DOMContentLoaded');
        p.get('searchInput').value = 'Alpha';
        await Promise.all([p.context.showSuggestions(), p.context.openModal('alpha', 'partner')]);
        await settle();
        assert.equal(p.requests, 2);
        assert.match(p.get('collaboratorGrid').children[0].textContent, /โหลดข้อมูลไม่สำเร็จ/);
        assert.match(p.get('eventGrid').children[0].textContent, /โหลดข้อมูลไม่สำเร็จ/);
        assert.equal(p.get('modalTitle').textContent, 'โหลดข้อมูลไม่สำเร็จ');
        assert.equal(p.get('searchSuggestions').style.display, 'none');
        await p.context.handleSearch();
        await p.context.openModal('alpha', 'partner');
        assert.equal(p.requests, 3);
        assert.match(p.get('collaboratorGrid').innerHTML, /Alpha Company/);
        assert.equal(p.get('modalTitle').textContent, 'Alpha Company');
        assert.equal(p.intervals.size, 1);
    });
}

test('a successful empty array is cached, unlike an API failure', async () => {
    const p = page(async () => response([]));
    await p.context.handleSearch();
    await p.context.handleSearch();
    assert.equal(p.requests, 1);
    assert.match(p.get('collaboratorGrid').innerHTML, /ไม่พบ/);
});


test('calendar day combines with category and keyword in cards and suggestions without extra requests', async () => {
    const p = page();
    p.get('filterEventDate').value = '2026-11-11';
    p.get('filterEventDateEnd').value = '2026-11-11';
    p.get('filterEvent').value = 'event';
    p.get('searchInput').value = 'Alpha';
    await p.context.handleSearch();
    await p.context.showSuggestions();
    assert.match(p.get('eventGrid').innerHTML, /Alpha Workshop/);
    assert.doesNotMatch(p.get('eventGrid').innerHTML, /Research Day|Beta Talk/);
    assert.match(p.get('searchSuggestions').innerHTML, /Alpha Workshop/);
    assert.doesNotMatch(p.get('searchSuggestions').innerHTML, /Research Day|Beta Talk/);
    assert.match(p.get('collaboratorGrid').innerHTML, /Alpha Company/, 'day does not filter organizations');
    assert.equal(p.requests, 1);
    p.get('filterEventDate').value = '2025-11-11';
    p.get('filterEventDateEnd').value = '2025-11-11';
    await p.context.applyBrowseDateFilter('filterEvent');
    assert.match(p.get('eventGrid').innerHTML, /ไม่พบกิจกรรม/, 'the year is part of the exact calendar day');
    assert.equal(p.get('filterEventDateClear').disabled, false);
    assert.equal(p.get('searchSuggestions').style.display, 'none');
    assert.equal(p.requests, 1);
});

test('clearing the calendar day preserves search and category; undated activities return when blank', async () => {
    const p = page();
    p.get('filterEvent').value = 'research';
    p.get('filterEventDate').value = '2026-11-11';
    p.get('filterEventDateEnd').value = '2026-11-11';
    p.get('searchInput').value = 'Research';
    await p.context.handleSearch();
    assert.match(p.get('eventGrid').innerHTML, /ไม่พบกิจกรรม/);
    await p.context.clearBrowseDateFilter('filterEvent');
    assert.match(p.get('eventGrid').innerHTML, /Research Day/);
    assert.equal(p.get('filterEvent').value, 'research');
    assert.equal(p.get('searchInput').value, 'Research');
    assert.equal(p.get('filterEventDate').value, '');
    assert.equal(p.get('filterEventDateClear').disabled, true);
    p.get('filterEvent').value = 'all';
    p.get('searchInput').value = '';
    await p.context.handleSearch();
    assert.match(p.get('eventGrid').innerHTML, /Beta Talk/, 'blank day includes undated records');
    assert.equal(p.requests, 1);
});

test('a calendar change during API loading renders only the latest day', async () => {
    const load = deferred();
    const p = page(() => load.promise);
    p.get('filterEventDate').value = '2026-11-11';
    p.get('filterEventDateEnd').value = '2026-11-11';
    const first = p.context.applyBrowseDateFilter('filterEvent');
    p.get('filterEventDate').value = '2020-08-17';
    p.get('filterEventDateEnd').value = '2020-08-17';
    const latest = p.context.applyBrowseDateFilter('filterEvent');
    load.resolve(response());
    await Promise.all([first, latest]);
    assert.match(p.get('eventGrid').innerHTML, /Research Day/);
    assert.doesNotMatch(p.get('eventGrid').innerHTML, /Alpha Workshop/);
    assert.equal(p.get('eventGrid').writes, 1);
    assert.equal(p.requests, 1);
});


test('organization day matches public collaborations including co-hosts, without changing their relationships', async () => {
    const p = page();
    p.get('filterCollabDate').value = '2026-11-11';
    p.get('filterCollabDateEnd').value = '2026-11-11';
    p.get('filterCollab').value = 'university';
    p.get('searchInput').value = 'Beta';
    await p.context.handleSearch();
    await p.context.showSuggestions();
    assert.match(p.get('collaboratorGrid').innerHTML, /Beta University/, 'a co-host retains its shared activity date');
    assert.doesNotMatch(p.get('collaboratorGrid').innerHTML, /Alpha Company/);
    assert.match(p.get('searchSuggestions').innerHTML, /Beta University/);
    p.get('filterCollabDate').value = '2020-08-17';
    p.get('filterCollabDateEnd').value = '2020-08-17';
    await p.context.applyBrowseDateFilter('filterCollab');
    assert.match(p.get('collaboratorGrid').innerHTML, /ไม่พบผู้มีส่วนได้ส่วนเสีย/);
    await p.context.clearBrowseDateFilter('filterCollab');
    assert.match(p.get('collaboratorGrid').innerHTML, /Beta University/);
    assert.equal(p.get('filterCollab').value, 'university');
    assert.equal(p.get('searchInput').value, 'Beta');
    assert.equal(p.get('filterCollabDateClear').disabled, true);
    assert.equal((await p.context.getPublicActivityById('joint')).partnerId, 'alpha');
    assert.equal(p.requests, 1);
});


test('inclusive date range combines with search and category and excludes undated records', async () => {
    const p = page();
    p.get('filterEventDate').value = '2020-08-17';
    p.get('filterEventDateEnd').value = '2026-11-11';
    await p.context.applyBrowseDateFilter('filterEvent');
    assert.match(p.get('eventGrid').innerHTML, /Research Day/);
    assert.match(p.get('eventGrid').innerHTML, /Alpha Workshop/);
    assert.doesNotMatch(p.get('eventGrid').innerHTML, /Beta Talk/);
    p.get('filterEvent').value = 'event';
    p.get('searchInput').value = 'Alpha';
    await p.context.handleSearch();
    await p.context.showSuggestions();
    assert.match(p.get('eventGrid').innerHTML, /Alpha Workshop/);
    assert.doesNotMatch(p.get('eventGrid').innerHTML, /Research Day|Beta Talk/);
    assert.match(p.get('searchSuggestions').innerHTML, /Alpha Workshop/);
    assert.equal(p.requests, 1);
});
test('one-sided ranges include only the available bound and clear resets both bounds', async () => {
    const p = page();
    p.get('filterEventDate').value = '2021-01-01';
    await p.context.applyBrowseDateFilter('filterEvent');
    assert.match(p.get('eventGrid').innerHTML, /Alpha Workshop/);
    assert.doesNotMatch(p.get('eventGrid').innerHTML, /Research Day|Beta Talk/);
    p.get('filterEventDate').value = '';
    p.get('filterEventDateEnd').value = '2021-01-01';
    await p.context.applyBrowseDateFilter('filterEvent');
    assert.match(p.get('eventGrid').innerHTML, /Research Day/);
    assert.doesNotMatch(p.get('eventGrid').innerHTML, /Alpha Workshop|Beta Talk/);
    assert.equal(p.get('filterEventDateClear').hidden, false);
    await p.context.clearBrowseDateFilter('filterEvent');
    assert.equal(p.get('filterEventDate').value, '');
    assert.equal(p.get('filterEventDateEnd').value, '');
    assert.equal(p.get('filterEventDateClear').hidden, true);
    assert.match(p.get('eventGrid').innerHTML, /Beta Talk/);
});
test('reversed ranges show an error and no results; correcting the range restores results', async () => {
    const p = page();
    p.get('filterEventDate').value = '2026-11-11';
    p.get('filterEventDateEnd').value = '2020-08-17';
    await p.context.applyBrowseDateFilter('filterEvent');
    assert.equal(p.get('filterEventDateError').hidden, false);
    assert.match(p.get('filterEventDateError').textContent, /วันที่สิ้นสุด/);
    assert.match(p.get('eventGrid').innerHTML, /ไม่พบกิจกรรม/);
    p.get('filterEventDate').value = '2020-08-17';
    await p.context.applyBrowseDateFilter('filterEvent');
    assert.equal(p.get('filterEventDateError').hidden, true);
    assert.match(p.get('eventGrid').innerHTML, /Research Day/);
});
test('organization ranges use a single public collaboration within both bounds, including co-hosts', async () => {
    const p = page();
    p.get('filterCollabDate').value = '2021-01-01';
    p.get('filterCollabDateEnd').value = '2027-01-01';
    await p.context.applyBrowseDateFilter('filterCollab');
    assert.match(p.get('collaboratorGrid').innerHTML, /Alpha Company/);
    assert.match(p.get('collaboratorGrid').innerHTML, /Beta University/);
    p.get('filterCollabDateEnd').value = '2025-12-31';
    await p.context.applyBrowseDateFilter('filterCollab');
    assert.match(p.get('collaboratorGrid').innerHTML, /ไม่พบผู้มีส่วนได้ส่วนเสีย/);
    assert.equal(p.requests, 1);
});


test('API failure uses one shared backup snapshot, shows notice and keeps date filters', async () => {
    const urls = [];
    const p = page(async url => {
        urls.push(url);
        if (url !== './data/partner-data-backup.json') throw new Error('Offline');
        return response();
    });
    p.get('filterEventDate').value = '2026-01-01';
    await Promise.all([p.context.renderCollaboratorCards(), p.context.renderEventCards()]);
    assert.equal(p.requests, 2);
    assert.equal(urls[1], './data/partner-data-backup.json');
    assert.match(p.get('backupDataNotice').textContent, /ข้อมูลสำรอง/);
    assert.equal(p.get('backupDataNotice').hidden, false);
    assert.match(p.get('eventGrid').innerHTML, /Alpha Workshop/);
    assert.doesNotMatch(p.get('eventGrid').innerHTML, /Research Day|Beta Talk/);
    await p.context.openModal('joint', 'activity');
    assert.equal(p.requests, 2);
    assert.equal((await p.context.getPublicActivityById('joint')).partnerId, 'alpha');
});

test('main public-only loading excludes records without explicit publication and invalid co-host entries', async () => {
    const p = page(async () => response([
        ...fixture,
        { id: 'unmarked', name: 'Unmarked Company', type: 'company' },
        { id: 'unmarked-event', title: 'Unmarked Event', partnerId: 'alpha' },
        { id: 'safe-event', title: 'Safe Event', partnerId: 'alpha', access_level: 'public', co_hosts: [null, 3, 'Beta'] }
    ]));
    assert.equal(await p.context.getPublicPartnerById('unmarked'), null);
    assert.equal(await p.context.getPublicActivityById('unmarked-event'), null);
    const beta = await p.context.getPublicPartnerById('beta');
    assert.ok(beta.collaborations.some(activity => activity.id === 'safe-event'));
    assert.equal((await p.context.getPublicActivityById('safe-event')).partnerId, 'alpha');
});
