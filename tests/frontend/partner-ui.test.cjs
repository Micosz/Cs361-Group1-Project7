const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const contactsSource = fs.readFileSync('public/assets/partner-contacts.js', 'utf8');
const historySource = fs.readFileSync('public/assets/partner-history.js', 'utf8');
const workNavSource = fs.readFileSync('public/assets/work-navigation.js', 'utf8');

function createSimpleDom() {
    const makeElement = (tag) => {
        const classes = new Set();
        const el = {
            tagName: tag.toUpperCase(),
            children: [],
            parentNode: null,
            isConnected: true,
            get className() { return Array.from(classes).join(' '); },
            set className(val) {
                classes.clear();
                (val || '').split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
            },
            classList: {
                add(...names) { names.forEach(n => classes.add(n)); },
                remove(...names) { names.forEach(n => classes.delete(n)); },
                contains(n) { return classes.has(n); }
            },
            style: {},
            textContent: '',
            innerHTML: '',
            setAttribute(k, v) { this[k] = String(v); },
            getAttribute(k) { return this[k] ?? null; },
            appendChild(child) {
                if (child) {
                    child.parentNode = el;
                    el.children.push(child);
                }
                return child;
            },
            append(...items) {
                items.forEach(item => {
                    if (typeof item === 'string') {
                        el.textContent += item;
                    } else if (item) {
                        el.appendChild(item);
                    }
                });
            },
            replaceChildren(...items) {
                el.children = [];
                el.textContent = '';
                items.forEach(item => {
                    if (typeof item === 'string') {
                        el.textContent += item;
                    } else if (item) {
                        el.appendChild(item);
                    }
                });
            },
            remove() { el.isConnected = false; },
            querySelector(sel) {
                const find = (node) => {
                    for (const c of node.children) {
                        if (sel.startsWith('.') && c.classList?.contains(sel.slice(1))) return c;
                        if (c.tagName === sel.toUpperCase()) return c;
                        const match = find(c);
                        if (match) return match;
                    }
                    return null;
                };
                return find(el);
            },
            querySelectorAll(sel) {
                const results = [];
                const search = (node) => {
                    for (const c of node.children) {
                        if (sel.startsWith('.') && c.classList?.contains(sel.slice(1))) results.push(c);
                        else if (c.tagName === sel.toUpperCase()) results.push(c);
                        search(c);
                    }
                };
                search(el);
                return results;
            }
        };
        return el;
    };
    return { makeElement };
}

test('PartnerContacts renders modern cards with name, position badge, and actions', async () => {
    const { makeElement } = createSimpleDom();
    const host = makeElement('section');

    const sampleContacts = [
        { id: 'c-1', name: 'Dr.Pepper', position: 'รอง', email: 'pepper@dome.tu.ac.th', phone: '081-234-5678', version: 1 }
    ];

    const windowObj = {
        CstuAuth: {
            request: async (url) => ({ data: sampleContacts }),
            remove: async () => {},
            mutate: async () => {},
            create: async () => {}
        },
        CstuWork: null,
        crypto: { randomUUID: () => 'uuid-123' },
        confirm: () => true
    };

    const context = vm.createContext({
        window: windowObj,
        document: {
            createElement: (tag) => makeElement(tag)
        }
    });

    vm.runInContext(workNavSource, context);
    vm.runInContext(contactsSource, context);

    const session = {
        user: { id: 'u-staff' },
        grants: [{ role: 'staff', scopeId: 'cs', active: true }]
    };
    const partner = { id: 'p-1', scopeId: 'cs' };

    await windowObj.PartnerContacts.mount(host, partner, session);

    assert.ok(host.classList.contains('partner-contacts-section'), 'Host should have partner-contacts-section class');
    const cards = host.querySelectorAll('.partner-contact-card');
    assert.equal(cards.length, 1, 'Should render 1 contact card');

    const nameNode = host.querySelector('.contact-name');
    assert.ok(nameNode, 'Contact name element exists');
    assert.equal(nameNode.textContent, 'Dr.Pepper');

    const posNode = host.querySelector('.contact-pos-badge');
    assert.ok(posNode, 'Contact position badge exists');
    assert.equal(posNode.textContent, 'รอง');

    const editBtn = host.querySelector('.btn-edit-sm');
    assert.ok(editBtn, 'Edit button exists');

    const delBtn = host.querySelector('.btn-del-sm');
    assert.ok(delBtn, 'Delete button exists');
    assert.equal(delBtn.getAttribute('aria-label'), 'ลบผู้ติดต่อ Dr.Pepper');
});

test('PartnerHistory renders modern cards with date, kind badge, and note', async () => {
    const { makeElement } = createSimpleDom();
    const container = makeElement('section');

    const sampleHistory = [
        { id: 'h-1', occurredOn: '2026-01-01', kind: 'meeting', note: 'คุยเยอะ', referenceId: null }
    ];

    const windowObj = {
        CstuAuth: {
            request: async (url) => ({ data: sampleHistory, page: {} }),
            mutate: async () => {},
            create: async () => {}
        },
        CstuWork: null,
        crypto: { randomUUID: () => 'uuid-456' }
    };

    const context = vm.createContext({
        window: windowObj,
        document: {
            createElement: (tag) => makeElement(tag)
        }
    });

    vm.runInContext(workNavSource, context);
    vm.runInContext(historySource, context);

    const session = {
        user: { id: 'u-staff' },
        grants: [{ role: 'staff', scopeId: 'cs', active: true }]
    };
    const partner = { id: 'p-1', scopeId: 'cs' };

    await windowObj.PartnerHistory.mount(container, partner, session);

    assert.ok(container.classList.contains('partner-history-section'), 'Container should have partner-history-section class');
    const cards = container.querySelectorAll('.partner-history-card');
    assert.equal(cards.length, 1, 'Should render 1 history card');

    const kindNode = container.querySelector('.history-kind');
    assert.ok(kindNode, 'Kind badge exists');
    assert.ok(kindNode.classList.contains('kind-meeting'), 'Kind meeting class applied');

    const noteNode = container.querySelector('.history-note');
    assert.ok(noteNode, 'Note element exists');
    assert.equal(noteNode.textContent, 'คุยเยอะ');
});
