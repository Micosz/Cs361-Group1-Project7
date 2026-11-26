const { test, expect } = require('@playwright/test');
const manual = require('../../public/assets/manual-data.json');

const publicGuides = manual.guides.filter(guide => guide.roles.includes('public'));
const trouble = 'เมื่อไม่พบปุ่ม โหลดไม่ครบ หรือบันทึกไม่ได้';
const retryStep = 'เก็บข้อความก่อนลองใหม่';
const ownerStep = 'เลือกผู้รับผิดชอบ';
const partners = Array.from({ length: 8 }, (_, i) => ({
  id: 'manual-fixture-' + i, name: 'เครือข่ายสมมติ ' + (i + 1),
  type: i === 7 ? 'company' : 'university', visibility: 'public', summary: 'องค์กรสมมติสำหรับทดสอบ'
}));

async function visit(page, role = 'public') {
  await page.route('**/*', route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== 'http://127.0.0.1:4173' || req.method() !== 'GET') return route.abort();
    if (url.pathname === '/fetchPartnersData') return route.fulfill({ json: partners });
    if (url.pathname === '/api/auth/session') {
      const isCoordinator = role === 'coordinator';
      return route.fulfill({ json: {
        user: isCoordinator ? { id: 'fixture-coordinator', displayName: 'ผู้ประสานงานสมมติ', accountType: 'tu' } : null,
        grants: isCoordinator ? [{ role, active: true, scopeId: 'fixture-scope' }] : [], capabilities: [], csrfToken: 'a'.repeat(64)
      } });
    }
    if (url.pathname === '/api/public/records') return route.fulfill({ json: [] });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { data: [], items: [], count: 0, page: { nextCursor: null } } });
    if (url.pathname.startsWith('/resources/manual/')) {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" fill="#f3efeb"/><text x="200" y="96" text-anchor="middle" font-size="18" fill="#645761">ภาพประกอบสมมติ</text></svg>' });
    }
    return route.continue();
  });
  await page.goto(role === 'public' ? '/index.html' : '/work.html');
  if (role === 'public') await expect(page.locator('#collaboratorGrid .browse-card-open')).toHaveCount(partners.length);
  else await expect(page.locator('#work-nav')).toContainText('คู่ความร่วมมือ');
}

async function openManual(page, opener = page.locator('.manual-labelled-trigger:visible').first()) {
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'คู่มือการใช้งาน', exact: true });
  await expect(dialog.locator('#manual-toc button').first()).toBeVisible();
  return {
    dialog, input: dialog.locator('#manual-search'), results: dialog.locator('#manual-toc'),
    status: dialog.getByRole('status'), content: dialog.locator('#manual-content')
  };
}

async function checkReadable(locator) {
  await locator.scrollIntoViewIfNeeded();
  const fits = await locator.evaluate(el => {
    const sidebar = el.closest('.manual-sidebar').getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()].every(line =>
      line.left >= sidebar.left - 1 && line.right <= sidebar.right + 1 &&
      line.top >= Math.max(box.top, sidebar.top) - 1 && line.bottom <= Math.min(box.bottom, sidebar.bottom) + 1);
  });
  expect(fits).toBe(true);
}

