const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const { startFixture } = require('./fixture.cjs');

const project = 'โครงการลุ่มน้ำ (สมมติ)',
    activity = 'แลกเปลี่ยนลุ่มน้ำ (สมมติ)',
    round = 'รอบลุ่มน้ำ (สมมติ)';
const secondary = 'แลกเปลี่ยนป่าชุมชน (สมมติ)';
const otherProject = 'โครงการป่าชุมชน (สมมติ)';
function thaiInput(epoch) {
    return new Date((epoch + 7 * 3600) * 1000).toISOString().slice(0, 16);
}
const detail = (page) => page.locator('#record-detail');
const panel = (page) => detail(page).locator('.exchange-admissions:visible').first();
async function capture(page, name, focus, region = page) {
    if (!process.env.CSTU_ADMISSIONS_EVIDENCE_DIR) return;
    if (focus) await focus.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const dir = process.env.CSTU_ADMISSIONS_EVIDENCE_DIR;
    await fs.mkdir(dir, { recursive: true });
    await region.screenshot({
        path: path.join(dir, name + '.jpg'),
        type: 'jpeg',
        quality: 80,
        animations: 'disabled'
    });
}
async function fromBoard(page, title) {
    if (await detail(page).isVisible())
        await detail(page).getByRole('button', { name: 'ปิดรายละเอียด' }).click();
    await page.goto('/index.html?public=1#board-section');
    await page.locator('#tabEvent').click();
    const button = page.locator('#eventGrid').getByRole('button', { name: title, exact: true });
    await page.waitForLoadState('networkidle');
    if (page.viewportSize().width < 500) await button.tap();
    else await button.press('Enter');
    await expect(detail(page)).toBeVisible();
    await expect(detail(page).locator('#detail-title')).toHaveText(title);
}
async function makeRound(page, clock, options = {}) {
    await fromBoard(page, options.activity || activity);
    await panel(page)
        .getByRole('link', { name: 'จัดการรอบสมัคร · ' + (options.project || project), exact: true })
        .click();
    const p = panel(page);
    await expect(p.getByRole('heading', { name: 'จัดการรอบสมัคร Exchange' })).toBeVisible();
    await expect(p.getByLabel('กิจกรรมที่ประกาศ')).toHaveValue(options.activity ? 'act-forest' : 'act-water');
    await p.getByLabel('ชื่อรอบ', { exact: true }).fill(options.title || round);
    await p.getByLabel('คุณสมบัติผู้สมัคร').fill('นักศึกษาในหลักสูตร (ข้อมูลสมมติ)');
    await p.getByLabel('จำนวนที่รับ').fill('2');
    const times = [
        ['เปิดรับสมัคร', 60],
        ['ปิดรับสมัคร', 180],
        ['เริ่มแจ้งผล', 240],
        ['สิ้นสุดช่วงแจ้งผลส่วนตัว', 420]
    ];
    if (options.official) {
        await p.getByLabel('ช่องทางสมัคร').selectOption('official');
        await p.getByLabel('ชื่อหน่วยงานทางการ').fill('สำนักงานวิเทศ (สมมติ)');
        await p.getByLabel('ลิงก์ช่องทางทางการ (https)').fill('https://example.org/official-exchange');
    } else times.push(['วันสิ้นสุดการยืนยันสิทธิ์', 600]);
    for (const [label, offset] of times)
        await p.getByLabel(label, { exact: true }).fill(thaiInput(clock + offset));
    if (!options.activity) await p.getByLabel('ต้องรอคู่สัญญาตอบรับ').check();
    if (!options.official) await p.getByLabel('คำถามเพิ่มเติมที่จำเป็น (ถ้ามี)').fill('หัวข้อที่สนใจศึกษา');
    await p.getByRole('button', { name: 'เปิดรอบรับสมัคร', exact: true }).click();
    await expect(p.getByText('ยังไม่มีใบสมัคร')).toBeVisible();
}
async function submit(page, user) {
    await fromBoard(page, activity);
    const login = panel(page).getByRole('link', { name: 'เข้าสู่ระบบ TU เพื่อสมัคร' });
    if (page.viewportSize().width < 500) await login.tap();
    else {
        await login.focus();
        await page.keyboard.press('Enter');
    }
    await page.locator('#student-id').fill(user);
    await page.locator('#student-password').fill('mock');
    await page.locator('#login-submit').click();
    await expect(detail(page).locator('#detail-title')).toHaveText(activity);
    const p = panel(page);
    await p.getByRole('button', { name: 'สมัครเข้าร่วมเพื่อให้สาขาคัดเลือก' }).click();
    await p.getByLabel('หัวข้อที่สนใจศึกษา').fill('งานวิจัยสมมติ ' + user.slice(-1).toUpperCase());
    if (user === 'student-a')
        await capture(page, '01-student-application-form', p.getByRole('button', { name: 'ส่งใบสมัคร', exact: true }));
    await p.getByRole('button', { name: 'ส่งใบสมัคร', exact: true }).click();
    await expect(p.getByText('ส่งใบสมัครแล้ว', { exact: true })).toBeVisible();
    if (user === 'student-a')
        await capture(page, 'exchange-application-submitted', p.getByText('ส่งใบสมัครแล้ว', { exact: true }));
}
async function roster(page) {
    if (await detail(page).isVisible())
        await detail(page).getByRole('button', { name: 'ปิดรายละเอียด' }).click();
    const target = '/work.html?kind=exchanges&id=project-water#board-section';
    if (page.url().endsWith(target)) await page.reload();
    else await page.goto(target);
    const p = panel(page);
    await p.getByRole('button', { name: 'ตรวจใบสมัคร · ' + round }).click();
    await expect(p.getByRole('heading', { name: 'นักศึกษา A', exact: true })).toBeVisible();
    return p;
}
function row(p, name) {
    return p.locator('article').filter({ has: p.page().getByRole('heading', { name, exact: true }) });
}
async function draft(card, value, evidence) {
    await card.getByLabel('ผลคัดเลือกร่าง').selectOption(value);
    if (evidence) await capture(card.page(), evidence, card);
    await card.getByRole('button', { name: 'บันทึกผลร่าง', exact: true }).click();
    await expect(card.getByText('ตรวจทานก่อนเผยแพร่')).toBeVisible();
}
async function publish(card, evidence) {
    await card.getByText('ตรวจทานก่อนเผยแพร่').click();
    if (evidence) await capture(card.page(), evidence, card.getByRole('button', { name: 'เผยแพร่ผลให้ผู้สมัครคนนี้' }));
    await card.getByRole('button', { name: 'เผยแพร่ผลให้ผู้สมัครคนนี้' }).click();
    await expect(card.getByText(/เผยแพร่แล้ว ·/)).toBeVisible();
}
async function checkHandbook(page) {
    const handout = detail(page).getByRole('link', { name: 'คู่มือผู้เข้าร่วม (สมมติ)', exact: true });
    const pdf = await handout.evaluate(async (anchor) => {
        const reply = await fetch(anchor.href, { credentials: 'same-origin' });
        return { status: reply.status, type: reply.headers.get('content-type'), body: await reply.text() };
    });
    expect(pdf.status).toBe(200);
    expect(pdf.type).toContain('application/pdf');
    expect(pdf.body).toContain('Synthetic Exchange handbook');
}
async function myExchange(page) {
    const url = '/index.html?kind=exchanges#board-section';
    if (page.url().endsWith(url)) await page.reload();
    else await page.goto(url);
    await expect(page.locator('#tabExchange')).toHaveAttribute('aria-pressed', 'true');
}
test('public activity, two private applications, staff publication, partner acceptance and existing My Exchange', async ({
    browser
}) => {
    const fx = startFixture(),
        contexts = [];
    try {
        const clock = await fx.send('clock', { offset: 0 });
        await fx.send('login', { client: 'manager', user: 'coordinator' });
        const manager = await fx.browserPage(browser, 'manager'),
            a = await fx.browserPage(browser, 'alpha');
        const b = await fx.browserPage(browser, 'beta', {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true
        });
        const ordinary = await fx.browserPage(browser, 'visitor');
        contexts.push(...[manager, a, b, ordinary].map((p) => p.context()));
        await makeRound(manager, clock);
        await makeRound(manager, clock, {
            activity: secondary,
            project: otherProject,
            title: 'รอบป่าชุมชน (สมมติ)'
        });
        await fromBoard(ordinary, activity);
        await expect(panel(ordinary).getByText('ยังไม่เปิดรับสมัคร', { exact: true })).toBeVisible();
        await expect(panel(ordinary)).not.toContainText('รอบป่าชุมชน');
        await fromBoard(ordinary, secondary);
        await expect(panel(ordinary)).toContainText('รอบป่าชุมชน');
        await fromBoard(ordinary, 'สัมมนาทั่วไป (สมมติ)');
        await expect(detail(ordinary).getByRole('heading', { name: 'รอบรับสมัคร Exchange' })).toHaveCount(0);
        await fx.send('clock', { offset: 60 });
        await fromBoard(ordinary, activity);
        await expect(panel(ordinary).getByText('เปิดรับสมัคร', { exact: true })).toBeVisible();
        await capture(
            ordinary,
            'exchange-round',
            panel(ordinary).getByRole('link', { name: 'เข้าสู่ระบบ TU เพื่อสมัคร' })
        );
        await submit(a, 'student-a');
        await submit(b, 'student-b');
        await a.reload();
        await expect(panel(a).getByText('ส่งใบสมัครแล้ว', { exact: true })).toBeVisible();
        const p = await roster(manager),
            ar = row(p, 'นักศึกษา A'),
            br = row(p, 'นักศึกษา B');
        const startReview = ar.getByRole('button', { name: 'เริ่มพิจารณา' });
        const requestInfo = ar.getByText('ขอข้อมูลเพิ่ม', { exact: true });
        const saveDraft = ar.getByRole('button', { name: 'บันทึกผลร่าง', exact: true });
        await expect(saveDraft).toHaveText('บันทึกผลร่าง');
        expect(await manager.evaluate(() => window.CstuAdmissions.message(new Error('NO_DRAFT'))))
            .toBe('กรุณาบันทึกผลร่างก่อนเผยแพร่');
        await expect(startReview).toHaveCSS('background-color', 'rgb(195, 0, 47)');
        await expect(saveDraft).toHaveCSS('border-top-color', 'rgb(195, 0, 47)');
        await expect(saveDraft).toHaveCSS('border-top-width', '1px');
        await expect(ar).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await expect(requestInfo).toHaveCSS('color', 'rgb(180, 77, 102)');
        await expect(requestInfo).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(requestInfo).toHaveCSS('border-top-style', 'none');
        await expect(requestInfo).toHaveCSS('display', 'list-item');
        const hitArea = await requestInfo.boundingBox();
        expect(hitArea.height).toBeGreaterThanOrEqual(44);
        expect(hitArea.width).toBeGreaterThanOrEqual(44);
        await capture(manager, 'exchange-action-hierarchy', ar);
        await capture(manager, 'review-disclosure', ar, ar);
        const mobileManager = await fx.browserPage(browser, 'manager', {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true
        });
        contexts.push(mobileManager.context());
        const mobileRow = row(await roster(mobileManager), 'นักศึกษา A');
        const mobileRequest = mobileRow.getByText('ขอข้อมูลเพิ่ม', { exact: true });
        for (const width of [390, 320]) {
            await mobileManager.setViewportSize({ width, height: 844 });
            await mobileRequest.scrollIntoViewIfNeeded();
            const box = await mobileRequest.boundingBox();
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width);
            await mobileRequest.tap();
            await expect(mobileRow.getByLabel('สิ่งที่ขอ')).toBeVisible();
            await mobileRequest.tap();
            await expect(mobileRow.getByLabel('สิ่งที่ขอ')).toBeHidden();
        }
        await startReview.click();
        await expect(ar.getByText('ใบสมัคร · อยู่ระหว่างพิจารณา', { exact: true })).toBeVisible();
        await startReview.focus();
        await manager.keyboard.press('Tab');
        await expect(requestInfo).toBeFocused();
        await expect(requestInfo).toHaveCSS('outline-style', 'solid');
        await requestInfo.press('Enter');
        await expect(ar.getByLabel('สิ่งที่ขอ')).toBeVisible();
        await requestInfo.press('Space');
        await expect(ar.getByLabel('สิ่งที่ขอ')).toBeHidden();
        await requestInfo.hover();
        await expect(requestInfo).toHaveCSS('text-decoration-line', 'underline');
        await expect(requestInfo).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await requestInfo.click();
        await ar.getByLabel('สิ่งที่ขอ').fill('หัวข้อฉบับปรับปรุง (สมมติ)');
        await ar.getByLabel('ช่องทางส่งข้อมูล').fill('ช่องทางของสาขา (สมมติ)');
        await ar.getByLabel('กำหนดส่ง (เวลาไทย)').fill(thaiInput(clock + 180));
        const saveRequest = ar.getByRole('button', { name: 'บันทึกข้อมูลคำขอ', exact: true });
        await expect(saveRequest).toBeVisible();
        await expect(saveRequest).toHaveText('บันทึกข้อมูลคำขอ');
        await capture(manager, '03-request-information', ar.locator('details[open] form'));
        await saveRequest.click();
        await expect(ar.getByText(/ช่องทางของสาขา/)).toBeVisible();
        await a.reload();
        await expect(panel(a)).toContainText('หัวข้อฉบับปรับปรุง');
        await capture(a, '04-student-information-request', panel(a).getByText('ต้องส่งข้อมูลเพิ่ม', { exact: true }));
        await b.reload();
        await expect(panel(b)).not.toContainText('หัวข้อฉบับปรับปรุง');
        await fx.send('clock', { offset: 180 });
        await draft(ar, 'passed', '05-select-draft');
        await draft(br, 'declined');
        await a.reload();
        await expect(panel(a).getByText('อยู่ระหว่างพิจารณา', { exact: true })).toBeVisible();
        await expect(panel(a)).not.toContainText('ผ่านการคัดเลือกของสาขา · รอยืนยันสิทธิ์');
        await capture(a, '06-student-before-publication', panel(a).getByText('อยู่ระหว่างพิจารณา', { exact: true }));
        await fx.send('clock', { offset: 240 });
        await publish(ar, '07-publication-preview');
        await publish(br);
        await capture(manager, 'exchange-review', ar.getByText('รอนักศึกษายืนยันสิทธิ์'));
        await myExchange(a);
        const mine = a.locator('#records-content .exchange-admissions');
        await expect(mine).toContainText('รอยืนยันสิทธิ์');
        await expect(mine.getByRole('button', { name: 'ยืนยันสิทธิ์ของฉัน' })).toHaveCSS(
            'background-color',
            'rgb(195, 0, 47)'
        );
        await capture(a, 'exchange-my-application', mine.getByRole('button', { name: 'ยืนยันสิทธิ์ของฉัน' }));
        await mine.getByRole('link', { name: round, exact: true }).click();
        const confirmation = panel(a).getByRole('button', { name: 'ยืนยันสิทธิ์ของฉัน' });
        await capture(a, '08-student-confirm-place', confirmation);
        await confirmation.focus();
        await a.keyboard.press('Space');
        await expect(panel(a)).toContainText('รอคู่สัญญาตอบรับ');
        await capture(
            a,
            'exchange-awaiting-partner',
            panel(a).getByText('ผู้รับผิดชอบจะบันทึกเมื่อได้รับการตอบรับจากคู่สัญญา')
        );
        await myExchange(a);
        await expect(a.locator('.records-list')).not.toContainText(project);
        await fx.send('clock', { offset: 419 });
        await b.reload();
        await expect(panel(b).getByText('ไม่ผ่านการคัดเลือกของสาขา', { exact: true })).toBeVisible();
        await capture(
            b,
            'exchange-mobile-result',
            panel(b).getByText('ไม่ผ่านการคัดเลือกของสาขา', { exact: true })
        );
        await fx.send('clock', { offset: 420 });
        await expect(panel(b).getByText('ไม่ผ่านการคัดเลือกของสาขา', { exact: true })).toHaveCount(0);
        await b.reload();
        await expect(panel(b)).toContainText(round);
        await expect(panel(b).getByText('ไม่ผ่านการคัดเลือกของสาขา', { exact: true })).toHaveCount(0);
        await myExchange(b);
        await expect(b.locator('#records-content')).not.toContainText(round);
        await roster(manager);
        await expect(br.getByText(/เผยแพร่แล้ว · ไม่ผ่าน/)).toBeVisible();
        await capture(manager, '09-coordinator-partner-acceptance', ar);
        await ar.getByRole('button', { name: 'บันทึกว่าคู่สัญญาตอบรับแล้ว' }).click();
        await expect(ar.getByText('เข้าร่วมโครงการแล้ว', { exact: true })).toBeVisible();
        await capture(manager, '10-coordinator-enrolled', ar);
        await myExchange(a);
        await expect(mine).toContainText('เข้าร่วมโครงการแล้ว');
        await capture(a, '11-student-my-exchange', a.locator('.records-list').getByRole('button', { name: project }));
        await a.locator('.records-list').getByRole('button', { name: project }).click();
        await expect(detail(a)).toContainText('กำหนดการสำหรับผู้เข้าร่วม (สมมติ)');
        await checkHandbook(a);
        await capture(
            a,
            'exchange-participant',
            detail(a).getByText('คู่มือผู้เข้าร่วม (สมมติ)', { exact: false }).first()
        );
        await fx.send('login', { client: 'existing', user: 'multi' });
        const legacy = await fx.browserPage(browser, 'existing');
        contexts.push(legacy.context());
        await legacy.goto('/work.html?kind=exchanges&id=project-original#board-section');
        await expect(detail(legacy).locator('#detail-title')).toHaveText('โครงการเดิม (สมมติ)');
        await checkHandbook(legacy);
    } finally {
        await Promise.all(contexts.map((c) => c.close()));
        fx.close();
    }
});

