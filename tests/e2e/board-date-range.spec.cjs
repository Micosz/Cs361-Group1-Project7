const {test, expect} = require('@playwright/test');

const groups = [
  {prefix:'filterCollab', tab:'#tabCollab', grid:'#collaboratorGrid', context:'องค์กร', legend:'วันจัดกิจกรรมที่องค์กรมีส่วนร่วม'},
  {prefix:'filterEvent', tab:'#tabEvent', grid:'#eventGrid', context:'กิจกรรม/MoU', legend:'วันจัดกิจกรรมหรือช่วงวันที่ของข้อตกลง'}
];
const sides = [['Date','เริ่มต้น (ตั้งแต่)'], ['DateEnd','สิ้นสุด (ถึง)']];
const keyword = 'คลองกลาง';
const day = '2026-11-25';
const organizations = [
  ['host','เจ้าภาพ'], ['co','ผู้ร่วมจัด'], ['early','ครั้งก่อน'], ['late','ครั้งหน้า'],
  ['edge','วันท้าย'], ['post','มีแต่ข่าว'], ['firm','บริษัท'], ['other','นอกคำค้น']
].map(([id, name]) => ({
  id, name:(id === 'other' ? 'ทุ่งเหนือ' : keyword) + ' ' + name + ' (สมมติ)',
  type:id === 'firm' ? 'company' : 'university', visibility:'public'
}));
const signingHosts = organizations.filter(row => ['host','co','firm'].includes(row.id));
const activities = [
  ['sign','host',day,day], ['before','early','2026-11-21','2026-11-24'],
  ['after','late','2026-11-26','2026-11-28'], ['ending','edge','2026-11-23',day],
  ['post-only','post'], ['other-name','other',day,day]
].map(([id, partnerId, start, end]) => ({
  id, partnerId, title:(id === 'other-name' ? 'ทุ่งเหนือ' : keyword) + ' ' + id + ' · วันสมมติ',
  type:'academic_activity', activity_tags:['mou'], visibility:'public',
  summary:id === 'sign' ? 'เผยแพร่ 20 พ.ย. 2569 (วันสมมติ)' : 'เผยแพร่ 25 พ.ย. 2569 (วันสมมติ)',
  ...(start && {period_date:start, period_end_date:end}),
  ...(id === 'sign' && {coHostPartnerIds:['co','firm'], co_hosts:signingHosts.map(row => row.name)})
}));
const agreements = [
  ['ag-left','2026-11-20',day], ['ag-right',day,'2026-11-28'], ['ag-before','2026-11-10','2026-11-24'],
  ['ag-after','2026-11-26','2026-11-28']
].map(([id,startDate,endDate]) => ({id, title:keyword + ' ' + id + ' · วันสมมติ', startDate, endDate,
  agreementType:'MoU', status:'expired', publication:'public', entityType:'agreement'}));

