const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { startFixture } = require('./fixture.cjs');

const FIXTURES = path.resolve(__dirname, '../fixtures/v7-feedback');
const SAMPLE_XLSX = path.join(FIXTURES, 'v7-partner-feedback-sample.xlsx');
const SAMPLE_LEGACY_CSV = path.join(FIXTURES, 'v7-legacy-partner-only-feedback.csv');
const EVIDENCE_DIR = process.env.CSTU_V7_264_EVIDENCE_DIR
    || path.resolve(__dirname, '../../docs/evidence/assets/v7/issue-264');

async function captureDesktop(page, filename, focusLocator = null) {
    if (focusLocator) {
        await focusLocator.evaluate((el) => {
            const top = el.getBoundingClientRect().top + window.scrollY - 92;
            window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
        });
    }
    await page.evaluate(() => document.fonts?.ready);
    await fs.mkdir(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({
        path: path.join(EVIDENCE_DIR, filename),
        fullPage: false,
        animations: 'disabled'
    });
}

async function importViaExistingUI(page, dialogRoot, {
    filePath,
    sheetIndex = 0,
    formName,
    sourceType,
    expectedButtonText,
    expectDuplicate = false
}) {
    const formsTab = dialogRoot.getByRole('tab', { name: 'ผลตอบรับจากแบบฟอร์ม' });
    await expect(formsTab).toBeVisible();
    await formsTab.click();

    const formSection = dialogRoot.locator('.form-feedback');
    await expect(formSection).toBeVisible();

    const openImportBtn = formSection.getByRole('button', { name: 'นำเข้าแบบฟอร์ม' });
    await expect(openImportBtn).toBeVisible();
    await openImportBtn.click();

    const editor = formSection.locator('form.form-import-editor');
    await expect(editor).toBeVisible();

    const fileInput = editor.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);

    const sheetSelect = editor.getByLabel('ชีต');
    await expect(sheetSelect).toBeEnabled({ timeout: 15000 });
    if (sheetIndex > 0) {
        await sheetSelect.selectOption(String(sheetIndex));
    }

    await editor.getByLabel('ชื่อแบบฟอร์ม').fill(formName);
    await editor.getByLabel('คำตอบจาก').selectOption(sourceType);

    // Verify PII email column is unchecked by default while the 3 feedback columns are checked.
    const checkedBoxes = editor.locator('.form-column-picker input[type="checkbox"]:checked');
    await expect(checkedBoxes).toHaveCount(3);
    const emailLabel = editor.locator('.form-column').filter({ hasText: 'อีเมลผู้ตอบ' }).locator('input[type="checkbox"]');
    await expect(emailLabel).not.toBeChecked();

    await editor.getByRole('button', { name: 'ดูตัวอย่าง' }).click();
    const confirmBtn = editor.getByRole('button', { name: expectedButtonText });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    if (expectDuplicate) {
        const dupNotice = formSection.getByText('ชุดคำตอบนี้นำเข้าในรายการนี้แล้ว กรุณาเปิดฟอร์มเดิม');
        await expect(dupNotice).toBeVisible();
    } else {
        await expect(editor).toHaveCount(0);
        await expect(formSection.locator('.form-batch').filter({ hasText: formName })).toBeVisible();
    }
    return formSection;
}

