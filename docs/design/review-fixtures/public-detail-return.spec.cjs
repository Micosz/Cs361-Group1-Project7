const {test, expect} = require('@playwright/test');

const partners = [
    ['p-north','มหาวิทยาลัยคลองเหนือ','university'],
    ['p-mid','มหาวิทยาลัยคลองกลาง','university'],
    ['p-company','บริษัทคลองใต้','company'],
    ['p-old','มหาวิทยาลัยคลองนอกช่วง','university'],
    ['p-hill','มหาวิทยาลัยภูเขา','university'],
];
const activities = [
    ['a-north','ห้องวิจัยคลองเหนือ','p-north','research','2026-06-18'],
    ['a-mid','ห้องวิจัยคลองกลาง','p-mid','research','2026-06-12'],
    ['a-other','เวทีคลองใต้','p-company','academic_activity','2026-06-14'],
    ['a-old','ห้องวิจัยคลองนอกช่วง','p-old','research','2026-05-12'],
    ['a-hill','ห้องวิจัยภูเขา','p-hill','research','2026-06-13'],
];
const summary = 'รายการสมมติสำหรับทดสอบการเปิดรายละเอียด';
const catalogue = [
    ...partners.map(([id,name,type]) => ({id,name:name+' (สมมติ)',type,visibility:'public',summary})),
    ...activities.map(([id,title,partnerId,type,period_date]) => ({
        id,title:title+' · วันสมมติ',partnerId,type,period_date,visibility:'public',summary,
    })),
];
const sections = {
    partner:{tab:'tabCollab',grid:'collaboratorGrid',prefix:'filterCollab',type:'university',
        title:'มหาวิทยาลัยคลองกลาง (สมมติ)',id:'p-mid'},
    activity:{tab:'tabEvent',grid:'eventGrid',prefix:'filterEvent',type:'research',
        title:'ห้องวิจัยคลองกลาง · วันสมมติ',id:'a-mid'},
};

async function visit(page) {
    await page.route('**/*', route => {
        const request=route.request(), url=new URL(request.url());
        if (url.origin!=='http://127.0.0.1:4173' || request.method()!=='GET') return route.abort();
        if (url.pathname==='/review-origin') return route.fulfill({contentType:'text/html', body:'<title>Fixture start</title>'});
        if (url.pathname==='/fetchPartnersData') return route.fulfill({json:catalogue});
        if (url.pathname==='/api/public/records') return route.fulfill({json:[]});
        if (url.pathname==='/api/auth/session') return route.fulfill({json:{user:null,grants:[],capabilities:[],csrfToken:'a'.repeat(64)}});
        if (url.pathname.startsWith('/api/')) return route.fulfill({json:{data:[],items:[],comments:[],count:0,page:{nextCursor:null}}});
        return route.continue();
    });
    await page.clock.setFixedTime(new Date('2026-07-01T12:00:00+07:00'));
    await page.goto('/review-origin');
    await page.goto('/index.html#board-section');
    await expect(page.locator('#collaboratorGrid .browse-card-open')).toHaveCount(5);
}

async function filter(page, section) {
    const s=sections[section];
    await page.locator('#'+s.tab).click();
    if (section==='activity') await page.locator('#eventTimePast').click();
    await page.locator('#'+s.prefix).selectOption(s.type);
    for (const [suffix,value] of [['Date','05/06/2569'],['DateEnd','20/06/2569']]) {
        const display=page.locator('#'+s.prefix+suffix+'Display');
        await display.fill(value);
        await display.press('Tab');
    }
    const matches=page.locator('#'+s.grid+' .browse-card-open');
    await expect(matches).toHaveCount(3);
    const search=page.locator('#searchInput');
    await search.fill('คลอง');
    await page.getByRole('button',{name:'ค้นหา',exact:true}).click();
    await expect(matches).toHaveCount(2);
    await expect(page.locator('#home-records')).toBeHidden();
    const card=page.locator('#'+s.id);
    await expect(card.locator('.browse-card-open')).toHaveAccessibleName(s.title);
    return card;
}

async function tabTo(page, element) {
    for (let step=0;step<60;step++) {
        if (await element.evaluate(el=>el===document.activeElement)) return;
        await page.keyboard.press('Tab');
    }
    throw new Error('Tab did not reach the control');
}

async function listState(page, s) {
    return page.evaluate(({tab,grid,prefix}) => {
        const get=id=>document.getElementById(id);
        return {
            tab:get(tab).getAttribute('aria-pressed'), keyword:get('searchInput').value, type:get(prefix).value,
            start:get(prefix+'Date').value,end:get(prefix+'DateEnd').value,
            past:get('eventTimePast').getAttribute('aria-selected'),
            ids:[...get(grid).querySelectorAll('.card')].map(card=>card.id),
            href:location.href, historyLength:history.length,
        };
    },s);
}

async function openPointer(element, mobile) {
    if (mobile) await element.tap();
    else await element.click();
}

