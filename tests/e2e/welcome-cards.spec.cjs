const { test, expect } = require('@playwright/test');

const partners = [
  ['อรุณสมมติ', 'university'], ['สายลมสมมติ', 'company'], ['ภูผาสมมติ', 'government'],
  ['สายน้ำสมมติ', 'research_institute'], ['เมฆาสมมติ', 'company'], ['แสงดาวสมมติ', 'university']
].map(([name, type], index) => ({
  id: 'fixture-org-' + index, name, type, visibility: 'public',
  summary: 'ข้อมูลองค์กรสมมติหมายเลข ' + (index + 1), logo_path: '/fixture-logos/' + index + '.svg'
}));

async function serveFixture(page, { failFirst = false } = {}) {
  let reads = 0;
  await page.clock.install();
  // Choosing opposite ends of the pool on later draws makes a timer-driven replacement observable.
  await page.addInitScript(() => {
    Math.random = () => Number(sessionStorage.getItem('fixture-draw') || '0.02');
  });
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:4173' || request.method() !== 'GET') return route.abort();
    if (url.pathname === '/fetchPartnersData') {
      reads++;
      if (failFirst && reads === 1) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: partners });
    }
    if (url.pathname.startsWith('/fixture-logos/')) {
      const index = Number(url.pathname.match(/(\d+)\.svg$/)[1]);
      const colors = ['#5c7194', '#9c6e60', '#5d8270', '#796a90', '#a18755', '#5b8490'];
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="12" fill="' +
        colors[index] + '"/><text x="40" y="55" font-size="44" font-family="sans-serif" fill="white" text-anchor="middle">' +
        (index + 1) + '</text></svg>';
      return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    }
    if (url.pathname === '/api/auth/session') {
      return route.fulfill({ json: { user: null, grants: [], capabilities: [], csrfToken: 'a'.repeat(64) } });
    }
    if (url.pathname === '/api/public/records') return route.fulfill({ json: [] });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { data: [], count: 0, page: { nextCursor: null } } });
    return route.continue();
  });
  await page.goto('/index.html');
  return () => reads;
}

const cards = page => page.locator('.hero-animation .float-card');
async function cardLabels(page) {
  return cards(page).evaluateAll(nodes => nodes.map(node => ({
    name: node.querySelector('h4').textContent, description: node.querySelector('p').textContent
  })));
}

async function ready(page) {
  await expect(page.locator('#collaboratorGrid .browse-card-open')).toHaveCount(partners.length);
  await expect(page.locator('.orbit-tile')).toHaveCount(partners.length);
  await expect(page.locator('.hero-section')).not.toHaveClass(/intro-(pending|playing)/);
}

async function readForTwentySeconds(page) {
  await page.evaluate(() => sessionStorage.setItem('fixture-draw', '0.98'));
  await page.clock.fastForward(10_000);
  await page.clock.fastForward(10_000);
}

async function pointAtCard(page, card) {
  const box = await card.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  expect(await card.evaluate(node => node.matches(':hover'))).toBe(true);
  return { x, y };
}

async function tabTo(page, card) {
  for (let step = 0; step < 30; step++) {
    await page.keyboard.press('Tab');
    if (await card.evaluate(node => document.activeElement === node)) return;
  }
  throw new Error('Tab did not reach the Welcome card');
}

