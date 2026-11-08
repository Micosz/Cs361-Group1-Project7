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
      {id:'p1',name:'Alpha University',type:'University',visibility:'public',description:'Alpha collaboration'},
      {id:'p2',name:'Beta Company',type:'Company',visibility:'public',description:'Beta collaboration'}]});
    if(!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({path:url.pathname,method:req.method(),headers:req.headers(),body:req.postDataJSON()});
    if(url.pathname === '/api/auth/session') return route.fulfill({json:session()});
    if(url.pathname === '/api/auth/login') {
      if(failLogin) return route.fulfill({status:401,json:{error:{code:'INVALID_CREDENTIALS'}}});
      signedIn=true; return route.fulfill({json:session()});
    }
    if(url.pathname === '/api/auth/logout') {signedIn=false; return route.fulfill({json:{}});}
    if(url.pathname === '/api/public/records') return route.fulfill({json:[]});
    return route.fulfill({json:{data:[],items:[],nextCursor:null}});
  });
  return requests;
}
test('public catalog renders, searches, and opens detail in a real browser', async ({page}) => {
  await fixture(page); await page.goto('/index.html');
  const grid=page.locator('#collaboratorGrid');
  await expect(grid).toContainText('Alpha University'); await expect(grid).toContainText('Beta Company');
  await page.locator('#searchInput').fill('Alpha');
  await expect(grid).toContainText('Alpha University'); await expect(grid).not.toContainText('Beta Company');
  await grid.getByText('Alpha University').click();
  await expect(page.locator('#detailModal')).toBeVisible();
  await expect(page.locator('#modalName')).toContainText('Alpha University');
});
test('invalid login shows feedback, clears password, and sends CSRF', async ({page}) => {
  const requests=await fixture(page, null, true); await page.goto('/login.html');
  await page.locator('#student-id').fill('test-account'); await page.locator('#student-password').fill('dummy-password');
  await page.locator('#login-submit').click();
  await expect(page.locator('#login-status')).toContainText('ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง');
  await expect(page.locator('#student-password')).toHaveValue('');
  expect(requests.find(r=>r.path.endsWith('/login')).headers['x-csrf-token']).toBe(csrfToken);
});
test('successful student login returns to public home without storing credentials', async ({page}) => {
  await fixture(page); await page.goto('/login.html');
  await page.locator('#student-id').fill('test-account'); await page.locator('#student-password').fill('dummy-password');
  await page.locator('#login-submit').click(); await expect(page).toHaveURL(/index.html/);
  await expect(page.locator('#student-home-link')).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toMatch(/dummy-password|test-account/);
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
