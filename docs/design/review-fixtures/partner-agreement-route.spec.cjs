const {test,expect}=require('@playwright/test');

const origin=process.env.ROUTE_ORIGIN || 'http://127.0.0.1:4173';
const day='2026-07-01T12:00:00+07:00';
const host='มหาวิทยาลัยคลองกลาง (สมมติ)';
const signing='พิธีลงนามคลองกลาง · วันสมมติ';
const workshop='ห้องเรียนวิจัยคลองกลาง · วันสมมติ';
const active='บันทึกคลองกลางด้านการเรียนรู้ (สมมติ)';
const expired='บันทึกคลองกลางด้านงานวิจัย (สมมติ)';
const organizations=[
    {id:'p-canal',name:host,type:'university'},
    {id:'p-hill',name:'มหาวิทยาลัยภูเขา (สมมติ)',type:'university'},
    {id:'p-firm',name:'บริษัทคลองกลาง (สมมติ)',type:'company'},
];
const events=[
    {id:'e-sign',title:signing,partnerId:'p-canal',type:'academic_activity',activity_tags:['mou'],period_date:'2026-06-20'},
    {id:'e-lab',title:workshop,partnerId:'p-canal',type:'research',period_date:'2026-07-15'},
    {id:'e-other',title:'ภาคสนามภูเขา · วันสมมติ',partnerId:'p-hill',type:'academic_activity',period_date:'2026-06-18'},
];
// Public agreement summaries have no organization or activity IDs.
const agreements=[
    {id:'ag-a',title:active,agreementType:'MoU',status:'active',startDate:'2026-06-01',endDate:'2026-08-31'},
    {id:'ag-b',title:expired,agreementType:'MoA',status:'expired',startDate:'2025-06-01',endDate:'2026-06-30'},
].map(row=>({...row,entityType:'agreement',publication:'public'}));

async function serve(page,{news=events,documents=agreements}={}) {
    const requests=[];
    const catalogue=[...organizations,...news].map(row=>({...row,visibility:'public',summary:'ข้อมูลสมมติสำหรับทดสอบ'}));
    await page.route('**/*',route=>{
        const req=route.request(), url=new URL(req.url()), path=url.pathname;
        if(url.origin!==origin || req.method()!=='GET') return route.abort();
        if(path==='/fetchPartnersData') return route.fulfill({json:catalogue});
        if(!path.startsWith('/api/')) return route.continue();
        requests.push(path+url.search);
        if(path==='/api/auth/session') return route.fulfill({json:{user:null,grants:[],capabilities:[],csrfToken:'a'.repeat(64)}});
        if(path==='/api/public/records') return route.fulfill({json:[]});
        if(path==='/api/public/agreements'){
            const q=(url.searchParams.get('q')||'').toLowerCase(), limit=Number(url.searchParams.get('limit')||20);
            const rows=documents.filter(a=>a.title.toLowerCase().includes(q)).sort((a,b)=>a.id.localeCompare(b.id));
            const start=Number(url.searchParams.get('cursor')||0), next=start+limit;
            return route.fulfill({json:{data:rows.slice(start,next),count:rows.length,page:{nextCursor:next<rows.length?String(next):null}}});
        }
        if(path.startsWith('/api/public/agreements/')){
            const record=documents.find(a=>path==='/api/public/agreements/'+a.id);
            return record?route.fulfill({json:{data:record}}):route.fulfill({status:404,json:{}});
        }
        if(path.startsWith('/api/public/') && path.endsWith('/feedback')) return route.fulfill({json:{data:[],count:0,page:{nextCursor:null}}});
        return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
    });
    await page.clock.setFixedTime(new Date(day));
    await page.goto('/index.html');
    await expect(page.getByRole('heading',{name:'Welcome to the Computer Science Community'})).toBeVisible();
    return requests;
}

