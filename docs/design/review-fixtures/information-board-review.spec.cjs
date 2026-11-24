// Copy this review fixture into tests/e2e of the temporary checkout described in the review notes.
const {test, expect} = require('@playwright/test');

const research = 'งานวิจัยและแลกเปลี่ยน';
const expectedTitles = ['วงวิจัยใต้ · วันสมมติ', 'วงวิจัยเหนือ · วันสมมติ'];
const archive = [
    ['south','วงวิจัยใต้','research','2026-06-18'],
    ['north','วงวิจัยเหนือ','research','2026-06-12'],
    ['earlier','วงวิจัยนอกช่วง','research','2026-05-12'],
    ['other','วงกิจกรรมวิชาการ','academic_activity','2026-06-13'],
    ['current','วงวิจัยต่อเนื่อง','research','2026-06-10','2026-07-05'],
    ['unknown','วงวิจัยรอวัน','research'],
];
const catalogue = [
    {id:'sample-partner',name:'ชมรมตัวอย่าง',type:'university',visibility:'public'},
    ...archive.map(([id,title,type,start,end]) => ({
        id, title:title+' · วันสมมติ', type, partnerId:'sample-partner', visibility:'public',
        summary:'กิจกรรมสำหรับการทดสอบ', period_date:start, period_end_date:end,
    })),
];

async function useSyntheticPage(page) {
    await page.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== 'http://127.0.0.1:4173' || request.method() !== 'GET') return route.abort();
        if (url.pathname === '/fetchPartnersData') return route.fulfill({json:catalogue});
        if (url.pathname === '/api/public/records') return route.fulfill({json:[]});
        if (url.pathname === '/api/auth/session') return route.fulfill({json:{
            user:null, grants:[], capabilities:[], csrfToken:'a'.repeat(64),
        }});
        if (url.pathname.startsWith('/api/')) return route.fulfill({json:{data:[],items:[],page:{nextCursor:null}}});
        return route.continue();
    });
    await page.clock.setFixedTime(new Date('2026-07-01T12:00:00+07:00'));
    await page.goto('/index.html');
    await expect(page.locator('#collaboratorGrid .card-title')).toHaveText(['ชมรมตัวอย่าง']);
}

async function tabTo(page, target, reverse=false) {
    for (let count=0; count<65; count++) {
        if (await target.evaluate(el => el === document.activeElement)) return;
        await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
    }
    throw new Error('Tab could not reach '+await target.getAttribute('id')+' from '+await page.evaluate(()=>document.activeElement.outerHTML.slice(0,100)));
}

async function chromiumNode(cdp, selector) {
    const {root}=await cdp.send('DOM.getDocument', {depth:0});
    const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
    const {node}=await cdp.send('DOM.describeNode',{nodeId});
    const {nodes}=await cdp.send('Accessibility.getPartialAXTree',{backendNodeId:node.backendNodeId,fetchRelatives:false});
    const ax=nodes.find(item=>item.backendDOMNodeId===node.backendNodeId);
    expect(ax?.ignored).toBe(false);
    const properties=Object.fromEntries((ax.properties||[]).map(p=>[p.name,p.value.value]));
    return {role:ax.role.value,name:ax.name.value,value:ax.value?.value,properties};
}

