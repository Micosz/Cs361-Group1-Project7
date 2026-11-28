const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const XLSX = require('../../public/vendor/sheetjs/xlsx.mini.min.js');
const importData = require('../../public/assets/form-import-data.js');
const overviewSource = fs.readFileSync('public/assets/overview.js', 'utf8');
const workNavSource = fs.readFileSync('public/assets/work-navigation.js', 'utf8');

const fixtureDir = path.resolve(__dirname, '../fixtures/v7-feedback');

test('V7 #264 sample .xlsx and .csv files parse identically, skip blank rows, and respect PII defaults', () => {
    const xlsxBytes = fs.readFileSync(path.join(fixtureDir, 'v7-partner-feedback-sample.xlsx'));
    const workbook = XLSX.read(xlsxBytes, { type: 'buffer', cellFormula: false, cellHTML: false, sheetRows: 2002 });
    assert.deepEqual(workbook.SheetNames, [
        '1_กิจกรรม_MoU1',
        '2_แลกเปลี่ยน_MoU2',
        '3_ผลตอบรับเก่า_คู่ความร่วมมือ'
    ]);

    const expected = [
        { sheet: '1_กิจกรรม_MoU1', csv: 'v7-activity-mou1-feedback.csv', responses: 3, skipped: 1 },
        { sheet: '2_แลกเปลี่ยน_MoU2', csv: 'v7-exchange-mou2-feedback.csv', responses: 2, skipped: 0 },
        { sheet: '3_ผลตอบรับเก่า_คู่ความร่วมมือ', csv: 'v7-legacy-partner-only-feedback.csv', responses: 3, skipped: 0 }
    ];

    const piiPattern = /ชื่อ|นามสกุล|name|mail|เมล|เมล์|โทร|phone|ที่อยู่|address|รหัส|เลขประจำตัว|\bid\b|timestamp|ประทับเวลา|วันที่ตอบ|เวลาตอบ/i;

    for (const item of expected) {
        const ws = workbook.Sheets[item.sheet];
        const xlsxMatrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true, range: 0 });
        const csvText = fs.readFileSync(path.join(fixtureDir, item.csv), 'utf8');
        const csvMatrix = importData.parseCSV(csvText);

        const header = xlsxMatrix[0];
        const autoSelected = header
            .map((label, idx) => (Boolean(String(label).trim()) && !piiPattern.test(String(label)) ? idx : -1))
            .filter(idx => idx >= 0);
        assert.deepEqual(autoSelected, [2, 3, 4], `Expected question columns [2,3,4] auto-selected for ${item.sheet}`);

        const fromXlsx = importData.prepare(xlsxMatrix, 0, autoSelected, 0);
        const fromCsv = importData.prepare(csvMatrix, 0, autoSelected, 0);
        assert.equal(fromXlsx.rows.length, item.responses);
        assert.equal(fromXlsx.skipped, item.skipped);
        assert.deepEqual(fromXlsx, fromCsv);

        const payload = {
            formName: item.sheet,
            sourceType: 'participant',
            fileName: 'v7-partner-feedback-sample.xlsx',
            sheetName: item.sheet,
            columns: fromXlsx.columns,
            rows: fromXlsx.rows
        };
        importData.assertSize(payload);
        assert.equal(JSON.stringify(payload).includes('@example.invalid'), false, 'PII email must not enter prepared payload');
    }
});

function createDom() {
    const makeElement = (tag = 'div') => {
        let ownText = '';
        const classes = new Set();
        const attrs = new Map();
        const node = {
            tagName: String(tag).toUpperCase(),
            id: '',
            name: '',
            type: '',
            value: '',
            href: '',
            hidden: false,
            disabled: false,
            isConnected: true,
            dataset: {},
            style: {},
            children: [],
            parentNode: null,
            listeners: {},
            get className() { return [...classes].join(' '); },
            set className(val) {
                classes.clear();
                String(val || '').split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
            },
            classList: {
                add(...names) { names.forEach(n => classes.add(n)); },
                remove(...names) { names.forEach(n => classes.delete(n)); },
                toggle(name, force) {
                    const next = force === undefined ? !classes.has(name) : Boolean(force);
                    if (next) classes.add(name); else classes.delete(name);
                    return next;
                },
                contains(name) { return classes.has(name); }
            },
            get textContent() {
                if (!this.children.length) return ownText;
                return ownText + this.children.map(c => c.textContent).join('');
            },
            set textContent(val) {
                this.children = [];
                ownText = String(val ?? '');
            },
            setAttribute(k, v) { attrs.set(k, String(v)); },
            getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
            appendChild(child) {
                if (typeof child === 'string') {
                    const textNode = makeElement('#text');
                    textNode.textContent = child;
                    this.children.push(textNode);
                    return textNode;
                }
                child.parentNode = node;
                child.isConnected = true;
                this.children.push(child);
                return child;
            },
            append(...items) { items.forEach(item => this.appendChild(item)); },
            remove() {
                this.isConnected = false;
                if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this);
            },
            click() { if (typeof this.onclick === 'function') this.onclick({ button: 0, preventDefault() {} }); },
            replaceChildren(...items) {
                this.children = [];
                ownText = '';
                items.forEach(item => this.appendChild(item));
            },
            addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
            dispatchEvent(event) { (this.listeners[event.type] || []).forEach(fn => fn(event)); },
            findAll(predicate, acc = []) {
                for (const child of this.children) {
                    if (predicate(child)) acc.push(child);
                    if (child.findAll) child.findAll(predicate, acc);
                }
                return acc;
            }
        };
        return node;
    };
    return { makeElement };
}

