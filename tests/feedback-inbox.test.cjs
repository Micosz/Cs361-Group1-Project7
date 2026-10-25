const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const authSource = fs.readFileSync('public/assets/auth-client.js', 'utf8');
const workNavSource = fs.readFileSync('public/assets/work-navigation.js', 'utf8');
const feedbackInboxSource = fs.readFileSync('public/assets/feedback-inbox.js', 'utf8');
const recordsSource = fs.readFileSync('public/assets/records.js', 'utf8');
const roleMenuSource = fs.readFileSync('public/assets/role-menu.js', 'utf8');
const openingSource = fs.readFileSync('public/assets/opening.js', 'utf8');

function createPortalHarness({ reducedMotion = false } = {}) {
    const elements = new Map();
    const mutationObservers = [];
    const boardEvents = [];
    const scrollCalls = [];

    const notifyBodyMutation = target => {
        if (target !== bodyNode) return;
        for (const obs of mutationObservers) {
            if (obs.target === bodyNode) obs.callback([{ target: bodyNode, attributeName: 'class' }]);
        }
    };

    const makeNode = (tag = 'div', id = '') => {
        const node = {
            tagName: tag.toUpperCase(),
            id,
            className: '',
            textContent: '',
            innerHTML: '',
            href: '',
            title: '',
            type: '',
            placeholder: '',
            value: id === 'filterCollab' || id === 'filterEvent' ? 'all' : '',
            checked: false,
            hidden: false,
            disabled: false,
            open: false,
            offsetTop: id === 'board-section' ? 900 : 0,
            offsetHeight: 70,
            dataset: {},
            attributes: {},
            style: { display: '', overflow: '', cssText: '' },
            children: [],
            parentNode: null,
            isConnected: true,
            listeners: {},
            classList: {
                classes: new Set(),
                add(...names) { names.forEach(n => this.classes.add(n)); notifyBodyMutation(node); },
                remove(...names) { names.forEach(n => this.classes.delete(n)); notifyBodyMutation(node); },
                toggle(name, force) {
                    const next = force === undefined ? !this.classes.has(name) : Boolean(force);
                    if (next) this.classes.add(name); else this.classes.delete(name);
                    notifyBodyMutation(node);
                    return next;
                },
                contains(name) { return this.classes.has(name); }
            },
            setAttribute(k, v) { this.attributes[k] = String(v); },
            removeAttribute(k) { delete this.attributes[k]; },
            getAttribute(k) { return this.attributes[k] ?? null; },
            addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
            dispatchEvent(event) { (this.listeners[event.type] || []).forEach(fn => fn(event)); },
            appendChild(child) {
                if (child && typeof child === 'object') {
                    child.parentNode = node;
                    child.isConnected = true;
                    this.children.push(child);
                }
                return child;
            },
            append(...items) { items.forEach(item => typeof item === 'object' && this.appendChild(item)); },
            prepend(...items) {
                const objs = items.filter(item => typeof item === 'object');
                objs.forEach(c => { c.parentNode = node; c.isConnected = true; });
                this.children.unshift(...objs);
            },
            before() {},
            after() {},
            remove() {
                this.isConnected = false;
                if (this.parentNode) {
                    this.parentNode.children = this.parentNode.children.filter(c => c !== this);
                }
            },
            contains(target) {
                let cur = target;
                while (cur) {
                    if (cur === node) return true;
                    cur = cur.parentNode;
                }
                return false;
            },
            replaceChildren(...items) {
                this.children.forEach(c => { c.parentNode = null; c.isConnected = false; });
                this.children = [];
                this.innerHTML = '';
                this.textContent = '';
                items.forEach(item => typeof item === 'object' && this.appendChild(item));
            },
            querySelector(sel) {
                if (sel === 'button') return this.children.find(c => c.tagName === 'BUTTON') || null;
                if (sel === '.account-summary') return this.children.find(c => c.className === 'account-summary') || null;
                if (sel === '.hero-content') return heroContent;
                if (sel === '.hero-btn') return heroBtn;
                return null;
            },
            querySelectorAll(sel) {
                if (sel === '.float-card') return [floatCard];
                return [];
            },
            closest(sel) {
                if (sel === 'a[href]') {
                    let cur = node;
                    while (cur) {
                        if (cur.tagName === 'A' && cur.href) return cur;
                        cur = cur.parentNode;
                    }
                    return null;
                }
                if (sel === 'a, button, .account-details') {
                    let cur = node;
                    while (cur) {
                        if (cur.tagName === 'A' || cur.tagName === 'BUTTON' || cur.className === 'account-details') return cur;
                        cur = cur.parentNode;
                    }
                    return null;
                }
                return null;
            },
            focus() { node.focused = (node.focused || 0) + 1; },
            getBoundingClientRect: () => ({ top: 800, left: 0, right: 600, bottom: 900, width: 600, height: 100 }),
            showModal() {
                if (this.open) {
                    const err = new Error("Failed to execute 'showModal' on 'HTMLDialogElement': The element already has an 'open' attribute.");
                    err.name = 'InvalidStateError';
                    throw err;
                }
                this.open = true;
            },
            close() {
                if (!this.open) return;
                this.open = false;
                this.dispatchEvent({ type: 'close' });
            },
            animate: () => ({ cancel() {}, finish() {}, finished: Promise.resolve() }),
            elements: {
                namedItem(name) { return getOrCreate(`field-${name}`); }
            }
        };
        return node;
    };

    const getOrCreate = id => {
        if (!elements.has(id)) {
            const tag = id === 'role-menu' || id === 'record-detail' ? 'dialog' : 'div';
            elements.set(id, makeNode(tag, id));
        }
        return elements.get(id);
    };

    const bodyNode = makeNode('body');
    const mainNode = makeNode('main');
    const homeRecords = getOrCreate('home-records');
    mainNode.appendChild(homeRecords);
    const boardScene = makeNode('div');
    boardScene.className = 'board-scene';
    boardScene.offsetTop = 960;
    const heroSection = makeNode('section');
    heroSection.className = 'hero-section';
    const heroContent = makeNode('div');
    heroContent.className = 'hero-content';
    const heroBtn = makeNode('a');
    heroBtn.className = 'hero-btn';
    const floatCard = makeNode('div');
    floatCard.className = 'float-card';
    const navbar = makeNode('nav');
    navbar.className = 'navbar';
    const searchBtn = makeNode('button');
    searchBtn.className = 'search-btn';
    const searchInput = getOrCreate('searchInput');
    getOrCreate('collaboratorGrid');

    const session = {
        user: { id: 'u-exec-demo', displayName: 'Executive Demo', accountType: 'demo' },
        grants: [{ scopeId: 'cs-demo', role: 'executive', active: true }],
        capabilities: [{ scopeId: 'cs-demo', name: 'manageRoles', active: true }],
        csrfToken: 'b'.repeat(64)
    };

    const feedbackRows = [
        {
            id: 'FB-1',
            parentType: 'activity',
            parentId: 'ACT-A02',
            parentTitle: 'ACT-A02 — Internship',
            sourceType: 'participant',
            occurredOn: '2026-10-25',
            comment: 'ได้เรียนรู้การทำงานจริงดีมาก',
            improvement: 'ควรเพิ่มเวลาช่วง Q&A'
        }
    ];

    const docListeners = {};
    const winListeners = {};
    const documentObj = {
        body: bodyNode,
        documentElement: makeNode('html'),
        getElementById: getOrCreate,
        createElement: tag => makeNode(tag),
        createTextNode: text => ({ nodeType: 3, textContent: text }),
        querySelector: sel => {
            if (sel === '#authNavButtons button') return getOrCreate('authNavButtons').querySelector('button');
            if (sel === '.hero-section') return heroSection;
            if (sel === '#collaboratorGrid') return getOrCreate('collaboratorGrid');
            if (sel === '.board-scene') return boardScene;
            if (sel === '.navbar') return navbar;
            if (sel === '.search-btn') return searchBtn;
            if (sel === '#searchInput') return searchInput;
            return null;
        },
        querySelectorAll: () => [],
        addEventListener(type, fn) { (docListeners[type] ??= []).push(fn); },
        clickLink(linkNode) {
            const event = {
                type: 'click',
                target: linkNode,
                button: 0,
                detail: 1,
                defaultPrevented: false,
                preventDefault() { this.defaultPrevented = true; }
            };
            (docListeners.click || []).forEach(fn => fn(event));
            return event;
        }
    };

    const locationObj = {
        hostname: 'localhost',
        href: 'http://localhost/index.html',
        origin: 'http://localhost',
        pathname: '/index.html',
        search: '',
        hash: '',
        replace() {}
    };

    const windowObj = {
        document: documentObj,
        location: locationObj,
        CSTU_AUTH_CONFIG: { enabled: true },
        innerHeight: 900,
        innerWidth: 1440,
        scrollY: 0,
        history: {
            scrollRestoration: 'auto',
            pushState(_s, _t, url) { locationObj.href = new URL(url, locationObj.href).href; },
            replaceState(_s, _t, url) {
                const u = new URL(url, locationObj.href);
                locationObj.href = u.href;
                locationObj.search = u.search;
                locationObj.hash = u.hash;
            }
        },
        scrollTo(arg1, arg2) {
            const top = typeof arg1 === 'object' ? arg1.top : arg2;
            windowObj.scrollY = top;
            scrollCalls.push(typeof arg1 === 'object' ? { ...arg1 } : { top: arg2, left: arg1 });
        },
        addEventListener(type, fn) { (winListeners[type] ??= []).push(fn); },
        dispatchEvent(event) {
            if (event.type === 'cstu:board') boardEvents.push(event.type);
            (winListeners[event.type] || []).forEach(fn => fn(event));
        },
        getComputedStyle: () => ({ top: '12px' }),
        matchMedia: query => ({
            matches: query.includes('reduce') ? reducedMotion : false,
            addEventListener() {},
            removeEventListener() {}
        }),
        requestAnimationFrame: fn => { fn(); return 1; },
        cancelAnimationFrame() {},
        createBrowseCard: row => makeNode('article', row.id),
        closeModal() {}
    };

    class FakeMutationObserver {
        constructor(callback) { this.callback = callback; this.target = null; }
        observe(target) { this.target = target; mutationObservers.push(this); }
        disconnect() { this.target = null; }
    }

    const storage = new Map();
    const context = {
        window: windowObj,
        document: documentObj,
        location: locationObj,
        history: windowObj.history,
        innerHeight: 900,
        innerWidth: 1440,
        scrollY: 0,
        CSTU_AUTH_CONFIG: windowObj.CSTU_AUTH_CONFIG,
        localStorage: {
            getItem: k => storage.get(k) ?? null,
            setItem: (k, v) => storage.set(k, String(v))
        },
        fetch: async url => {
            if (String(url).startsWith('/api/auth/session')) {
                return { ok: true, status: 200, text: async () => JSON.stringify(session), headers: { get: () => 'application/json' } };
            }
            if (String(url).startsWith('/api/feedback')) {
                return { ok: true, status: 200, text: async () => JSON.stringify({ data: feedbackRows, count: 1, page: { nextCursor: null } }), headers: { get: () => 'application/json' } };
            }
            return { ok: true, status: 200, text: async () => JSON.stringify({ data: [], count: 0, page: { nextCursor: null } }), headers: { get: () => 'application/json' } };
        },
        AbortController,
        MutationObserver: FakeMutationObserver,
        URL,
        URLSearchParams,
        FormData: class { *[Symbol.iterator]() {} },
        Option: function(text, value) { return Object.assign(makeNode('option'), { textContent: text, value }); },
        Event: class { constructor(type) { this.type = type; } },
        matchMedia: windowObj.matchMedia,
        getComputedStyle: windowObj.getComputedStyle,
        requestAnimationFrame: windowObj.requestAnimationFrame,
        cancelAnimationFrame: windowObj.cancelAnimationFrame,
        setTimeout,
        clearTimeout,
        queueMicrotask,
        console
    };

    vm.createContext(context);
    vm.runInContext(authSource, context);
    vm.runInContext(workNavSource, context);
    vm.runInContext(feedbackInboxSource, context);
    vm.runInContext(openingSource, context);
    vm.runInContext(recordsSource, context);
    vm.runInContext(roleMenuSource, context);

    return { context, windowObj, documentObj, elements, getOrCreate, boardScene, boardEvents, scrollCalls };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 25));

