const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const overviewCss = fs.readFileSync('public/assets/overview.css', 'utf8');
const recordsCss = fs.readFileSync('public/assets/records.css', 'utf8');
const overviewSource = fs.readFileSync('public/assets/overview.js', 'utf8');
const workNavSource = fs.readFileSync('public/assets/work-navigation.js', 'utf8');
const recordsSource = fs.readFileSync('public/assets/records.js', 'utf8');

function specificity(selector) {
    const clean = selector
        .replace(/::[a-z-]+/gi, '')
        .replace(/:not\(([^)]*)\)/gi, ' $1 ');
    const ids = (clean.match(/#[a-z0-9_-]+/gi) || []).length;
    const classesAndAttrs =
        (clean.match(/\.[a-z0-9_-]+/gi) || []).length +
        (clean.match(/\[[^\]]+\]/g) || []).length +
        (clean.match(/:[a-z-]+/gi) || []).length;
    const withoutTokens = clean
        .replace(/#[a-z0-9_-]+/gi, ' ')
        .replace(/\.[a-z0-9_-]+/gi, ' ')
        .replace(/\[[^\]]+\]/g, ' ')
        .replace(/:[a-z-]+/gi, ' ');
    const elements = (withoutTokens.match(/\b[a-z][a-z0-9-]*\b/gi) || []).length;
    return [ids, classesAndAttrs, elements];
}

function compareSpecificity(a, b) {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

function extractRuleBlock(css, selectorSubstring) {
    const escaped = selectorSubstring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`([^{}]*${escaped}[^{}]*)\\{([^}]*)\\}`, 'm');
    const match = css.match(regex);
    return match ? { selectors: match[1].split(',').map(s => s.trim()), body: match[2] } : null;
}

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
            lang: '',
            hidden: false,
            disabled: false,
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
                this.children.push(child);
                return child;
            },
            append(...items) { items.forEach(item => this.appendChild(item)); },
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