async function activate(locator,touch) {
    if(touch) await locator.tap(); else await locator.click();
}
async function enterBoard(page,touch) {
    const welcome=page.locator('.browse-hero-slot #tabCollab');
    if(await welcome.count()){
        await activate(welcome,touch);
    } else {
        await activate(page.locator('.hero-btn[href="#board-section"]'),touch);
    }
    await expect(page.locator('#tabCollab')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#collaboratorGrid .browse-card-open:visible')).toHaveCount(3);
    await expect(page.locator('#tabExchange')).toBeHidden();
}

async function boardState(page) {
    return page.evaluate(()=>{
        const named=id=>document.getElementById(id), names=grid=>[...named(grid).querySelectorAll('.browse-card-open')].filter(el=>el.getClientRects().length).map(el=>el.textContent);
        return {category:document.querySelector('.tabs button[aria-pressed="true"]')?.id,
            query:named('searchInput').value,organization:named('filterCollab').value,type:named('filterEvent').value,
            period:document.querySelector('.event-time-tab[aria-selected="true"]')?.id,
            organizationCards:names('collaboratorGrid'),eventCards:names('eventGrid'),
            tabNames:['eventTimeCurrent','eventTimePast'].map(id=>named(id).textContent.trim()),
            url:location.pathname+location.search+location.hash,historyLength:history.length};
    });
}
const titles=page=>page.locator('#eventGrid .browse-card-open:visible');
async function selectMou(page,touch) {
    await activate(page.locator('#tabEvent'),touch);
    await expect(page.locator('#tabEvent')).toHaveAttribute('aria-pressed','true');
    await page.locator('#filterEvent').selectOption('mou');
}
async function close(page,dialog,touch) {
    if(touch) await activate(dialog.getByRole('button',{name:'ปิดรายละเอียด',exact:true}),true);
    else await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
}
const capture=(info,name,data)=>info.attach(name,{body:JSON.stringify(data),contentType:'application/json'});
function countIn(label) {
    const match=label.match(/\((\d+)\)/);return match?Number(match[1]):null;
}

for(const [width,height,touch] of [[390,844,true],[1280,800,false]]){
    test.describe(width+' CSS pixels',()=>{
        test.use({viewport:{width,height},hasTouch:touch,isMobile:touch,reducedMotion:'reduce',locale:'th-TH',timezoneId:'Asia/Bangkok',serviceWorkers:'block'});
        test('trace an organization to a signing story, then inspect public agreement summaries',async({page},info)=>{
            const requests=await serve(page);
            await enterBoard(page,touch);
            await page.locator('#filterCollab').selectOption('university');
            await page.locator('#searchInput').fill('คลองกลาง');
            await activate(page.getByRole('button',{name:'ค้นหา',exact:true}),touch);
            await expect(page.locator('#collaboratorGrid .browse-card-open:visible')).toHaveText([host]);
            const original=await boardState(page);
            const hostTitle=page.locator('#p-canal .browse-card-open');
            await activate(hostTitle,touch);
            const partner=page.getByRole('dialog',{name:host,exact:true});
            const history=partner.locator('.partner-history');
            await expect(history.getByRole('button')).toHaveText([workshop,signing]);
            expect(await partner.locator('a[href*="kind=agreements"]').count()).toBe(0);
            await activate(history.getByRole('button',{name:signing}),touch);
            const event=page.getByRole('dialog',{name:signing,exact:true});
            await expect(event).toBeVisible();
            await expect(event.getByRole('link',{name:host}).first()).toBeVisible();
            expect(await event.locator('a[href*="kind=agreements"]').count()).toBe(0);
            await close(page,event,touch);
            await expect(page.getByRole('dialog')).toHaveCount(0);
            expect(await boardState(page)).toEqual(original);
            const returnedToHost=await hostTitle.evaluate(el=>el===document.activeElement);
            await selectMou(page,touch);
            await expect(titles(page)).toHaveText([active]);
            const current=await boardState(page);
            await activate(page.locator('#eventTimePast'),touch);
            await expect(titles(page)).toHaveText([expired,signing]);
            const past=await boardState(page);
            const agreement=page.getByRole('button',{name:expired,exact:true});
            await activate(agreement,touch);
            const details=page.getByRole('dialog',{name:expired,exact:true});
            await expect(details).toBeVisible();
            await expect(details).toContainText('2026-06-30');
            expect(await details.locator('a[href*="kind=partners"],a[href*="kind=activities"]').count()).toBe(0);
            await close(page,details,touch);
            await expect(agreement).toBeFocused();
            expect(await boardState(page)).toEqual(past);
            expect(requests.some(url=>url.startsWith('/api/public/agreements?') && new URL(url,origin).searchParams.get('q')==='คลองกลาง')).toBe(true);
            expect(requests.filter(url=>/^\/api\/(partners|activities|agreements|exchanges)(\/|\?|$)/.test(url))).toEqual([]);
            await capture(info,'route',{original,returnedToHost,current,past,history:[workshop,signing]});
        });

        test('agreement-only results do not claim an empty period',async({page},info)=>{
            await serve(page,{news:events.filter(row=>!row.activity_tags)});
            await enterBoard(page,touch);
            await selectMou(page,touch);
            await expect(titles(page)).toHaveText([active]);
            const current=await boardState(page);
            await activate(page.locator('#eventTimePast'),touch);
            await expect(titles(page)).toHaveText([expired]);
            await page.locator('#eventTimePast').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
            const past=await boardState(page);
            if(width===390) await info.attach('agreement-with-tab',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
            await page.locator('#filterEvent').selectOption('research');
            await activate(page.locator('#eventTimeCurrent'),touch);
            await expect(titles(page)).toHaveText([workshop]);
            await expect(page.locator('#eventTimeCurrent')).toHaveAccessibleName(/ปัจจุบัน\s*\(1\)/);
            await expect(page.locator('#eventTimePast')).toHaveAccessibleName(/ผ่านมาแล้ว\s*\(0\)/);
            await capture(info,'period-labels',{current,past});
            for(const [visible,label] of [[current.eventCards,current.tabNames[0]],[past.eventCards,past.tabNames[1]]]){
                const count=countIn(label);
                expect(count===null||count===visible.length).toBe(true);
            }
        });
        test('the other-period shortcut leads to both a signing story and an agreement',async({page},info)=>{
            await serve(page,{documents:[agreements[1]]});
            await enterBoard(page,touch);
            await selectMou(page,touch);
            const shortcut=page.getByRole('button',{name:/ดู.*ที่ผ่านมาแล้ว/});
            await expect(shortcut).toBeVisible();
            const label=await shortcut.innerText();
            await activate(shortcut,touch);
            await expect(page.locator('#eventTimePast')).toHaveAttribute('aria-selected','true');
            await expect(titles(page)).toHaveText([expired,signing]);
            const rows=await titles(page).allTextContents();
            await capture(info,'other-period',{label,rows});
            const count=countIn(label);
            expect(count===null||count===rows.length).toBe(true);
        });

        test('the next public agreement page remains available on scroll',async({page},info)=>{
            const first=Array.from({length:20},(_,i)=>({...agreements[0],id:'ag-'+String(i).padStart(2,'0'),title:active+' '+i}));
            const documents=[...first,{...agreements[1],id:'ag-20'}];
            const requests=await serve(page,{documents});
            await enterBoard(page,touch);
            await selectMou(page,touch);
            await expect(titles(page)).toHaveCount(20);
            const listRequests=()=>requests.filter(path=>path.startsWith('/api/public/agreements?'));
            expect(listRequests().some(path=>new URL(path,origin).searchParams.has('cursor'))).toBe(false);
            const nextPage=page.waitForResponse(res=>{
                const url=new URL(res.url());
                return url.pathname==='/api/public/agreements' && url.searchParams.get('cursor')==='20';
            });
            await page.locator('#records-sentinel').scrollIntoViewIfNeeded();
            await nextPage;
            await expect(page.locator('#records-sentinel')).toHaveCount(0);
            await activate(page.locator('#eventTimePast'),touch);
            await expect(titles(page)).toHaveText([expired,signing]);
            const state=await boardState(page);
            await capture(info,'paginated',{listRequests:listRequests(),past:state});
            const count=countIn(state.tabNames[1]);
            expect(count===null||count===state.eventCards.length).toBe(true);
        });
        test('the catalogue signing story links back to its host and filtered list',async({page},info)=>{
            await serve(page);
            await enterBoard(page,touch);
            await page.locator('#filterCollab').selectOption('university');
            await page.locator('#searchInput').fill('คลองกลาง');
            await activate(page.getByRole('button',{name:'ค้นหา',exact:true}),touch);
            const hostButton=page.getByRole('button',{name:host,exact:true});
            await expect(page.locator('#collaboratorGrid .browse-card-open:visible')).toHaveText([host]);
            const original=await boardState(page);
            const position=()=>hostButton.evaluate(el=>{
                const rect=el.getBoundingClientRect();
                return {scrollY:window.scrollY,top:Math.round(rect.top),inView:rect.top>=0&&rect.bottom<=innerHeight,focused:el===document.activeElement};
            });
            await hostButton.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
            const before=await position();
            await activate(hostButton,touch);
            const partner=page.getByRole('dialog',{name:host,exact:true});
            await activate(partner.getByRole('button',{name:signing,exact:true}),touch);
            const article=page.getByRole('dialog',{name:signing,exact:true});
            const hostLink=article.getByRole('link',{name:host}).first();
            await expect(hostLink).toHaveAttribute('href','#partner-p-canal');
            await activate(hostLink,touch);
            await expect(partner.locator('.partner-history')).toBeVisible();
            await close(page,partner,touch);
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            expect(await boardState(page)).toEqual(original);
            const after=await position();
            expect(after.inView).toBe(true);
            const focused=()=>page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id}));
            const afterClose=await focused();
            await page.keyboard.press('Tab');
            await capture(info,'catalogue-return',{before,after,afterClose,afterTab:await focused(),query:original.query,category:original.category});
        });
    });
}
