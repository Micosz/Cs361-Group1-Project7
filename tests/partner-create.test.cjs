const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');

const workNavSource = fs.readFileSync('public/assets/work-navigation.js', 'utf8');
const selectionSource = fs.readFileSync('public/assets/selection-fields.js', 'utf8');
const basicFormsSource = fs.readFileSync('public/assets/basic-record-forms.js', 'utf8');
const roleMenuSource = fs.readFileSync('public/assets/role-menu.js', 'utf8');

function createDomNode(tag, ownerDoc) {
    const node = {
        tagName: String(tag).toUpperCase(),
        id: '',
        className: '',
        textContent: '',
        value: '',
        type: '',
        required: false,
        disabled: false,
        hidden: false,
        multiple: false,
        selected: false,
        size: 0,
        maxLength: -1,
        href: '',
        title: '',
        tabIndex: 0,
        parentElement: null,
        parentNode: null,
        children: [],
        attributes: {},
        dataset: {},
        style: {},
        listeners: {},
        classList: {
            _set: new Set(),
            add(...names) { names.forEach(n => this._set.add(n)); },
            remove(...names) { names.forEach(n => this._set.delete(n)); },
            toggle(n, force) {
                const on = force === undefined ? !this._set.has(n) : Boolean(force);
                if (on) this._set.add(n); else this._set.delete(n);
                return on;
            },
            contains(n) { return this._set.has(n); }
        },
        get isConnected() {
            let cur = this;
            while (cur) {
                if (cur === ownerDoc.body || cur.isRootConnected) return true;
                cur = cur.parentElement;
            }
            return false;
        },
        get options() {
            return this.tagName === 'SELECT' ? this.children.filter(c => c.tagName === 'OPTION') : [];
        },
        get selectedOptions() {
            if (this.tagName !== 'SELECT') return [];
            if (this.multiple) return this.options.filter(o => o.selected);
            return this.options.filter(o => o.value === this.value);
        },
        appendChild(child) {
            if (child.parentElement) {
                const idx = child.parentElement.children.indexOf(child);
                if (idx >= 0) child.parentElement.children.splice(idx, 1);
            }
            child.parentElement = this;
            child.parentNode = this;
            this.children.push(child);
            if (this.tagName === 'SELECT' && child.tagName === 'OPTION' && !this.multiple && this.options.length === 1 && !this.value) {
                this.value = child.value;
            }
            return child;
        },
        append(...items) {
            for (const item of items) {
                if (typeof item === 'string') {
                    const txt = createDomNode('#text', ownerDoc);
                    txt.textContent = item;
                    this.appendChild(txt);
                } else if (item) {
                    this.appendChild(item);
                }
            }
        },
        prepend(...items) {
            for (const item of [...items].reverse()) {
                if (item.parentElement) {
                    const idx = item.parentElement.children.indexOf(item);
                    if (idx >= 0) item.parentElement.children.splice(idx, 1);
                }
                item.parentElement = this;
                item.parentNode = this;
                this.children.unshift(item);
            }
        },
        insertBefore(newNode, refNode) {
            if (!refNode) return this.appendChild(newNode);
            if (newNode.parentElement) {
                const oldIdx = newNode.parentElement.children.indexOf(newNode);
                if (oldIdx >= 0) newNode.parentElement.children.splice(oldIdx, 1);
            }
            const idx = this.children.indexOf(refNode);
            newNode.parentElement = this;
            newNode.parentNode = this;
            if (idx >= 0) this.children.splice(idx, 0, newNode);
            else this.children.push(newNode);
            return newNode;
        },
        replaceChildren(...items) {
            for (const child of this.children) {
                child.parentElement = null;
                child.parentNode = null;
            }
            this.children = [];
            this.append(...items);
        },
        remove() {
            if (!this.parentElement) return;
            const idx = this.parentElement.children.indexOf(this);
            if (idx >= 0) this.parentElement.children.splice(idx, 1);
            this.parentElement = null;
            this.parentNode = null;
        },
        setAttribute(k, v) {
            this.attributes[k] = String(v);
            if (k.startsWith('data-')) {
                const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                this.dataset[camel] = String(v);
            }
        },
        getAttribute(k) { return this.attributes[k] ?? null; },
        addEventListener(type, fn, opts) {
            (this.listeners[type] ??= []).push({ fn, capture: Boolean(opts?.capture) });
        },
        removeEventListener(type, fn) {
            if (!this.listeners[type]) return;
            this.listeners[type] = this.listeners[type].filter(entry => entry.fn !== fn);
        },
        dispatchEvent(event) {
            let stoppedImmediate = false;
            event.stopImmediatePropagation = () => { stoppedImmediate = true; };
            event.preventDefault ??= () => { event.defaultPrevented = true; };
            const list = [...(this.listeners[event.type] || [])];
            for (const entry of list.filter(e => e.capture)) {
                entry.fn(event);
                if (stoppedImmediate) return !event.defaultPrevented;
            }
            if (typeof this['on' + event.type] === 'function') {
                this['on' + event.type](event);
            }
            for (const entry of list.filter(e => !e.capture)) {
                if (stoppedImmediate) break;
                entry.fn(event);
            }
            return !event.defaultPrevented;
        },
        matches(selector) {
            if (selector === '[data-selection-fields]') return 'selectionFields' in this.dataset;
            if (selector === 'p') return this.tagName === 'P';
            if (selector === 'div') return this.tagName === 'DIV';
            if (selector === 'dialog') return this.tagName === 'DIALOG';
            if (selector === 'fieldset.entry-section') return this.tagName === 'FIELDSET' && this.classList.contains('entry-section');
            if (selector.startsWith('#')) return this.id === selector.slice(1);
            return false;
        },
        closest(selector) {
            let cur = this;
            while (cur) {
                if (cur.matches?.(selector)) return cur;
                cur = cur.parentElement;
            }
            return null;
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },
        querySelectorAll(selector) {
            const found = [];
            const visit = cur => {
                for (const child of cur.children) {
                    if (child.matches?.(selector)) found.push(child);
                    visit(child);
                }
            };
            visit(this);
            return found;
        },
        focus() { this.focused = true; },
        close() { this.open = false; },
        showModal() { this.open = true; },
        getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 40 }; }
    };
    return node;
}

