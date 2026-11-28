const { test, expect } = require('@playwright/test');
const {
    login,
    enter,
    read,
    board,
    card,
    flow,
    newProposal,
    openCard,
    closeDetail,
    capture,
    row,
    interest,
    draft,
    submitRevision,
    verifyFile
} = require('./browser.cjs');

test.beforeEach(async ({ request }) => {
    expect((await request.post('/__fixture/reset')).status()).toBe(200);
});

test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map((context) => context.close()));
});

test('normal synthetic TU login opens the internal work page through its proposal shortcut', async ({
    browser
}) => {
    const owner = await login(browser, 'coordinator');
    const shortcut = owner.locator('#proposal-shortcut');
    await expect(shortcut).toBeVisible();
    await shortcut.click();
    await expect(owner).toHaveURL(/work\.html\?view=proposals/);
    await expect(owner.getByRole('heading', { name: 'กระดานข้อเสนอความร่วมมือ' })).toBeVisible();
    const options = await read(owner, '/api/selection-partners?scopeId=cs-demo');
    expect(options.status).toBe(200);
    expect(options.body.data).toContainEqual({ id: 'partner-demo', name: 'ศูนย์การเรียนรู้ลานดาว (สมมติ)' });
    await owner.close();
});

const reason = 'ขอระบุในข้อ 3 ว่าใครส่งผลกิจกรรม ส่งให้ใคร และภายในกี่วัน';
const revisionNote = 'แก้ข้อ 3 ให้เจ้าภาพส่งสรุปแก่ผู้ประสานงานทั้งสองฝ่ายภายใน 14 วันหลังจบกิจกรรม';

