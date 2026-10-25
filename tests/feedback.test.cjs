const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const workNavSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'assets', 'work-navigation.js'),
    'utf8'
);
const feedbackSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'assets', 'feedback.js'),
    'utf8'
);

function createElement(tag) {
    return {
        tagName: String(tag).toUpperCase(),
        className: '',
        textContent: '',
        type: '',
        value: '',
        required: false,
        disabled: false,
        maxLength: 0,
        isConnected: true,
        attributes: {},
        children: [],
        parentNode: null,
        onclick: null,
        onsubmit: null,
        setAttribute(name, value) {
            this.attributes[name] = String(value);
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
    };
}

function findAll(root, predicate, acc = []) {
    if (predicate(root)) acc.push(root);
    for (const child of root.children || []) findAll(child, predicate, acc);
    return acc;
}

function setupHarness({ requestImpl, createImpl, mutateImpl } = {}) {
    const requests = [];
    const creates = [];
    const mutations = [];

    const document = {
        createElement,
    };
    const window = {
        CstuAuth: {
            enabled: () => true,
            async request(url) {
                requests.push(url);
                if (requestImpl) return requestImpl(url);
                return { data: [], page: { nextCursor: null } };
            },
            async create(url, payload, key) {
                creates.push({ url, payload, key });
                if (createImpl) return createImpl(url, payload, key);
                return { data: { id: 'fb-created', version: 1, ...payload } };
            },
            async mutate(url, payload, version) {
                mutations.push({ url, payload, version });
                if (mutateImpl) return mutateImpl(url, payload, version);
                return { data: { id: 'fb-updated', version: version + 1, ...payload } };
            },
        },
    };

    const context = vm.createContext({
        window,
        document,
        crypto: { randomUUID: () => crypto.randomUUID() },
        Object,
        Array,
        String,
        Boolean,
        Map,
        Error,
        encodeURIComponent,
        JSON,
    });
    vm.runInContext(workNavSource, context);
    vm.runInContext(feedbackSource, context);

    return { window, requests, creates, mutations };
}

test('student sees Feedback section, can create Feedback, and can edit only own Feedback on Exchange', async () => {
    let rows = [
        {
            id: 'fb-staff',
            version: 1,
            occurredOn: '2026-10-20',
            sourceType: 'partner',
            comment: 'ความเห็นจากคู่ความร่วมมือ',
            improvement: '',
            canEdit: false,
        },
        {
            id: 'fb-student-own',
            version: 2,
            occurredOn: '2026-10-21',
            sourceType: 'participant',
            comment: 'ความเห็นเดิมของนักศึกษา',
            improvement: 'ควรเพิ่มเวลาเตรียมตัว',
            canEdit: true,
        },
    ];

    const h = setupHarness({
        requestImpl: async () => ({
            data: rows,
            canCreate: true,
            page: { nextCursor: null },
        }),
    });

    const container = createElement('section');
    // Student projection for Exchange deliberately omits scopeId on the server.
    const studentExchange = {
        id: 'ex-101',
        title: 'Tokyo Exchange 2026',
        status: 'ongoing',
    };
    const studentSession = {
        user: { id: 'u-student-1' },
        grants: [{ role: 'student', scopeId: 'cs-demo', active: true }],
    };

    await h.window.CstuFeedback.mount(container, studentExchange, 'exchanges', studentSession);

    assert.equal(h.requests[0], '/exchanges/ex-101/feedback?limit=100');

    const buttons = findAll(container, node => node.tagName === 'BUTTON');
    assert.deepEqual(
        buttons.map(btn => btn.textContent),
        ['แก้ไข Feedback', 'เพิ่ม Feedback']
    );

    // Clicking "เพิ่ม Feedback" opens create form with default sourceType = 'participant'
    const addBtn = buttons.find(btn => btn.textContent === 'เพิ่ม Feedback');
    addBtn.onclick();

    const inputs = findAll(container, node => ['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName));
    const [dateInput, sourceSelect, commentInput, improvementInput, nameInput] = inputs;
    assert.equal(sourceSelect.value, 'participant');

    dateInput.value = '2026-10-25';
    commentInput.value = '  ได้เรียนรู้วัฒนธรรมและการทำงานจริง  ';
    improvementInput.value = '  อยากให้มีคู่มือก่อนเดินทาง  ';
    nameInput.value = '';

    const createForm = findAll(container, node => node.tagName === 'FORM')[0];
    await createForm.onsubmit({ preventDefault() {} });

    assert.equal(h.creates.length, 1);
    assert.equal(h.creates[0].url, '/exchanges/ex-101/feedback');
    assert.deepEqual({ ...h.creates[0].payload }, {
        occurredOn: '2026-10-25',
        sourceType: 'participant',
        comment: 'ได้เรียนรู้วัฒนธรรมและการทำงานจริง',
        improvement: 'อยากให้มีคู่มือก่อนเดินทาง',
        respondentName: '',
    });

    // Editing own feedback omits respondentName when not projected by server and left blank
    const editBtn = findAll(container, node => node.tagName === 'BUTTON' && node.textContent === 'แก้ไข Feedback')[0];
    editBtn.onclick();

    const editInputs = findAll(container, node => ['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName));
    editInputs[2].value = 'อัปเดตความเห็นของตนเอง';

    const editForm = findAll(container, node => node.tagName === 'FORM')[0];
    await editForm.onsubmit({ preventDefault() {} });

    assert.equal(h.mutations.length, 1);
    assert.equal(h.mutations[0].url, '/exchanges/ex-101/feedback/fb-student-own');
    assert.equal(h.mutations[0].version, 2);
    assert.equal('respondentName' in h.mutations[0].payload, false);
    assert.equal(h.mutations[0].payload.comment, 'อัปเดตความเห็นของตนเอง');
});

test('student can add Feedback on public Activity, while executive remains read-only', async () => {
    const h = setupHarness({
        requestImpl: async () => ({
            data: [
                {
                    id: 'fb-1',
                    version: 1,
                    occurredOn: '2026-10-18',
                    sourceType: 'participant',
                    comment: 'กิจกรรมดีมาก',
                    improvement: '',
                    canEdit: false,
                },
            ],
            page: { nextCursor: null },
        }),
    });

    const activity = { id: 'act-1', title: 'Tech Talk 2026', publication: 'public' };

    const studentContainer = createElement('section');
    await h.window.CstuFeedback.mount(studentContainer, activity, 'activities', {
        user: { id: 'u-student-1' },
        grants: [{ role: 'student', scopeId: 'cs-demo', active: true }],
    });
    assert.deepEqual(
        findAll(studentContainer, node => node.tagName === 'BUTTON').map(b => b.textContent),
        ['เพิ่ม Feedback']
    );

    const executiveContainer = createElement('section');
    await h.window.CstuFeedback.mount(executiveContainer, activity, 'activities', {
        user: { id: 'u-exec-1' },
        grants: [{ role: 'executive', scopeId: 'cs-demo', active: true }],
    });
    assert.deepEqual(
        findAll(executiveContainer, node => node.tagName === 'BUTTON').map(b => b.textContent),
        []
    );
});

test('server canCreate=false hides add button for cross-scope multi-role viewer', async () => {
    const h = setupHarness({
        requestImpl: async () => ({
            data: [],
            canCreate: false,
            page: { nextCursor: null },
        }),
    });

    const container = createElement('section');
    await h.window.CstuFeedback.mount(
        container,
        { id: 'act-exec-scope', title: 'Scoped Activity', publication: 'public' },
        'activities',
        {
            user: { id: 'u-mixed' },
            grants: [
                { role: 'executive', scopeId: 'cs-1', active: true },
                { role: 'student', scopeId: 'cs-2', active: true },
            ],
        }
    );

    assert.deepEqual(
        findAll(container, node => node.tagName === 'BUTTON').map(b => b.textContent),
        []
    );
});