test('overview CSS button and active-tab selectors beat #home-records button and avoid white-on-white states', () => {
    const baseRecordsBtn = specificity('#home-records button');
    assert.deepEqual(baseRecordsBtn, [1, 0, 1]);

    const submitRule = extractRuleBlock(overviewCss, '#home-records .overview-actions button[type="submit"]');
    assert.ok(submitRule, 'Expected scoped submit button rule in overview.css');
    const submitSpec = specificity('#home-records .overview-actions button[type="submit"]');
    assert.ok(compareSpecificity(submitSpec, baseRecordsBtn) > 0, 'Submit button specificity must beat #home-records button');
    assert.match(submitRule.body, /background\s*:\s*var\(--tu-red,\s*#c3002f\)/i);
    assert.match(submitRule.body, /color\s*:\s*#ffffff/i);

    const tabBaseRule = extractRuleBlock(overviewCss, '#home-records .overview-tabs button,');
    assert.ok(tabBaseRule, 'Expected scoped unselected tab button rule in overview.css');
    assert.ok(compareSpecificity(specificity('#home-records .overview-tabs button'), baseRecordsBtn) > 0);
    assert.match(tabBaseRule.body, /background\s*:\s*transparent/i);
    assert.match(tabBaseRule.body, /color\s*:\s*#5b4d52/i);

    const activeTabRule = extractRuleBlock(overviewCss, '#home-records .overview-tabs button.active');
    assert.ok(activeTabRule, 'Expected scoped active tab button rule in overview.css');
    const activeTabSpec = specificity('#home-records .overview-tabs button.active');
    assert.ok(compareSpecificity(activeTabSpec, baseRecordsBtn) > 0, 'Active tab specificity must beat #home-records button');
    assert.match(activeTabRule.body, /background\s*:\s*var\(--tu-red,\s*#c3002f\)/i);
    assert.match(activeTabRule.body, /color\s*:\s*#ffffff/i);

    const boardOverviewRule = extractRuleBlock(recordsCss, '#board-overview.active');
    assert.ok(boardOverviewRule, 'Expected #board-overview.active rule in records.css');
    assert.match(boardOverviewRule.body, /background\s*:\s*var\(--tu-red,\s*#c3002f\)/i);
    assert.match(boardOverviewRule.body, /color\s*:\s*#fff/i);
});

test('CstuOverview renders structured breakdown rows, tab active states, and role-appropriate tabs', async () => {
    const { makeElement } = createDom();
    const container = makeElement('div');
    const sampleData = {
        role: 'executive',
        stakeholders: { count: 21, byType: { company: 14, university: 7 } },
        activities: { count: 17, outcomesRecorded: 2, byType: { academic_activity: 10, research: 7 } },
        agreements: { count: 13, statuses: { active: 8, draft: 3, expired: 1, terminated: 1 } },
        exchanges: { count: 3, outcomesRecorded: 1, statuses: { draft: 2, ongoing: 1 } },
        feedback: {
            count: 4,
            withImprovement: 1,
            bySource: { participant: 3, partner: 1 },
            latest: [{ date: '2026-05-01', sourceType: 'participant', parentType: 'activity', parentTitle: 'AI Camp', comment: 'ดีมาก', improvement: 'เพิ่มเวลา Workshop' }]
        },
        outcomes: {
            count: 3,
            records: [{ date: '2026-05-10', recordType: 'activity', title: 'AI Camp', summary: 'นักศึกษาได้ฝึกงานจริง 5 คน' }]
        }
    };

    const windowObj = {
        CstuAuth: {
            enabled: () => true,
            request: async () => ({ data: sampleData })
        },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
        Blob: class {},
        setTimeout,
        clearTimeout
    };
    const context = vm.createContext({
        window: windowObj,
        document: { createElement: tag => makeElement(tag), body: makeElement('body') },
        URLSearchParams,
        URL: windowObj.URL,
        Blob: windowObj.Blob,
        location: { origin: 'http://localhost', replace() {} },
        setTimeout,
        clearTimeout
    });

    vm.runInContext(workNavSource, context);
    vm.runInContext(overviewSource, context);

    windowObj.CstuOverview.render(container, {
        user: { id: 'u-exec' },
        grants: [{ role: 'executive', scopeId: 'cs', active: true }]
    });

    // Wait for async load() to settle.
    await new Promise(resolve => setImmediate(resolve));

    const root = container.children[0];
    assert.ok(root.classList.contains('overview-dashboard'));

    const statusNode = root.findAll(el => el.classList?.contains('overview-status'))[0];
    assert.equal(statusNode.dataset.state, 'ready');
    assert.equal(statusNode.textContent, 'แสดงเฉพาะข้อมูลในขอบเขตที่คุณมีสิทธิ์');

    const tabsNav = root.findAll(el => el.classList?.contains('overview-tabs'))[0];
    const tabButtons = tabsNav.children;
    assert.deepEqual(tabButtons.map(b => b.textContent), ['สรุป', 'Stakeholder']);
    assert.equal(tabButtons[0].classList.contains('active'), true);
    assert.equal(tabButtons[0].getAttribute('aria-selected'), 'true');
    assert.equal(tabButtons[1].classList.contains('active'), false);

    // Chart data remains readable in the separate status legend.
    const breakdownRows = root.findAll(el => el.classList?.contains('overview-legend-row'));
    assert.ok(breakdownRows.length > 0);
    const activeRow = breakdownRows.find(r => r.textContent.includes('มีผล'));
    assert.ok(activeRow);
    assert.equal(activeRow.textContent, 'มีผล8');
    assert.equal(activeRow.children[1].textContent, 'มีผล');
    assert.equal(activeRow.children[2].textContent, '8');

    // Switch through every tab and verify exclusive active state + rendered content.
    tabButtons[1].onclick(); // Stakeholder
    assert.equal(tabButtons[0].classList.contains('active'), false);
    assert.equal(tabButtons[0].getAttribute('aria-selected'), 'false');
    assert.equal(tabButtons[1].classList.contains('active'), true);
    assert.equal(tabButtons[1].getAttribute('aria-selected'), 'true');
    const company = root.findAll(el => el.dataset?.type === 'company')[0];
    assert.equal(company.textContent, 'บริษัท / ภาคเอกชน14 แห่ง');
    assert.equal(root.findAll(el => el.classList?.contains('overview-stakeholder-total'))[0].textContent, '21คู่ความร่วมมือทั้งหมด');
    assert.equal(root.textContent.includes('%'), false);

    assert.equal(tabButtons.length, 2); // Feedback now belongs to the dedicated inbox.
    assert.equal(root.textContent.includes('บันทึกผลลัพธ์แล้ว'), false);
});

test('records.js clears outer #records-status after CstuOverview mounts so status text is not duplicated', () => {
    assert.match(
        recordsSource,
        /await window\.CstuOverview\.render\(\$\('records-content'\),session\);\s*if \(current !== revision\) return;\s*status\(''\);\s*return;/
    );
});

