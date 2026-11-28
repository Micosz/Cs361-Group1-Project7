const { test, expect } = require('@playwright/test');

const partials = Array.from({ length: 7 }, (_, index) => ({
  id: 'partial-' + (index + 1), name: 'Open Lab Partner ' + (index + 1),
  type: 'university', summary: 'องค์กรสมมติ'
}));
const catalogue = [
  ...partials,
  { id: 'company-open', name: 'Open Lab', type: 'company', summary: 'บริษัทสมมติ' },
  { id: 'river-org', name: 'River Society', type: 'university', summary: 'องค์กรสมมติ' },
  { id: 'activity-open', partnerId: 'company-open', title: 'Open Lab',
    type: 'research', period_date: '2026-07-15', summary: 'กิจกรรมสมมติ · วันสมมติ' },
  { id: 'river-event', partnerId: 'river-org', title: 'River Seminar',
    type: 'academic_activity', period_date: '2026-07-18', summary: 'กิจกรรมสมมติ · วันสมมติ' }
].map(record => ({ ...record, visibility: 'public' }));

const partialNames = partials.map(record => record.name);
const partnerLabel = 'องค์กร / ผู้มีส่วนได้ส่วนเสีย • บริษัท';
const activityLabel = 'กิจกรรม / โครงการ • งานวิจัยและแลกเปลี่ยน';

async function openFixture(page) {
  await page.clock.setFixedTime(new Date('2026-07-01T12:00:00+07:00'));
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:4173' || request.method() !== 'GET') return route.abort();
    if (url.pathname === '/fetchPartnersData') return route.fulfill({ json: catalogue });
    if (url.pathname === '/api/auth/session') {
      return route.fulfill({ json: { user: null, grants: [], capabilities: [], csrfToken: 'a'.repeat(64) } });
    }
    if (url.pathname === '/api/public/records') return route.fulfill({ json: [] });
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ json: { data: [], count: 0, page: { nextCursor: null } } });
    }
    return route.continue();
  });
  await page.goto('/index.html');
  await expect(page.locator('#collaboratorGrid .browse-card-open')).toHaveCount(9);
}

for (const { width, height, touch } of [
  { width: 390, height: 844, touch: true },
  { width: 1280, height: 800, touch: false }
]) {
  test.describe(width + 'px public search suggestions', () => {
    test.use({ viewport: { width, height }, hasTouch: touch, isMobile: touch, timezoneId: 'Asia/Bangkok' });
    test.beforeEach(async ({ page }) => { await openFixture(page); });

    test('broad terms preserve catalogue order and the six-result limit', async ({ page }) => {
      const input = page.locator('#searchInput');
      const titles = page.locator('#searchSuggestions:visible .suggestion-title');
      await input.fill('open');
      await expect(titles).toHaveText(partialNames.slice(0, 6));
      await input.fill('river');
      await expect(titles).toHaveText(['River Society', 'River Seminar']);
      await input.fill('Open  Lab');
      await expect(page.locator('#searchSuggestions:visible')).toContainText('ไม่พบข้อมูล');
    });

    test('exact names below the cutoff keep their types and open the matching detail', async ({ page }) => {
      const input = page.locator('#searchInput');
      const menu = page.locator('#searchSuggestions:visible');
      const keyword = '  oPeN lAb  ';
      await input.fill(keyword);
      await expect(menu.locator('.suggestion-item')).toHaveCount(6);
      await expect(menu.locator('.suggestion-title')).toHaveText(['Open Lab', 'Open Lab', ...partialNames.slice(0, 4)]);
      await expect(menu.locator('.suggestion-category').nth(0)).toHaveText(partnerLabel);
      await expect(menu.locator('.suggestion-category').nth(1)).toHaveText(activityLabel);

      for (const label of [partnerLabel, activityLabel]) {
        const row = menu.locator('.suggestion-item').filter({ hasText: label });
        if (touch) await row.tap();
        else await row.click();
        const detail = page.getByRole('dialog', { name: 'Open Lab', exact: true });
        await expect(detail).toBeVisible();
        if (label === partnerLabel) {
          await expect(detail.locator('.partner-history').getByRole('button', { name: 'Open Lab', exact: true })).toBeVisible();
        } else {
          await expect(detail.locator('.activity-detail-date')).toHaveText('15 ก.ค. 69');
        }
        await detail.getByRole('button', { name: 'ปิดรายละเอียด', exact: true }).click();
        await expect(detail).toBeHidden();
        if (label === partnerLabel) {
          await input.fill('');
          await input.fill(keyword);
          await expect(menu.locator('.suggestion-title')).toHaveCount(6);
        }
      }
    });

    test('type and date filters still exclude full-name matches', async ({ page }) => {
      await page.locator('#filterCollab').selectOption('company');
      await page.locator('#tabEvent').click();
      const eventType = page.locator('#filterEvent');
      await eventType.selectOption('academic_activity');
      const input = page.locator('#searchInput');
      const categories = page.locator('#searchSuggestions:visible .suggestion-category');
      await input.fill('Open Lab');
      await expect(categories).toHaveText([partnerLabel]);
      await input.fill('');
      await eventType.selectOption('research');
      const date = page.locator('#filterEventDateDisplay');
      await date.fill('16/07/2569');
      await date.press('Tab');
      await expect(page.locator('#filterEventDate')).toHaveValue('2026-07-16');
      await input.fill('Open Lab');
      await expect(categories).toHaveText([partnerLabel]);
      await expect(eventType).toHaveValue('research');
      await expect(page.locator('#filterCollab')).toHaveValue('company');
    });

    test('a slower response cannot replace the latest suggestions', async ({ page }) => {
      let releaseOlder;
      const gate = new Promise(resolve => { releaseOlder = resolve; });
      let reportOlder;
      const olderRequest = new Promise(resolve => { reportOlder = resolve; });
      await page.route('**/fetchPartnersData', async route => {
        if (reportOlder) {
          reportOlder(route.request());
          reportOlder = null;
          await gate;
        }
        await route.fallback();
      });
      try {
        await page.evaluate(() => window.invalidatePublicData());
        const input = page.locator('#searchInput');
        await input.fill('Open Lab');
        const older = await olderRequest;
        // Force a second catalogue read so the replies can arrive out of order.
        await page.evaluate(() => window.invalidatePublicData());
        await input.fill('River Seminar');
        const titles = page.locator('#searchSuggestions:visible .suggestion-title');
        await expect(titles).toHaveText(['River Seminar']);
        releaseOlder();
        await (await older.response()).finished();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(input).toHaveValue('River Seminar');
        await expect(titles).toHaveText(['River Seminar']);
      } finally {
        releaseOlder();
      }
    });
  });
}
