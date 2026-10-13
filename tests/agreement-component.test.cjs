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
        state: () => ({user: {id: 'u1'}, grants: [{role: 'staff', scopeId: 'cs-demo', active: true}]}),
        create: async () => ({ data: { id: 'ag-1', version: 1 } }),
        mutate: async () => ({ data: { id: 'ag-1', version: 2 } }),
        request: async () => ({ data: { id: 'ag-1', version: 1 } }),
        refresh: async () => ({ csrfToken: 'mock-csrf-token-123', user: { id: 'u1' } }),
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
        status: 'draft', scopeId: 'cs-demo',
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

test('renderDetail renders status section with activate button for draft agreement and calls status endpoint', async () => {
    let capturedRequest = null;
    const { component, body } = setup({
        request: async (path, options) => {
            capturedRequest = { path, options };
            return {
                data: {
                    id: 'ag-draft-1',
                    version: 2,
                    status: 'active', scopeId: 'cs-demo',
                    title: 'Activated Agreement',
                },
            };
        },
    });

    const draftAgreement = {
        id: 'ag-draft-1',
        title: 'Draft MoU',
        agreementType: 'MoU',
        status: 'draft', scopeId: 'cs-demo',
        scopeId: 'cs-demo',
        partnerIds: ['p-1'],
        startDate: '2026-10-01',
        endDate: '2027-10-01',
        version: 1,
    };

    component.renderDetail(draftAgreement);

    const dialog = body.querySelector('#agreement-dialog');
    const statusSec = dialog.querySelector('#agreement-status-section');
    assert.ok(statusSec, 'Status section should be present');

    const activateBtn = statusSec.querySelector('#activate-agreement-btn');
    assert.ok(activateBtn, 'Activate button should exist for draft agreement');

    await activateBtn.onclick();

    assert.ok(capturedRequest, 'API request should have been made');
    assert.equal(capturedRequest.path, '/agreements/ag-draft-1/status');
    assert.equal(capturedRequest.options.method, 'POST');
    assert.equal(capturedRequest.options.headers['If-Match'], '"1"');
    const bodyObj = JSON.parse(capturedRequest.options.body);
    assert.equal(bodyObj.to, 'active');
});

test('renderDetail renders active agreement with expire and terminate actions', async () => {
    let capturedRequest = null;
    const { component, body } = setup({
        request: async (path, options) => {
            capturedRequest = { path, options };
            return {
                data: {
                    id: 'ag-act-1',
                    version: 3,
                    status: 'terminated', scopeId: 'cs-demo',
                    title: 'Terminated Agreement',
                },
            };
        },
    });

    const activeAgreement = {
        id: 'ag-act-1',
        title: 'Active MoU',
        agreementType: 'MoU',
        status: 'active', scopeId: 'cs-demo',
        scopeId: 'cs-demo',
        partnerIds: ['p-1'],
        startDate: '2026-10-01',
        endDate: '2027-10-01',
        version: 2,
    };

    component.renderDetail(activeAgreement);

    const dialog = body.querySelector('#agreement-dialog');
    const statusSec = dialog.querySelector('#agreement-status-section');
    const expireBtn = statusSec.querySelector('#expire-agreement-btn');
    const terminateToggleBtn = statusSec.querySelector('#terminate-toggle-btn');
    const termForm = statusSec.querySelector('#terminate-form');
    const termInput = statusSec.querySelector('#terminate-reason-input');
    const confirmTermBtn = statusSec.querySelector('#confirm-terminate-btn');

    assert.ok(expireBtn, 'Expire button must exist');
    assert.ok(terminateToggleBtn, 'Terminate toggle button must exist');
    assert.ok(termForm, 'Terminate form must exist');

    // Toggle open form and fill reason
    terminateToggleBtn.onclick();
    termInput.value = 'Mutual agreement to discontinue';

    await confirmTermBtn.onclick();

    assert.ok(capturedRequest, 'Status request should be sent');
    assert.equal(capturedRequest.path, '/agreements/ag-act-1/status');
    assert.equal(capturedRequest.options.headers['If-Match'], '"2"');
    const bodyObj = JSON.parse(capturedRequest.options.body);
    assert.equal(bodyObj.to, 'terminated');
    assert.equal(bodyObj.reason, 'Mutual agreement to discontinue');
});