test('V7 #264 browser journey: import 3 feedback types, verify Overview & permissions, re-import duplicates (8 -> 8), and capture evidence', async ({ browser }) => {
    const fx = await startFixture();
    try {
        await fx.send('login', { client: 'coord', user: 'coordinator' });
        await fx.send('login', { client: 'staff', user: 'staff' });
        await fx.send('login', { client: 'exec', user: 'executive' });
        await fx.send('login', { client: 'student', user: 'student-a' });

        const coordPage = await fx.browserPage(browser, 'coord');
        const staffPage = await fx.browserPage(browser, 'staff');
        const execPage = await fx.browserPage(browser, 'exec');
        const studentPage = await fx.browserPage(browser, 'student');

        // 1. Import #1 (Activity of MoU 1 -> 3 responses, skipping 1 blank row) as assigned coordinator
        await fx.send('clock', { offset: 10 });
        await coordPage.goto('/work.html?kind=activities&id=act-v7-mou1#board-section');
        const actDialog = coordPage.locator('#record-detail[open]');
        await expect(actDialog.locator('#detail-title')).toHaveText('อบรมเชิงปฏิบัติการ AI ร่วมกับพันธมิตร');
        const actForms = await importViaExistingUI(coordPage, actDialog, {
            filePath: SAMPLE_XLSX,
            sheetIndex: 0,
            formName: 'แบบประเมินกิจกรรม AI Workshop',
            sourceType: 'participant',
            expectedButtonText: 'ยืนยันนำเข้า 3 คำตอบ'
        });
        await expect(actForms).toContainText('3 คำตอบ · ข้อตกลง: MoU ฉบับที่ 1 — ความร่วมมือทางวิชาการและกิจกรรม AI');

        // 2. Import #2 (Exchange of MoA 2 -> 2 responses) as staff
        await fx.send('clock', { offset: 20 });
        await staffPage.goto('/work.html?kind=exchanges&id=ex-v7-moa2#board-section');
        const exDialog = staffPage.locator('#record-detail[open]');
        await expect(exDialog.locator('#detail-title')).toHaveText('โครงการแลกเปลี่ยนวิจัยภาคฤดูร้อน');
        const exForms = await importViaExistingUI(staffPage, exDialog, {
            filePath: SAMPLE_XLSX,
            sheetIndex: 1,
            formName: 'แบบประเมินโครงการแลกเปลี่ยนวิจัย',
            sourceType: 'participant',
            expectedButtonText: 'ยืนยันนำเข้า 2 คำตอบ'
        });
        await expect(exForms).toContainText('2 คำตอบ · ข้อตกลง: MoA ฉบับที่ 2 — โครงการแลกเปลี่ยนวิจัยนักศึกษา');
        await exDialog.locator('#detail-close').click();

        // 3. Import #3 (Legacy partner-only feedback -> 3 responses -> "ยังไม่ระบุข้อตกลง") as staff
        await fx.send('clock', { offset: 30 });
        await staffPage.goto('/work.html?kind=partners&id=partner-v7-demo#board-section');
        const partnerModal = staffPage.locator('#detailModal');
        await expect(partnerModal).toBeVisible();
        await expect(partnerModal.locator('#modalTitle')).toHaveText('สถาบันพันธมิตรเทคโนโลยีดิจิทัล (สมมติ)');
        const partnerForms = await importViaExistingUI(staffPage, partnerModal, {
            filePath: SAMPLE_LEGACY_CSV,
            sheetIndex: 0,
            formName: 'ผลตอบรับย้อนหลังระดับองค์กรคู่ความร่วมมือ',
            sourceType: 'partner',
            expectedButtonText: 'ยืนยันนำเข้า 3 คำตอบ'
        });
        await expect(partnerForms).toContainText('3 คำตอบ · ยังไม่ระบุข้อตกลง');
        await partnerModal.locator('.close-btn').click();

        // 4. Open Overview report after 1st import (as executive) -> verify 8 total (3 / 2 / 3) & capture screenshot #1
        await execPage.goto('/work.html?view=overview#board-section');
        const ffPanel = execPage.locator('.overview-form-feedback');
        await expect(ffPanel).toBeVisible();
        await expect(ffPanel.locator('.overview-panel-total')).toHaveText('รวม 3 ชุด · 8 คำตอบ');
        await expect(ffPanel.locator('[data-agreement-id="mou-v7-1"]')).toContainText('MoU: MoU ฉบับที่ 1 — ความร่วมมือทางวิชาการและกิจกรรม AI');
        await expect(ffPanel.locator('[data-agreement-id="mou-v7-1"] .overview-breakdown-count')).toHaveText('1 ชุด · 3 คำตอบ');
        await expect(ffPanel.locator('[data-agreement-id="moa-v7-2"]')).toContainText('MoA: MoA ฉบับที่ 2 — โครงการแลกเปลี่ยนวิจัยนักศึกษา');
        await expect(ffPanel.locator('[data-agreement-id="moa-v7-2"] .overview-breakdown-count')).toHaveText('1 ชุด · 2 คำตอบ');
        await expect(ffPanel.locator('[data-agreement-status="unspecified"] .overview-breakdown-label')).toHaveText('ยังไม่ระบุข้อตกลง');
        await expect(ffPanel.locator('[data-agreement-status="unspecified"] .overview-breakdown-count')).toHaveText('1 ชุด · 3 คำตอบ');

        await captureDesktop(execPage, '01-overview-after-first-import.png', ffPanel);

        // 5. From Overview, click to view source file, sheet, and answers, then open related work & MoU
        const actItem = ffPanel.locator('.overview-form-list > li').filter({ hasText: 'แบบประเมินกิจกรรม AI Workshop' });
        const legItem = ffPanel.locator('.overview-form-list > li').filter({ hasText: 'ผลตอบรับย้อนหลังระดับองค์กรคู่ความร่วมมือ' });
        await expect(legItem).toContainText('ยังไม่ระบุข้อตกลง');

        await actItem.getByRole('button', { name: 'ดูแหล่งที่มาและคำตอบ' }).click();
        await expect(actItem.locator('.overview-source-detail')).toContainText('แหล่งที่มา: ไฟล์ v7-partner-feedback-sample.xlsx · ชีต 1_กิจกรรม_MoU1 · นำเข้าโดย ผู้ประสานงาน');
        await expect(actItem.locator('.overview-source-detail')).toContainText('ได้ฝึกโจทย์ AI จากกรณีศึกษาจริงร่วมกับทีมวิศวกรของคู่ความร่วมมือ');
        await expect(actItem.locator('.overview-source-detail')).not.toContainText('@example.invalid');

        await legItem.getByRole('button', { name: 'ดูแหล่งที่มาและคำตอบ' }).click();
        await expect(legItem.locator('.overview-source-detail')).toContainText('แหล่งที่มา: ไฟล์ v7-legacy-partner-only-feedback.csv · ชีต CSV · นำเข้าโดย เจ้าหน้าที่หลักสูตร');
        await expect(legItem.locator('.overview-source-detail')).toContainText('ผลสำรวจย้อนหลังระดับองค์กรก่อนแยกเก็บตามข้อตกลงรายฉบับ');

        await captureDesktop(execPage, '02-overview-source-and-answers.png', actItem);

        // Open related MoU 1 directly from Overview
        await ffPanel.locator('[data-agreement-id="mou-v7-1"] a.overview-related-link').click();
        const execDetail = execPage.locator('#record-detail[open]');
        await expect(execDetail.locator('#detail-title')).toHaveText('MoU ฉบับที่ 1 — ความร่วมมือทางวิชาการและกิจกรรม AI');
        await expect(execDetail.locator('#detail-fields')).toContainText('MoU');
        await expect(execDetail.locator('#detail-fields')).toContainText('2026-06-01');
        await execDetail.locator('#detail-close').click();
        await expect(execDetail).toHaveCount(0);

        // Open related Activity directly from Overview
        await actItem.getByRole('link', { name: 'อบรมเชิงปฏิบัติการ AI ร่วมกับพันธมิตร' }).click();
        await expect(execDetail.locator('#detail-title')).toHaveText('อบรมเชิงปฏิบัติการ AI ร่วมกับพันธมิตร');
        await expect(execDetail.locator('#detail-fields')).toContainText('MoU ฉบับที่ 1 — ความร่วมมือทางวิชาการและกิจกรรม AI');
        await execDetail.locator('#detail-close').click();
        await expect(execDetail).toHaveCount(0);

        // Open related Exchange & Partner directly from Overview as well
        const exItem = ffPanel.locator('.overview-form-list > li').filter({ hasText: 'แบบประเมินโครงการแลกเปลี่ยนวิจัย' });
        await exItem.getByRole('link', { name: 'โครงการแลกเปลี่ยนวิจัยภาคฤดูร้อน' }).click();
        await expect(execDetail.locator('#detail-title')).toHaveText('โครงการแลกเปลี่ยนวิจัยภาคฤดูร้อน');
        await execDetail.locator('#detail-close').click();
        await expect(execDetail).toHaveCount(0);

        await legItem.getByRole('link', { name: 'สถาบันพันธมิตรเทคโนโลยีดิจิทัล (สมมติ)' }).click();
        await expect(execPage.locator('#detailModal')).toBeVisible();
        await expect(execPage.locator('#modalTitle')).toHaveText('สถาบันพันธมิตรเทคโนโลยีดิจิทัล (สมมติ)');
        await execPage.locator('#detailModal .close-btn').click();

        // Staff role also sees Overview & exports CSV matching 8 (3 / 2 / 3)
        await staffPage.goto('/work.html?view=overview#board-section');
        await expect(staffPage.locator('.overview-form-feedback .overview-panel-total')).toHaveText('รวม 3 ชุด · 8 คำตอบ');
        const downloadPromise = staffPage.waitForEvent('download');
        await staffPage.getByRole('button', { name: 'ส่งออกรายงาน CSV' }).click();
        const csvDownload = await downloadPromise;
        const csvContent = await fs.readFile(await csvDownload.path(), 'utf8');
        expect(csvContent).toContain('"Form Feedback","จำนวนคำตอบนำเข้าทั้งหมด","8"');
        expect(csvContent).toContain('"ผลตอบรับตามข้อตกลง","MoU ฉบับที่ 1 — ความร่วมมือทางวิชาการและกิจกรรม AI","3"');
        expect(csvContent).toContain('"ผลตอบรับตามข้อตกลง","MoA ฉบับที่ 2 — โครงการแลกเปลี่ยนวิจัยนักศึกษา","2"');
        expect(csvContent).toContain('"ผลตอบรับตามข้อตกลง","ยังไม่ระบุข้อตกลง","3"');
        expect(csvContent).not.toContain('@example.invalid');

        // 6. Verify unauthorized & partial-permission accounts without altering permissions:
        // 6a. Coordinator cannot access Overview (nav link hidden, dashboard blocked, API returns 403),
        //     CAN read shared Form Feedback inbox & assigned Activity/MoU 1,
        //     but CANNOT open unassigned Exchange (ex-v7-moa2) and never sees internal MoA 2 title leaked.
        await coordPage.goto('/work.html?view=overview#board-section');
        await expect(coordPage.locator('#board-overview')).toBeHidden();
        await expect(coordPage.locator('#work-nav').getByText('ภาพรวมความร่วมมือ')).toHaveCount(0);
        await expect(coordPage.locator('.overview-dashboard')).toHaveCount(0);
        expect(await coordPage.evaluate(() => fetch('/api/overview').then((r) => r.status))).toBe(403);

        await coordPage.goto('/work.html?view=feedback#board-section');
        await coordPage.getByRole('tab', { name: 'Form Feedback' }).click();
        const formsInbox = coordPage.locator('#feedback-forms-panel');
        await expect(formsInbox).toContainText('พบ 3 แบบฟอร์ม');
        await expect(formsInbox).toContainText('MoU ฉบับที่ 1 — ความร่วมมือทางวิชาการและกิจกรรม AI');
        await expect(formsInbox).toContainText('ยังไม่ระบุข้อตกลง');
        await expect(formsInbox).not.toContainText('MoA ฉบับที่ 2 — โครงการแลกเปลี่ยนวิจัยนักศึกษา');

        // Coordinator opens assigned MoU 1 -> permitted
        await formsInbox.getByRole('link', { name: 'MoU ฉบับที่ 1 — ความร่วมมือทางวิชาการและกิจกรรม AI' }).click();
        await expect(coordPage.locator('#record-detail[open] #detail-title')).toHaveText('MoU ฉบับที่ 1 — ความร่วมมือทางวิชาการและกิจกรรม AI');
        await coordPage.locator('#detail-close').click();

        // Coordinator clicks unassigned Exchange -> denied according to policy (404 -> ไม่พบรายการหรือไม่มีสิทธิ์เข้าถึง)
        const unassignedCard = formsInbox.locator('.feedback-inbox-card').filter({ hasText: 'แบบประเมินโครงการแลกเปลี่ยนวิจัย' });
        await unassignedCard.getByRole('link', { name: 'โครงการแลกเปลี่ยนวิจัยภาคฤดูร้อน' }).click();
        await expect(coordPage.locator('#record-detail[open] #detail-status')).toHaveText('ไม่พบรายการหรือไม่มีสิทธิ์เข้าถึง');
        await captureDesktop(coordPage, '03-permission-denied-unassigned-work.png');
        await coordPage.locator('#detail-close').click();

        // 6b. Student cannot access Overview, Form Feedback inbox, or form-feedback tab on participating Exchange
        await studentPage.goto('/index.html?kind=exchanges#board-section');
        await studentPage.locator('.records-list').getByRole('button', { name: 'โครงการแลกเปลี่ยนวิจัยภาคฤดูร้อน' }).click();
        const stuDetail = studentPage.locator('#record-detail[open]');
        await expect(stuDetail.locator('#detail-title')).toHaveText('โครงการแลกเปลี่ยนวิจัยภาคฤดูร้อน');
        await expect(stuDetail.getByRole('tab', { name: 'ผลตอบรับจากแบบฟอร์ม' })).toBeHidden();

        // 7. Re-import the exact same files onto the same 3 records -> duplicate message shown, counts stay 8 -> 8 (3 / 2 / 3)
        await coordPage.goto('/work.html?kind=activities&id=act-v7-mou1#board-section');
        await expect(actDialog.locator('#detail-title')).toHaveText('อบรมเชิงปฏิบัติการ AI ร่วมกับพันธมิตร');
        const dupActForms = await importViaExistingUI(coordPage, actDialog, {
            filePath: SAMPLE_XLSX,
            sheetIndex: 0,
            formName: 'แบบประเมินกิจกรรม AI Workshop (นำเข้าซ้ำ)',
            sourceType: 'participant',
            expectedButtonText: 'ยืนยันนำเข้า 3 คำตอบ',
            expectDuplicate: true
        });
        await dupActForms.evaluate((el) => {
            let cur = el.parentElement;
            while (cur) {
                if (cur.scrollHeight > cur.clientHeight) {
                    cur.scrollTop = 0;
                }
                cur = cur.parentElement;
            }
            window.scrollTo({ top: 0, behavior: 'instant' });
        });
        await captureDesktop(coordPage, '04-duplicate-reimport-message.png');

        await staffPage.goto('/work.html?kind=exchanges&id=ex-v7-moa2#board-section');
        await expect(exDialog.locator('#detail-title')).toHaveText('โครงการแลกเปลี่ยนวิจัยภาคฤดูร้อน');
        await importViaExistingUI(staffPage, exDialog, {
            filePath: SAMPLE_XLSX,
            sheetIndex: 1,
            formName: 'แบบประเมินโครงการแลกเปลี่ยนวิจัย (นำเข้าซ้ำ)',
            sourceType: 'participant',
            expectedButtonText: 'ยืนยันนำเข้า 2 คำตอบ',
            expectDuplicate: true
        });
        await exDialog.locator('#detail-close').click();

        await staffPage.goto('/work.html?kind=partners&id=partner-v7-demo#board-section');
        await expect(partnerModal).toBeVisible();
        await importViaExistingUI(staffPage, partnerModal, {
            filePath: SAMPLE_LEGACY_CSV,
            sheetIndex: 0,
            formName: 'ผลตอบรับย้อนหลังระดับองค์กรคู่ความร่วมมือ (นำเข้าซ้ำ)',
            sourceType: 'partner',
            expectedButtonText: 'ยืนยันนำเข้า 3 คำตอบ',
            expectDuplicate: true
        });
        await partnerModal.locator('.close-btn').click();

        // 8. Re-open Overview report after 2nd import -> verify counts remain 8 -> 8 and 3 / 2 / 3 & capture screenshot #5
        await execPage.goto('/work.html?view=overview#board-section');
        await execPage.reload();
        await expect(ffPanel.locator('.overview-panel-total')).toHaveText('รวม 3 ชุด · 8 คำตอบ');
        await expect(ffPanel.locator('[data-agreement-id="mou-v7-1"] .overview-breakdown-count')).toHaveText('1 ชุด · 3 คำตอบ');
        await expect(ffPanel.locator('[data-agreement-id="moa-v7-2"] .overview-breakdown-count')).toHaveText('1 ชุด · 2 คำตอบ');
        await expect(ffPanel.locator('[data-agreement-status="unspecified"] .overview-breakdown-count')).toHaveText('1 ชุด · 3 คำตอบ');
        await expect(ffPanel.locator('.overview-form-list > li')).toHaveCount(3);

        await captureDesktop(execPage, '05-overview-after-second-import.png', ffPanel);
    } finally {
        await fx.close();
    }
});