for (const [width,height] of [[320,707],[390,844],[1280,800]]) {
    const mobile=width<600;
    test.describe(width+' pixels', () => {
        test.use({viewport:{width,height}, isMobile:mobile, hasTouch:mobile, reducedMotion:'reduce',
            timezoneId:'Asia/Bangkok',locale:'th-TH',serviceWorkers:'block'});
        test('partner dialog keyboard boundary',async ({page}, info) => {
            await visit(page);
            const card=await filter(page,'partner');
            const title=card.locator('.browse-card-open');
            await tabTo(page,title);
            await page.keyboard.press('Enter');
            const dialog=page.getByRole('dialog',{name:sections.partner.title});
            await expect(dialog).toBeVisible();
            const position=()=>dialog.evaluate(el=>{
                const a=document.activeElement;
                return {inside:el.contains(a),tag:a.tagName,id:a.id,cls:a.className,label:a.getAttribute('aria-label')};
            });
            const states=[await position()];
            for (const key of ['Tab','Shift+Tab','Escape']) {
                await page.keyboard.press(key);
                if (await dialog.isVisible()) states.push({key,...await position()});
            }
            await info.attach('keyboard-boundary',{body:JSON.stringify(states),contentType:'application/json'});
            if (width===390) {
                await info.attach('keyboard-outcome',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
            }
            expect(states.filter(s=>s.key==='Tab'||s.key==='Shift+Tab').every(s=>s.inside)).toBe(true);
            await expect(dialog).toBeHidden();
            await expect(title).toBeFocused();
        });
        for (const [section,s] of Object.entries(sections)) {
            test(section+' list to detail and back',async ({page},info) => {
                await visit(page);
                const card=await filter(page,section);
                const title=card.locator('.browse-card-open');
                const dialog=page.getByRole('dialog',{name:s.title,exact:true});
                const initial=await listState(page,s);
                expect(initial).toMatchObject({keyword:'คลอง',type:s.type,start:'2026-06-05',end:'2026-06-20',tab:'true'});
                expect(initial.ids[1]).toBe(s.id);
                if (section==='activity') expect(initial.past).toBe('true');
                const rows=[];
                for (const [target,close] of [['keyboard','escape'],['title','button'],['summary','button'],['summary','escape']]) {
                    if (target==='keyboard') await tabTo(page,title);
                    await title.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
                    const start=await page.evaluate(()=>scrollY);
                    if (target==='keyboard') await page.keyboard.press('Enter');
                    else await openPointer(target==='title'?title:card.locator('.card-desc'),mobile);
                    await expect(dialog).toBeVisible();
                    const entryFocus=await dialog.evaluate(el=>el.contains(document.activeElement));
                    expect(entryFocus).toBe(true);
                    const closeButton=dialog.getByRole('button',{name:'ปิดรายละเอียด',exact:true});
                    await expect(closeButton).toBeVisible();
                    const dialogUrl=page.url(), entries=await page.evaluate(()=>history.length);
                    expect([dialogUrl,entries]).toEqual([initial.href,initial.historyLength]);
                    if (close==='escape') await page.keyboard.press('Escape');
                    else await openPointer(closeButton,mobile);
                    await expect(dialog).toBeHidden();
                    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
                    if (width===390 && target==='summary' && close==='escape')
                        await info.attach('returned-focus',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
                    const result=await title.evaluate(el=>{
                        const rect=el.getBoundingClientRect();
                        const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
                        return {focus:document.activeElement===el,activeTag:document.activeElement.tagName,
                            activeId:document.activeElement.id,visible:el.contains(hit),scrollY};
                    });
                    expect(await listState(page,s)).toEqual(initial);
                    expect(result.visible).toBe(true);
                    const scrollDelta=result.scrollY-start;
                    expect(Math.abs(scrollDelta)).toBeLessThanOrEqual(2);
                    await page.keyboard.press('Tab');
                    const next=await page.evaluate(()=>({tag:document.activeElement.tagName,
                        label:document.activeElement.textContent.trim().slice(0,70),id:document.activeElement.id}));
                    rows.push({target,close,entryFocus,...result,scrollDelta,next});
                }
                await info.attach('observations',{body:JSON.stringify({width,section,initial,rows},null,2),contentType:'application/json'});
                expect(rows.filter(row=>row.focus).map(row=>[row.target,row.close])).toEqual([
                    ['keyboard','escape'],['title','button'],['summary','button'],['summary','escape'],
                ]);
            });
        }
    });
}

test('Back from a detail reached by direct board entry follows browser history', async ({page}) => {
    await visit(page);
    const card=await filter(page,'partner');
    await card.locator('.browse-card-open').click();
    await expect(page.getByRole('dialog',{name:sections.partner.title})).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/review-origin$/);
    await expect(page).toHaveTitle('Fixture start');
});

test('Back after the Welcome link follows the board anchor', async ({page}) => {
    await visit(page);
    await page.goto('/index.html');
    const category=page.locator('.browse-hero-slot #tabCollab');
    if (await category.count()) await category.click();
    else await page.locator('a.hero-btn[href="#board-section"]').click();
    await expect(page).toHaveURL(/#board-section$/);
    const card=await filter(page,'partner');
    await card.locator('.browse-card-open').click();
    const dialog=page.getByRole('dialog',{name:sections.partner.title});
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/index\.html$/);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
});
