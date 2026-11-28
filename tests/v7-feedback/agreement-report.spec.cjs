const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { startFixture } = require('./fixture.cjs');

const mou = 'MoU ฉบับที่ 1 — ความร่วมมือทางวิชาการและกิจกรรม AI';
const moa = 'MoA ฉบับที่ 2 — โครงการแลกเปลี่ยนวิจัยนักศึกษา';
const topic = 'ส่งกำหนดการอบรมให้ผู้เข้าร่วมล่วงหน้า';
const enrolled = 'นักศึกษาที่เข้าร่วม Exchange ครบขั้น (คนไม่ซ้ำ)';
const evidence = process.env.CSTU_V7_REPORT_EVIDENCE_DIR;
const overview = '/work.html?view=overview#board-section';
const exportButton = page => page.getByRole('button', { name: 'ส่งออกรายงาน CSV' });
const metric = (page, label) => page.locator('.overview-metric').filter({ has: page.getByText(label, {exact: true}) }).locator('strong');

async function screenshot(page, anchor, filename) {
    if (!evidence) return;
    await fs.mkdir(evidence, { recursive: true });
    await anchor.evaluate(el => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 95, behavior: 'instant' }));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(evidence, filename), animations: 'disabled' });
}

async function csv(page, filename) {
    const pending = page.waitForEvent('download');
    await exportButton(page).click();
    const download = await pending;
    const contents = await fs.readFile(await download.path(), 'utf8');
    expect(contents).not.toMatch(/@example\.invalid|ชื่อผู้(ตอบ|สมัคร)จำลองสำหรับตรวจการแสดงผล|student-pending/);
    if (evidence && filename) await download.saveAs(path.join(evidence, filename));
    return contents;
}

async function apply(page, agreementId, status = '') {
    const form = page.locator('.overview-filters');
    await form.locator('[name=agreementId]').selectOption(agreementId);
    await form.locator('[name=status]').selectOption(status);
    const ready = page.waitForResponse(r => new URL(r.url()).pathname === '/api/overview');
    await form.getByRole('button', { name: 'แสดงผล' }).click();
    await ready;
    await expect(exportButton(page)).toBeEnabled();
}