test('two accounts submit, open the exact PDF, return v1 and approve v2 with a durable decision history', async ({
    browser,
    request
}) => {
    const title = 'ห้องเรียนข้อมูลชุมชน (สมมติ)';
    const owner = await login(browser, 'coordinator');
    await enter(owner);
    await newProposal(owner, { title, direct: true, host: true });
    await expect(flow(owner)).toContainText('ส่งตรง');
    await expect(owner.locator('#proposal-draft-form')).toBeHidden();
    await draft(owner, 1);
    await submitRevision(owner, 1);
    await expect(owner.locator('#proposal-flow-waiting')).toHaveText('รอผู้บริหารพิจารณา');

    const executive = await login(browser, 'executive');
    await enter(executive);
    await executive.locator('#proposal-view').selectOption('review');
    await expect(card(executive, title)).toContainText('ส่งตรง');
    await openCard(executive, title);
    const documentLink = (page, n) =>
        page
            .locator('#proposal-review-file')
            .getByRole('link', { name: 'ร่างฉบับที่ ' + n + ' · เปิดไฟล์', exact: true });
    const v1Url = await verifyFile(executive, documentLink(executive, 1), 1);
    const decision = executive.locator('#proposal-decision-form');
    await decision.getByRole('button', { name: 'ส่งกลับให้แก้' }).click();
    await expect(decision.locator('[name=reason]')).toBeFocused();
    await expect(executive.locator('#proposal-flow-waiting')).toHaveText('รอผู้บริหารพิจารณา');
    await closeDetail(executive);
    await openCard(executive, title);
    await decision.locator('[name=reason]').fill(reason);
    await capture(executive, '03-review-v1', decision);
    await decision.getByRole('button', { name: 'ส่งกลับให้แก้' }).click();
    await expect(executive.locator('#proposal-flow-waiting')).toHaveText('ส่งกลับให้แก้');

    await owner.reload();
    await openCard(owner, title);
    await expect(owner.locator('#proposal-review-file')).toContainText(reason);
    await draft(owner, 2);
    await owner.locator('#proposal-submit-form [name=note]').fill(revisionNote);
    await capture(owner, '04-resubmit-v2', owner.locator('#proposal-submit-form'));
    await submitRevision(owner, 2, revisionNote);
    await request.post('/__fixture/clock', { data: { offset: 60 } });
    await executive.reload();
    await openCard(executive, title);
    const v2Url = await verifyFile(executive, documentLink(executive, 2), 2);
    expect(v2Url).not.toBe(v1Url);

    const mobile = await login(browser, 'executive', true, 60);
    await enter(mobile);
    await openCard(mobile, title);
    expect(await verifyFile(mobile, documentLink(mobile, 2), 2)).toBe(v2Url);
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await decision.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await expect(executive.locator('#proposal-flow-waiting')).toHaveText('รอลงนาม');
    await executive.reload();
    await openCard(executive, title);
    const audit = executive.locator('#proposal-flow-history li');
    const returned = audit.filter({ hasText: reason }),
        approved = audit.filter({ hasText: 'อนุมัติ · ร่างฉบับที่ 2' });
    await expect(audit.locator('strong').filter({ hasText: /^ส่งกลับให้แก้/ })).toHaveCount(1);
    await expect(audit.locator('strong').filter({ hasText: /^แนบร่าง.*ฉบับที่ 2/ })).toHaveCount(1);
    await expect(returned).toContainText('ร่างฉบับที่ 1');
    await expect(approved).toContainText('ผู้พิจารณาหลักสูตร (สมมติ)');
    await expect(approved).toContainText('10:01');
    await expect(approved.getByRole('link')).toHaveAttribute('href', v2Url);
    await expect(returned.getByRole('link')).toHaveAttribute('href', v1Url);
    const persisted = await row(executive, title);
    expect(persisted.approvedRevision).toBe(2);
    expect(persisted.history.find((e) => e.action === 'return')).toMatchObject({ revision: 1, note: reason });
    expect(persisted.history.find((e) => e.action === 'approve')).toMatchObject({
        revision: 2,
        at: '2027-05-10T10:01:00+07:00'
    });
    const again = await login(browser, 'coordinator', false, 60);
    await enter(again);
    await openCard(again, title);
    await expect(again.locator('#proposal-flow-waiting')).toHaveText('รอลงนาม');
    await expect(again.locator('#proposal-flow-history')).toContainText(revisionNote);
    await capture(again, '05-decisions', again.locator('#proposal-flow-history li').last());

    const signature = again.locator('#proposal-signing');
    await signature.locator('summary').click();
    const specimen = await browser.newPage();
    await specimen.setContent(
        '<html lang="th"><meta charset="utf-8"><body style="font-family:Noto Sans Thai,sans-serif;padding:48px"><strong>ตัวอย่างเพื่อทดสอบ CSTUHub · ข้อมูลสมมติ</strong><h1>หลักฐานการลงนามสมมติ</h1><p>ห้องเรียนข้อมูลชุมชน · ร่างที่อนุมัติฉบับที่ 2</p><p>วันที่ลงนาม 10 พฤษภาคม 2570 · เริ่มมีผล 1 มิถุนายน 2570 ถึง 30 พฤศจิกายน 2570</p></body></html>'
    );
    const signedBytes = await specimen.pdf();
    await specimen.close();
    await signature
        .locator('[name=evidenceFile]')
        .setInputFiles({ name: 'mou-demo-signed.pdf', mimeType: 'application/pdf', buffer: signedBytes });
    await signature.getByRole('button', { name: 'แนบหลักฐานการลงนาม' }).click();
    const signForm = again.locator('#proposal-sign-form');
    await signForm.locator('[name=signedOn]').fill('2027-05-10');
    await signForm.locator('[name=startDate]').fill('2027-06-01');
    await signForm.locator('[name=endDate]').fill('2027-11-30');
    await signForm.getByRole('button', { name: 'บันทึกการลงนาม' }).click();
    await expect(again.locator('#proposal-flow-waiting')).toHaveText('ลงนามแล้ว');
    await capture(again, '07-signing', again.locator('#proposal-destination-panel'));
    await createDestination(again, title, 'agreement');
    await followBothWays(again, title);
    await executive.reload();
    await openCard(executive, title);
    const signed = await row(executive, title);
    expect(signed.signed).toMatchObject({
        signedOn: '2027-05-10',
        startDate: '2027-06-01',
        endDate: '2027-11-30',
        revision: 2
    });
    const proof = executive
        .locator('#proposal-destination-panel')
        .getByRole('link', { name: /เปิดหลักฐานการลงนาม/ });
    const evidenceResponse = await executive.context().request.get(await proof.getAttribute('href'));
    expect(evidenceResponse.status()).toBe(200);
    expect(Buffer.compare(await evidenceResponse.body(), signedBytes)).toBe(0);

    for (const [account, expected] of [
        [null, 401],
        ['student-a', 403],
        ['other-scope', 404]
    ]) {
        const page = await login(browser, account, false, 60);
        await page.goto(board);
        if (account === 'other-scope') {
            await expect(page.locator('#proposal-board')).toBeVisible();
            await expect(card(page, title)).toHaveCount(0);
            expect((await read(page, '/api/proposals')).body.data).toEqual([]);
        } else {
            await page.waitForURL(account ? '**/index.html*' : '**/login.html*');
            await expect(page.locator('#proposal-board')).toHaveCount(0);
        }
        for (const route of ['/api/proposals/' + persisted.id, v1Url, v2Url]) {
            expect((await page.context().request.get(route)).status()).toBe(expected);
        }
        await page.close();
    }
});

