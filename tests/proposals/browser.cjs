const { expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');

const origin = 'https://127.0.0.1:4178';
const start = new Date('2027-05-10T03:00:00Z');
const file = (n) => path.join(__dirname, 'fixtures', 'mou-demo-v' + n + '.pdf');
const board = '/work.html?view=proposals';
const flow = (p) => p.locator('#proposal-flow-dialog');
const card = (p, title) =>
    p.locator('#proposal-cards article').filter({
        has: p.getByRole('heading', { name: title, exact: true })
    });

async function login(browser, account, mobile = false, offset = 0) {
    const page = await browser.newPage({
        baseURL: origin,
        ignoreHTTPSErrors: true,
        timezoneId: 'Asia/Bangkok',
        locale: 'th-TH',
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        isMobile: mobile,
        hasTouch: mobile,
        reducedMotion: 'reduce',
        serviceWorkers: 'block'
    });
    await page.context().route('**/*', (route) => {
        if (new URL(route.request().url()).origin !== origin) return route.abort();
        return route.continue();
    });
    await page.clock.setFixedTime(new Date(start.getTime() + offset * 1000));
    await page.goto('/login.html');
    if (account) {
        await page.locator('#student-id').fill(account);
        await page.locator('#student-password').fill('mock');
        const result = page.waitForResponse((r) => r.url().endsWith('/api/auth/login'));
        await page.locator('#login-submit').click();
        expect((await result).status()).toBe(200);
        await page.waitForURL(account === 'student-a' ? '**/index.html*' : '**/work.html*');
    }
    return page;
}
async function enter(page) {
    await page.goto(board);
    await expect(page.locator('#proposal-board')).toBeVisible();
    await expect(page.locator('#proposal-status')).not.toContainText('โหลดข้อเสนอไม่ได้');
}
async function openCard(page, title) {
    await card(page, title)
        .getByRole('button', { name: 'ดูรายละเอียด ' + title })
        .click();
    await expect(flow(page)).toBeVisible();
    return flow(page);
}
async function newProposal(
    page,
    {
        kind = 'mou',
        title,
        person,
        organization,
        direct = false,
        host = false,
        support = false,
        validate = false,
        captureForm = false
    }
) {
    await page.locator('#proposal-new').click();
    const form = page.locator('#proposal-form');
    await form.locator('[name=kind]').selectOption(kind);
    await form.locator('[name=title]').fill(title);
    if (person || organization) {
        await form.locator('[name=partnerMode]').selectOption(person ? 'person' : 'organization');
        await form.locator('[name=partner]').fill(person || organization);
    } else {
        await form.locator('[name=partnerId]').selectOption('partner-demo');
        await expect(form.locator('#proposal-partner-history')).toHaveAttribute('href', /partner-demo/);
    }
    await form.locator('[name=stage]').selectOption('contacted');
    if (direct) await form.locator('[name=source]').selectOption('direct');
    else {
        await form.locator('[name=days]').fill('1');
        await expect(form.locator('#proposal-deadline')).toContainText('10:00:00');
    }
    if (host) await form.locator('[name=hostSelf]').check();
    if (validate) {
        await form.locator('#proposal-post').click();
        await expect(form.locator('[name=summary]:invalid')).toHaveCount(1);
        await expect(form).toBeVisible();
        await expect(form.locator('#proposal-summary-hint')).toHaveText('อยากทำอะไร กับใคร และตอนนี้อยู่ขั้นไหน');
    }
    const summary =
        kind === 'activity'
            ? 'ศิษย์เก่าติดต่ออาจารย์เพื่อเป็นวิทยากรห้องเรียนข้อมูลชุมชน คุยหัวข้อเบื้องต้นแล้ว (ข้อมูลสมมติ)'
            : kind === 'exchange'
              ? 'หลักสูตรกับศูนย์การเรียนรู้ลานดาววางแผนแลกเปลี่ยนนักศึกษา กำลังหาช่วงเวลาที่ตรงกัน (ข้อมูลสมมติ)'
              : 'หลักสูตรกับศูนย์การเรียนรู้ลานดาวหารือร่างความร่วมมือจัดห้องเรียนข้อมูลชุมชนแล้ว (ข้อมูลสมมติ)';
    await form.locator('[name=summary]').fill(summary);
    if (support) {
        await form.locator('details summary').click();
        await form.locator('[name=supportUrl]').fill('https://example.org/synthetic-agenda');
        await form.locator('[name=supportFile]').setInputFiles(file(1));
    }
    if (captureForm) {
        const host = form.locator('[name=hostSelf]');
        const box = await host.boundingBox(),
            label = await host.locator('..').boundingBox();
        expect(box.width).toBeLessThanOrEqual(28);
        expect(box.width).toBeLessThan(label.width / 3);
        await capture(page, '01-proposal');
    }
    await form.locator('#proposal-post').click();
    await expect(flow(page)).toBeVisible();
    await expect(flow(page).locator('#proposal-flow-title')).toHaveText(title);
    return flow(page);
}
async function closeDetail(page) {
    await page.locator('#proposal-flow-close').click();
    await expect(flow(page)).toBeHidden();
}
async function capture(page, name, target) {
    if (!process.env.CSTU_PROPOSAL_EVIDENCE_DIR) return;
    if (target) await target.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.evaluate(() => document.fonts.ready);
    await fs.mkdir(process.env.CSTU_PROPOSAL_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({
        path: path.join(process.env.CSTU_PROPOSAL_EVIDENCE_DIR, name + '.jpg'),
        type: 'jpeg',
        quality: 84,
        animations: 'disabled'
    });
}
async function draft(page, n, selected = n) {
    const form = page.locator('#proposal-draft-form');
    if (!(await form.isVisible())) {
        await flow(page)
            .getByRole('button', { name: /^(ส่ง MoU ให้พิจารณา|เตรียมร่าง MoU)$/ })
            .click();
    }
    await form.locator('[name=draftFile]').setInputFiles(file(n));
    await form.getByRole('button', { name: 'แนบร่างฉบับใหม่' }).click();
    const choices = page.locator('#proposal-submit-form [name=revision]');
    await expect(choices.locator('option[value="' + n + '"]')).toHaveCount(1);
    await expect(choices).toHaveValue(String(selected));
}
async function submitRevision(page, n, note = '') {
    const form = page.locator('#proposal-submit-form');
    await form.locator('[name=revision]').selectOption(String(n));
    if (note) await form.locator('[name=note]').fill(note);
    await form.locator('[name=confirmed]').check();
    const complete = page.waitForResponse((r) => r.url().endsWith('/workflow') && r.request().method() === 'POST');
    await form.getByRole('button').click();
    const result = await complete;
    expect(result.status(), await result.text()).toBe(200);
}
async function verifyFile(page, anchor, number) {
    await expect(anchor).toBeVisible();
    const download = page.waitForEvent('download', { timeout: 7000 });
    if (page.viewportSize().width === 390) await anchor.tap();
    else await anchor.press('Enter');
    const saved = await download;
    expect(saved.suggestedFilename()).toBe('mou-demo-v' + number + '.pdf');
    expect(await saved.failure()).toBe(null);
    expect(Buffer.compare(await fs.readFile(await saved.path()), await fs.readFile(file(number)))).toBe(0);
    return anchor.getAttribute('href');
}
async function row(page, title) {
    const id = await card(page, title).locator('[data-details]').getAttribute('data-details');
    const result = await page.context().request.get('/api/proposals/' + id);
    expect(result.status()).toBe(200);
    return (await result.json()).data;
}
async function interest(page, title, note = '', edit = false) {
    await card(page, title)
        .getByRole('button', { name: edit ? 'แก้ไขความสนใจ' : 'สนใจช่วยงาน' })
        .click();
    await page.locator('#proposal-interest-note').fill(note);
    await page.locator('#proposal-interest-save').click();
    await expect(page.locator('#proposal-interest-dialog')).toBeHidden();
}
async function read(apiPage, path) {
    const result = await apiPage.context().request.get(path);
    return { status: result.status(), body: await result.json() };
}
module.exports = {
    origin,
    start,
    file,
    board,
    flow,
    card,
    login,
    enter,
    openCard,
    newProposal,
    closeDetail,
    capture,
    read,
    row,
    interest,
    draft,
    submitRevision,
    verifyFile
};
