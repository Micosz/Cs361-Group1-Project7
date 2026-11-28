const {test, expect} = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const organization = 'สถาบันคลองแก้ว (สมมติ)';
const earlier = 'เวิร์กช็อปคลองแก้ว · วันสมมติ';
const today = 'เปิดบ้านคลองแก้ว · วันสมมติ';
const rows = [
  {id:'canal', name:organization, type:'university', summary:'ตัวอย่างเพื่อทดสอบการแสดงผล'},
  {id:'garden', name:'บริษัทสวนลม (สมมติ)', type:'company'},
  {id:'library', name:'ห้องสมุดสนามดาว (สมมติ)', type:'government'},
  {id:'before', title:earlier, period_date:'2026-11-25', partnerId:'canal', type:'academic_activity'},
  {id:'today', title:today, period_date:'2026-11-26', partnerId:'canal', type:'academic_activity'},
].map(row => ({...row, visibility:'public'}));
const agreement = {id:'agreement', title:'ข้อตกลงสถาบันคลองแก้ว (สมมติ)', summary:'เนื้อหาข้อตกลงสมมติ',
  agreementType:'MoU', startDate:'2026-01-01', endDate:'2027-01-01', status:'active', publication:'public'};
const result = data => ({data, count:data.length, page:{nextCursor:null}});

async function fixture(page, baseURL, role) {
  const writes = [];
  await page.clock.setFixedTime(new Date('2026-11-25T17:01:00Z')); // 26 November in Bangkok.
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
    if (url.pathname === '/api/public/records') return route.fulfill({json:rows});
    const detailMatch = url.pathname.match(/^\/api\/public\/(partners|activities)\/([^/]+)$/);
    if (detailMatch) {
      const found = rows.find(r => r.id === decodeURIComponent(detailMatch[2]));
      return found ? route.fulfill({json:{data:found}}) : route.fulfill({status:404,json:{}});
    }
    if (url.pathname === '/api/auth/session') return route.fulfill({json:{
      user:role ? {id:'guide-fixture', displayName:'ผู้ทดสอบสมมติ', accountType:'tu'} : null,
      grants:role ? [{role, scopeId:'sample', active:true}] : [], capabilities:[], csrfToken:'a'.repeat(64)
    }});
    if (url.pathname === '/api/public/agreements') return route.fulfill({json:result([agreement])});
    if (url.pathname === '/api/public/agreements/agreement') return route.fulfill({json:{data:agreement}});
    if (url.pathname.endsWith('/feedback')) return route.fulfill({json:result([
      {id:'comment', comment:'ค้นหา', respondentType:'student', occurredOn:'2026-11-25', likes:1}
    ])});
    if (url.pathname.startsWith('/api/')) return route.fulfill({json:result([])});
    return route.continue();
  });
  return writes;
}

const header = page => page.locator('.navbar');
async function language(root, code) {
  const button = root.locator('.public-language button[data-language="' + code + '"]').first();
  await button.press('Enter');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}
async function capture(page, filename) {
  const directory = process.env.CSTU_LANGUAGE_EVIDENCE_DIR;
  if (!directory || page.viewportSize().width !== 1280) return;
  fs.mkdirSync(directory, {recursive:true});
  await page.screenshot({path:path.join(directory, filename + '.jpg'), type:'jpeg', quality:87, animations:'disabled'});
}