test('Feedback Inbox renders back button and clicking it returns cleanly to Information Board', async () => {
    const h = createPortalHarness();
    await flush();

    // Initially on home partners view with desktop scene-ready enabled
    assert.equal(h.documentObj.body.classList.contains('scene-ready'), true);
    assert.equal(h.documentObj.body.classList.contains('feedback-inbox-view'), false);

    // Executive opens Menu and clicks "รวม Feedback"
    const menuTrigger = h.getOrCreate('authNavButtons').querySelector('button');
    assert.ok(menuTrigger, 'Menu button should render for Executive');
    await menuTrigger.onclick({ detail: 1 });

    const feedbackLink = h.getOrCreate('role-menu-links').children.find(a => a.children[0]?.textContent === 'รวม Feedback');
    assert.ok(feedbackLink, 'Menu should include รวม Feedback link');

    h.boardEvents.length = 0;
    h.documentObj.clickLink(feedbackLink);
    await flush();

    // Feedback Inbox state & Back button assertions
    assert.equal(h.documentObj.body.classList.contains('feedback-inbox-view'), true);
    assert.equal(h.documentObj.body.classList.contains('scene-ready'), false, 'opening.js must disable scene-ready in feedback-inbox-view');
    assert.equal(h.boardScene.style.transform || '', '', 'board-scene inline transform must be cleared');
    assert.equal(h.boardEvents.length, 0, 'Navigating into Feedback Inbox must not trigger hero board scroll');
    assert.equal(h.getOrCreate('records-title').textContent, 'รวม Feedback');

    const backLinks = h.getOrCreate('record-links').children;
    assert.equal(backLinks.length, 1, 'Feedback Inbox must render a back button');
    assert.equal(backLinks[0].className, 'feedback-inbox-back');
    assert.equal(backLinks[0].textContent, '← กลับหน้าหลัก');
    assert.equal(h.getOrCreate('records-content').children.length, 3, 'Toolbar, status, and feedback list should be rendered');

    // Click Back button -> returns to Information Board (partners)
    h.documentObj.clickLink(backLinks[0]);
    await flush();

    assert.equal(h.documentObj.body.classList.contains('feedback-inbox-view'), false);
    assert.equal(h.documentObj.body.classList.contains('scene-ready'), true);
    assert.equal(h.getOrCreate('record-links').children.length, 0, 'Back link should be removed outside Feedback Inbox');
    assert.equal(h.getOrCreate('tabCollab').classList.contains('active'), true);
    assert.ok(h.boardEvents.length >= 1, 'Returning to board should scroll to #board-section');
});