for (const motion of ['no-preference', 'reduce']) {
  for (const [width, height, touch] of [[320, 707, true], [390, 844, true], [1280, 800, false]]) {
    test.describe(width + 'px ' + motion, () => {
      test.use({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: motion });
      const activations = touch ? [['tap', width === 320 ? 0 : 1]] : [['mouse', 0], ['Enter', 1], ['Space', 2]];
      for (const [action, index] of activations) {
        test(action + ' opens the organization read twenty seconds earlier', async ({ page }) => {
          await serveFixture(page);
          await ready(page);
          const card = cards(page).nth(index);
          const pointer = action === 'mouse' ? await pointAtCard(page, card) : null;
          if (action === 'tap') await card.scrollIntoViewIfNeeded();
          if (action === 'Enter' || action === 'Space') await tabTo(page, card);

          const before = await cardLabels(page);
          expect(new Set(before.map(row => row.name)).size).toBe(3);
          await readForTwentySeconds(page);
          const after = await cardLabels(page);
          if (action === 'tap') await card.tap();
          else if (action === 'mouse') {
            expect(await card.evaluate((node, { x, y }) => node.contains(document.elementFromPoint(x, y)), pointer)).toBe(true);
            await page.mouse.click(pointer.x, pointer.y);
          }
          else {
            await expect(card).toBeFocused();
            await page.keyboard.press(action);
          }
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          await expect(dialog.getByRole('heading', { name: before[index].name, exact: true })).toBeVisible();
          await expect(dialog).toContainText(partners.find(partner => partner.name === before[index].name).summary);
          expect(after).toEqual(before);
        });
      }

      if (width === 1280) {
        test('background control and the Collaborator catalogue remain usable', async ({ page }) => {
          const reads = await serveFixture(page);
          await ready(page);
          const hero = page.locator('.hero-section');
          const toggle = hero.locator('.constellation-toggle');
          const before = await cardLabels(page);
          if (motion === 'reduce') {
            await expect(toggle).toBeHidden();
            await expect(hero).toHaveAttribute('data-constellation-motion', 'paused');
          } else {
            await expect(hero).toHaveAttribute('data-constellation-motion', 'running');
            await toggle.click();
            await expect(toggle).toHaveAttribute('aria-pressed', 'true');
            await expect(hero).toHaveAttribute('data-constellation-motion', 'paused');
            await toggle.click();
            await expect(toggle).toHaveAttribute('aria-pressed', 'false');
            await expect(hero).toHaveAttribute('data-constellation-motion', 'running');
          }
          await readForTwentySeconds(page);
          const enter = hero.getByRole('link', { name: /เริ่มต้นเลย/ }).or(hero.getByRole('button', { name: 'COLLABORATOR', exact: true }));
          await enter.click();
          await expect(page.locator('#tabCollab')).toHaveAttribute('aria-pressed', 'true');
          const listed = page.locator('#collaboratorGrid .browse-card-open');
          await expect(listed).toHaveText(partners.map(partner => partner.name));
          const extra = partners.find(partner => !before.some(row => row.name === partner.name));
          await page.locator('#collaboratorGrid').getByRole('button', { name: extra.name, exact: true }).click();
          await expect(page.getByRole('dialog', { name: extra.name, exact: true })).toBeVisible();
          expect(reads()).toBe(1);
        });
      }
    });
  }
}

test('logo previews keep the held preview and update the others on their own timer', async ({ page }) => {
  await serveFixture(page);
  await ready(page);
  const previews = page.locator('.orbit-tile:enabled');
  const labels = () => previews.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  await expect(previews).toHaveCount(3);
  await previews.first().focus();
  const before = await labels();
  await readForTwentySeconds(page);
  const after = await labels();
  await expect(previews.first()).toBeFocused();
  expect(after[0]).toBe(before[0]);
  expect(after.slice(1)).not.toEqual(before.slice(1));
});

test('first load can fail and retry, then the selection lasts until a new document', async ({ page }) => {
  const reads = await serveFixture(page, { failFirst: true });
  await expect(cards(page).locator('h4')).toHaveText(Array(3).fill('โหลดข้อมูลไม่สำเร็จ'));
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  await ready(page);
  const before = await cardLabels(page);
  expect(before.every(row => partners.some(partner => partner.name === row.name))).toBe(true);
  expect(reads()).toBe(2);
  await readForTwentySeconds(page);
  await page.locator('#filterCollab').selectOption('company');
  await expect(page.locator('#collaboratorGrid .browse-card-open')).toHaveCount(2);
  expect(await cardLabels(page)).toEqual(before);
  expect(reads()).toBe(2);

  // A fresh document may draw a new sample; the fixture now draws from the opposite end.
  await page.reload();
  await ready(page);
  expect(await cardLabels(page)).not.toEqual(before);
  expect(reads()).toBe(3);
});
