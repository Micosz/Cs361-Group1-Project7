const {test, expect} = require('@playwright/test');
const csrfToken = 'a'.repeat(64);
async function fixture(page, role, failLogin = false) {
  let signedIn = !!role;
  const requests = [];
  const session = () => ({user:signedIn ? {id:'browser-user',displayName:'Browser Tester',accountType:'tu'} : null,
    grants:signedIn ? [{role:role || 'student',scopeId:'demo',active:true}] : [],capabilities:[],csrfToken});
  await page.route('**/*', async route => {
    const req=route.request(), url=new URL(req.url());
    // No browser request can reach AWS, TU authentication or third-party services.
    if(url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if(url.pathname === '/fetchPartnersData') return route.fulfill({json:[
      {id:'p1',name:'Alpha University',type:'university',visibility:'public',description:'Alpha collaboration'},
      {id:'p2',name:'Beta Company',type:'company',visibility:'public',description:'Beta collaboration'}]});
    if(!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({path:url.pathname,method:req.method(),headers:req.headers(),body:req.postDataJSON()});
    if(url.pathname === '/api/auth/session') return route.fulfill({json:session()});
    if(url.pathname === '/api/auth/login') {
      if(failLogin) return route.fulfill({status:401,json:{error:{code:'INVALID_CREDENTIALS'}}});
      signedIn=true; return route.fulfill({json:session()});
    }
    if(url.pathname === '/api/auth/logout') {signedIn=false; return route.fulfill({json:{}});}
    if(url.pathname === '/api/public/records') return route.fulfill({json:[]});
    if(url.pathname === '/api/me/exchanges') return route.fulfill({json:{
      data:[{id:'fixture-exchange',title:'โครงการแลกเปลี่ยนตัวอย่างที่เข้าร่วม'}], count:1, page:{nextCursor:null}
    }});
    return route.fulfill({json:{data:[],count:0,items:[],page:{nextCursor:null}}});
  });
  return requests;
}
test('public catalog renders, searches, and opens detail in a real browser', async ({page}) => {
  await fixture(page); await page.goto('/index.html');
  await page.locator('#tabCollab').click();
  await expect(page.locator('#tabExchange')).toBeHidden();
  const grid=page.locator('#collaboratorGrid');
  await expect(grid).toContainText('Alpha University'); await expect(grid).toContainText('Beta Company');
  await page.locator('#filterCollab').selectOption('university');
  await expect(grid).toContainText('Alpha University'); await expect(grid).not.toContainText('Beta Company');
  await page.locator('#filterCollab').selectOption('all');
  await page.locator('#searchInput').fill('Alpha');
  await expect(grid).toContainText('Alpha University'); await expect(grid).not.toContainText('Beta Company');
  await grid.getByRole('button', {name:'Alpha University', exact:true}).click();
  await expect(page.locator('#detailModal')).toBeVisible();
  await expect(page.locator('#modalTitle')).toContainText('Alpha University');
});
async function publicDetailFixture(page) {
  await fixture(page);
  const partner='มหาวิทยาลัยคลองกลาง (สมมติ)', activity='กิจกรรมคลองกลาง · วันสมมติ';
  await page.route('**/fetchPartnersData', route => route.fulfill({json:[
    {id:'sample-host', name:partner, type:'university', visibility:'public', summary:'ตัวอย่างสำหรับทดสอบ'},
    {id:'sample-company', name:'บริษัทสมมติ', type:'company', visibility:'public'},
    {id:'sample-event', title:activity, partnerId:'sample-host', type:'research', visibility:'public', summary:'ตัวอย่างสำหรับทดสอบ'}
  ]}));
  return {partner, activity};
}
test('filtered public cards restore focus and keep keyboard navigation inside partner details', async ({page}) => {
  await page.setViewportSize({width:320,height:707});
  const {partner, activity} = await publicDetailFixture(page);
  await page.goto('/index.html#board-section');
  await page.locator('#filterCollab').selectOption('university');
  const host=page.locator('#sample-host');
  const title=host.getByRole('button',{name:partner});
  const partnerDialog=page.getByRole('dialog',{name:partner});
  await title.press('Enter');
  await expect(partnerDialog).toBeVisible();
  const identity=partnerDialog.locator('.detail-identity');
  expect(await identity.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(identity).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await partnerDialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(partnerDialog).toBeHidden();
  await expect(title).toBeFocused();

  await host.locator('.card-desc').click();
  await partnerDialog.getByRole('button',{name:'ปิดรายละเอียด'}).click();
  await expect(title).toBeFocused();
  await expect(page.locator('#filterCollab')).toHaveValue('university');

  await page.goto('/index.html?kind=activities#board-section');
  await page.locator('#filterEvent').selectOption('research');
  const eventCard=page.locator('#sample-event');
  await eventCard.locator('.card-desc').click();
  const eventDialog=page.getByRole('dialog',{name:activity});
  await expect(eventDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(eventCard.getByRole('button',{name:activity})).toBeFocused();
  await expect(page.locator('#filterEvent')).toHaveValue('research');
});
const detailOpenerCases = [
  {kind:'partner', path:'/index.html#board-section', filter:'#filterCollab', value:'university', card:'#sample-host'},
  {kind:'activity', path:'/index.html?kind=activities#board-section', filter:'#filterEvent', value:'research', card:'#sample-event'}
];
for (const scenario of detailOpenerCases) {
  test(`public ${scenario.kind} title restores focus when activation leaves focus on the filter`, async ({page}) => {
    const names = await publicDetailFixture(page);
    await page.goto(scenario.path);
    const filter = page.locator(scenario.filter);
    await filter.selectOption(scenario.value);
    const title = page.locator(scenario.card).getByRole('button', {name:names[scenario.kind], exact:true});
    const dialog = page.getByRole('dialog', {name:names[scenario.kind], exact:true});
    for (const close of ['escape','button']) {
      await filter.focus();
      await expect(filter).toBeFocused();
      await title.evaluate(button => button.click());
      await expect(dialog).toBeVisible();
      if (close === 'escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', {name:'ปิดรายละเอียด'}).click();
      await expect(dialog).toBeHidden();
      await expect(title).toBeFocused();
      await expect(filter).toHaveValue(scenario.value);
    }
  });
}
test('closing an activity opened from partner history restores the visible partner card title', async ({page}) => {
  const {partner, activity} = await publicDetailFixture(page);
  await page.goto('/index.html#board-section');
  const title = page.locator('#sample-host').getByRole('button', {name:partner, exact:true});
  await title.click();
  const partnerDialog = page.getByRole('dialog', {name:partner, exact:true});
  await partnerDialog.locator('.partner-history').getByRole('button', {name:activity, exact:true}).click();
  const activityDialog = page.getByRole('dialog', {name:activity, exact:true});
  await expect(partnerDialog).toBeHidden();
  await expect(activityDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(activityDialog).toBeHidden();
  await expect(title).toBeFocused();
});
test('invalid login shows feedback, clears password, and sends CSRF', async ({page}) => {
  const requests=await fixture(page, null, true); await page.goto('/login.html');
  await page.locator('#student-id').fill('test-account'); await page.locator('#student-password').fill('dummy-password');
  await page.locator('#login-submit').click();
  await expect(page.locator('#login-status')).toContainText('ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง');
  await expect(page.locator('#student-password')).toHaveValue('');
  expect(requests.find(r=>r.path.endsWith('/login')).headers['x-csrf-token']).toBe(csrfToken);
});
test('MoU period labels cover agreements and signing news without partial counts', async ({page}) => {
  await fixture(page);
  await page.clock.setFixedTime(new Date('2026-07-01T12:00:00+07:00'));
  await page.route('http://127.0.0.1:4173/fetchPartnersData', route => route.fulfill({json:[
    {id:'host',name:'Fixture University',type:'university',visibility:'public'},
    {id:'story',partnerId:'host',title:'Signing story (fixture)',type:'academic_activity',activity_tags:['mou'],period_date:'2026-06-20',visibility:'public'}
  ]}));
  await page.route('http://127.0.0.1:4173/api/public/agreements?*', route => route.fulfill({json:{
    data:[{id:'agreement',title:'Expired agreement (fixture)',entityType:'agreement',agreementType:'MoA',
      startDate:'2025-06-01',endDate:'2026-06-30',status:'expired',publication:'public'}],count:1,page:{nextCursor:null}
  }}));
  await page.goto('/index.html');
  await page.locator('#tabEvent').click();
  const current = page.locator('#eventTimeCurrent'), past = page.locator('#eventTimePast');
  await expect(current).toHaveAccessibleName('ปัจจุบัน (0)');
  await expect(past).toHaveAccessibleName('ผ่านมาแล้ว (1)');

  await page.locator('#filterEvent').selectOption('mou');
  await expect(current).toHaveAccessibleName('ปัจจุบัน');
  await expect(past).toHaveAccessibleName('ผ่านมาแล้ว');
  await page.getByRole('button',{name:'ดูรายการที่ผ่านมาแล้ว',exact:true}).click();
  await expect(past).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#eventGrid .browse-card-open:visible')).toHaveText(['Expired agreement (fixture)','Signing story (fixture)']);

  await page.locator('#filterEvent').selectOption('all');
  await expect(current).toHaveAccessibleName('ปัจจุบัน (0)');
  await expect(past).toHaveAccessibleName('ผ่านมาแล้ว (1)');
  await expect(page.locator('#eventGrid .browse-card-open:visible')).toHaveText(['Signing story (fixture)']);
});
test('successful student login returns to public home without storing credentials', async ({page}) => {
  await fixture(page); await page.goto('/login.html');
  await page.locator('#student-id').fill('test-account'); await page.locator('#student-password').fill('dummy-password');
  await page.locator('#login-submit').click(); await expect(page).toHaveURL(/index.html/);
  await expect(page.locator('.browse-hero-slot #tabExchange')).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toMatch(/dummy-password|test-account/);
});
test('student can use Help and Exchange, then log out directly from the Welcome header', async ({page}) => {
  await page.setViewportSize({width:483,height:707});
  const requests = await fixture(page, 'student');
  await page.goto('/index.html');
  const brand = page.locator('.navbar .logo');
  const account = page.locator('.navbar .account-summary');
  const logout = page.locator('#authNavButtons').getByRole('button', {name:'ออกจากระบบ', exact:true});
  const search = page.locator('.navbar .search-wrapper');
  await expect(account).toContainText('Student');
  await expect(logout).toBeVisible();
  await expect(logout).not.toHaveAttribute('aria-haspopup', 'dialog');
  await expect(page.locator('.role-menu-trigger')).toHaveCount(0);
  for (const width of [521, 483, 320]) {
    await page.setViewportSize({width,height:708});
    const [logoBox, accountBox, logoutBox, searchBox] = await Promise.all(
      [brand, account, logout, search].map(control => control.boundingBox()));
    expect(logoBox.y + logoBox.height / 2).toBeGreaterThan(accountBox.y);
    expect(logoBox.y + logoBox.height / 2).toBeLessThan(accountBox.y + accountBox.height);
    expect(accountBox.x + accountBox.width).toBeLessThan(logoutBox.x);
    expect(logoutBox.x + logoutBox.width).toBeLessThanOrEqual(width);
    expect(logoutBox.y + logoutBox.height).toBeLessThanOrEqual(searchBox.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.locator('.navbar .manual-trigger').click();
  await expect(page.locator('#cstu-manual')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#cstu-manual')).toBeHidden();

  const exchange = page.getByRole('button', {name:'EXCHANGE', exact:true});
  await exchange.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#board-section$/);
  await expect(page.locator('.browse-board-slot #tabExchange')).toBeFocused();
  await expect(page.locator('#records-content')).toContainText('โครงการแลกเปลี่ยนตัวอย่างที่เข้าร่วม');
  await expect(exchange).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.scrollTo({top:0, behavior:'instant'}));
  await expect(page.locator('.browse-hero-slot #tabExchange')).toBeFocused();
  await expect(exchange).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', {name:'เลือกหมวดข้อมูล'})).toHaveCount(1);

  await page.locator('html').evaluate(el => { el.lang = 'en'; });
  const englishLogout = page.locator('#authNavButtons').getByRole('button', {name:'Logout', exact:true});
  await expect(englishLogout).toBeVisible();
  await englishLogout.press('Space');
  await expect(page.locator('#authNavButtons a[href="login.html"]')).toBeVisible();
  await expect(exchange).toBeHidden();
  await expect(page.locator('#records-content')).not.toContainText('โครงการแลกเปลี่ยนตัวอย่างที่เข้าร่วม');
  const signouts = requests.filter(r => r.path === '/api/auth/logout');
  expect(signouts).toHaveLength(1);
  expect(signouts[0].method).toBe('POST');
  expect(signouts[0].headers['x-csrf-token']).toBe(csrfToken);
});

test('failed student logout can be retried from the header', async ({page}) => {
  await fixture(page, 'student');
  await page.route('**/api/auth/logout', route => route.fulfill({status:503, json:{error:{code:'UNAVAILABLE'}}}), {times:1});
  await page.goto('/index.html');
  const logout = page.locator('#authNavButtons').getByRole('button', {name:'ออกจากระบบ', exact:true});
  await logout.click();
  await expect(page.locator('#authNavButtons [role="status"]')).toHaveText('ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง');
  await expect(logout).toBeEnabled();
  await expect(page.locator('#tabExchange')).toBeVisible();
  await logout.press('Enter');
  await expect(page.locator('#authNavButtons a[href="login.html"]')).toBeVisible();
  await expect(page.locator('#tabExchange')).toBeHidden();
});

test('the Student shortcut follows active grants and preserves role management and multi-role navigation', async ({page}) => {
  await fixture(page, 'student');
  const student = {role:'student', scopeId:'demo', active:true};
  const session = {user:{id:'fixture-user'}, grants:[student, {...student,role:'staff',active:false}], capabilities:[], csrfToken};
  await page.route('**/api/auth/session', route => route.fulfill({json:session}));
  await page.goto('/index.html?public=1');
  const header = page.locator('#authNavButtons');
  const logout = header.getByRole('button', {name:'ออกจากระบบ',exact:true});
  await expect(logout).toBeVisible();
  session.capabilities = [{name:'manageRoles',scopeId:'demo',active:true}];
  await page.evaluate(() => window.dispatchEvent(new Event('authchange')));
  await header.getByRole('button', {name:'Menu',exact:true}).click();
  const dialog = page.locator('#role-menu');
  await expect(dialog.getByRole('link',{name:/จัดการสิทธิ์ผู้ใช้/})).toBeVisible();
  await expect(dialog.getByRole('link',{name:/โครงการแลกเปลี่ยนของฉัน/})).toBeVisible();

  session.capabilities[0].active = false;
  await page.evaluate(() => window.dispatchEvent(new Event('authchange')));
  await expect(dialog).toBeHidden();
  await expect(logout).toBeVisible();
  await expect(logout).not.toHaveAttribute('aria-expanded', 'false');
  session.grants.push({...student,role:'coordinator'});
  await page.evaluate(() => window.dispatchEvent(new Event('authchange')));
  await expect(header.locator('a[href="work.html"]')).toBeVisible();
  await expect(logout).toHaveCount(0);
});

test('short filtered board keeps category buttons clickable below the mobile header', async ({page}) => {
  await fixture(page);
  await page.route('**/fetchPartnersData', route => route.fulfill({json:[
    {id:'p1', name:'Alpha University', type:'university', summary:'Fixture partner summary', visibility:'public'},
    {id:'p2', name:'Beta Company', type:'company', visibility:'public'},
  ]}));
  await page.setViewportSize({width:320, height:707});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/index.html#board-section');
  await page.locator('#filterCollab').selectOption('university');
  const card = page.locator('#p1');
  const dialog = page.getByRole('dialog', {name:'Alpha University'});
  await card.getByRole('button', {name:'Alpha University', exact:true}).press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await card.locator('.card-desc').click();
  await dialog.getByRole('button', {name:'ปิดรายละเอียด'}).click();
  await expect(dialog).toBeHidden();

  const event = page.locator('#tabEvent');
  async function expectClickable() {
    await expect.poll(() => event.evaluate(button => {
      const {left, top, width, height} = button.getBoundingClientRect();
      return [.1, .5, .9].every(fraction =>
        button.contains(document.elementFromPoint(left + width / 2, top + height * fraction)));
    })).toBe(true);
  }
  await expectClickable();
  await page.evaluate(() => window.scrollTo({top:document.scrollingElement.scrollHeight, behavior:'instant'}));
  await expect(page.locator('.browse-board-slot #tabEvent')).toBeVisible();
  await expectClickable();
  await event.click();
  await expect(event).toHaveAttribute('aria-pressed', 'true');
});

test('category buttons keep focus and selection across the desktop scroll scene', async ({page}) => {
  await fixture(page);
  await page.setViewportSize({width:1280,height:800});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/index.html');
  const event = page.locator('#tabEvent');
  await event.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.browse-board-slot #tabEvent')).toBeFocused();
  await expect(event).toHaveAttribute('aria-pressed','true');
  await page.evaluate(() => window.scrollTo({top:0,behavior:'instant'}));
  await expect(page.locator('.browse-hero-slot #tabEvent')).toBeFocused();
  await expect(event).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#tabExchange')).toBeHidden();
});

for (const role of ['coordinator','staff','executive']) test(`${role} gets internal navigation and create actions`, async ({page}) => {
  await fixture(page, role); await page.goto('/index.html'); await expect(page).toHaveURL(/work.html/);
  await expect(page.locator('#work-nav')).toContainText('คู่ความร่วมมือ');
  await expect(page.locator('#work-actions')).toContainText('อ่านผลตอบรับ');
  await page.locator('#work-nav a[href*="view=feedback"]').click();
  await expect(page).toHaveURL(/view=feedback/);
  await expect(page.locator('#work-nav a[aria-current="page"]')).toContainText('Feedback');
});
for(const role of [null,'student']) test(`${role || 'anonymous'} direct work URL is redirected`, async ({page}) => {
  await fixture(page, role); await page.goto('/work.html'); await expect(page).toHaveURL(role ? /index.html/ : /login.html/);
});
test('session outage keeps internal page gated and retry recovers', async ({page}) => {
  await fixture(page,'staff');
  await page.route('**/api/auth/session',route=>route.fulfill({status:503,json:{error:{code:'UNAVAILABLE'}}}));
  await page.goto('/work.html'); await expect(page.locator('#work-gate-retry')).toBeVisible();
  await expect(page.locator('#work-nav a')).toHaveCount(0);
  await page.unroute('**/api/auth/session'); await page.locator('#work-gate-retry').click();
  await expect(page.locator('#work-nav')).toContainText('คู่ความร่วมมือ');
});
test('public feedback validates category, retries with the same key and renders safe text', async ({page}) => {
  await fixture(page);
  const writes=[]; let rows=[];
  await page.route('**/api/public/partners/p1/feedback**',async route=>{
    const req=route.request();
    if(req.method()==='GET') return route.fulfill({json:{data:rows,page:{nextCursor:null}}});
    writes.push({body:req.postDataJSON(),headers:req.headers()});
    if(writes.length===1) return route.fulfill({status:503,json:{error:{code:'UNAVAILABLE'}}});
    rows=[{id:'f1',...req.postDataJSON(),occurredOn:'2026-11-08',likes:0,dislikes:0}];
    return route.fulfill({status:201,json:{data:rows[0]}});
  });
  await page.goto('/index.html');
  await page.locator('#tabCollab').click();
  await page.locator('#collaboratorGrid').getByRole('button', {name:'Alpha University', exact:true}).click();
  await page.locator('#detailModal').getByRole('tab', {name:'ความคิดเห็น', exact:true}).click();
  const form=page.locator('#detailModal .public-comment-composer');
  await form.getByRole('textbox').fill('<img src=x onerror=alert(1)> Useful feedback');
  await form.getByRole('button',{name:'ส่งความคิดเห็น'}).click();
  expect(writes).toHaveLength(0);
  await form.locator('select').selectOption('student');
  await form.getByRole('button',{name:'ส่งความคิดเห็น'}).click();
  await expect(form.getByRole('status')).toContainText('ส่งความคิดเห็นไม่ได้');
  await form.getByRole('button',{name:'ส่งความคิดเห็น'}).click();
  await expect(form.getByRole('status')).toContainText('ส่งความคิดเห็นแล้ว');
  expect(writes).toHaveLength(2);
  expect(writes[0].headers['idempotency-key']).toBe(writes[1].headers['idempotency-key']);
  expect(writes[1].headers['x-csrf-token']).toBe(csrfToken);
  await expect(page.locator('#detailModal .public-comment-list')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#detailModal .public-comment-list img')).toHaveCount(0);
  await expect(form.getByRole('textbox')).toHaveValue('');
});

test('clearing the search from empty results keeps dates, type and activity view', async ({page}) => {
  await fixture(page);
  await page.route('**/fetchPartnersData', route => route.fulfill({json:[
    {id:'p1', name:'Fixture University', type:'university', visibility:'public'},
    {id:'p2', name:'Fixture Company', type:'company', visibility:'public'},
    {id:'a1', title:'Research workshop (วันสมมติ)', type:'research', visibility:'public',
      partnerId:'p1', period_date:'2020-06-15'}
  ]}));
  await page.goto('/index.html#board-section');
  const input = page.locator('#searchInput');
  const clear = {name:'ล้างคำค้นหา', exact:true};
  await page.locator('#filterCollab').selectOption('university');
  await input.fill('no matching text');
  const collab = page.locator('#collaboratorGrid');
  await collab.getByRole('button',clear).focus();
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.locator('#filterCollab')).toBeFocused();
  await expect(collab).toContainText('Fixture University');
  await expect(collab).not.toContainText('Fixture Company');
  await expect(collab.getByRole('button',clear)).toHaveCount(0);

  await page.locator('#tabEvent').click();
  await page.locator('#filterEvent').selectOption('research');
  await page.locator('#filterEventDate').fill('2020-01-01');
  await page.locator('#filterEventDateEnd').fill('2020-12-31');
  await input.fill('workshop');
  const events = page.locator('#eventGrid');
  await events.getByRole('button',{name:/ดูกิจกรรมที่ผ่านมาแล้ว/}).click();
  await input.fill('no matching text');
  await events.getByRole('button',clear).click();
  await expect(input).toHaveValue('');
  await expect(page.locator('#filterEvent')).toHaveValue('research');
  await expect(page.locator('#filterEventDate')).toHaveValue('2020-01-01');
  await expect(page.locator('#filterEventDateEnd')).toHaveValue('2020-12-31');
  await expect(page.locator('#eventTimePast')).toHaveAttribute('aria-selected','true');
  await expect(events).toContainText('Research workshop');
  await expect(events.getByRole('button',clear)).toHaveCount(0);
});

test('clearing a search leaves the activity filter visible below the mobile header', async ({page}) => {
  await page.setViewportSize({width:320,height:707});
  await fixture(page);
  await page.route('**/fetchPartnersData', route => route.fulfill({json:[
    {id:'p1',name:'ชมรมตัวอย่าง',type:'university',visibility:'public'},
    {id:'a1',title:'วงวิจัยตัวอย่าง · วันสมมติ',type:'research',visibility:'public',
      partnerId:'p1',period_date:'2020-06-15'},
    {id:'a2',title:'เวทีตัวอย่าง · วันสมมติ',type:'research',visibility:'public',partnerId:'p1'}
  ]}));
  await page.goto('/index.html#board-section');
  await page.locator('#tabEvent').click();
  await page.locator('#eventTimePast').click();
  const filter = page.getByRole('combobox',{name:'ประเภทกิจกรรม'});
  await filter.selectOption('research');
  await page.locator('#filterEventDate').fill('2020-06-01');
  await page.locator('#filterEventDateEnd').fill('2020-06-30');
  await page.locator('#searchInput').fill('ไม่มีรายการสมมตินี้');

  const results = page.locator('#eventGrid');
  const clear = results.getByRole('button',{name:'ล้างคำค้นหา',exact:true});
  await expect(clear).toBeVisible();
  await clear.evaluate(button => button.scrollIntoView({block:'center',behavior:'instant'}));
  await clear.focus();
  await page.keyboard.press('Space');
  await expect(results.getByRole('button',{name:'วงวิจัยตัวอย่าง · วันสมมติ'})).toBeVisible();
  await expect(filter).toBeFocused();
  await expect.poll(() => filter.evaluate(select => {
    const bounds = select.getBoundingClientRect();
    const headerBottom = document.querySelector('.navbar').getBoundingClientRect().bottom;
    return bounds.top >= headerBottom && bounds.bottom <= window.innerHeight;
  })).toBe(true);
});