test('deadline closes interest once and distinguishes no draft, manual submission and confirmed automatic submission', async ({
    browser,
    request
}) => {
    const noDraft = 'MoU รอแนบร่าง (สมมติ)',
        manual = 'MoU เจ้าของส่งเอง (สมมติ)',
        automatic = 'MoU ยืนยันส่งเมื่อครบกำหนด (สมมติ)';
    const original = await login(browser, 'coordinator');
    await enter(original);
    for (const title of [noDraft, manual, automatic]) {
        await newProposal(original, {
            title,
            organization: title === noDraft ? 'สถาบันแนวคิด (สมมติ)' : undefined
        });
        if (title !== noDraft) await draft(original, 1);
        if (title === automatic) {
            await submitRevision(original, 1);
            await draft(original, 2, 1);
            await expect(flow(original)).toContainText('ยืนยันส่งร่างฉบับที่ 1 เมื่อครบกำหนดแล้ว');
        }
        await closeDetail(original);
    }
    const volunteer = await login(browser, 'helper');
    await enter(volunteer);
    await interest(volunteer, manual);
    await request.post('/__fixture/clock', { data: { offset: 86399 } });
    const owner = await login(browser, 'coordinator', false, 86399);
    await enter(owner);
    for (const title of [noDraft, manual, automatic])
        await expect(card(owner, title)).toContainText('เปิดรับความสนใจ');
    await request.post('/__fixture/clock', { data: { offset: 86400 } });
    await owner.reload();
    await expect(card(owner, noDraft)).toContainText('ปิดรับความสนใจแล้ว · รอเจ้าของแนบร่าง');
    await expect(card(owner, manual)).toContainText('ปิดรับความสนใจแล้ว');
    await expect(card(owner, automatic)).toContainText('รอผู้บริหารพิจารณา');
    for (let i = 0; i < 2; i++) {
        const originalRow = await row(owner, automatic);
        expect(originalRow.interestCount).toBe(0);
        expect(originalRow.submittedRevision).toBe(1);
        expect(originalRow.history.filter((e) => e.action === 'auto-submit')).toHaveLength(1);
        expect(originalRow.history.filter((e) => e.action === 'close')).toHaveLength(1);
        await owner.reload();
    }
    const executive = await login(browser, 'executive', false, 86400);
    await enter(executive);
    await executive.locator('#proposal-view').selectOption('review');
    await expect(executive.locator('#proposal-cards h3')).toHaveText([automatic]);
    await openCard(executive, automatic);
    await verifyFile(
        executive,
        executive.locator('#proposal-review-file').getByRole('link', { name: 'ร่างฉบับที่ 1 · เปิดไฟล์' }),
        1
    );
    await closeDetail(executive);
    await request.post('/__fixture/clock', { data: { offset: 86460 } });
    await openCard(owner, manual);
    await flow(owner).getByRole('button', { name: 'ส่ง MoU ให้พิจารณา' }).click();
    await submitRevision(owner, 1);
    await executive.reload();
    await executive.locator('#proposal-view').selectOption('review');
    await expect(executive.locator('#proposal-cards h3')).toHaveText([automatic, manual]);
    await executive.locator('#proposal-sort').selectOption('interest');
    await expect(executive.locator('#proposal-cards h3')).toHaveText([manual, automatic]);
    await executive.locator('#proposal-sort').selectOption('time');
    await capture(executive, '06-review-queue', card(executive, automatic));
    await openCard(executive, manual);
    await executive
        .locator('#proposal-decision-form')
        .getByRole('button', { name: 'อนุมัติ', exact: true })
        .click();
    await expect(executive.locator('#proposal-flow-waiting')).toHaveText('รอลงนาม');
    await executive
        .locator('#proposal-destination-panel')
        .getByRole('button', { name: 'เชื่อมข้อตกลงเดิม' })
        .click();
    const linkForm = executive.locator('#proposal-destination-form');
    await linkForm.locator('[name=agreementId]').selectOption('agreement-demo');
    await linkForm.getByRole('button', { name: 'ยืนยันเชื่อมข้อตกลง' }).click();
    await followBothWays(executive, manual, 'ทะเบียนห้องเรียนชุมชนเดิม (สมมติ)');
    const previous = await read(executive, '/api/agreements/agreement-demo');
    expect(previous.body.data).toMatchObject({
        proposalId: (await row(executive, manual)).id,
        endDate: '2027-11-15'
    });
});

