const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const scriptSource = fs.readFileSync('public/assets/script.js', 'utf8');
const recordsSource = fs.readFileSync('public/assets/records.js', 'utf8');
const workNavSource = fs.readFileSync('public/assets/work-navigation.js', 'utf8');

function createHarness({ activityAuthPromise = null, failFetch = false } = {}) {
    const elements = new Map();
    const makeNode = (tag = 'div', id = '') => {
        const node = {
            tagName: tag.toUpperCase(),
            id,
            className: '',
            textContent: '',
            innerHTML: '',
            value: 'all',
            hidden: false,
            disabled: false,
            open: false,
            scrollTop: 0,
            dataset: {},
            style: { display: '' },
            children: [],
            parentNode: null,
            isConnected: true,
            listeners: {},
            classList: {
                classes: new Set(),
                add(...names) { names.forEach(n => this.classes.add(n)); },
                remove(...names) { names.forEach(n => this.classes.delete(n)); },
                toggle(name, force) {
                    const next = force === undefined ? !this.classes.has(name) : Boolean(force);
                    if (next) this.classes.add(name); else this.classes.delete(name);
                    return next;
                },
                contains(name) { return this.classes.has(name); }
            },
            setAttribute(k, v) { this[k] = String(v); },
            removeAttribute(k) { delete this[k]; },
            getAttribute(k) { return this[k] ?? null; },
            addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
            dispatchEvent(event) { (this.listeners[event.type] || []).forEach(fn => fn(event)); },
            appendChild(child) {
                if (child) {
                    child.parentNode = node;
                    child.isConnected = true;
                    this.children.push(child);
                }
                return child;
            },
            append(...items) { items.forEach(item => typeof item === 'object' && this.appendChild(item)); },
            prepend(...items) { this.children.unshift(...items.filter(item => typeof item === 'object')); },
            before() {},
            after() {},
            remove() { this.isConnected = false; },
            replaceChildren(...items) {
                this.children = [];
                this.innerHTML = '';
                this.textContent = '';
                items.forEach(item => typeof item === 'object' && this.appendChild(item));
            },
            insertAdjacentElement() {},
            querySelector(sel) {
                if (sel === '.modal-content') return modalContent;
                return null;
            },
            querySelectorAll() { return []; },
            closest() { return null; },
            focus() { node.focused = (node.focused || 0) + 1; },
            showModal() { this.open = true; },
            close() {
                this.open = false;
                // Simulate queued close event per HTML dialog specification.
                queueMicrotask(() => this.dispatchEvent({ type: 'close' }));
            },
            elements: {
                namedItem(name) { return getOrCreate(`field-${name}`); }
            }
        };
        return node;
    };

    const getOrCreate = id => {
        if (!elements.has(id)) elements.set(id, makeNode('div', id));
        return elements.get(id);
    };

    const modalContent = makeNode('div');
    modalContent.scrollTop = 180;
    const detailModal = getOrCreate('detailModal');
    detailModal.style.display = 'none';
    const recordDetail = getOrCreate('record-detail');
    getOrCreate('home-records').parentNode = makeNode('main');

    const sampleRecords = [
        {
            id: 'PART-A',
            name: 'PART-A — Siam Digital Solutions',
            type: 'company',
            location: 'ข้อมูลสมมติสำหรับห้องเรียน',
            summary: 'ข้อมูลจำลอง Part A',
            visibility: 'public',
            businessRecord: true
        },
        {
            id: 'ACT-A02',
            title: 'ACT-A02 — Internship',
            type: 'event',
            partnerId: 'PART-A',
            partnerName: 'PART-A — Siam Digital Solutions',
            summary: 'ข้อมูลจำลอง Part A: กิจกรรม Internship ที่ผ่านมาของ PART-A — Siam Digital Solutions',
            visibility: 'public',
            businessRecord: true
        }
    ];

    class FakeDOMParser {
        parseFromString(str) {
            return {
                querySelectorAll: () => [],
                createTextNode: text => makeNode('text', text),
                body: { textContent: String(str || '') }
            };
        }
    }

    const windowObj = {
        location: {
            hostname: 'localhost',
            href: 'http://localhost/index.html',
            origin: 'http://localhost',
            pathname: '/index.html',
            search: '',
            replace() {}
        },
        addEventListener() {},
        dispatchEvent() {},
        getComputedStyle: () => ({ fontFamily: 'sans-serif', fontSize: '14px', fontWeight: '400', paddingLeft: '16px', paddingRight: '40px' }),
        CstuAuth: {
            enabled: () => true,
            roles: session => (session?.grants || []).map(g => g.role),
            refresh: async () => ({
                user: { id: 'u-staff-1' },
                grants: [{ scopeId: 'cs-demo', role: 'staff', active: true }],
                capabilities: []
            }),
            request: async path => {
                if (path === '/activities/ACT-A02' && activityAuthPromise) return await activityAuthPromise;
                if (path.startsWith('/activities/')) {
                    return { data: { id: 'ACT-A02', title: 'ACT-A02 — Internship', scopeId: 'cs-demo', publication: 'public' } };
                }
                if (path.startsWith('/partners/')) {
                    return { data: { id: 'PART-A', name: 'PART-A — Siam Digital Solutions', scopeId: 'cs-demo', publication: 'public' } };
                }
                return { data: [], count: 0, page: { nextCursor: null } };
            }
        }
    };

    const documentObj = {
        body: makeNode('body'),
        activeElement: makeNode('button', 'event-card-trigger'),
        getElementById: getOrCreate,
        createElement: tag => makeNode(tag),
        createTextNode: text => ({ nodeType: 3, textContent: text }),
        querySelector: sel => {
            if (sel === '#detailModal') return detailModal;
            if (sel === '#record-detail') return recordDetail;
            return null;
        },
        querySelectorAll: () => [],
        addEventListener() {}
    };

    const context = {
        window: windowObj,
        document: documentObj,
        location: windowObj.location,
        fetch: async () => {
            if (failFetch) throw new Error('network down');
            return { ok: true, json: async () => sampleRecords };
        },
        AbortController,
        URL,
        URLSearchParams,
        FormData: class { *[Symbol.iterator]() {} },
        Option: function(text, value) { return Object.assign(makeNode('option'), { textContent: text, value }); },
        Event: class { constructor(type) { this.type = type; } },
        DOMParser: FakeDOMParser,
        console: { warn() {}, error() {}, log() {} },
        setTimeout,
        clearTimeout,
        setInterval: () => 0,
        queueMicrotask
    };
    windowObj.document = documentObj;
    vm.createContext(context);
    vm.runInContext(workNavSource, context);
    vm.runInContext(scriptSource, context);
    windowObj.openModal = context.openModal;
    windowObj.closeModal = context.closeModal;
    windowObj.createActivityDetailContent = context.createActivityDetailContent;
    windowObj.createBrowseCard = context.createBrowseCard;
    vm.runInContext(recordsSource, context);

    return { context, detailModal, recordDetail, modalContent, getOrCreate, documentObj };
}

