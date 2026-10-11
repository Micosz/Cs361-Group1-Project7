const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/assets/agreement.js', 'utf8');

function mockDom() {
    class Element extends EventTarget {
        constructor(tagName = 'div') {
            super();
            this.tagName = tagName.toUpperCase();
            this.id = '';
            this.className = '';
            this.style = {};
            this.children = [];
            this.parentNode = null;
            this.attributes = new Map();
            this._textContent = '';
            this.open = false;
            this.value = '';
            this.disabled = false;
        }

        get textContent() {
            return this._textContent;
        }

        set textContent(val) {
            this._textContent = String(val);
            this.children = [];
        }

        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        }

        append(...children) {
            for (const c of children) {
                if (typeof c === 'string') {
                    const textNode = new Element('text');
                    textNode.textContent = c;
                    this.appendChild(textNode);
                } else {
                    this.appendChild(c);
                }
            }
        }

        replaceChildren(...children) {
            this.children = [];
            this._textContent = '';
            this.append(...children);
        }

        querySelector(sel) {
            const match = el => {
                if (sel.startsWith('#') && el.id === sel.slice(1)) return el;
                if (sel.startsWith('.') && el.className.split(' ').includes(sel.slice(1))) return el;
                if (el.tagName.toLowerCase() === sel.toLowerCase()) return el;
                for (const c of el.children) {
                    const found = match(c);
                    if (found) return found;
                }
                return null;
            };
            for (const c of this.children) {
                const found = match(c);
                if (found) return found;
            }
            return null;
        }

        setAttribute(k, v) {
            this.attributes.set(k, v);
        }

        showModal() {
            this.open = true;
        }

        close() {
            this.open = false;
        }
    }

    const elementsById = new Map();
    const body = new Element('body');

    const document = {
        body,
        activeElement: null,
        createElement(tag) {
            const el = new Element(tag);
            return el;
        },
        getElementById(id) {
            const find = el => {
                if (el.id === id) return el;
                for (const c of el.children) {
                    const res = find(c);
                    if (res) return res;
                }
                return null;
            };
            return find(body);
        },
    };

    const window = new EventTarget();
    window.document = document;

    return { window, document, body };
}

function setup(mockAuth = {}) {
    const { window, document, body } = mockDom();
    window.CstuAuth = {
        create: async () => ({ data: { id: 'ag-1', version: 1 } }),
        mutate: async () => ({ data: { id: 'ag-1', version: 2 } }),
        request: async () => ({ data: { id: 'ag-1', version: 1 } }),
        ...mockAuth,
    };

    vm.runInNewContext(source, {
        window,
        document,
        Event,
        CustomEvent: Event,
        setTimeout,
        clearTimeout,
    });

    return { window, document, body, component: window.AgreementComponent };
}

test('renderDetail renders agreement fields safely with textContent', () => {
    const { component, body } = setup();
    const fakeAgreement = {
        id: 'ag-001',
        title: '<script>alert(1)</script> Safe Title',
        agreementType: 'MoU',
        status: 'draft',
        scopeId: 'cs-demo',
        partnerIds: ['p-1', 'p-2'],
        startDate: '2026-10-01',
        endDate: '2027-09-30',
        renewalNote: 'Renewal review',
        internalNote: 'Internal note',
    };

    component.renderDetail(fakeAgreement);

    const dialog = body.querySelector('#agreement-dialog');
    assert.ok(dialog);
    assert.equal(dialog.open, true);

    // Verify script tags are NOT interpreted as HTML, but rendered via textContent
    const titleEl = dialog.querySelector('h2');
    assert.equal(titleEl.textContent, '<script>alert(1)</script> Safe Title');

    // Extension points exist
    assert.ok(dialog.querySelector('#agreement-status-section'));
    assert.ok(dialog.querySelector('#agreement-documents-section'));
});

test('renderForm creates accessible form and validates reversed dates before submitting', async () => {
    let createCalled = false;
    const { component, body } = setup({
        create: async () => {
            createCalled = true;
            return { data: { id: 'ag-new', version: 1 } };
        },
    });

    component.renderForm();
    const dialog = body.querySelector('#agreement-dialog');
    const form = dialog.querySelector('#agreement-edit-form');
    assert.ok(form);

    const titleInput = dialog.querySelector('#agreement-form-title');
    const startInput = dialog.querySelector('#agreement-form-start-date');
    const endInput = dialog.querySelector('#agreement-form-end-date');
    const partnerInput = dialog.querySelector('#agreement-form-partners');

    titleInput.value = 'Reversed Date Agreement';
    partnerInput.value = 'partner-001';
    startInput.value = '2027-01-01';
    endInput.value = '2026-01-01'; // Reversed!

    // Trigger submit
    const submitEvent = new Event('submit');
    submitEvent.preventDefault = () => {};
    await form.onsubmit(submitEvent);

    assert.equal(createCalled, false, 'Form must NOT submit with startDate > endDate');
    const statusMsg = dialog.querySelector('.agreement-status-msg');
    assert.ok(statusMsg.textContent.includes('วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด'));
});