const devices = [
    {width:1280,height:800, keyboard:true, reducedMotion:'no-preference'},
    {width:1280,height:800, keyboard:false,reducedMotion:'reduce'},
    {width:390,height:844, keyboard:true, reducedMotion:'reduce'},
    {width:390,height:844, keyboard:false,reducedMotion:'no-preference'},
    {width:320,height:707, keyboard:true, reducedMotion:'reduce'},
    {width:320,height:707, keyboard:false,reducedMotion:'no-preference'},
];
for (const {width,height,keyboard,reducedMotion} of devices) {
    const mobile=width<600;
    const action=keyboard?'keyboard':mobile?'touch':'mouse';
    test.describe(width+' '+action, () => {
        test.use({viewport:{width,height}, isMobile:mobile, hasTouch:mobile, reducedMotion, timezoneId:'Asia/Bangkok', locale:'th-TH'});
        test('Welcome through cleared search', async ({page}, info) => {
            await useSyntheticPage(page);
            const activate=async (element,key,reverse=false) => {
                if (keyboard) { await tabTo(page,element,reverse); await page.keyboard.press(key); }
                else if (mobile) await element.tap();
                else await element.click();
            };
            const cdp=await page.context().newCDPSession(page);
            const group=page.getByRole('group',{name:'เลือกหมวดข้อมูล'});
            const category=group.getByRole('button',{name:'ACTIVITIES & MOU',exact:true});
            const past=page.getByRole('tab',{name:/^ผ่านมาแล้ว/});
            const type=page.getByRole('combobox',{name:'ประเภทกิจกรรม'});
            const input=page.locator('#searchInput');
            const grid=page.locator('#eventGrid');
            const clear=grid.getByRole('button',{name:'ล้างคำค้นหา',exact:true});
            const include=page.locator('#filterEventIncludeUndated');
            const dates=[['#filterEventDate','05/06/2569','2026-06-05'],['#filterEventDateEnd','20/06/2569','2026-06-20']];
            await expect(group).toHaveCount(1);
            await expect(group.getByRole('button')).toHaveText(['COLLABORATOR','ACTIVITIES & MOU']);
            await expect(page.locator('.browse-hero-slot #tabEvent')).toBeVisible();
            await activate(category,'Enter');
            await expect(page).toHaveURL(/#board-section$/);
            await expect(page.locator('.browse-board-slot #tabEvent')).toBeVisible();
            await expect(category).toHaveAttribute('aria-pressed','true');
            if (keyboard) await expect(category).toBeFocused();
            const categoryAX=await chromiumNode(cdp,'#tabEvent');
            expect(categoryAX.role).toBe('button');
            expect(String(categoryAX.properties.pressed)).toBe('true');
            await activate(past,'Space');
            await expect(past).toHaveAttribute('aria-selected','true');
            if (keyboard) { await tabTo(page,type,true); await page.keyboard.press('End'); }
            else await type.selectOption('research');
            await expect(type).toHaveValue('research');
            for (const [id,display,iso] of dates) {
                const field=page.locator(id+'Display');
                if (keyboard) await tabTo(page,field);
                await field.fill(display);
                await field.press('Tab');
                await expect(page.locator(id)).toHaveValue(iso);
            }
            if (!keyboard) await include.check();
            await expect(grid.locator('.card-title')).toHaveText(expectedTitles);
            const currentCount=keyboard?1:2;
            await expect(page.locator('#eventTimeCurrentCount')).toHaveText('('+currentCount+')');
            if (keyboard) await tabTo(page,input,true);
            await input.fill('ไม่มีรายการสมมตินี้');
            if (keyboard) await input.press('Enter');
            await expect(grid.getByRole('heading',{name:'ไม่พบกิจกรรมที่ผ่านมาแล้ว'})).toBeVisible();
            await expect(page.getByRole('button',{name:'ล้างคำค้นหา',exact:true})).toHaveCount(1);
            await expect(past).toHaveAccessibleName('ผ่านมาแล้ว (0)');
            if (keyboard) await tabTo(page,clear);
            const emptyAX=await chromiumNode(cdp,'#eventGrid [data-public-event-empty] button');
            expect(emptyAX.role).toBe('button');
            expect(emptyAX.name).toBe('ล้างคำค้นหา');
            if (keyboard) expect(emptyAX.properties.focused).toBe(true);
            await activate(clear,width===320?'Space':'Enter');
            await expect(input).toHaveValue('');
            await expect(clear).toHaveCount(0);
            await expect(type).toBeFocused();
            await expect(type).toHaveValue('research');
            for (const [id,display,iso] of dates) {
                await expect(page.locator(id)).toHaveValue(iso);
                await expect(page.locator(id+'Display')).toHaveValue(display);
            }
            if (keyboard) await expect(include).not.toBeChecked();
            else await expect(include).toBeChecked();
            await expect(category).toHaveAttribute('aria-pressed','true');
            await expect(past).toHaveAttribute('aria-selected','true');
            await expect(past).toHaveAccessibleName('ผ่านมาแล้ว (2)');
            await expect(page.locator('#eventTimeCurrentCount')).toHaveText('('+currentCount+')');
            await expect(grid.locator('.card-title')).toHaveText(expectedTitles);
            await expect(grid.locator('.event-date')).toHaveText(['18 มิ.ย. 69','12 มิ.ย. 69']);
            const focusAX=await chromiumNode(cdp,'#filterEvent');
            const pastAX=await chromiumNode(cdp,'#eventTimePast');
            expect([focusAX.role,focusAX.name,focusAX.value,focusAX.properties.focused]).toEqual(['combobox','ประเภทกิจกรรม',research,true]);
            expect([pastAX.role,pastAX.name,pastAX.properties.selected]).toEqual(['tab','ผ่านมาแล้ว (2)',true]);
            const tree=await grid.ariaSnapshot();
            for (const title of expectedTitles) expect(tree).toContain(title);
            await expect(page.locator('.browse-board-slot #tabEvent')).toBeVisible();
            await expect(group).toHaveCount(1);
            const readFocusPosition = () => type.evaluate(element => {
                const box = element.getBoundingClientRect();
                const header = document.querySelector('.navbar').getBoundingClientRect();
                const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                return {top:Math.round(box.top), bottom:Math.round(box.bottom), headerBottom:Math.round(header.bottom),
                    visible:box.top >= header.bottom && box.bottom <= innerHeight && element.contains(center)};
            });
            await expect.poll(async () => (await readFocusPosition()).visible).toBe(true);
            const position = await readFocusPosition();
            await info.attach('Chromium accessibility', {
                body:JSON.stringify({categoryAX, emptyAX, focusAX, pastAX, restored:tree, position}, null, 2),
                contentType:'application/json',
            });
        });
    });
}