test('renderDetail renders renewal section for expired agreement and submits new endDate and renewalNote', async () => {
    let capturedRequest = null;
    const { component, body } = setup({
        request: async (path, options) => {
            capturedRequest = { path, options };
            return {
                data: {
                    id: 'ag-exp-1',
                    version: 4,
                    status: 'active', scopeId: 'cs-demo',
                    title: 'Renewed Agreement',
                    endDate: '2028-10-01',
                    renewalNote: 'Renewed for 1 additional year',
                },
            };
        },
    });

    const expiredAgreement = {
        id: 'ag-exp-1',
        title: 'Expired MoU',
        agreementType: 'MoU',
        status: 'expired', scopeId: 'cs-demo',
        scopeId: 'cs-demo',
        partnerIds: ['p-1'],
        startDate: '2026-10-01',
        endDate: '2027-10-01',
        version: 3,
    };

    component.renderDetail(expiredAgreement);

    const dialog = body.querySelector('#agreement-dialog');
    const statusSec = dialog.querySelector('#agreement-status-section');
    const renewalForm = statusSec.querySelector('#renewal-form');
    const newEndInput = statusSec.querySelector('#renewal-end-date-input');
    const renewalNoteInput = statusSec.querySelector('#renewal-note-input');
    const renewBtn = statusSec.querySelector('#confirm-renewal-btn');

    assert.ok(renewalForm, 'Renewal form must exist');
    assert.ok(newEndInput, 'New end date input must exist');
    assert.ok(renewalNoteInput, 'Renewal note input must exist');
    assert.ok(renewBtn, 'Renew button must exist');

    newEndInput.value = '2028-10-01';
    renewalNoteInput.value = 'Renewed for 1 additional year';

    await renewBtn.onclick();

    assert.ok(capturedRequest, 'Renewal status request should be sent');
    assert.equal(capturedRequest.path, '/agreements/ag-exp-1/status');
    assert.equal(capturedRequest.options.headers['If-Match'], '"3"');
    const bodyObj = JSON.parse(capturedRequest.options.body);
    assert.equal(bodyObj.to, 'active');
    assert.equal(bodyObj.endDate, '2028-10-01');
    assert.equal(bodyObj.renewalNote, 'Renewed for 1 additional year');
});

test('renderDetail renders terminal state notice for terminated agreement without transition buttons', () => {
    const { component, body } = setup();

    const terminatedAgreement = {
        id: 'ag-term-1',
        title: 'Terminated MoU',
        agreementType: 'MoU',
        status: 'terminated', scopeId: 'cs-demo',
        scopeId: 'cs-demo',
        partnerIds: ['p-1'],
        internalNote: 'Status reason: Discontinued by mutual consent',
        version: 5,
    };

    component.renderDetail(terminatedAgreement);

    const dialog = body.querySelector('#agreement-dialog');
    const statusSec = dialog.querySelector('#agreement-status-section');

    const notice = statusSec.querySelector('.agreement-terminated-notice');
    assert.ok(notice, 'Terminal state notice must be displayed');
    assert.ok(notice.textContent.includes('ยุติก่อนกำหนดแล้ว'));

    assert.equal(statusSec.querySelector('#activate-agreement-btn'), null);
    assert.equal(statusSec.querySelector('#expire-agreement-btn'), null);
    assert.equal(statusSec.querySelector('#terminate-toggle-btn'), null);
    assert.equal(statusSec.querySelector('#renewal-form'), null);
});

test('status transition handles 409 conflict and renders reload review button', async () => {
    let reloadCalled = false;
    const { component, body } = setup({
        request: async (path) => {
            if (path.includes('/status')) {
                const err = new Error('VERSION_CONFLICT');
                err.status = 409;
                throw err;
            }
            if (path.includes('/agreements/ag-conf-1')) {
                reloadCalled = true;
                return {
                    data: {
                        id: 'ag-conf-1',
                        version: 2,
                        status: 'active', scopeId: 'cs-demo',
                        title: 'Latest Server Version',
                    },
                };
            }
            return { data: {} };
        },
    });

    const staleAgreement = {
        id: 'ag-conf-1',
        title: 'Stale Draft MoU',
        agreementType: 'MoU',
        status: 'draft', scopeId: 'cs-demo',
        scopeId: 'cs-demo',
        partnerIds: ['p-1'],
        startDate: '2026-10-01',
        endDate: '2027-10-01',
        version: 1,
    };

    component.renderDetail(staleAgreement);

    const dialog = body.querySelector('#agreement-dialog');
    const activateBtn = dialog.querySelector('#activate-agreement-btn');

    await activateBtn.onclick();

    const reloadBtn = dialog.querySelector('.reload-conflict-btn');
    assert.ok(reloadBtn, 'Conflict reload review button should be rendered on 409');
    await reloadBtn.onclick();
    assert.equal(reloadCalled, true, 'Reloading fetches latest data without silent overwrite');
});