test('renderForm handles 409 conflict and renders reload review button', async () => {
    const conflictError = new Error('VERSION_CONFLICT');
    conflictError.status = 409;

    const { component, body } = setup({
        mutate: async () => {
            throw conflictError;
        },
    });

    const existingAgreement = {
        id: 'ag-conflict',
        title: 'Original Title',
        agreementType: 'MoU',
        version: 1,
    };

    component.renderForm(existingAgreement);
    const dialog = body.querySelector('#agreement-dialog');
    const form = dialog.querySelector('#agreement-edit-form');

    const submitEvent = new Event('submit');
    submitEvent.preventDefault = () => {};
    await form.onsubmit(submitEvent);

    const statusMsg = dialog.querySelector('.agreement-status-msg');
    assert.ok(statusMsg.textContent.includes('ข้อมูลถูกแก้ไขโดยผู้อื่น'));

    const reloadBtn = dialog.querySelector('.reload-conflict-btn');
    assert.ok(reloadBtn, 'Reload button must be provided on 409 conflict');
});

test('close restores focus to activeElement', () => {
    const { component, document, body } = setup();
    let focusCalled = false;
    const triggerBtn = document.createElement('button');
    triggerBtn.focus = () => { focusCalled = true; };
    document.activeElement = triggerBtn;

    component.openCreate();
    const dialog = body.querySelector('#agreement-dialog');
    assert.equal(dialog.open, true);

    component.close();
    assert.equal(dialog.open, false);
    assert.equal(focusCalled, true);
});

test('renderForm allows same-day dates and submits multiple partners and responsible users', async () => {
    let capturedPayload = null;
    const { component, body } = setup({
        create: async (path, payload) => {
            capturedPayload = payload;
            return { data: { id: 'ag-sameday-1', version: 1, ...payload } };
        },
    });

    component.renderForm();
    const dialog = body.querySelector('#agreement-dialog');
    const form = dialog.querySelector('#agreement-edit-form');

    const titleInput = dialog.querySelector('#agreement-form-title');
    const startInput = dialog.querySelector('#agreement-form-start-date');
    const endInput = dialog.querySelector('#agreement-form-end-date');
    const partnerInput = dialog.querySelector('#agreement-form-partners');
    const respInput = dialog.querySelector('#agreement-form-responsible');

    titleInput.value = 'One-Day Symposium Agreement';
    partnerInput.value = 'partner-001, partner-002, partner-001'; // Multiple with duplicate
    startInput.value = '2026-10-15';
    endInput.value = '2026-10-15'; // Same-day
    if (respInput) respInput.value = 'u1, u2, u1';

    const submitEvent = new Event('submit');
    submitEvent.preventDefault = () => {};
    await form.onsubmit(submitEvent);

    assert.ok(capturedPayload, 'Form should submit with same-day dates');
    assert.equal(capturedPayload.startDate, '2026-10-15');
    assert.equal(capturedPayload.endDate, '2026-10-15');
    assert.deepEqual([...capturedPayload.partnerIds], ['partner-001', 'partner-002']);
    if (respInput) {
        assert.deepEqual([...capturedPayload.responsibleUserIds], ['u1', 'u2']);
    }
});

test('renderForm rejects exceeding 20 partner IDs', async () => {
    let createCalled = false;
    const { component, body } = setup({
        create: async () => {
            createCalled = true;
        },
    });

    component.renderForm();
    const dialog = body.querySelector('#agreement-dialog');
    const form = dialog.querySelector('#agreement-edit-form');

    const titleInput = dialog.querySelector('#agreement-form-title');
    const partnerInput = dialog.querySelector('#agreement-form-partners');

    titleInput.value = 'Too Many Partners';
    const excessivePartners = Array.from({ length: 21 }, (_, i) => `partner-${i + 1}`).join(', ');
    partnerInput.value = excessivePartners;

    const submitEvent = new Event('submit');
    submitEvent.preventDefault = () => {};
    await form.onsubmit(submitEvent);

    assert.equal(createCalled, false, 'Form must NOT submit with more than 20 partners');
    const statusMsg = dialog.querySelector('.agreement-status-msg');
    assert.ok(statusMsg.textContent.includes('สูงสุดไม่เกิน 20'));
});