for (const [width, height, touch] of [[320, 707, true], [390, 844, true], [1280, 800, false]]) {
  test.describe(width + 'px manual search', () => {
    test.use({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
    test('every public step heading finds its own guide', async ({ page }) => {
      await visit(page);
      const { input, results } = await openManual(page);
      const missing = [];
      for (const guide of publicGuides) {
        for (const step of guide.steps) {
          await input.fill(step.title);
          if (await results.getByRole('button', { name: guide.title, exact: true }).count() !== 1) missing.push(step.title);
        }
      }
      expect(missing).toEqual([]);
    });

    test('existing fields remain searchable and image metadata and private steps stay out', async ({ page }) => {
      await visit(page);
      const { input, results } = await openManual(page);
      for (const [term, ids] of [
        ['พักการเคลื่อนไหวพื้นหลัง', ['motion']], ['เริ่มต้นใช้งาน', ['browse', 'search', 'login', 'motion']],
        ['กดอีกครั้งเมื่อต้องการให้เล่นต่อ', ['motion']], ['  fEeDbAcK  ', ['public-comment', 'comment-filter']],
        ['พักการเคลื่อนไหวพื้นหลัง เริ่มต้นใช้งาน', ['motion']], ['board-tabs.jpg', []],
        ['หน้าจอ CSTUHub', []], ['ภาพประกอบถ่ายจากเว็บจริง', []], [ownerStep, []]
      ]) {
        await input.fill(term);
        expect(await results.getByRole('button').evaluateAll(nodes => nodes.map(n => n.dataset.guide)), term).toEqual(ids);
      }
      await input.fill('');
      await expect(results.getByRole('button')).toHaveCount(publicGuides.length);
    });

    test('one button per chapter describes the matching steps beneath it', async ({ page }) => {
      await visit(page);
      const { input, results, status } = await openManual(page);
      await input.fill('ผู้ตอบ');
      const cases = [
        ['อ่านและส่งความคิดเห็นสาธารณะ', 'เขียนและเลือกกลุ่มผู้ตอบ'],
        ['กรองและแสดงความเห็นต่อ Comment', 'เลือกกลุ่มผู้ตอบและอ่านรายการ']
      ];
      await expect(status).toHaveText('พบ 2 ฟีเจอร์');
      for (const [title, step] of cases) {
        const button = results.getByRole('button', { name: title, exact: true });
        await expect(button).toHaveAccessibleDescription(step);
        await checkReadable(button);
        await checkReadable(results.getByText(step, { exact: true }));
      }
      await input.fill('ก่อน');
      await expect(results.getByRole('button')).toHaveCount(1);
      const result = results.getByRole('button', { name: trouble, exact: true });
      await expect(result).toHaveAccessibleDescription('ตรวจบัญชีและบทบาทก่อน ' + retryStep);
      const id = await result.getAttribute('aria-describedby');
      const hints = results.locator('[id="' + id + '"]');
      await expect(hints.getByRole('listitem')).toHaveText(['ตรวจบัญชีและบทบาทก่อน', retryStep]);
      expect(await result.evaluate(node => node.nextElementSibling.id)).toBe(id);
      for (const el of [result, ...await hints.getByRole('listitem').all()]) await checkReadable(el);
    });

    test('typing keeps the caret and the status changes only with the result count', async ({ page }) => {
      await visit(page);
      const { input, status } = await openManual(page);
      await input.fill('ผู้ตอบ');
      await expect(status).toHaveText('พบ 2 ฟีเจอร์');
      const updates = await status.evaluateHandle(el => {
        const messages = [];
        new MutationObserver(() => messages.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
        return messages;
      });
      for (const term of ['ก่อน', retryStep, 'ผู้ตอบ', 'คำสมมติไม่มีในคู่มือ', 'อีกคำสมมติที่ไม่มี', 'ก่อน']) await input.fill(term);
      expect(await updates.jsonValue()).toEqual(['พบ 1 ฟีเจอร์', 'พบ 2 ฟีเจอร์', 'พบ 0 ฟีเจอร์', 'พบ 1 ฟีเจอร์']);
      const prefix = 'เก็บข้อความ';
      await input.fill(prefix + 'อนลองใหม่');
      await input.evaluate((el, i) => el.setSelectionRange(i, i), prefix.length);
      await page.keyboard.insertText('ก่');
      await expect(input).toHaveValue(retryStep);
      await expect(input).toBeFocused();
      expect(await input.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual(Array(2).fill(prefix.length + 'ก่'.length));
      await updates.dispose();
    });

    for (const action of touch ? ['tap'] : ['Enter', 'Space']) {
      test(action + ' focuses the chapter heading and Escape restores the filtered board', async ({ page }) => {
        await visit(page);
        await page.locator('#searchInput').fill('เครือข่ายสมมติ');
        await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();
        await page.locator('#filterCollab').selectOption('university');
        await expect(page.locator('#collaboratorGrid .browse-card-open')).toHaveCount(7);
        await page.locator('#collaboratorGrid .browse-card-open').nth(4).scrollIntoViewIfNeeded();
        const url = page.url();
        const opener = page.locator('.manual-labelled-trigger:visible').first();
        // The manual saves the board position when its opener is activated.
        const [y, { dialog, input, results, content }] = await Promise.all([
          page.evaluate(() => new Promise(resolve => {
            window.addEventListener('click', () => resolve(scrollY), { capture: true, once: true });
          })),
          openManual(page, opener)
        ]);
        expect(y).toBeGreaterThan(0);
        await input.fill('ผู้ตอบ');
        const title = 'กรองและแสดงความเห็นต่อ Comment';
        const result = results.getByRole('button', { name: title, exact: true });
        await expect(input).toBeFocused();
        if (action === 'tap') await result.tap();
        else {
          await input.press('Tab');
          await expect(results.getByRole('button').first()).toBeFocused();
          await page.keyboard.press('Tab');
          await expect(result).toBeFocused();
          await page.keyboard.press(action);
        }
        await expect(content.getByRole('heading', { level: 2, name: title, exact: true })).toBeFocused();
        await expect(content.getByRole('heading', { level: 3 }).first()).toHaveText('1. เลือกกลุ่มผู้ตอบและอ่านรายการ');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
        expect(page.url()).toBe(url);
        await expect(page.locator('#searchInput')).toHaveValue('เครือข่ายสมมติ');
        await expect(page.locator('#filterCollab')).toHaveValue('university');
        await expect(page.locator('#collaboratorGrid .browse-card-open')).toHaveCount(7);
        const restored = await page.evaluate(() => new Promise(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(scrollY)));
        }));
        expect(restored).toBe(y);
      });
    }

    test('a Coordinator finds two distinct authorized guides and public role finds neither', async ({ page }) => {
      await visit(page, 'coordinator');
      const { dialog, input, results } = await openManual(page);
      const role = dialog.locator('#manual-role');
      await expect(role).toHaveValue('coordinator');
      await input.fill(ownerStep);
      await expect(results.getByRole('button')).toHaveText(['เพิ่มคู่ความร่วมมือ', 'เพิ่มกิจกรรมและเชื่อมหน่วยงาน']);
      await expect(results.getByRole('button').nth(0)).toHaveAccessibleDescription(ownerStep);
      await expect(results.getByRole('button').nth(1)).toHaveAccessibleDescription('เชื่อมคู่ความร่วมมือและข้อตกลง');
      await role.selectOption('public');
      await expect(results.getByRole('button')).toHaveCount(0);
      await role.selectOption('coordinator');
      await expect(results.getByRole('button')).toHaveCount(2);
    });
  });
}

test('closing help from an organization detail returns to that same help button', async ({ page }) => {
  await visit(page);
  await page.locator('#searchInput').fill('เครือข่ายสมมติ 3');
  const row = page.locator('#collaboratorGrid').getByRole('button', { name: 'เครือข่ายสมมติ 3', exact: true });
  await row.click();
  const detail = page.getByRole('dialog', { name: 'เครือข่ายสมมติ 3', exact: true });
  const opener = detail.getByRole('button', { name: 'เปิดคู่มือการใช้งาน' });
  const { dialog, input, results } = await openManual(page, opener);
  await input.fill('พักการเคลื่อนไหวพื้นหลัง');
  await results.getByRole('button', { name: 'พักการเคลื่อนไหวพื้นหลัง', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(detail).toBeVisible();
  await expect(opener).toBeFocused();
  await expect(page.locator('#searchInput')).toHaveValue('เครือข่ายสมมติ 3');
});
