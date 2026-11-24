const {test,expect}=require('@playwright/test');

const origin=process.env.CATEGORY_ORIGIN || 'http://127.0.0.1:4173';
const catalogue=[
    {id:'sample-host',name:'มหาวิทยาลัยคลองกลาง (สมมติ)',type:'university',visibility:'public',summary:'ตัวอย่างสำหรับทดสอบ'},
    {id:'sample-company',name:'บริษัทสมมติ',type:'company',visibility:'public'},
    {id:'sample-event',title:'กิจกรรมคลองกลาง · วันสมมติ',partnerId:'sample-host',type:'research',visibility:'public',summary:'ตัวอย่างสำหรับทดสอบ'},
];

async function mock(page,rows=catalogue) {
    await page.route('**/*',route=>{
        const r=route.request(),u=new URL(r.url());
        if(u.origin!==origin || r.method()!=='GET') return route.abort();
        if(u.pathname==='/fetchPartnersData') return route.fulfill({json:rows});
        if(u.pathname==='/api/public/records') return route.fulfill({json:[]});
        if(u.pathname==='/api/auth/session') return route.fulfill({json:{user:null,grants:[],capabilities:[],csrfToken:'a'.repeat(64)}});
        if(u.pathname.startsWith('/api/')) return route.fulfill({json:{data:[],items:[],count:0,page:{nextCursor:null}}});
        return route.continue();
    });
}

