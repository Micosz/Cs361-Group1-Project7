const {test, expect} = require('@playwright/test');

const host = 'มหาวิทยาลัยคลองกลาง (สมมติ)';
const signing = 'พิธีลงนามคลองกลาง · วันสมมติ';
const rows = [
  {id:'canal', name:host, type:'university'},
  {id:'west', name:'มหาวิทยาลัยคลองกลางฝั่งตะวันตก (สมมติ)', type:'university'},
  {id:'company', name:'บริษัทคลองกลาง (สมมติ)', type:'company'},
  {id:'signing', title:signing, partnerId:'canal', period_date:'2026-06-20'},
  {id:'seminar', title:'เสวนาคลองกลาง · วันสมมติ', partnerId:'west', period_date:'2026-06-10'}
].map(row => ({...row, visibility:'public', summary:'ข้อมูลสมมติสำหรับทดสอบ',
  ...(row.title && {type:'academic_activity', activity_tags:['mou']})}));

async function visit(page, kind) {
  const writes = [];
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (request.method() !== 'GET') {
      writes.push(request.method() + ' ' + url.pathname);
      return route.abort();
    }
    if (url.pathname === '/api/public/records') return route.fulfill({json:rows});
    const detailMatch = url.pathname.match(/^\/api\/public\/(partners|activities)\/([^/]+)$/);
    if (detailMatch) {
      const found = rows.find(r => r.id === decodeURIComponent(detailMatch[2]));
      return found ? route.fulfill({json:{data:found}}) : route.fulfill({status:404, json:{}});
    }
    if (url.pathname === '/api/auth/session') return route.fulfill({json:{user:null, grants:[], capabilities:[], csrfToken:'a'.repeat(64)}});
    if (url.pathname === '/api/public/agreements' || url.pathname.endsWith('/feedback')) {
      return route.fulfill({json:{data:[], count:0, page:{nextCursor:null}}});
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({status:404, json:{}});
    return route.continue();
  });
  await page.clock.setFixedTime(new Date('2026-07-01T12:00:00+07:00'));
  const activity = kind === 'activity';
  await page.goto('/index.html' + (activity ? '?kind=activities' : '') + '#board-section');
  const filter = activity ? '#filterEvent' : '#filterCollab';
  await page.locator(filter).selectOption(activity ? 'mou' : 'university');
  await page.locator(filter + 'Date').fill('2026-06-01');
  await page.locator(filter + 'DateEnd').fill('2026-06-30');
  await page.locator('#searchInput').fill('คลองกลาง');
  await page.getByRole('button', {name:'ค้นหา', exact:true}).click();
  if (activity) await page.locator('#eventTimePast').click();
  const grid = page.locator(activity ? '#eventGrid' : '#collaboratorGrid');
  await expect(grid.locator('.browse-card-open:visible')).toHaveCount(2);
  return {grid, writes};
}

async function boardState(page) {
  return page.evaluate(() => {
    const value = id => document.getElementById(id).value;
    return {
      url:location.href, query:value('searchInput'),
      category:document.querySelector('.tabs [aria-pressed="true"]').id,
      period:document.querySelector('.event-time-tab[aria-selected="true"]').id,
      filters:['filterCollab','filterEvent'].map(id => [value(id), value(id + 'Date'), value(id + 'DateEnd')]),
      cards:[...document.querySelectorAll('.browse-card-open')].filter(el => el.getClientRects().length).map(el => el.textContent),
      scroll:window.scrollY
    };
  });
}

async function activate(control, mode) {
  if (mode === 'keyboard') await control.press('Enter');
  else if (mode === 'touch') await control.tap();
  else await control.click();
}

async function openFrom(page, opener, mode) {
  await opener.evaluate(el => el.scrollIntoView({block:'center', behavior:'instant'}));
  const before = await boardState(page);
  await activate(opener, mode);
  return before;
}

async function verifyReturn(page, opener, next, before, writes) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeInViewport();
  await expect.poll(() => boardState(page)).toEqual(before);
  await expect(opener).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(next).toBeFocused();
  expect(writes).toEqual([]);
}