test('official-office notice, a form submitted at closing, and retained application count', async ({
    browser
}) => {
    const fx = startFixture(),
        contexts = [];
    try {
        const clock = await fx.send('clock', { offset: 0 });
        await fx.send('login', { client: 'manager', user: 'coordinator' });
        await fx.send('login', { client: 'applicant', user: 'student-a' });
        const manager = await fx.browserPage(browser, 'manager'),
            student = await fx.browserPage(browser, 'applicant');
        contexts.push(manager.context(), student.context());
        await makeRound(manager, clock);
        await makeRound(manager, clock, {
            activity: secondary,
            project: otherProject,
            title: 'รอบช่องทางภายนอก (สมมติ)',
            official: true
        });
        await fx.send('clock', { offset: 60 });
        await fromBoard(student, secondary);
        const official = panel(student).getByRole('link', { name: 'ช่องทางทางการของสำนักงานวิเทศ (สมมติ)' });
        await expect(official).toHaveAttribute('href', 'https://example.org/official-exchange');
        await expect(
            panel(student).getByRole('button', { name: 'สมัครเข้าร่วมเพื่อให้สาขาคัดเลือก' })
        ).toHaveCount(0);
        await fromBoard(student, activity);
        const card = panel(student);
        await card.getByRole('button', { name: 'สมัครเข้าร่วมเพื่อให้สาขาคัดเลือก' }).click();
        await card.getByLabel('หัวข้อที่สนใจศึกษา').fill('คำตอบสมมติที่ค้างไว้');
        await fx.send('clock', { offset: 180 });
        await card.getByRole('button', { name: 'ส่งใบสมัคร', exact: true }).press('Enter');
        await expect(card.getByRole('status')).toContainText('หมดเวลารับสมัครแล้ว');
        await student.reload();
        await fromBoard(student, activity);
        await expect(panel(student).getByText('ปิดรับสมัครแล้ว', { exact: true })).toBeVisible();
        const [status, reply] = await fx.send('request', {
            client: 'applicant',
            path: '/api/me/admission-applications',
            method: 'GET'
        });
        expect(status).toBe(200);
        expect(reply.data).toEqual([]);
    } finally {
        await Promise.all(contexts.map((c) => c.close()));
        fx.close();
    }
});