test('Overview report renders MoU feedback counts, "ยังไม่ระบุข้อตกลง", source answers, related links, and CSV export', async () => {
    const { makeElement } = createDom();
    const container = makeElement('div');
    const openedRelated = [];
    const requestedPaths = [];
    let exportedCsv = '';

    const overviewPayload = {
        role: 'executive',
        stakeholders: { count: 1, byType: { university: 1 } },
        activities: { count: 1, outcomesRecorded: 1, byType: { academic_activity: 1 } },
        agreements: { count: 2, statuses: { active: 2 } },
        exchanges: { count: 1, outcomesRecorded: 0, statuses: { ongoing: 1 } },
        feedback: { count: 0, withImprovement: 0, bySource: {}, latest: [] },
        outcomes: { count: 1, records: [] },
        formFeedback: {
            batchCount: 3,
            responseCount: 8,
            bySource: { participant: 5, partner: 3 },
            unspecifiedAgreement: { label: 'ยังไม่ระบุข้อตกลง', batchCount: 1, responseCount: 3, commentCount: 0 },
            byAgreement: [
                { id: 'mou-1', title: 'MoU ฉบับที่ 1 — กิจกรรม AI', agreementType: 'MoU', status: 'active', batchCount: 1, responseCount: 3, commentCount: 0 },
                { id: 'mou-2', title: 'MoA ฉบับที่ 2 — แลกเปลี่ยนวิจัย', agreementType: 'MoA', status: 'active', batchCount: 1, responseCount: 2, commentCount: 0 }
            ],
            batches: [
                {
                    id: 'form-act-1',
                    formName: 'แบบประเมินกิจกรรม AI Workshop',
                    sourceType: 'participant',
                    fileName: 'v7-partner-feedback-sample.xlsx',
                    sheetName: '1_กิจกรรม_MoU1',
                    importedByName: 'ผู้ประสานงาน',
                    responseCount: 3,
                    parentType: 'activity',
                    parentId: 'act-1',
                    parentTitle: 'อบรมเชิงปฏิบัติการ AI ร่วมกับพันธมิตร',
                    relatedPartners: [{ id: 'partner-1', name: 'สถาบันพันธมิตรเทคโนโลยีดิจิทัล (สมมติ)' }],
                    relatedAgreements: [{ id: 'mou-1', title: 'MoU ฉบับที่ 1 — กิจกรรม AI', agreementType: 'MoU' }],
                    agreementStatus: 'linked',
                    agreementLabel: 'MoU ฉบับที่ 1 — กิจกรรม AI'
                },
                {
                    id: 'form-leg-1',
                    formName: 'ผลตอบรับย้อนหลังระดับองค์กรคู่ความร่วมมือ',
                    sourceType: 'partner',
                    fileName: 'v7-partner-feedback-sample.xlsx',
                    sheetName: '3_ผลตอบรับเก่า_คู่ความร่วมมือ',
                    importedByName: 'เจ้าหน้าที่หลักสูตร',
                    responseCount: 3,
                    parentType: 'partner',
                    parentId: 'partner-1',
                    parentTitle: 'สถาบันพันธมิตรเทคโนโลยีดิจิทัล (สมมติ)',
                    relatedPartners: [],
                    relatedAgreements: [],
                    agreementStatus: 'unspecified',
                    agreementLabel: 'ยังไม่ระบุข้อตกลง'
                }
            ]
        }
    };

    class CaptureBlob {
        constructor(parts) { exportedCsv = parts.join(''); }
    }

    const windowObj = {
        CstuAuth: {
            enabled: () => true,
            request: async path => {
                requestedPaths.push(path);
                if (path.startsWith('/overview')) return { data: overviewPayload };
                if (path === '/activities/act-1/form-feedback/form-act-1') {
                    return {
                        data: {
                            id: 'form-act-1',
                            fileName: 'v7-partner-feedback-sample.xlsx',
                            sheetName: '1_กิจกรรม_MoU1',
                            importedByName: 'ผู้ประสานงาน',
                            columns: ['ความพึงพอใจต่อกิจกรรม (1-5)'],
                            rows: [{ sourceRow: 2, answers: ['5'], respondedAt: '2026-09-15 16:10:00' }]
                        }
                    };
                }
                throw Object.assign(new Error('FORBIDDEN'), { status: 403 });
            }
        },
        CstuRecords: {
            openRelated: (kind, id) => { openedRelated.push([kind, id]); return true; }
        },
        URL: { createObjectURL: () => 'blob:csv', revokeObjectURL: () => {} },
        Blob: CaptureBlob,
        setTimeout,
        clearTimeout
    };

    const context = vm.createContext({
        window: windowObj,
        document: { createElement: tag => makeElement(tag), body: makeElement('body') },
        URLSearchParams,
        URL: windowObj.URL,
        Blob: CaptureBlob,
        location: { origin: 'http://localhost', replace() {} },
        setTimeout,
        clearTimeout
    });

    vm.runInContext(workNavSource, context);
    vm.runInContext(overviewSource, context);

    windowObj.CstuOverview.render(container, {
        user: { id: 'u-exec' },
        grants: [{ role: 'executive', scopeId: 'cs-demo', active: true }]
    });
    await new Promise(resolve => setImmediate(resolve));

    const root = container.children[0];
    const ffSection = root.findAll(el => el.classList?.contains('overview-form-feedback'))[0];
    assert.ok(ffSection, 'Expected form feedback linkage section in Overview');
    assert.match(ffSection.textContent, /รวม 3 ชุด · 8 คำตอบ/);
    assert.match(ffSection.textContent, /MoU ฉบับที่ 1 — กิจกรรม AI.*1 ชุด · 3 คำตอบ/);
    assert.match(ffSection.textContent, /MoA ฉบับที่ 2 — แลกเปลี่ยนวิจัย.*1 ชุด · 2 คำตอบ/);
    assert.match(ffSection.textContent, /ยังไม่ระบุข้อตกลง.*1 ชุด · 3 คำตอบ/);
    assert.equal(root.textContent.includes('%'), false);

    // Click related Agreement link and Activity link -> opens related records via CstuRecords.openRelated
    const links = ffSection.findAll(el => el.tagName === 'A');
    const mouLink = links.find(a => a.textContent.includes('MoU ฉบับที่ 1'));
    const actLink = links.find(a => a.textContent.includes('อบรมเชิงปฏิบัติการ AI'));
    assert.ok(mouLink && actLink);
    mouLink.onclick({ button: 0, preventDefault() {} });
    actLink.onclick({ button: 0, preventDefault() {} });
    assert.deepEqual(openedRelated, [['agreements', 'mou-1'], ['activities', 'act-1']]);

    // Click "ดูแหล่งที่มาและคำตอบ" -> fetches authorized form batch and renders provenance + answers
    const sourceButtons = ffSection.findAll(el => el.classList?.contains('overview-read-source'));
    await sourceButtons[0].onclick();
    assert.ok(requestedPaths.includes('/activities/act-1/form-feedback/form-act-1'));
    assert.match(ffSection.textContent, /แหล่งที่มา: ไฟล์ v7-partner-feedback-sample\.xlsx · ชีต 1_กิจกรรม_MoU1/);
    assert.match(ffSection.textContent, /ความพึงพอใจต่อกิจกรรม \(1-5\): 5/);

    // Export CSV -> contains MoU breakdown and "ยังไม่ระบุข้อตกลง" without personal emails
    const exportBtn = root.findAll(el => el.classList?.contains('overview-btn-export'))[0];
    exportBtn.onclick();
    assert.match(exportedCsv, /"Form Feedback","จำนวนคำตอบนำเข้าทั้งหมด","8"/);
    assert.match(exportedCsv, /"ผลตอบรับตามข้อตกลง","MoU ฉบับที่ 1 — กิจกรรม AI","3"/);
    assert.match(exportedCsv, /"ผลตอบรับตามข้อตกลง","MoA ฉบับที่ 2 — แลกเปลี่ยนวิจัย","2"/);
    assert.match(exportedCsv, /"ผลตอบรับตามข้อตกลง","ยังไม่ระบุข้อตกลง","3"/);
});