async function visit(page) {
  const reads = [], writes = [];
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (request.method() !== 'GET') { writes.push(request.method() + ' ' + url.pathname); return route.abort(); }
    if (url.pathname === '/fetchPartnersData' || url.pathname.startsWith('/api/')) reads.push(url.pathname + url.search);
    if (url.pathname === '/fetchPartnersData') return route.fulfill({json:[...organizations,...activities]});
    if (url.pathname === '/api/auth/session') return route.fulfill({json:{user:null,grants:[],capabilities:[],csrfToken:'a'.repeat(64)}});
    if (url.pathname === '/api/public/records') return route.fulfill({json:[]});
    if (url.pathname === '/api/public/agreements') {
      const from = url.searchParams.get('startDate'), to = url.searchParams.get('endDate'), q = url.searchParams.get('q') || '';
      const data = agreements.filter(row => row.title.includes(q) && (!from || row.endDate >= from) && (!to || row.startDate <= to));
      return route.fulfill({json:{data,count:data.length,page:{nextCursor:null}}});
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({status:404,json:{}});
    return route.continue();
  });
  await page.clock.setFixedTime(new Date('2026-12-05T12:00:00+07:00'));
  await page.goto('/index.html#board-section');
  await expect(page.locator('#filterCollabDateDisplay')).toBeVisible();
  return {reads, writes};
}
async function dateValue(page, id, value) {
  const display = page.locator('#' + id + 'Display');
  await display.fill(value);
  if (value) {
    await expect(display).toHaveValue('25/11/2569');
    expect(await display.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  await display.press('Tab');
  await expect(page.locator('#' + id)).toHaveValue(value ? day : '');
}
const idForTitle = new Map([...organizations,...activities,...agreements].map(row => [row.name || row.title,row.id]));
async function ids(page, grid) {
  const titles = await page.locator(grid + ' .browse-card-open:visible').allTextContents();
  return titles.map(title => idForTitle.get(title) || title);
}

for (const width of [320,390,1280]) {
  test.describe('board date ranges at ' + width + 'px', () => {
    test.use({viewport:{width,height:width === 320 ? 707 : width === 390 ? 844 : 800}, isMobile:width < 500, hasTouch:width < 500});

    test('date ranges keep accessible group names and show only the bound labels without clipping', async ({page}) => {
      await visit(page);
      const names = new Set();
      for (const {prefix,tab,legend} of groups) {
        await page.locator(tab).click();
        const group = page.getByRole('group', {name:legend,exact:true});
        await expect(group).toBeVisible();
        await expect(group.locator('legend')).toBeHidden();
        for (const [suffix,side] of sides) {
          const id = prefix + suffix;
          const field = group.getByRole('textbox', {name:side + ' ' + legend,exact:true});
          const buttonName = 'เปิดปฏิทิน · ' + side + ' · ' + legend;
          const picker = group.getByRole('button', {name:buttonName,exact:true});
          await expect(field).toHaveAttribute('id', id + 'Display');
          await expect(group.locator('#' + id + 'Label')).toHaveAttribute('for', id + 'Display');
          await expect(group.locator('#' + id + 'Label')).toHaveText(side);
          await expect(group.locator('#' + id + 'Label')).toBeVisible();
          await expect(picker).toHaveAttribute('title',buttonName);
          const source = page.locator('#' + id);
          await source.evaluate(date => { date.showPicker = function() { this.dataset.activated = 'yes'; }; });
          const icon = picker;
          if (width < 500) await icon.tap(); else await icon.click();
          await expect(source).toHaveAttribute('data-activated','yes');
          names.add(buttonName);
        }
        const fits = await group.evaluate(group => {
          const bounds = group.getBoundingClientRect();
          if (bounds.left < -1 || bounds.right > document.documentElement.clientWidth + 1) return false;
          return [...group.querySelectorAll('.date-range-field > label')].every(el => {
            const box = el.getBoundingClientRect(), range = document.createRange();
            range.selectNodeContents(el.lastChild);
            return [...range.getClientRects()].every(r => r.left >= box.left-1 && r.right <= box.right+1 && r.top >= box.top-1 && r.bottom <= box.bottom+1);
          });
        });
        expect(fits).toBe(true);
        const fields = await group.getByRole('textbox').all();
        const [first, last] = await Promise.all(fields.map(field => field.boundingBox()));
        expect(Math.abs(first.y - last.y)).toBeLessThanOrEqual(1);
      }
      expect(names.size).toBe(4);
    });

    test('inline labels and both bounds survive a public language round trip', async ({page}) => {
      await visit(page);
      for (const {prefix,tab,legend} of groups) {
        await page.locator(tab).click();
        const fields = ['Date','DateEnd'].map(s => page.locator('#' + prefix + s + 'Display'));
        for (const [start,end] of [[false,false],[true,false],[false,true],[true,true]]) {
          await dateValue(page,prefix+'Date',start ? '๒๕๑๑๒๕๖๙' : '');
          await dateValue(page,prefix+'DateEnd',end ? '๒๕๑๑๒๕๖๙' : '');
          for (const lang of ['th','en','th']) {
            await page.locator('.navbar button[data-language='+lang+']').click();
            const heading = lang==='th' ? legend : prefix==='filterCollab'
              ? 'Dates of activities involving the organization' : 'Activity dates or agreement period';
            const group = page.getByRole('group',{name:heading,exact:true});
            await expect(group).toBeVisible();
            await expect(group.locator('legend')).toBeHidden();
            const labels = lang==='th' ? ['เริ่มต้น (ตั้งแต่)','สิ้นสุด (ถึง)'] : ['Start (from)','End (to)'];
            for (const [index,field] of fields.entries()) {
              const name = labels[index]+' '+heading;
              await expect(field).toHaveAccessibleName(name);
              const action = lang==='th' ? 'เปิดปฏิทิน' : 'Open calendar';
              const buttonName = [action,labels[index],heading].join(' · ');
              await expect(group.getByRole('button',{name:buttonName,exact:true})).toHaveAttribute('title',buttonName);
              await expect(field).toHaveValue([start,end][index] ? '25/11/2569' : '');
            }
            const hint = page.locator('#'+prefix+'BuddhistHint');
            if (lang==='en') await expect(hint).toBeVisible(); else await expect(hint).toBeHidden();
            const [a,b] = await Promise.all(fields.map(field=>field.boundingBox()));
            expect(Math.abs(a.y-b.y)).toBeLessThanOrEqual(1);
            expect(b.x).toBeGreaterThanOrEqual(a.x+a.width);
            expect(b.x+b.width).toBeLessThanOrEqual(width+1);
          }
        }
      }
    });

    for (const mode of ['no-op','missing','throws']) {
      test('calendar keyboard activation when showPicker is ' + mode, async ({page}) => {
        const {reads,writes} = await visit(page);
        for (const {prefix,tab} of groups) {
          await page.locator(tab).click();
          for (const [suffix] of sides) {
            const id = prefix + suffix, source = page.locator('#'+id);
            const field = page.locator('#'+id+'Display');
            const button = field.locator('..').getByRole('button');
            await source.evaluate((date, mode) => {
              date.dataset.pickerCalls = '0';
              Object.defineProperty(date,'showPicker',{configurable:true,value:mode === 'missing' ? undefined : function() {
                this.dataset.pickerCalls = String(Number(this.dataset.pickerCalls)+1);
                if (mode === 'throws') throw new DOMException('Fixture','NotAllowedError');
              }});
            },mode);
            for (const [index,key] of ['Enter','Space'].entries()) {
              await field.focus();
              await page.keyboard.press('Tab');
              await expect(button).toBeFocused();
              await page.keyboard.press(key);
              await expect(source).toHaveAttribute('data-picker-calls', String(mode === 'missing' ? 0 : index+1));
              await expect(mode === 'no-op' ? button : field).toBeFocused();
              await expect(source).toHaveValue('');
            }
          }
        }
        expect(reads.filter(url => url.startsWith('/api/public/agreements'))).toEqual([]);
        expect(writes).toEqual([]);
      });
    }

    test('Buddhist inputs preserve inclusive results, board context and independent ranges', async ({page},info) => {
      const {reads,writes} = await visit(page);
      const trail = [];
      async function check(stage, group, expected) {
        const {grid,prefix} = groups[group];
        await expect.poll(async () => (await ids(page,grid)).sort()).toEqual([...expected].sort());
        await expect(page.locator('#searchInput')).toHaveValue(keyword);
        await expect(page.locator('#' + prefix)).toHaveValue(group === 0 ? 'university' : 'mou');
        if (group === 1) await expect(page.locator('#eventTimePast')).toHaveAttribute('aria-selected','true');
        await page.waitForLoadState('networkidle');
        trail.push({stage, cards:await ids(page,grid), from:await page.locator('#'+prefix+'Date').inputValue(),
          to:await page.locator('#'+prefix+'DateEnd').inputValue(),
          states:await page.locator(grid+' .protected-event-card .author-name:visible').allTextContents()});
      }
      await page.waitForLoadState('networkidle');
      await page.locator('#filterCollab').selectOption('university');
      await expect.poll(() => ids(page,'#collaboratorGrid')).not.toContain('firm');
      await page.waitForLoadState('networkidle');
      await page.locator('#searchInput').fill(keyword);
      const orgAll = ['host','co','early','late','edge','post'];
      await check('organization / no dates',0,orgAll);
      await dateValue(page,'filterCollabDate','๒๕๑๑๒๕๖๙');
      await check('organization / from',0,['host','co','edge','late']);
      await dateValue(page,'filterCollabDateEnd','๒๕๑๑๒๕๖๙');
      await check('organization / same day',0,['host','co','edge']);
      await dateValue(page,'filterCollabDate','');
      await check('organization / to',0,['host','co','edge','early']);
      await dateValue(page,'filterCollabDate','๒๕๑๑๒๕๖๙');
      await page.locator('#tabEvent').click();
      await page.locator('#filterEvent').selectOption('mou');
      await page.locator('#eventTimePast').click();
      const eventAll = ['sign','before','after','ending','ag-left','ag-right','ag-before','ag-after'];
      await check('activity / no dates',1,eventAll);
      await dateValue(page,'filterEventDateEnd','๒๕๑๑๒๕๖๙');
      await check('activity / to',1,['sign','before','ending','ag-left','ag-right','ag-before']);
      await dateValue(page,'filterEventDate','๒๕๑๑๒๕๖๙');
      await check('activity / same day',1,['sign','ending','ag-left','ag-right']);
      const card = page.locator('#eventGrid #sign');
      for (const host of signingHosts) {
        await expect(card.getByRole('link',{name:host.name,exact:true})).toHaveAttribute('href','#partner-'+host.id);
      }
      await expect(page.locator('#eventGrid .protected-event-card .author-name:visible')).toHaveText(['หมดอายุ','หมดอายุ']);
      const exact = reads.filter(value => value.startsWith('/api/public/agreements')).map(value => new URL(value,'http://127.0.0.1:4173').searchParams);
      expect(exact.some(params => params.get('startDate') === day && params.get('endDate') === day && params.get('q') === keyword)).toBe(true);
      await dateValue(page,'filterEventDateEnd','');
      await check('activity / from',1,['sign','after','ending','ag-left','ag-right','ag-after']);
      await page.locator('#filterEventDateClear').click();
      await check('activity / cleared',1,eventAll);
      await expect(page.locator('#filterCollabDate')).toHaveValue(day);
      await expect(page.locator('#filterCollabDateEnd')).toHaveValue(day);
      await dateValue(page,'filterEventDateEnd','๒๕๑๑๒๕๖๙');
      await check('activity / keep end while clearing organizations',1,['sign','before','ending','ag-left','ag-right','ag-before']);
      await page.locator('#tabCollab').click();
      await check('organization / still selected',0,['host','co','edge']);
      await page.locator('#filterCollabDateClear').click();
      await check('organization / cleared',0,orgAll);
      await expect(page.locator('#filterEventDate')).toHaveValue('');
      await expect(page.locator('#filterEventDateEnd')).toHaveValue(day);
      await expect(page.locator('#filterEventDateEndDisplay')).toHaveValue('25/11/2569');
      await page.waitForLoadState('networkidle');
      expect(writes).toEqual([]);
      await info.attach('fixture-results-and-reads',{body:JSON.stringify({trail, reads, writes}),contentType:'application/json'});
    });
  });
}