for (const width of [390, 1280]) {
  const touch = width === 390;
  const pointer = touch ? 'touch' : 'mouse';
  test.describe('public detail return at ' + width + 'px', () => {
    test.use({viewport:{width, height:touch ? 844 : 800}, isMobile:touch, hasTouch:touch});

    test('partner history to signing to organizer returns to the original partner title', async ({page}) => {
      const {grid, writes} = await visit(page, 'partner');
      const opener = grid.getByRole('button', {name:host, exact:true});
      const partner = page.getByRole('dialog', {name:host, exact:true});
      const article = page.getByRole('dialog', {name:signing, exact:true});
      const mode = touch ? 'touch' : 'keyboard';
      const before = await openFrom(page, opener, mode);
      await activate(partner.getByRole('button', {name:signing, exact:true}), mode);
      await activate(article.getByRole('link', {name:host}).first(), mode);
      await expect(partner).toBeVisible();
      await expect(article).toBeHidden();
      if (touch) await partner.getByRole('button', {name:'ปิดรายละเอียด'}).tap();
      else await page.keyboard.press('Escape');
      await verifyReturn(page, opener, grid.locator('#west .browse-card-open'), before, writes);
    });

    test('organizer inside an activity returns to the activity title', async ({page}) => {
      const {grid, writes} = await visit(page, 'activity');
      const card = grid.locator('#signing');
      const opener = card.getByRole('button', {name:signing});
      const before = await openFrom(page, opener, pointer);
      const article = page.getByRole('dialog', {name:signing});
      await activate(article.getByRole('link', {name:host}).first(), pointer);
      const partner = page.getByRole('dialog', {name:host});
      await activate(partner.getByRole('button', {name:'ปิดรายละเอียด'}), pointer);
      await verifyReturn(page, opener, card.getByRole('link', {name:host}), before, writes);
    });

    test('organizer on the board returns to that link, including focus-neutral activation', async ({page}) => {
      const {grid, writes} = await visit(page, 'activity');
      const opener = grid.locator('#signing').getByRole('link', {name:host});
      const next = grid.locator('#seminar .browse-card-open');
      const partner = page.getByRole('dialog', {name:host});
      const before = await openFrom(page, opener, pointer);
      await expect(partner).toBeVisible();
      await page.keyboard.press('Escape');
      await verifyReturn(page, opener, next, before, writes);

      await page.locator('#filterEvent').evaluate(el => el.focus({preventScroll:true}));
      await opener.evaluate(el => el.scrollIntoView({block:'center', behavior:'instant'}));
      const fromFilter = await boardState(page);
      await opener.evaluate(link => link.click());
      await expect(partner).toBeVisible();
      await page.keyboard.press('Escape');
      await verifyReturn(page, opener, next, fromFilter, writes);
    });

    for (const kind of ['partner', 'activity']) {
      for (const control of ['cancelled draft', 'respondent filter']) {
        test(kind + ' closes with Escape from the ' + control, async ({page}) => {
          const {grid, writes} = await visit(page, kind);
          const isPartner = kind === 'partner';
          const name = isPartner ? host : signing;
          const opener = grid.getByRole('button', {name, exact:true});
          const before = await openFrom(page, opener, pointer);
          const dialog = page.getByRole('dialog', {name, exact:true});
          await activate(dialog.getByRole('tab', {name:'ความคิดเห็น'}), pointer);
          if (control === 'cancelled draft') {
            const draft = dialog.getByRole('textbox', {name:'ความคิดเห็น'});
            await draft.fill('ร่างสมมติ');
            await activate(dialog.getByRole('button', {name:'ยกเลิก'}), pointer);
            await expect(draft).toHaveValue('');
            await expect(draft).toBeFocused();
          } else {
            const filter = dialog.getByRole('combobox', {name:'กรองตามกลุ่มผู้ตอบ'});
            await filter.selectOption('teacher');
            await filter.focus();
            await expect(filter).toBeFocused();
          }
          await page.keyboard.press('Escape');
          const next = isPartner ? grid.locator('#west .browse-card-open') : grid.locator('#signing').getByRole('link', {name:host});
          await verifyReturn(page, opener, next, before, writes);
        });
      }
    }
  });
}