async function createDestination(page, title, kind, fromPerson = false) {
    const panel = page.locator('#proposal-destination-panel');
    const label = {
        activity: 'สร้างกิจกรรมจากข้อเสนอนี้',
        exchange: 'สร้างโครงการ Exchange',
        agreement: 'สร้างทะเบียนข้อตกลง'
    }[kind];
    await panel.getByRole('button', { name: label }).click();
    const form = panel.locator('#proposal-destination-form');
    await expect(form.locator('[name=title]')).toHaveValue(title);
    if (fromPerson) {
        await expect(form).toContainText('ศิษย์เก่าวิทยากร (สมมติ)');
        await expect(form).toContainText('เจ้าภาพหลักในรายการปลายทาง · อาจารย์ผู้ร่วมงาน (สมมติ)');
        await expect(form.locator('[name=partnerId]')).toHaveValue('');
        await form.locator('[name=partnerId]').selectOption('partner-demo');
        await capture(page, '08-activity-preview', form);
    } else await expect(form.locator('[name=partnerId]')).toHaveValue('partner-demo');
    const complete = page.waitForResponse(
        (r) => r.url().endsWith('/destination') && r.request().method() === 'POST'
    );
    await form.getByRole('button', { name: 'ยืนยันสร้างรายการ' }).click();
    const response = await complete;
    expect(response.status(), await response.text()).toBe(200);
    const first = (await response.json()).data.destination;
    const request = response.request(),
        headers = request.headers();
    const retry = await page.context().request.post(request.url(), {
        data: request.postDataJSON(),
        headers: {
            origin: new URL(request.url()).origin,
            'x-csrf-token': headers['x-csrf-token'],
            'if-match': headers['if-match']
        }
    });
    expect(retry.status(), await retry.text()).toBe(200);
    expect((await retry.json()).data.destination.id).toBe(first.id);
    return first;
}
async function followBothWays(page, title, targetTitle = title, evidence) {
    const link = page
        .locator('#proposal-destination-panel')
        .getByRole('link', { name: 'เปิดรายการที่เชื่อม · ' + targetTitle });
    await link.click();
    const back = page.getByRole('link', { name: 'เปิดข้อเสนอต้นทาง', exact: true });
    await expect(back).toBeVisible();
    if (evidence) await capture(page, evidence, back);
    await back.click();
    await expect(flow(page)).toBeVisible();
    await expect(page.locator('#proposal-flow-title')).toHaveText(title);
}
test('alumnus activity and Exchange keep the host and optional offers separate and link once in both directions', async ({
    browser,
    request
}) => {
    const activity = 'เวิร์กช็อปวิเคราะห์ข้อมูลกับศิษย์เก่า (สมมติ)',
        exchange = 'แลกเปลี่ยนห้องเรียนข้อมูลชุมชน (สมมติ)';
    const owner = await login(browser, 'coordinator');
    await enter(owner);
    await newProposal(owner, {
        kind: 'activity',
        title: activity,
        person: 'ศิษย์เก่าวิทยากร (สมมติ)',
        validate: true,
        captureForm: true
    });
    await expect(flow(owner)).toContainText('อาจารย์ผู้เสนอ (สมมติ)');
    await flow(owner).getByRole('button', { name: 'แจ้งผู้บริหารเพื่อทราบ' }).click();
    await expect(owner.locator('#proposal-detail-meta')).toContainText('แจ้งเพื่อทราบแล้ว');
    await expect(owner.locator('#proposal-flow-waiting')).toHaveText('เปิดรับความสนใจ');
    await closeDetail(owner);
    await expect(card(owner, activity)).toContainText('คุยกับคู่ความร่วมมือแล้ว');
    await newProposal(owner, { kind: 'exchange', title: exchange, host: true, support: true });
    await flow(owner).locator('#proposal-flow-support summary').click();
    const support = flow(owner).locator('#proposal-flow-support');
    await expect(support.getByRole('link', { name: 'https://example.org/synthetic-agenda' })).toHaveAttribute(
        'href',
        'https://example.org/synthetic-agenda'
    );
    await verifyFile(owner, support.getByRole('link', { name: 'mou-demo-v1.pdf' }), 1);
    await closeDetail(owner);
    const helper = await login(browser, 'helper'),
        staff = await login(browser, 'staff');
    await enter(helper);
    await enter(staff);
    await interest(helper, activity, 'ติดต่อวิทยากร');
    await interest(helper, activity, 'ประสานวิทยากรและเตรียมตัวอย่าง (สมมติ)', true);
    await interest(staff, activity);
    await card(staff, activity).getByRole('button', { name: 'แก้ไขความสนใจ' }).click();
    await staff.locator('#proposal-interest-withdraw').click();
    await expect(card(staff, activity)).toContainText('สนใจช่วย 1 คน');
    await interest(staff, activity);
    await openCard(helper, activity);
    await flow(helper).getByRole('button', { name: 'รับเป็นเจ้าภาพหลัก', exact: true }).click();
    await expect(helper.locator('#proposal-detail-meta')).toContainText('อาจารย์ผู้ร่วมงาน (สมมติ)');
    await owner.reload();
    await openCard(owner, activity);
    await expect(owner.locator('#proposal-flow-waiting')).toHaveText('เปิดรับความสนใจ');
    await expect(owner.locator('#proposal-flow-people')).toContainText('สนใจช่วย 2 คน · 1 คนระบุสิ่งที่ช่วยได้');
    await expect(owner.locator('#proposal-flow-people')).toContainText('ประสานวิทยากรและเตรียมตัวอย่าง (สมมติ)');
    await expect(owner.locator('#proposal-flow-people')).toContainText('เจ้าหน้าที่หลักสูตร (สมมติ)');
    await capture(owner, '02-board-interest', owner.locator('#proposal-flow-people'));
    await request.post('/__fixture/clock', { data: { offset: 86400 } });
    const host = await login(browser, 'helper', false, 86400),
        exchangeOwner = await login(browser, 'coordinator', false, 86400);
    await enter(host);
    await openCard(host, activity);
    const created = await createDestination(host, activity, 'activity', true);
    const actual = await read(host, '/api/activities/' + created.id);
    expect(actual.status).toBe(200);
    expect(actual.body.data.partnerId).toBe('partner-demo');
    expect(actual.body.data.proposalId).toBe((await row(host, activity)).id);
    await followBothWays(host, activity, activity, '09-activity-link');
    await enter(exchangeOwner);
    await openCard(exchangeOwner, exchange);
    const project = await createDestination(exchangeOwner, exchange, 'exchange');
    const record = await read(exchangeOwner, '/api/exchanges/' + project.id);
    expect(record.status).toBe(200);
    expect(record.body.data.participantUserIds || []).toEqual([]);
    await followBothWays(exchangeOwner, exchange);
});