test('Executive reopening Menu and opening Role Manager from Feedback Inbox preserves Feedback Inbox view and content', async () => {
    const h = createPortalHarness({ reducedMotion: false });
    await flush();

    const menuTrigger = h.getOrCreate('authNavButtons').querySelector('button');
    const roleMenu = h.getOrCreate('role-menu');

    // 1. Open Menu -> navigate to "รวม Feedback"
    await menuTrigger.onclick({ detail: 1 });
    const feedbackLink = h.getOrCreate('role-menu-links').children.find(a => a.children[0]?.textContent === 'รวม Feedback');
    h.documentObj.clickLink(feedbackLink);
    await flush();

    assert.equal(roleMenu.open, false);
    assert.equal(h.documentObj.body.classList.contains('feedback-inbox-view'), true);
    assert.equal(h.getOrCreate('records-content').children.length, 3);

    // 2. Reopen Menu again on Feedback Inbox, close via Close button (starts 500ms animated close where roleMenu.open stays true),
    //    and immediately click Menu again within 500ms — must NOT throw InvalidStateError!
    await menuTrigger.onclick({ detail: 1 });
    assert.equal(roleMenu.open, true);
    assert.equal(roleMenu.classList.contains('is-open'), true);
    assert.equal(h.documentObj.body.classList.contains('feedback-inbox-view'), true);

    h.getOrCreate('close-role-menu').onclick({ detail: 1 });
    assert.equal(roleMenu.open, true, 'Dialog remains open during 500ms slide-up transition');
    assert.equal(roleMenu.classList.contains('is-open'), false);

    await assert.doesNotReject(() => menuTrigger.onclick({ detail: 1 }));
    assert.equal(roleMenu.open, true);
    assert.equal(roleMenu.classList.contains('is-open'), true);

    // 3. Click "จัดการสิทธิ์ผู้ใช้" from Menu while still on "รวม Feedback"
    h.boardEvents.length = 0;
    const rolesLink = h.getOrCreate('role-menu-links').children.find(a => a.children[0]?.textContent === 'จัดการสิทธิ์ผู้ใช้');
    assert.ok(rolesLink, 'Executive menu should include จัดการสิทธิ์ผู้ใช้');
    h.documentObj.clickLink(rolesLink);
    await flush();

    // Role Manager modal opens cleanly WITHOUT corrupting Feedback Inbox layout or wiping its cards!
    assert.equal(roleMenu.open, false);
    assert.equal(h.getOrCreate('record-detail').open, true);
    assert.equal(h.getOrCreate('detail-title').textContent, 'จัดการสิทธิ์ผู้ใช้');
    assert.equal(h.documentObj.body.classList.contains('feedback-inbox-view'), true, 'Must keep feedback-inbox-view so hero/tabs never bleed onto Feedback Inbox');
    assert.equal(h.getOrCreate('records-title').textContent, 'รวม Feedback');
    assert.equal(h.getOrCreate('records-content').children.length, 3, 'Feedback Inbox toolbar and cards must NOT be cleared by openRoles()');
    assert.equal(h.getOrCreate('record-links').children.length, 1, 'Back button must remain intact');
    assert.equal(h.boardEvents.length, 0, 'openRoles() must not trigger hero scroll while in Feedback Inbox');
});

