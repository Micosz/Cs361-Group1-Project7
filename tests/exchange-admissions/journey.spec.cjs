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
async function capture(page, name, focus) {
    if (!process.env.CSTU_ADMISSIONS_EVIDENCE_DIR) return;
    if (focus) await focus.scrollIntoViewIfNeeded();
    const dir = process.env.CSTU_ADMISSIONS_EVIDENCE_DIR;
    await fs.mkdir(dir, { recursive: true });
    await page.screenshot({
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
async function draft(card, value) {
    await card.getByLabel('ผลคัดเลือกร่าง').selectOption(value);
    await card.getByRole('button', { name: 'บันทึกร่างผล' }).click();
    await expect(card.getByText('ตรวจทานก่อนเผยแพร่')).toBeVisible();
}
async function publish(card) {
    await card.getByText('ตรวจทานก่อนเผยแพร่').click();
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
        await ar.getByText('ขอข้อมูลเพิ่ม', { exact: true }).click();
        await ar.getByLabel('สิ่งที่ขอ').fill('หัวข้อฉบับปรับปรุง (สมมติ)');
        await ar.getByLabel('ช่องทางส่งข้อมูล').fill('ช่องทางของสาขา (สมมติ)');
        await ar.getByLabel('กำหนดส่ง (เวลาไทย)').fill(thaiInput(clock + 180));
        await ar.getByRole('button', { name: 'บันทึกคำขอข้อมูล' }).click();
        await expect(ar.getByText(/ช่องทางของสาขา/)).toBeVisible();
        await a.reload();
        await expect(panel(a)).toContainText('หัวข้อฉบับปรับปรุง');
        await b.reload();
        await expect(panel(b)).not.toContainText('หัวข้อฉบับปรับปรุง');
        await fx.send('clock', { offset: 180 });
        await draft(ar, 'passed');
        await draft(br, 'declined');
        await a.reload();
        await expect(panel(a).getByText('อยู่ระหว่างพิจารณา', { exact: true })).toBeVisible();
        await expect(panel(a)).not.toContainText('ผ่านการคัดเลือกของสาขา · รอยืนยันสิทธิ์');
        await fx.send('clock', { offset: 240 });
        await publish(ar);
        await publish(br);
        await capture(manager, 'exchange-review', ar.getByText('รอนักศึกษายืนยันสิทธิ์'));
        await myExchange(a);
        const mine = a.locator('#records-content .exchange-admissions');
        await expect(mine).toContainText('รอยืนยันสิทธิ์');
        await expect(mine.getByRole('button', { name: 'ยืนยันสิทธิ์ของฉัน' })).toHaveCSS(
            'background-color',
            'rgb(121, 36, 58)'
        );
        await capture(a, 'exchange-my-application', mine.getByRole('button', { name: 'ยืนยันสิทธิ์ของฉัน' }));
        await mine.getByRole('link', { name: round, exact: true }).click();
        const confirmation = panel(a).getByRole('button', { name: 'ยืนยันสิทธิ์ของฉัน' });
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
        await ar.getByRole('button', { name: 'บันทึกว่าคู่สัญญาตอบรับแล้ว' }).click();
        await expect(ar.getByText('เข้าร่วมโครงการแล้ว', { exact: true })).toBeVisible();
        await myExchange(a);
        await expect(mine).toContainText('เข้าร่วมโครงการแล้ว');
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
