const { test, expect } = require('@playwright/test');

const base = process.env.OPENER_ORIGIN || 'http://127.0.0.1:4173';
const partner = 'มหาวิทยาลัยคลองกลาง (สมมติ)';
const activity = 'เวทีคลองกลาง · วันสมมติ';
const summary = 'ข้อมูลสมมติสำหรับทดสอบการเปิดรายละเอียด';
const rows = [
    {id:'sample-host', name:partner, type:'university', visibility:'public', summary},
    {id:'sample-other', name:'มหาวิทยาลัยคลองเหนือ (สมมติ)', type:'university', visibility:'public', summary},
    {id:'sample-company', name:'บริษัทลานกลาง (สมมติ)', type:'company', visibility:'public', summary},
    {id:'sample-event', title:activity, partnerId:'sample-host', type:'research', period_date:'2026-07-05', visibility:'public', summary},
    {id:'extra-event', title:'เวทีสาธารณะ · วันสมมติ', partnerId:'sample-company', type:'academic_activity', period_date:'2026-07-07', visibility:'public', summary},
    {id:'other-event', title:'เวทีคลองเหนือ · วันสมมติ', partnerId:'sample-other', type:'research', period_date:'2026-07-06', visibility:'public', summary},
];
const kinds = {
    partner:{filter:'#filterCollab', value:'university', grid:'#collaboratorGrid', card:'#sample-host', name:partner},
    activity:{filter:'#filterEvent', value:'research', grid:'#eventGrid', card:'#sample-event', name:activity},
};

async function visit(page, kind) {
    await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== base || request.method() !== 'GET') return route.abort();
        if (url.pathname === '/fetchPartnersData') return route.fulfill({json:rows});
        if (url.pathname === '/api/auth/session') return route.fulfill({json:{user:null,grants:[],capabilities:[],csrfToken:'a'.repeat(64)}});
        if (url.pathname === '/api/public/records') return route.fulfill({json:[]});
        if (url.pathname.startsWith('/api/')) return route.fulfill({json:{data:[],items:[],count:0,page:{nextCursor:null}}});
        return route.continue();
    });
    await page.clock.setFixedTime(new Date('2026-07-01T12:00:00+07:00'));
    await page.goto('/index.html'+(kind==='activity'?'?kind=activities':'')+'#board-section');
    const k=kinds[kind];
    await expect(page.locator(k.grid+' .browse-card-open')).toHaveCount(3);
    await page.locator(k.filter).selectOption(k.value);
    await expect(page.locator(k.grid+' .browse-card-open')).toHaveCount(2);
}

async function settle(page) {
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
}

async function afterClose(page, k, original=null) {
    return page.evaluate(({k,original})=>{
        const a=document.activeElement, t=document.querySelector(k.card+' .browse-card-open');
        return {same:a===t && (!original || a===original), originalConnected:original?.isConnected, focused:a.id || a.closest('.card')?.id || a.tagName, filter:document.querySelector(k.filter).value,
            url:location.href, historyLength:history.length};
    },{k,original});
}

async function pressControl(page, locator, touch) {
    if (touch) await locator.tap();
    else await locator.click();
}

async function closeDetail(page, dialog, method, touch) {
    // A native dialog hides before its close event restores focus.
    const event=await dialog.evaluateHandle(el=>({done:el instanceof HTMLDialogElement
        ? new Promise(resolve=>el.addEventListener('close',()=>resolve(),{once:true})) : Promise.resolve()}));
    if (method==='escape') await page.keyboard.press('Escape');
    else await pressControl(page,dialog.getByRole('button',{name:'ปิดรายละเอียด',exact:true}),touch);
    await expect(dialog).toBeHidden();
    await event.evaluate(state=>state.done);
    await event.dispose();
    await settle(page);
}

for (const [width,height,touch] of [[320,707,true],[390,844,true],[1280,800,false]]) {
    test.describe(width+' CSS pixels',()=>{
        test.use({viewport:{width,height},hasTouch:touch,isMobile:touch,reducedMotion:'reduce',
            locale:'th-TH',timezoneId:'Asia/Bangkok',serviceWorkers:'block'});
        for (const [kind,k] of Object.entries(kinds)) {
            test(kind+' detail restores the card title for each opening and closing method',async({page},info)=>{
                await visit(page,kind);
                const filter=page.locator(k.filter), card=page.locator(k.card), title=card.locator('.browse-card-open');
                const dialog=page.getByRole('dialog',{name:k.name,exact:true});
                const reference=await afterClose(page,k);
                const results=[];
                for (const method of ['dom-click','enter','summary','pointer-title']) {
                    for (const close of ['escape','close-button']) {
                        await title.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
                        await filter.evaluate(el=>el.focus({preventScroll:true}));
                        await expect(filter).toBeFocused();
                        const original=await title.elementHandle();
                        if (method==='dom-click') {
                            // Record the focused element in the click handler before the application opens a dialog.
                            const during=await title.evaluate(el=>{
                                let focused;
                                el.addEventListener('click',()=>{focused=document.activeElement.id;},{capture:true,once:true});
                                el.click();
                                return focused;
                            });
                            expect('#'+during).toBe(k.filter);
                        } else if (method==='enter') {
                            await title.focus();
                            await page.keyboard.press('Enter');
                        } else {
                            await pressControl(page, method==='summary'?card.locator('.card-desc'):title,touch);
                        }
                        await expect(dialog).toBeVisible();
                        expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
                        await closeDetail(page,dialog,close,touch);
                        const state=await afterClose(page,k,original);
                        await original.dispose();
                        expect([state.filter,state.url,state.historyLength]).toEqual([k.value,reference.url,reference.historyLength]);
                        results.push({method,close,...state});
                        if (method==='dom-click' && close==='escape' && (width===390||width===1280)){
                            await info.attach('focus-after-close',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
                        }
                    }
                }
                await info.attach('focus-results',{body:JSON.stringify(results),contentType:'application/json'});
                expect(results.filter(row=>!row.same).map(r=>[r.method,r.close,r.focused])).toEqual([]);
            });
        }

        test('partner history opens a public activity then returns to the visible partner title',async({page},info)=>{
            await visit(page,'partner');
            const k=kinds.partner,filter=page.locator(k.filter),title=page.locator(k.card+' .browse-card-open');
            const hostDialog=page.getByRole('dialog',{name:partner,exact:true});
            const eventDialog=page.getByRole('dialog',{name:activity,exact:true});
            const reference=await afterClose(page,k),results=[];
            for (const entry of ['dom-click','pointer-title']) for (const close of ['escape','close-button']){
                await filter.focus();
                const original=await title.elementHandle();
                if(entry==='dom-click') await title.evaluate(button=>button.click());
                else await pressControl(page,title,touch);
                await expect(hostDialog).toBeVisible();
                const historyButton=hostDialog.locator('.partner-history').getByRole('button',{name:activity,exact:true});
                await pressControl(page,historyButton,touch);
                await expect(hostDialog).toBeHidden();
                await expect(eventDialog).toBeVisible();
                await expect(page.getByRole('dialog')).toHaveCount(1);
                await closeDetail(page,eventDialog,close,touch);
                const state=await afterClose(page,k,original);
                await original.dispose();
                expect([state.filter,state.url,state.historyLength]).toEqual([k.value,reference.url,reference.historyLength]);
                results.push({entry,close,...state});
            }
            await info.attach('history-results',{body:JSON.stringify(results),contentType:'application/json'});
            expect(results.filter(r=>!r.same).map(r=>[r.entry,r.close,r.focused])).toEqual([]);
        });
    });
}