for (const width of [320, 390, 1280]) {
  test.describe('public languages at ' + width, () => {
    test.use({viewport:{width, height:width === 1280 ? 800 : 844}, hasTouch:width < 500, isMobile:width < 500});

    test('Welcome and filtered search retain the query, dates and Bangkok day on language change', async ({page, baseURL}) => {
      const writes = await fixture(page, baseURL);
      await page.goto('/index.html');
      await expect(page.locator('#collaboratorGrid .browse-card-open')).toHaveCount(3);
      const group = header(page).getByRole('group', {name:'ภาษาเว็บไซต์'});
      await expect(page.locator('.public-language')).toHaveCount(1);
      await expect(group.getByRole('button')).toHaveText(['TH','EN']);
      await expect(group.getByRole('button', {name:'TH (ภาษาไทย)', exact:true})).toHaveAttribute('aria-pressed','true');
      await expect(group.getByRole('button', {name:'EN (English)', exact:true})).toHaveAttribute('aria-pressed','false');
      if (width < 500) for (const button of await group.getByRole('button').all()) {
        const box = await button.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      const search = page.locator('.search-btn');
      await expect(page.locator('html')).toHaveAttribute('lang', 'th');
      await expect(search).toHaveText('ค้นหา');
      await expect(search).toHaveAccessibleName('ค้นหา');
      await expect(search).toHaveAttribute('title', 'ค้นหา');
      await capture(page, '01-welcome-th');
      await language(header(page), 'en');
      await expect(header(page).getByRole('group', {name:'Website language'})).toBeVisible();
      await expect(page).toHaveTitle('Information Board | CSTUHub');
      await expect(search).toHaveText('Search');
      await expect(search).toHaveAccessibleName('Search');
      await expect(search).toHaveAttribute('title', 'Search');
      await expect(page.getByRole('link', {name:'Sign in'})).toBeVisible();
      await capture(page, '02-welcome-en');
      await page.getByRole('button', {name:'Activities & MoU'}).click();
      await page.locator('#filterEvent').selectOption('academic_activity');
      const date = page.locator('#filterEventDateDisplay');
      await date.fill('๒๔๑๑๒๕๖๙'); await date.press('Tab');
      await expect(date).toHaveValue('24/11/2569');
      await expect(page.locator('#filterEventDate')).toHaveValue('2026-11-24');
      await expect(page.locator('#filterEventBuddhistHint')).toBeVisible();
      const grid = page.locator('#eventGrid');
      await expect(grid.locator('.browse-card-open:visible')).toHaveText([today]);
      await page.locator('#eventTimePast').click();
      await expect(grid.locator('.browse-card-open:visible')).toHaveText([earlier]);
      await page.locator('#searchInput').fill('ไม่พบในตัวอย่าง');
      await search.click();
      const clear = grid.getByRole('button', {name:'Clear search'});
      await expect(clear).toBeVisible();
      await language(header(page), 'th');
      await expect(page.locator('#searchInput')).toHaveValue('ไม่พบในตัวอย่าง');
      await expect(page.locator('#filterEvent')).toHaveValue('academic_activity');
      await expect(page.locator('#eventTimePast')).toHaveAttribute('aria-selected','true');
      await expect(date).toHaveValue('24/11/2569');
      await language(header(page), 'en');
      await grid.scrollIntoViewIfNeeded();
      await capture(page, '03-board-en');
      await clear.click();
      await expect(page.locator('#searchInput')).toHaveValue('');
      await expect(page.locator('#filterEvent')).toHaveValue('academic_activity');
      await expect(grid.locator('.browse-card-open:visible')).toHaveText([earlier]);
      await page.locator('#eventTimeCurrent').click();
      await expect(grid.locator('.browse-card-open:visible')).toHaveText([today]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(writes).toEqual([]);
    });

    test('activity filter labels, dates and both time descriptions follow the selected language', async ({page, baseURL}) => {
      await fixture(page, baseURL);
      await page.goto('/index.html');
      // A returning browser can still have Thai-only renderers and the old date dictionary at these URLs.
      const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src));
      for (const oldURL of ['/assets/script.js?v=clear-result-focus', '/assets/filter-presentation.js?v=5', '/assets/public-english.js']) {
        expect(scripts).not.toContain(new URL(oldURL, baseURL).href);
      }
      await page.locator('#tabEvent').click();
      const board = page.locator('#sectionEvent');
      const type = board.locator('#filterEvent');
      const from = board.locator('#filterEventDateDisplay');
      const to = board.locator('#filterEventDateEndDisplay');
      const titles = board.locator('#eventGrid .browse-card-open:visible');
      const copy = {
        th: ['ตัวกรอง', 'วัน/เดือน/พ.ศ.', 'กิจกรรมที่กำลังจะมาถึงหรือยังดำเนินอยู่ รวมรายการที่แหล่งข้อมูลยังไม่ระบุวันที่',
          'กิจกรรมที่สิ้นสุดแล้วยังเก็บไว้เป็นประวัติความร่วมมือ ไม่ถูกลบออกจากระบบ'],
        en: ['Filters', 'DD/MM/YYYY', 'Upcoming and ongoing activities, including records without a confirmed date.',
          'Completed activities are kept in the partnership history.']
      };

      await type.selectOption('academic_activity');
      for (const code of ['th', 'en', 'th']) {
        await language(header(page), code);
        const [caption, placeholder, current, past] = copy[code];
        await expect(board.locator('.filter-caption')).toHaveText(caption);
        for (const field of [from, to]) {
          await expect(field).toHaveAttribute('placeholder', placeholder);
          if (code === 'en') await expect(field).toHaveAccessibleDescription('Use a Buddhist Era year (e.g. 2569 for 2026).');
        }
        if (code === 'en') {
          await from.fill('31/02/2569'); await from.press('Tab');
          await expect(from).toHaveJSProperty('validationMessage', 'Enter a valid date as DD/MM/YYYY using a Buddhist Era year, for example 17/08/2563.');
          await from.fill('๒๕๑๑๒๕๖๙'); await from.press('Tab');
          await to.fill('26112569'); await to.press('Tab');
        }
        for (const [tab, hint, title] of [['#eventTimeCurrent', current, today], ['#eventTimePast', past, earlier]]) {
          await board.locator(tab).click();
          await expect(board.locator('#eventTimeHint')).toHaveText(hint);
          await expect(titles).toHaveText([title]);
        }
      }

      await expect(type).toHaveValue('academic_activity');
      await expect(from).toHaveValue('25/11/2569');
      await expect(to).toHaveValue('26/11/2569');
      await expect(board.locator('#filterEventDate')).toHaveValue('2026-11-25');
      await expect(board.locator('#filterEventDateEnd')).toHaveValue('2026-11-26');
      await to.fill('25112569'); await to.press('Tab');
      await expect(titles).toHaveText([earlier]);
      await board.locator('#eventTimeCurrent').click();
      await expect(titles).toHaveCount(0);
    });

    test('public record, comments and guide retain original content, draft and selection', async ({page, baseURL}) => {
      const writes = await fixture(page, baseURL);
      await page.goto('/index.html');
      await language(header(page),'en');
      await page.goto('/records.html?kind=partners&id=canal');
      const dialog = page.getByRole('dialog', {name:organization});
      await expect(dialog.getByRole('tab', {name:'Details', exact:true})).toBeVisible();
      await expect(dialog.locator('.public-language')).toHaveCount(0);
      await expect(header(page).locator('.public-language')).toBeHidden();
      await dialog.getByRole('tab', {name:/Comments/}).click();
      const draft = dialog.getByRole('textbox', {name:'Comments'});
      await draft.fill('ร่างจากข้อมูลสมมติ');
      const selection = dialog.locator('.feedback-composer-controls select');
      await selection.selectOption('student');
      await dialog.getByRole('button', {name:'Open user guide'}).click();
      await expect(page.locator('#cstu-manual')).toHaveAccessibleName('User guide');
      await expect(page.locator('#cstu-manual [data-language]')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(draft).toHaveValue('ร่างจากข้อมูลสมมติ');
      await expect(selection).toHaveValue('student');
      await expect(dialog.locator('.public-comment-list li > p').nth(1)).toHaveText('ค้นหา');
      await expect(dialog.getByRole('button',{name:'Post comment'})).toBeVisible();
      await capture(page, '04-comments-en');
      await page.keyboard.press('Escape');
      await header(page).getByRole('button', {name:'Open user guide'}).click();
      const guide = page.locator('#cstu-manual');
      await expect(guide.locator('#manual-count')).toHaveText('7 guides');
      await expect(guide.locator('.public-language')).toHaveCount(0);
      await expect(header(page).locator('.public-language')).toBeHidden();
      await guide.locator('#manual-search').fill('respondent group');
      await expect(guide.locator('#manual-toc button')).toHaveCount(2);
      const chapter = guide.getByRole('button', {name:'Read and post public comments'});
      await chapter.press('Enter');
      await expect(guide.locator('#manual-content > h2')).toBeFocused();
      await expect(guide.getByRole('heading',{name:/Write a comment and choose a respondent group/})).toBeVisible();
      await guide.locator('#manual-content img').first().evaluate(image => image.decode());
      await capture(page, '05-guide-en');
      await page.keyboard.press('Escape');
      await expect(header(page).getByRole('button',{name:'Open user guide'})).toBeFocused();
      await page.goto('/index.html?kind=activities&id=today');
      const activity = page.getByRole('dialog', {name:today});
      await expect(activity.getByRole('tab',{name:'Details'})).toBeVisible();
      await expect(activity.locator('[data-language]')).toHaveCount(0);
      await expect(header(page).locator('.public-language')).toBeHidden();
      await page.goto('/index.html?kind=agreements&id=agreement');
      const mou = page.getByRole('dialog',{name:agreement.title});
      await expect(mou.locator('dt').filter({hasText:'Summary'})).toBeVisible();
      await expect(mou.locator('[data-language]')).toHaveCount(0);
      await expect(header(page).locator('.public-language')).toBeHidden();
      await expect(mou.locator('dd').filter({hasText:agreement.summary})).toBeVisible();
      expect(writes).toEqual([]);
    });
  });
}

for (const width of [320, 390, 768, 1280, 1728]) {
  test.describe('date filters at ' + width, () => {
    test.use({viewport:{width, height:800}, hasTouch:width < 500, isMobile:width < 500});

    test('both English date fields share a hint directly below the range', async ({page, baseURL}) => {
      await fixture(page, baseURL);
      await page.goto('/index.html');
      await language(header(page), 'en');
      for (const [tab, filter, type] of [
        ['#tabCollab', '#filterCollab', 'university'],
        ['#tabEvent', '#filterEvent', 'mou'],
      ]) {
        await page.locator(tab).click();
        const start = page.locator(filter + 'DateDisplay');
        const end = page.locator(filter + 'DateEndDisplay');
        const hint = page.locator(filter + 'BuddhistHint');
        const description = 'Use a Buddhist Era year (e.g. 2569 for 2026).';
        await expect(start).toHaveAccessibleDescription(description);
        await expect(end).toHaveAccessibleDescription(description);
        for (const category of ['all', type]) {
          await page.locator(filter).selectOption(category);
          if (category !== 'all') {
            await start.fill('25112569');
            await start.press('Tab');
          }
          const [from, to, help] = await Promise.all([start.boundingBox(), end.boundingBox(), hint.boundingBox()]);
          const gap = help.y - Math.max(from.y + from.height, to.y + to.height);
          expect(Math.abs(help.x - from.x)).toBeLessThanOrEqual(1);
          expect(gap).toBeGreaterThanOrEqual(0);
          expect(gap).toBeLessThanOrEqual(16);
        }
      }
    });
  });
}

test('both login URLs and their guide inherit the Welcome choice after refresh', async ({page,baseURL}) => {
  const writes = await fixture(page,baseURL);
  await page.goto('/');
  await language(header(page),'en');
  await header(page).getByRole('link', {name:'Sign in'}).click();
  await expect(page).toHaveURL(/\/login\.html$/);
  for (const url of ['/login.html','/login/']) {
    if (url === '/login/') await page.goto(url);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang','en');
    await expect(page).toHaveTitle('Sign in | CSTUHub');
    await expect(page.locator('[data-language]')).toHaveCount(0);
    await page.getByLabel('TU account').fill('demo-only');
    await page.keyboard.press('F1');
    const guide = page.locator('#cstu-manual');
    await expect(guide).toHaveAccessibleName('User guide');
    await expect(guide.locator('#manual-content h2')).toBeVisible();
    await expect(page.locator('[data-language]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('TU account')).toHaveValue('demo-only');
    await expect(page.getByRole('button',{name:'Sign in', exact:true})).toBeEnabled();
  }
  await capture(page,'06-login-en');
  await page.locator('.back-link').click();
  await expect(header(page).getByRole('group',{name:'Website language'})).toBeVisible();
  await language(header(page),'th');
  await header(page).getByRole('link',{name:'เข้าสู่ระบบ'}).click();
  await expect(page.getByLabel('บัญชี TU')).toBeVisible();
  await expect(page.locator('[data-language]')).toHaveCount(0);
  expect(writes).toEqual([]);
});

for (const role of ['coordinator','staff','executive']) test(role + ' keeps a Thai workspace and public English', async ({page,baseURL}) => {
  const writes = await fixture(page,baseURL,role);
  await page.goto('/index.html?public=1');
  await language(header(page),'en');
  await header(page).getByRole('link',{name:'Back to workspace'}).click();
  await expect(page.locator('.work-dashboard')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang','th');
  await expect(page).toHaveTitle('หน้าทำงาน | CSTUHub');
  await expect(page.locator('[data-language]')).toHaveCount(0);
  await page.keyboard.press('F1');
  await expect(page.locator('#cstu-manual')).toHaveAccessibleName('คู่มือการใช้งาน');
  await expect(page.locator('[data-language]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('.work-public-link').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(header(page).getByRole('button',{name:'EN (English)'})).toHaveAttribute('aria-pressed','true');
  expect(writes).toEqual([]);
});

test('the student private tab stays Thai and returning to a public partner restores English', async ({page,baseURL}) => {
  const writes = await fixture(page,baseURL,'student');
  await page.goto('/');
  await language(header(page),'en');
  const title = page.locator('#collaboratorGrid').getByRole('button',{name:organization});
  for (let open=0; open<2; open++) {
    await title.click();
    const dialog = page.getByRole('dialog',{name:organization});
    await expect(dialog.getByRole('tab',{name:'Details'})).toBeVisible();
    await expect(dialog.locator('[data-language]')).toHaveCount(0);
    await expect(header(page).locator('.public-language')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(title).toBeFocused();
  }
  await page.locator('#tabExchange').click();
  await expect(page.locator('html')).toHaveAttribute('lang','th');
  await expect(header(page).locator('.public-language')).toBeHidden();
  await page.locator('#tabCollab').click();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(header(page).getByRole('button',{name:'English'})).toHaveAttribute('aria-pressed','true');
  expect(writes).toEqual([]);
});

test('visitors can change language when preference storage is unavailable', async ({page,baseURL}) => {
  await fixture(page,baseURL);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {get() { throw new DOMException('Unavailable', 'SecurityError'); }});
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang','th');
  await language(header(page),'en');
  await expect(header(page).getByRole('link',{name:'Sign in',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','th');
});