const painted=page=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(done)))));
// The animated desktop board receives the buttons before its smooth scroll finishes.
async function settledScroll(page) {
    await page.evaluate(()=>new Promise(done=>{
        let last=scrollY,still=0;
        const frame=()=>{
            still=scrollY===last ? still+1 : 0;
            last=scrollY;
            if(still>=5) done(); else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }));
}

async function shortList(page,hash=true) {
    await page.goto('about:blank');
    await page.goto(hash ? '/index.html#board-section' : '/index.html');
    if(await page.evaluate(()=>matchMedia('(min-width: 1024px) and (prefers-reduced-motion: no-preference)').matches)){
        await page.locator('#tabCollab').press('Enter');
        await expect(page.locator('.browse-board-slot #tabCollab')).toBeVisible();
    }
    await page.locator('#filterCollab').selectOption('university');
    await expect(page.locator('#collaboratorGrid .browse-card-open')).toHaveText(['มหาวิทยาลัยคลองกลาง (สมมติ)']);
}

// Sample inner points and the middle vertical line. For the failing mouse case,
// also count every CSS pixel centre inside each rectangular button bound.
async function targetGeometry(page,full=false) {
    return page.evaluate(full=>{
        const bar=document.querySelector('.browse-tabs');
        const phase=bar.closest('.browse-hero-slot')?'welcome':bar.closest('.browse-board-slot')?'board':'floating';
        const header=document.querySelector('.navbar').getBoundingClientRect();
        const buttons=[...bar.querySelectorAll('button.tab')].filter(b=>!b.hidden).map(b=>{
            const r=b.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
            const hit=(x,y)=>b.contains(document.elementFromPoint(x,y));
            const left=Math.ceil(r.left-.5),right=Math.ceil(r.right-.5),top=Math.ceil(r.top-.5),bottom=Math.ceil(r.bottom-.5);
            let centres=0,rows=0,pixels=0;
            for(const x of [.1,.3,.5,.7,.9]) for(const y of [.1,.3,.5,.7,.9]) {
                if(hit(r.left+x*r.width,r.top+y*r.height)) centres++;
            }
            for(let y=top;y<bottom;y++) {
                if(hit(cx,y+.5)) rows++;
                if(full) for(let x=left;x<right;x++) if(hit(x+.5,y+.5)) pixels++;
            }
            return {id:b.id,cx,cy,top:r.top,bottom:r.bottom,width:r.width,height:r.height,
                centres,rows,possibleRows:bottom-top,pixels:full?pixels:null,possiblePixels:full?(right-left)*(bottom-top):null};
        });
        return {phase,scrollY,headerBottom:header.bottom,buttons};
    },full);
}

async function attach(info,name,value) {
    await info.attach(name,{body:JSON.stringify(value),contentType:'application/json'});
}
async function pressAt(page,point,touch) {
    if(touch) await page.touchscreen.tap(point.cx,point.cy);
    else await page.mouse.click(point.cx,point.cy);
}

async function setPhase(page,phase) {
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await expect(page.locator('.browse-hero-slot .browse-tabs')).toBeVisible();
    await page.evaluate(()=>document.fonts.ready);
    await painted(page);
    if(phase==='welcome') return;
    const y=await page.evaluate(phase=>{
        const max=document.scrollingElement.scrollHeight-innerHeight;
        if(phase==='board') return max;
        if(document.body.classList.contains('scene-ready')){
            const travel=document.querySelector('.hero-scroll').offsetHeight-document.querySelector('.hero-section').offsetHeight;
            return Math.round(travel*.45);
        }
        const heroY=document.querySelector('.browse-hero-slot').getBoundingClientRect().top;
        const boardY=document.querySelector('.board-scene').getBoundingClientRect().top;
        const inset=document.querySelector('.navbar').getBoundingClientRect().bottom+12;
        return Math.max(0,Math.min(max,Math.round((heroY+boardY)/2-inset)));
    },phase);
    await page.evaluate(y=>window.scrollTo({top:y,behavior:'instant'}),y);
    await expect(page.locator(phase==='floating'?'.browse-tabs.browse-floating':'.browse-board-slot .browse-tabs')).toBeVisible();
    await painted(page);
}

for(const [width,height] of [[320,707],[390,844],[1280,800]]) {
    for(const touch of width===1280?[false]:[false,true]) for(const motion of ['reduce','no-preference']) {
        test.describe(width+' '+(touch?'touch':'mouse')+' '+motion,()=>{
            test.use({viewport:{width,height},hasTouch:touch,isMobile:touch,reducedMotion:motion,
                locale:'th-TH',timezoneId:'Asia/Bangkok',serviceWorkers:'block'});

            test('short filtered list after partner details close',async({page},info)=>{
                await mock(page);
                const full=width===320 && !touch && motion==='reduce';
                const attempts=[];
                let selected,photo;
                for(let attempt=0;attempt<(full?5:1);attempt++){
                    await shortList(page);
                    const card=page.locator('#sample-host');
                    const dialog=page.getByRole('dialog',{name:'มหาวิทยาลัยคลองกลาง (สมมติ)'});
                    const close=dialog.getByRole('button',{name:'ปิดรายละเอียด'});
                    await card.locator('.browse-card-open').press('Enter');
                    await expect(dialog).toBeVisible();
                    await painted(page);
                    await page.keyboard.press('Escape');
                    await expect(dialog).toBeHidden();
                    await painted(page);
                    if(touch) await card.locator('.card-desc').tap(); else await card.locator('.card-desc').click();
                    await expect(dialog).toBeVisible();
                    await painted(page);
                    if(touch) await close.tap(); else await close.click();
                    await expect(dialog).toBeHidden();
                    await painted(page);
                    const afterClose=await targetGeometry(page,full);
                    const capture=full ? await page.screenshot({animations:'disabled'}) : null;
                    await pressAt(page,afterClose.buttons.find(b=>b.id==='tabEvent'),touch);
                    await painted(page);
                    const activated=await page.locator('#tabEvent').getAttribute('aria-pressed',{timeout:1500}).catch(()=>null);
                    const record={afterClose,activated};
                    attempts.push(record);
                    if(!selected || afterClose.buttons[1].centres<selected.afterClose.buttons[1].centres){
                        selected=record;photo=capture;
                    }
                    if(activated==='true') await expect(page.locator('#eventGrid')).toContainText('กิจกรรมคลองกลาง');
                }
                if(photo) await info.attach('after-close',{body:photo,contentType:'image/png'});
                await attach(info,'after-close-hits',{...selected,attempts});
                expect(attempts.every(a=>a.afterClose.buttons.every(b=>b.centres===25))).toBe(true);
                expect(attempts.every(a=>a.activated==='true')).toBe(true);
            });

            test('Welcome, floating and board support pointer and keyboard',async({page},info)=>{
                await mock(page);
                const group=page.getByRole('group',{name:'เลือกหมวดข้อมูล'});
                const event=page.locator('#tabEvent'), partner=page.locator('#tabCollab');
                const samples=[];
                for(const method of ['pointer','keyboard']) for(const phase of ['welcome','floating','board']){
                    await shortList(page,false);
                    await setPhase(page,phase);
                    await expect(group).toHaveCount(1);
                    await expect(group.getByRole('button')).toHaveText(['COLLABORATOR','ACTIVITIES & MOU']);
                    const state=await targetGeometry(page);
                    expect(state.phase).toBe(phase);
                    expect(state.buttons.map(b=>b.centres)).toEqual([25,25]);
                    if(method==='keyboard'){
                        // Seed the start of the group without scrolling, then use actual Tab and activation keys.
                        await partner.evaluate(b=>b.focus({preventScroll:true}));
                        await page.keyboard.press('Tab');
                        await expect(event).toBeFocused();
                        await page.keyboard.press(phase==='floating'?'Space':'Enter');
                        await expect(event).toBeFocused();
                    } else await pressAt(page,state.buttons.find(b=>b.id==='tabEvent'),touch);
                    await expect(event).toHaveAttribute('aria-pressed','true');
                    await expect(page.locator('#eventGrid')).toContainText('กิจกรรมคลองกลาง');
                    await expect(page.locator('.browse-board-slot #tabEvent')).toBeVisible();
                    await settledScroll(page);
                    samples.push({method,phase,state});
                    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
                    await expect(page.locator('.browse-hero-slot #tabEvent')).toHaveAttribute('aria-pressed','true');
                }
                await shortList(page,false);
                await page.evaluate(()=>scrollTo({top:document.scrollingElement.scrollHeight,behavior:'instant'}));
                await painted(page);
                const bottom=await targetGeometry(page);
                await attach(info,'phase-hits',{samples,bottom});
                expect(bottom.phase).toBe('board');
                expect(bottom.buttons.every(b=>b.rows===b.possibleRows)).toBe(true);
            });
        });
    }
}

test.describe('long public list',()=>{
    test.use({viewport:{width:320,height:707},reducedMotion:'reduce'});
    test('a settled category bar scrolls away with the board',async({page})=>{
        const rows=Array.from({length:12},(_,i)=>({
            id:'fixture-'+i,name:'มหาวิทยาลัยสมมติ '+(i+1),type:'university',
            visibility:'public',summary:'ตัวอย่างสำหรับทดสอบ',
        }));
        await mock(page,rows);
        await page.goto('/index.html');
        await page.locator('#tabCollab').press('Enter');
        await expect(page.locator('.browse-board-slot #tabCollab')).toBeVisible();
        await expect(page.locator('#collaboratorGrid .browse-card-open')).toHaveCount(12);
        await page.evaluate(()=>scrollTo({top:document.scrollingElement.scrollHeight,behavior:'instant'}));
        await settledScroll(page);
        await expect(page.locator('#collaboratorGrid .browse-card-open').last()).toBeInViewport();
        const bottom=await targetGeometry(page);
        expect(bottom.phase).toBe('board');
        expect(bottom.buttons.every(b=>b.bottom<0)).toBe(true);
    });
});

test.describe('320 mouse with reduced motion',()=>{
    test.use({viewport:{width:320,height:707},reducedMotion:'reduce',hasTouch:false});
    test('keyboard can select a category immediately after closing partner details with a mouse',async({page},info)=>{
        await mock(page);
        await shortList(page);
        const card=page.locator('#sample-host'),dialog=page.getByRole('dialog',{name:'มหาวิทยาลัยคลองกลาง (สมมติ)'});
        await card.locator('.browse-card-open').press('Enter');
        await expect(dialog).toBeVisible();
        await painted(page);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await painted(page);
        await card.locator('.card-desc').click();
        await expect(dialog).toBeVisible();
        await painted(page);
        await dialog.getByRole('button',{name:'ปิดรายละเอียด'}).click();
        await expect(dialog).toBeHidden();
        await painted(page);
        const before=await targetGeometry(page);
        const current=()=>page.evaluate(()=>document.activeElement.id || document.activeElement.tagName);
        const initial=await current(),direction=initial==='BODY'?'Tab':'Shift+Tab';
        let presses=0;
        while(await current()!=='tabEvent' && presses<36){
            await page.keyboard.press(direction);
            presses++;
        }
        const event=page.locator('#tabEvent');
        await expect(event).toBeFocused();
        await page.keyboard.press('Space');
        await expect(event).toHaveAttribute('aria-pressed','true');
        await expect(event).toBeFocused();
        await expect(page.locator('#eventGrid')).toContainText('กิจกรรมคลองกลาง');
        await attach(info,'keyboard-after-close',{initial,direction,presses,before});
    });
});