test('term report follows a partner through the signed agreement, Exchange feedback, scoped overview and actual CSV', async ({browser}) => {
    const fx = await startFixture();
    try {
        await fx.send('seed_term');
        await fx.send('login', {client: 'office', user: 'staff'});
        const page = await fx.browserPage(browser, 'office');
        await page.goto('/work.html?kind=partners&id=partner-v7-demo#board-section');
        await page.locator('#detailModal .partner-agreements').getByRole('button', { name: moa, exact: true }).click();
        const dialog = page.locator('#record-detail[open]');
        await dialog.locator('.agreement-work').getByRole('button', { name: 'โครงการแลกเปลี่ยนวิจัยภาคฤดูร้อน' }).click();
        await dialog.getByRole('tab', { name: 'ผลตอบรับจากแบบฟอร์ม' }).click();
        await dialog.getByRole('button', { name: 'นำเข้าแบบฟอร์ม' }).click();
        const editor = dialog.locator('form.form-import-editor');
        await editor.locator('[type=file]').setInputFiles({
            name: 'ผลตอบรับเทอมตัวอย่าง.csv', mimeType: 'text/csv',
            buffer: Buffer.from('ประเด็นติดตาม,ข้อเสนอแนะ\nเตรียมภาษา,เพิ่มชั่วโมงฝึก\nที่พัก,ส่งแผนที่ล่วงหน้า\nการเดินทาง,แจ้งเวลานัดหมาย')
        });
        await expect(editor.getByLabel('ชีต')).toBeEnabled();
        await editor.getByLabel('ชื่อแบบฟอร์ม').fill('แบบติดตามหลังแลกเปลี่ยน');
        await editor.getByLabel('คำตอบจาก').selectOption('participant');
        await editor.getByRole('button', { name: 'ดูตัวอย่าง' }).click();
        await editor.getByRole('button', { name: 'ยืนยันนำเข้า 3 คำตอบ' }).click();
        await expect(dialog.locator('.form-batch')).toContainText('แบบติดตามหลังแลกเปลี่ยน');
        await dialog.locator('#detail-close').click();
        await page.goto(overview);
        const form = page.locator('.overview-filters');
        await form.locator('[name=startDate]').fill('2026-11-01');
        await form.locator('[name=endDate]').fill('2027-03-31');
        await expect(exportButton(page)).toBeDisabled();
        await apply(page, 'mou-v7-1');
        const panel = page.locator('.overview-form-feedback');
        await expect(metric(page, 'กิจกรรม')).toHaveText('2');
        await expect(metric(page, enrolled)).toHaveText('0');
        await expect(panel).toContainText(topic);
        await expect(panel).not.toContainText('กิจกรรมก่อนเปิดเทอม');
        await expect(panel.locator('[data-agreement-id]')).toHaveCount(1);
        await expect(panel.locator('[data-agreement-id]')).toContainText('1 ความคิดเห็น');
        await screenshot(page, panel, 'mou-feedback.png');
        const first = await csv(page, 'mou-term.csv');
        expect(first).toContain('"ภาพรวม","กิจกรรม","2"');
        expect(first).toContain(topic);
        expect(first).toContain('"ความคิดเห็นตามข้อตกลง","' + mou + '","1"');
        expect(first).not.toContain(moa);
        await apply(page, 'moa-v7-2', 'ongoing');
        await expect(metric(page, 'กิจกรรม')).toHaveText('0');
        await expect(metric(page, enrolled)).toHaveText('2');
        await expect(panel.locator('.overview-panel-total')).toHaveText('รวม 1 ชุด · 3 คำตอบ');
        await expect(panel.locator('[data-agreement-id]')).toHaveCount(1);
        await expect(panel).not.toContainText(topic);
        await screenshot(page, form, 'moa-term.png');
        const second = await csv(page, 'moa-term.csv');
        expect(second).toContain('"ภาพรวม","' + enrolled + '","2"');
        expect(second).toContain('"ผลตอบรับตามข้อตกลง","' + moa + '","3"');
        expect(second).toContain('"ตัวกรอง","ข้อตกลง","moa-v7-2"');
        expect(second).not.toContain(mou);
        await panel.getByRole('button', {name:'ดูแหล่งที่มาและคำตอบ'}).click();
        await expect(panel.locator('.overview-source-detail')).toContainText('ส่งแผนที่ล่วงหน้า');
        await expect(page.locator('.overview-dashboard')).not.toContainText('ชื่อผู้สมัครจำลองสำหรับตรวจการแสดงผล');
        await apply(page, 'moa-v7-2', 'completed');
        await expect(metric(page, enrolled)).toHaveText('0');
        await expect(panel.locator('.overview-panel-total')).toHaveText('รวม 0 ชุด · 0 คำตอบ');
        await apply(page, '');
        await expect(panel.locator('.overview-unspecified-row')).toContainText('1 ความคิดเห็น');
        await expect(metric(page, 'ความคิดเห็น')).toHaveText('2');
        await form.locator('[name=startDate]').fill('');
        await form.locator('[name=endDate]').fill('');
        await apply(page, 'mou-v7-1');
        await expect(metric(page, 'กิจกรรม')).toHaveText('3');
    } finally { await fx.close(); }
});

test('Executive recovers from an unavailable report, Coordinator sees assigned work without CSV', async ({browser}) => {
    const fx = await startFixture();
    try {
        await fx.send('seed_term');
        await fx.send('login', {client:'manager', user:'executive'});
        await fx.send('login', {client:'owner', user:'coordinator'});
        const page = await fx.browserPage(browser, 'manager');
        await page.goto(overview);
        await expect(exportButton(page)).toBeEnabled();
        await page.route('**/api/overview*', route => route.fulfill({status:503, json:{error:'unavailable'}}), {times:1});
        await page.getByRole('button', { name: 'แสดงผล' }).click();
        await expect(page.locator('.overview-status')).toHaveAttribute('data-state', 'error');
        await expect(page.locator('.overview-tab-content')).toContainText('โหลดข้อมูลสรุปไม่สำเร็จ');
        await expect(exportButton(page)).toBeDisabled();
        await screenshot(page, page.locator('.overview-filters'), 'outage.png');
        await page.getByRole('button', { name: 'แสดงผล' }).click();
        await expect(exportButton(page)).toBeEnabled();
        await expect(metric(page, enrolled)).toHaveText('2');
        expect(await csv(page)).toContain('"ภาพรวม","' + enrolled + '","2"');
        const owner = await fx.browserPage(browser, 'owner');
        await owner.goto('/work.html?kind=partners&id=partner-v7-demo#board-section');
        const links = owner.locator('#detailModal .partner-agreements');
        await expect(links.getByRole('button', {name:mou,exact:true})).toBeVisible();
        await expect(links.getByRole('button', {name:moa,exact:true})).toHaveCount(0);
        await links.getByRole('button', {name:mou,exact:true}).click();
        await expect(owner.locator('.agreement-links-activities button')).toHaveCount(3);
        await screenshot(owner, owner.locator('.agreement-work'), 'coordinator.png');
        await owner.goto(overview);
        await expect(owner.locator('#board-overview')).toBeHidden();
        await expect(exportButton(owner)).toHaveCount(0);
    } finally { await fx.close(); }
});