test('clicking partner link from open event card closes event dialog so modals never overlap', async () => {
    let resolveActivityAuth;
    const activityAuthPromise = new Promise(resolve => { resolveActivityAuth = resolve; });
    const h = createHarness({ activityAuthPromise });
    const trigger = h.documentObj.activeElement;

    // 1. Open event card -> opens #record-detail dialog while /activities/ACT-A02 is still in flight.
    const openingEvent = h.context.openModal('ACT-A02', 'activity');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.recordDetail.open, true);
    assert.equal(h.detailModal.style.display, 'none');

    // 2. Click partner link inside event dialog -> closes #record-detail and opens #detailModal.
    let prevented = false, stopped = false;
    await h.context.handlePartnerClick({
        preventDefault() { prevented = true; },
        stopPropagation() { stopped = true; }
    }, 'PART-A');
    // Wait for handlePartnerClick's openModal promise and queued dialog close microtask.
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(h.recordDetail.open, false);
    assert.equal(h.detailModal.style.display, 'flex');
    assert.equal(h.getOrCreate('modalTitle').textContent, 'PART-A — Siam Digital Solutions');
    assert.equal(h.modalContent.scrollTop, 0);
    // Closing #record-detail for modal switch must not yank focus back to background card trigger.
    assert.equal(trigger.focused || 0, 0);

    // Late resolution of /activities/ACT-A02 must not mutate closed #record-detail.
    resolveActivityAuth({ data: { id: 'ACT-A02', title: 'ACT-A02 — Internship', scopeId: 'cs-demo', publication: 'public' } });
    await openingEvent;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.recordDetail.open, false);
    assert.equal(h.getOrCreate('detail-fields').children.length, 0);
});

test('switching from partner modal back to event card closes partner modal without overlap', async () => {
    const h = createHarness();

    await h.context.openModal('PART-A', 'partner');
    assert.equal(h.detailModal.style.display, 'flex');
    assert.equal(h.recordDetail.open, false);

    await h.context.openModal('ACT-A02', 'activity');
    assert.equal(h.detailModal.style.display, 'none');
    assert.equal(h.recordDetail.open, true);
    assert.equal(h.getOrCreate('detail-title').textContent, 'ACT-A02 — Internship');
});

test('openModal error fallback still closes open event dialog before showing detailModal', async () => {
    const h = createHarness({ failFetch: true });
    h.recordDetail.showModal();
    assert.equal(h.recordDetail.open, true);

    await h.context.openModal('PART-A', 'partner');
    assert.equal(h.recordDetail.open, false);
    assert.equal(h.detailModal.style.display, 'flex');
    assert.equal(h.getOrCreate('modalTitle').textContent, 'โหลดข้อมูลไม่สำเร็จ');
});