function makeHarness({ session, onRequest, onCreate, onMutate }) {
    const doc = { body: null, byId: {} };
    doc.body = createDomNode('body', doc);
    doc.body.isRootConnected = true;
    doc.createElement = tag => createDomNode(tag, doc);
    doc.getElementById = id => {
        if (doc.byId[id]) return doc.byId[id];
        return doc.body.querySelector('#' + id);
    };
    for (const [id, tag] of [
        ['authNavButtons', 'div'], ['role-menu', 'dialog'], ['role-menu-links', 'nav'],
        ['role-menu-status', 'p'], ['role-menu-logout', 'button'],
        ['role-menu-account', 'div'], ['close-role-menu', 'button']
    ]) {
        const el = createDomNode(tag, doc);
        el.id = id;
        doc.byId[id] = el;
        doc.body.appendChild(el);
    }
    const container = createDomNode('div', doc);
    doc.body.appendChild(container);

    const ctx = {
        window: null,
        document: doc,
        crypto,
        URL,
        URLSearchParams,
        Event,
        AbortController,
        setTimeout,
        clearTimeout,
        queueMicrotask,
        matchMedia: () => ({ matches: true }),
        addEventListener() {},
        CstuAuth: {
            enabled: () => true,
            refresh: async () => session,
            roles: s => [...new Set((s?.grants || []).filter(g => g.active !== false).map(g => g.role))],
            managedScopes: s => [...new Set((s?.grants || []).filter(g => g.active !== false && g.role === 'executive').map(g => g.scopeId))],
            request: async path => onRequest ? onRequest(path) : { data: [] },
            create: async (path, payload, key) => onCreate(path, payload, key),
            mutate: async (path, payload, version) => onMutate(path, payload, version)
        }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(workNavSource, ctx);
    vm.runInContext(selectionSource, ctx);
    vm.runInContext(basicFormsSource, ctx);
    return { ctx, doc, container };
}

test('coordinator gets partner create permission and menu item; unauthorized roles do not', async () => {
    const coordSession = {
        user: { id: 'u-coord', displayName: 'อาจารย์ ทดสอบ', accountType: 'tu' },
        grants: [{ role: 'coordinator', scopeId: 'cs-demo', active: true }],
        capabilities: []
    };
    const studentSession = {
        user: { id: 'u-student', displayName: 'นักศึกษา ทดสอบ', accountType: 'tu' },
        grants: [{ role: 'student', scopeId: 'cs-demo', active: true }],
        capabilities: []
    };
    const inactiveCoord = {
        user: { id: 'u-inactive', displayName: 'หมดสิทธิ์', accountType: 'tu' },
        grants: [{ role: 'coordinator', scopeId: 'cs-demo', active: false }],
        capabilities: []
    };
    const rolelessSession = {
        user: { id: 'u-emp', displayName: 'พนักงาน', accountType: 'tu' },
        grants: [],
        capabilities: []
    };

    const h = makeHarness({ session: coordSession });
    assert.equal(h.ctx.CstuWork.canCreate(coordSession, 'partners'), true);
    assert.equal(h.ctx.CstuWork.canCreate(coordSession, 'partners', 'cs-demo'), true);
    assert.equal(h.ctx.CstuWork.canCreate(coordSession, 'partners', 'other-scope'), false);

    assert.equal(h.ctx.CstuWork.canCreate(studentSession, 'partners'), false);
    assert.equal(h.ctx.CstuWork.canCreate(inactiveCoord, 'partners'), false);
    assert.equal(h.ctx.CstuWork.canCreate(rolelessSession, 'partners'), false);
    assert.equal(h.ctx.CstuWork.canCreate({ user: null, grants: [] }, 'partners'), false);

    vm.runInContext(roleMenuSource, h.ctx);
    await new Promise(r => setTimeout(r, 20));
    const links = h.doc.byId['role-menu-links'].children.map(a => ({
        label: a.children[0].textContent,
        href: a.href
    }));
    assert.deepEqual(links, [
        { label: 'เพิ่มคู่ความร่วมมือ', href: 'index.html?kind=partners&action=create#board-section' },
        { label: 'เพิ่มกิจกรรม', href: 'index.html?kind=activities&action=create#board-section' },
        { label: 'เพิ่มข้อตกลง', href: 'index.html?kind=agreements&action=create#board-section' },
        { label: 'เพิ่มการแลกเปลี่ยน', href: 'index.html?kind=exchanges&action=create#board-section' }
    ]);
});

test('coordinator partner form shows authorized scopes only, validates fields, saves without privileged fields, and reloads list', async () => {
    const requests = [];
    const creates = [];
    let reloaded = false;
    const savedRows = [];
    const coordSession = {
        user: { id: 'u-coord-a', displayName: 'อาจารย์ เอ', accountType: 'tu' },
        grants: [
            { role: 'coordinator', scopeId: 'cs-demo', active: true },
            { role: 'coordinator', scopeId: 'revoked-scope', active: false },
            { role: 'student', scopeId: 'student-scope', active: true }
        ],
        capabilities: []
    };
    const h = makeHarness({
        session: coordSession,
        onRequest: async path => { requests.push(path); return { data: [] }; },
        onCreate: async (path, payload, key) => {
            creates.push({ path, payload, key });
            const created = { id: 'partner-new-1', ...payload, publication: 'internal', responsibleUserIds: ['u-coord-a'], version: 1 };
            savedRows.push(created);
            return { data: created };
        }
    });

    const createHandler = h.ctx.CstuWork.handler('partners', 'create');
    createHandler({
        container: h.container,
        record: null,
        session: coordSession,
        reload: async () => { reloaded = true; }
    });

    const form = h.doc.getElementById('partner-entry-form');
    assert.ok(form, 'partner-entry-form should mount');
    const scopeSelect = h.doc.getElementById('basic-partners-scope');
    assert.deepEqual(scopeSelect.options.map(o => o.value), ['cs-demo']);

    // Coordinator must not see staff-only publication or responsibleUserIds controls, nor call /selection-users
    assert.equal(h.doc.getElementById('basic-partners-publication'), null);
    assert.equal(h.doc.getElementById('basic-partners-responsibleUserIds'), null);
    assert.equal(requests.length, 0);

    const nameInput = h.doc.getElementById('basic-partners-name');
    const typeSelect = h.doc.getElementById('basic-partners-type');
    const summaryInput = h.doc.getElementById('basic-partners-summary');
    const locationInput = h.doc.getElementById('basic-partners-location');
    const websiteInput = h.doc.getElementById('basic-partners-websiteUrl');
    const logoInput = h.doc.getElementById('basic-partners-logoPath');
    const descInput = h.doc.getElementById('basic-partners-fullDescription');
    const statusEl = form.children.find(c => c.attributes.role === 'status');

    assert.equal(nameInput.maxLength, 200);
    assert.equal(locationInput.maxLength, 200);
    assert.equal(summaryInput.maxLength, 2000);

    // 1. Whitespace-only required field blocked client-side
    nameInput.value = '   ';
    typeSelect.value = 'company';
    summaryInput.value = 'สรุปความร่วมมือ';
    locationInput.value = 'กรุงเทพมหานคร';
    await form.onsubmit({ preventDefault() {} });
    assert.equal(creates.length, 0);
    assert.match(statusEl.textContent, /ชื่อ/);

    // 2. Invalid website URL blocked client-side
    nameInput.value = 'บริษัท คู่ความร่วมมือใหม่ จำกัด';
    websiteInput.value = 'javascript:alert(1)';
    await form.onsubmit({ preventDefault() {} });
    assert.equal(creates.length, 0);
    assert.match(statusEl.textContent, /http/);

    // 3. Invalid logo path blocked client-side
    websiteInput.value = 'https://partner.example.org';
    logoInput.value = '../private/secret.png';
    await form.onsubmit({ preventDefault() {} });
    assert.equal(creates.length, 0);
    assert.match(statusEl.textContent, /resources\//);

    // 4. Valid coordinator submission succeeds, omits privileged fields, and triggers reload so saved item appears
    logoInput.value = 'resources/partner-logo.png';
    descInput.value = 'รายละเอียดความร่วมมือทางวิชาการและสหกิจศึกษา';
    await form.onsubmit({ preventDefault() {} });

    assert.equal(creates.length, 1);
    assert.equal(creates[0].path, '/partners');
    assert.ok(creates[0].key);
    assert.deepEqual({ ...creates[0].payload }, {
        name: 'บริษัท คู่ความร่วมมือใหม่ จำกัด',
        type: 'company',
        summary: 'สรุปความร่วมมือ',
        location: 'กรุงเทพมหานคร',
        websiteUrl: 'https://partner.example.org',
        logoPath: 'resources/partner-logo.png',
        fullDescription: 'รายละเอียดความร่วมมือทางวิชาการและสหกิจศึกษา',
        scopeId: 'cs-demo'
    });
    assert.equal('publication' in creates[0].payload, false);
    assert.equal('responsibleUserIds' in creates[0].payload, false);
    assert.equal(reloaded, true);
    assert.equal(savedRows.length, 1);
});

test('multi-scope staff + coordinator switches controls cleanly per selected scope without forbidden selection-users call', async () => {
    const requests = [];
    const creates = [];
    const mixedSession = {
        user: { id: 'u-mixed', displayName: 'อาจารย์ควบเจ้าหน้าที่', accountType: 'tu' },
        grants: [
            { role: 'staff', scopeId: 'scope-staff', active: true },
            { role: 'coordinator', scopeId: 'scope-coord', active: true }
        ],
        capabilities: []
    };
    const h = makeHarness({
        session: mixedSession,
        onRequest: async path => {
            requests.push(path);
            if (path.includes('scope-coord') && path.includes('kind=responsible')) {
                throw Object.assign(new Error('FORBIDDEN'), { status: 403 });
            }
            return { data: [{ id: 'u-mixed', displayName: 'อาจารย์ควบเจ้าหน้าที่' }] };
        },
        onCreate: async (path, payload, key) => {
            creates.push({ path, payload, key });
            return { data: { id: 'p-1', ...payload } };
        }
    });

    h.ctx.CstuWork.handler('partners', 'create')({
        container: h.container,
        record: null,
        session: mixedSession,
        reload: async () => {}
    });
    await new Promise(r => setTimeout(r, 10));

    const form = h.doc.getElementById('partner-entry-form');
    const scopeSelect = h.doc.getElementById('basic-partners-scope');
    const pubSelect = h.doc.getElementById('basic-partners-publication');
    assert.deepEqual(scopeSelect.options.map(o => o.value), ['scope-staff', 'scope-coord']);
    assert.equal(pubSelect.disabled, false);
    assert.deepEqual(requests, ['/selection-users?scopeId=scope-staff&kind=responsible']);

    // Switch to coordinator-only scope: must hide/disable publication, NOT request responsible users for scope-coord, and keep save enabled
    scopeSelect.value = 'scope-coord';
    scopeSelect.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 10));

    assert.equal(pubSelect.disabled, true);
    assert.equal(requests.some(r => r.includes('scope-coord')), false);

    h.doc.getElementById('basic-partners-name').value = 'องค์กรในขอบเขตผู้ประสานงาน';
    h.doc.getElementById('basic-partners-type').value = 'university';
    h.doc.getElementById('basic-partners-summary').value = 'ความร่วมมือวิจัย';
    h.doc.getElementById('basic-partners-location').value = 'ปทุมธานี';
    await form.onsubmit({ preventDefault() {} });

    assert.equal(creates.length, 1);
    assert.equal(creates[0].payload.scopeId, 'scope-coord');
    assert.equal('publication' in creates[0].payload, false);
    assert.equal('responsibleUserIds' in creates[0].payload, false);
});

test('unauthorized student session disables partner form save and never calls create API', async () => {
    const creates = [];
    const studentSession = {
        user: { id: 'u-std', displayName: 'นักศึกษา', accountType: 'tu' },
        grants: [{ role: 'student', scopeId: 'cs-demo', active: true }],
        capabilities: []
    };
    const h = makeHarness({
        session: studentSession,
        onCreate: async (path, payload) => { creates.push({ path, payload }); }
    });
    h.ctx.CstuWork.handler('partners', 'create')({
        container: h.container,
        record: null,
        session: studentSession,
        reload: async () => {}
    });
    const form = h.doc.getElementById('partner-entry-form');
    const scopeSelect = h.doc.getElementById('basic-partners-scope');
    assert.equal(scopeSelect.options.length, 0);
    await form.onsubmit({ preventDefault() {} });
    assert.equal(creates.length, 0);
});
