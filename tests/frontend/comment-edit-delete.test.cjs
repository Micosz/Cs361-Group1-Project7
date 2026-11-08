const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicFeedbackSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'assets', 'public-feedback.js'),
    'utf8'
);

function createElement(tag) {
    const listeners = {};
    return {
        tagName: String(tag).toUpperCase(),
        className: '',
        textContent: '',
        innerHTML: '',
        type: '',
        value: '',
        required: false,
        disabled: false,
        maxLength: 0,
        hidden: false,
        isConnected: true,
        attributes: {},
        style: {},
        children: [],
        parentNode: null,
        dataset: {},
        onclick: null,
        onsubmit: null,
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        getAttribute(name) {
            return this.attributes[name];
        },
        classList: {
            classes: new Set(),
            add(...names) {
                for (const name of names) this.classes.add(name);
            },
            contains(name) {
                return this.classes.has(name);
            },
        },
        appendChild(child) {
            if (child.parentNode) child.remove();
            child.parentNode = this;
            this.children.push(child);
            return child;
        },
        append(...nodes) {
            for (const node of nodes) this.appendChild(node);
        },
        replaceChildren(...nodes) {
            for (const child of this.children) child.parentNode = null;
            this.children = [];
            this.append(...nodes);
        },
        remove() {
            if (!this.parentNode) return;
            const idx = this.parentNode.children.indexOf(this);
            if (idx >= 0) this.parentNode.children.splice(idx, 1);
            this.parentNode = null;
        },
        focus() {
            this.focused = true;
        },
        reset() {
            this.value = '';
        },
        addEventListener(event, fn) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
        },
        dispatchEvent(event) {
            const fns = listeners[event.type] || [];
            for (const fn of fns) fn(event);
        },
        querySelector(selector) {
            const matches = findAll(this, node => {
                if (selector.startsWith('.')) {
                    const cls = selector.slice(1);
                    return node.className.split(' ').includes(cls) || node.classList.contains(cls);
                }
                return false;
            });
            return matches[0] || null;
        },
        querySelectorAll(selector) {
            return findAll(this, node => {
                if (selector.startsWith('.')) {
                    const cls = selector.slice(1);
                    return node.className.split(' ').includes(cls) || node.classList.contains(cls);
                }
                return false;
            });
        },
    };
}

function findAll(root, predicate, acc = []) {
    if (predicate(root)) acc.push(root);
    for (const child of root.children || []) findAll(child, predicate, acc);
    return acc;
}

function setupHarness({ requestImpl, removeImpl, mutateImpl } = {}) {
    const requests = [];
    const removals = [];
    const mutations = [];
    let confirmCalled = false;

    const document = {
        createElement,
    };
    const window = {
        confirm: () => {
            confirmCalled = true;
            return true;
        },
        CstuAuth: {
            refresh: async () => ({ csrfToken: 'test-csrf', user: { id: 'u-1' } }),
            request: async (url, opts) => {
                requests.push({ url, opts });
                if (requestImpl) return requestImpl(url, opts);
                return { data: [], page: { nextCursor: null }, canCreate: true };
            },
            remove: async (url, version) => {
                removals.push({ url, version });
                if (removeImpl) return removeImpl(url, version);
                return { deleted: true };
            },
            mutate: async (url, payload, version) => {
                mutations.push({ url, payload, version });
                if (mutateImpl) return mutateImpl(url, payload, version);
                return { data: { version: version + 1 } };
            },
        },
    };

    const context = vm.createContext({
        window,
        document,
        crypto: { randomUUID: () => 'uuid-1234' },
        Event: class Event { constructor(type) { this.type = type; } },
        Object,
        Array,
        String,
        Number,
        Boolean,
        Map,
        Set,
        Error,
        encodeURIComponent,
        JSON,
    });
    vm.runInContext(publicFeedbackSource, context);

    return { window, requests, removals, mutations, didConfirm: () => confirmCalled };
}

test('author sees edit and delete buttons with clean classes and can delete comment', async () => {
    const comments = [
        {
            id: 'fb-own',
            version: 1,
            occurredOn: '2026-11-03',
            sourceType: 'participant',
            respondentType: 'student',
            comment: 'ความคิดเห็นของฉัน',
            canEdit: true,
            canDelete: true,
            likes: 0,
            dislikes: 0,
        },
        {
            id: 'fb-other',
            version: 1,
            occurredOn: '2026-11-03',
            sourceType: 'partner',
            respondentType: 'partner',
            comment: 'ความคิดเห็นของคนอื่น',
            canEdit: false,
            canDelete: false,
            likes: 2,
            dislikes: 0,
        },
    ];

    const h = setupHarness({
        requestImpl: async (url) => {
            if (url.includes('/feedback')) {
                return {
                    data: comments,
                    canCreate: true,
                    canReact: true,
                    page: { nextCursor: null },
                };
            }
            return { data: [] };
        },
    });

    const container = createElement('section');
    h.window.CstuPublicFeedback.mount(container, { id: 'act-1' }, 'activities', { scoped: true });

    // Wait for async load to finish
    await new Promise(r => setImmediate(r));

    const list = container.querySelector('.public-comment-list');
    assert.ok(list, 'comment list should exist');
    assert.equal(list.children.length, 2);

    // First comment (own): has edit and delete buttons inside .feedback-comment-actions
    const ownLi = list.children[0];
    const ownActions = ownLi.querySelector('.feedback-comment-actions');
    assert.ok(ownActions, 'own comment should have feedback-comment-actions');

    const editBtn = ownLi.querySelector('.feedback-edit-btn');
    assert.ok(editBtn, 'edit button should exist');
    assert.equal(editBtn.className, 'feedback-action-btn feedback-edit-btn');

    const deleteBtn = ownLi.querySelector('.feedback-delete-btn');
    assert.ok(deleteBtn, 'delete button should exist');
    assert.equal(deleteBtn.className, 'feedback-action-btn feedback-delete-btn');

    // Second comment (other): no edit or delete button
    const otherLi = list.children[1];
    const otherActions = otherLi.querySelector('.feedback-comment-actions');
    assert.equal(otherActions, null, 'other comment should NOT have feedback-comment-actions');

    // Test deleting own comment
    await deleteBtn.onclick();
    assert.ok(h.didConfirm(), 'window.confirm should have been prompted');
    assert.equal(h.removals.length, 1);
    assert.equal(h.removals[0].url, '/activities/act-1/feedback/fb-own');
    assert.equal(h.removals[0].version, 1);
});

test('public view without scoped does not render edit or delete buttons', async () => {
    const comments = [
        {
            id: 'fb-public',
            version: 1,
            occurredOn: '2026-11-03',
            comment: 'ความคิดเห็นสาธารณะ',
            canEdit: true,
            canDelete: true,
            likes: 0,
            dislikes: 0,
        },
    ];

    const h = setupHarness({
        requestImpl: async () => ({
            data: comments,
            page: { nextCursor: null },
        }),
    });

    const container = createElement('section');
    h.window.CstuPublicFeedback.mount(container, { id: 'act-1' }, 'activities', { scoped: false });

    await new Promise(r => setImmediate(r));

    const list = container.querySelector('.public-comment-list');
    assert.ok(list);
    const li = list.children[0];
    const actions = li.querySelector('.feedback-comment-actions');
    assert.equal(actions, null, 'public comments should not have edit/delete actions');
});

