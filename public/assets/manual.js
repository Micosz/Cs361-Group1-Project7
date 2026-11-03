/* Read-only help overlay. Never navigates or touches the underlying form. */
(() => {
    'use strict';
    const assetBase = new URL('.', document.currentScript.src);
    const labels = {public:'ผู้ใช้ทั่วไป', account:'บัญชีที่เข้าสู่ระบบ', student:'นักศึกษา', coordinator:'อาจารย์ / ผู้ประสานงาน', staff:'ผู้ช่วยดูแลข้อมูล', executive:'ผู้ดูแลความร่วมมือ', manager:'ผู้จัดการสิทธิ์'};
    const node = (tag, text, cls) => { const el=document.createElement(tag); if(text)el.textContent=text;if(cls)el.className=cls;return el; };
    let data, pending, modal, viewer, trigger, returnFocus, scroll, overflow, currentGuide, scrollPositions=[], generation=0;
    const embedded = window.parent !== window;
    function available() {
        const s=window.CstuAuth?.state?.(), roles=['public'];
        if(s?.user){roles.push('account');for(const g of s.grants||[])if(g.active!==false && labels[g.role])roles.push(g.role);
            if(window.CstuAuth?.managedScopes?.(s)?.length)roles.push('manager');}
        return [...new Set(roles)];
    }
    function button(context=false) {
        const b=node('button',context?'?':'? คู่มือ','manual-trigger'+(context?' manual-context-trigger':' manual-labelled-trigger'));b.type='button';b.title='คู่มือการใช้งาน';b.setAttribute('aria-label','เปิดคู่มือการใช้งาน');b.setAttribute('aria-haspopup','dialog');
        return b;
    }
    function contextGuide(source, doc=document) {
        const visible = el => el && el.getClientRects().length && !el.closest('[hidden]');
        const dialogs = [...doc.querySelectorAll('dialog[open], #detailModal .modal-content[role="dialog"]')].filter(el=>visible(el)&&!el.matches('.manual-dialog,.manual-image-dialog'));
        const root = source?.closest?.('dialog[open], [role="dialog"]') || dialogs.at(-1) || doc;
        const find = selector => [...root.querySelectorAll(selector)].find(visible);
        for(const frame of root.querySelectorAll('iframe')) {
            try { if(visible(frame) && frame.contentDocument) { const guide=contextGuide(null,frame.contentDocument);if(guide)return guide; } } catch { /* Cross-origin help falls back to this page. */ }
        }
        const editing = /แก้ไข/.test(root.querySelector('h2')?.textContent || '');
        if(find('#role-form'))return 'roles';
        if(find('#partner-entry-form'))return root.querySelector('#basic-partners-scope')?.disabled?'edit-partner':'create-partner';
        if(find('#activity-form'))return doc.getElementById('activity-id')?.value?'activity-outcome':'create-activity';
        if(find('#exchange-form'))return doc.getElementById('exchange-id')?.value?'edit-exchange':'create-exchange';
        if(find('#agreement-edit-form'))return editing?'edit-agreement':'create-agreement';
        if(find('#login-form'))return 'login';
        if(find('#my-exchange-detail-container'))return 'exchange-read';
        if(doc.body.classList.contains('feedback-inbox-view'))return 'feedback-inbox';
        if(doc.querySelector('#board-overview[aria-pressed="true"]'))return 'overview';
        if(doc.querySelector('#tabExchange[aria-pressed="true"]'))return 'exchange-read';
        return null;
    }
    function rememberScroll(doc=document) {
        const positions=[...doc.querySelectorAll('*')].filter(el=>!el.closest('.manual-dialog,.manual-image-dialog') && (el.scrollTop||el.scrollLeft)).map(el=>[el,el.scrollLeft,el.scrollTop]);
        for(const frame of doc.querySelectorAll('iframe')){try{if(frame.contentDocument)positions.push(...rememberScroll(frame.contentDocument));}catch{}}
        return positions;
    }
    function close() { if(viewer?.open)viewer.close(); if(modal?.open)modal.close(); }
    function figure(step, large=false) {
        const f=node('figure',null,'manual-figure'), wrap=node('div',null,'manual-image-wrap');
        const img=node('img');img.src=new URL('../resources/manual/'+step.image,assetBase).href;img.alt=step.alt||step.title;img.loading=large?'eager':'lazy';img.decoding='async';img.addEventListener('error',()=>{wrap.replaceChildren(node('p','โหลดภาพไม่ได้ ลองปิดแล้วเปิดคู่มือใหม่ ข้อความขั้นตอนยังอ่านได้','manual-image-error'));});wrap.append(img);
        if(step.highlight){const [x,y,w,h]=step.highlight;const ring=node('span',null,'manual-highlight');ring.style.cssText=`left:${x}%;top:${y}%;width:${w}%;height:${h}%`;ring.setAttribute('aria-hidden','true');wrap.append(ring);}
        f.append(wrap);
        if(!large){const zoom=node('button','ขยายภาพ','manual-zoom');zoom.type='button';zoom.onclick=()=>{
            viewer.replaceChildren();const c=node('button','ปิดภาพ ×','manual-close');c.type='button';c.onclick=()=>viewer.close();viewer.append(c,figure(step,true));viewer.showModal();};f.append(zoom);}
        return f;
    }
    function build() {
        if(modal)return;
        modal=node('dialog',null,'manual-dialog');modal.id='cstu-manual';modal.setAttribute('aria-labelledby','manual-title');
        const head=node('header',null,'manual-header'), title=node('h2','คู่มือการใช้งาน');title.id='manual-title';
        const c=node('button','ปิดคู่มือ ×','manual-close');c.type='button';c.onclick=close;head.append(title,c);
        const layout=node('div',null,'manual-layout'), nav=node('nav',null,'manual-sidebar');nav.setAttribute('aria-label','สารบัญคู่มือ');
        const roleLabel=node('label','คู่มือสำหรับ'), role=node('select');role.id='manual-role';roleLabel.append(role);
        const searchLabel=node('label','ค้นหาฟีเจอร์'), search=node('input');search.type='search';search.id='manual-search';search.placeholder='เช่น แนบไฟล์ หรือ Feedback';searchLabel.append(search);
        const count=node('p',null,'manual-count');count.id='manual-count';count.setAttribute('role','status');
        const toc=node('div');toc.id='manual-toc';nav.append(roleLabel,searchLabel,count,toc);
        const content=node('main',null,'manual-content');content.id='manual-content';content.tabIndex=0;
        layout.append(nav,content);modal.append(head,layout);document.body.append(modal);
        viewer=node('dialog',null,'manual-image-dialog');viewer.setAttribute('aria-label','ภาพคู่มือขนาดใหญ่');document.body.append(viewer);
        for(const d of [modal,viewer]){d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();d.close();}});d.addEventListener('cancel',e=>{e.preventDefault();d.close();});}
        modal.addEventListener('close',()=>{++generation;if(viewer.open)viewer.close();document.body.style.overflow=overflow;returnFocus?.isConnected&&returnFocus.focus({preventScroll:true});for(const [el,x,y] of scrollPositions)if(el.isConnected){el.scrollLeft=x;el.scrollTop=y;}if(scroll)window.scrollTo({left:scroll.x,top:scroll.y,behavior:'instant'});});
        role.onchange=()=>draw();search.addEventListener('input',()=>draw());
    }
    function draw() {
        const allowed=available(), select=modal.querySelector('#manual-role'), q=modal.querySelector('#manual-search').value.trim().toLocaleLowerCase();
        const role=allowed.includes(select.value)?select.value:'public';
        const guides=data.guides.filter(g=>g.roles.includes(role) && (!q||[g.title,g.category,...g.steps.map(s=>s.text)].join(' ').toLocaleLowerCase().includes(q)));
        const toc=modal.querySelector('#manual-toc');toc.replaceChildren();modal.querySelector('#manual-count').textContent=`พบ ${guides.length} ฟีเจอร์`;
        let category='';for(const g of guides){if(g.category!==category){category=g.category;toc.append(node('h3',category));}const b=node('button',g.title);b.type='button';b.dataset.guide=g.id;b.onclick=()=>show(g);toc.append(b);}
        const selected=guides.find(g=>g.id===currentGuide)||guides[0];if(selected)show(selected);else modal.querySelector('#manual-content').replaceChildren(node('p','ไม่พบคู่มือ ลองเปลี่ยนคำค้นหรือเลือกบทบาทอื่นที่คุณมี'));
    }
    function show(g) {
        currentGuide=g.id;for(const b of modal.querySelectorAll('[data-guide]')){b.setAttribute('aria-current',String(b.dataset.guide===g.id));}
        const host=modal.querySelector('#manual-content');host.replaceChildren(node('p',g.category,'manual-eyebrow'),node('h2',g.title));
        if(g.note)host.append(node('p',g.note,'manual-note'));
        g.steps.forEach((s,i)=>{const section=node('section',null,'manual-step');section.append(node('h3',`${i+1}. ${s.title}`),figure(s),node('p',s.text));host.append(section);});
        host.append(node('p','สิทธิ์ขึ้นกับบทบาท ขอบเขต และงานที่ได้รับมอบหมาย ภาพประกอบถ่ายจากเว็บจริง ชื่อรายการอาจต่างจากข้อมูลของคุณ','manual-caption'));host.scrollTop=0;
    }
    async function open(source) {
        build();if(modal.open)return;
        const suggested=contextGuide(source);
        returnFocus=source||document.activeElement;scrollPositions=rememberScroll();scroll={x:window.scrollX,y:window.scrollY};overflow=document.body.style.overflow;document.body.style.overflow='hidden';modal.showModal();
        const run=++generation,host=modal.querySelector('#manual-content');host.replaceChildren(node('p','กำลังโหลดคู่มือ…'));modal.querySelector('#manual-toc').replaceChildren();
        try {if(!data){pending ||= fetch(new URL('manual-data.json',assetBase)).then(r=>{if(!r.ok)throw Error();return r.json();}).finally(()=>pending=null);data=await pending;}
            if(run!==generation||!modal.open)return;
            const roles=available(),select=modal.querySelector('#manual-role'),previous=select.value;select.replaceChildren();for(const key of roles){const o=node('option',labels[key]);o.value=key;select.append(o);}select.value=roles.includes(previous)?previous:['executive','staff','coordinator','student','manager','account','public'].find(r=>roles.includes(r));
            const guide=data.guides.find(g=>g.id===suggested && g.roles.some(r=>roles.includes(r)));
            if(guide){currentGuide=guide.id;modal.querySelector('#manual-search').value='';if(!guide.roles.includes(select.value))select.value=roles.find(r=>guide.roles.includes(r));}
            draw();
        } catch {if(run!==generation||!modal.open)return;const retry=node('button','ลองโหลดคู่มืออีกครั้ง');retry.onclick=()=>{modal.addEventListener('close',()=>open(source),{once:true});close();};host.replaceChildren(node('p','โหลดคู่มือไม่ได้ ข้อมูลในหน้าที่ทำงานอยู่ยังคงเดิม'),retry);}
    }
    // Delegate so help also survives host dialogs rebuilding their children.
    document.addEventListener('click',e=>{const b=e.target.closest?.('.manual-trigger');if(!b)return;e.preventDefault();e.stopPropagation();if(embedded)window.parent.postMessage({type:'cstu-manual-open'},location.origin);else open(b);},true);
    if(!embedded){
        // The main header renders help in HTML so all controls enter on one timeline.
        trigger=document.querySelector('.navbar > .manual-trigger');
        if(!trigger){trigger=button();const auth=document.getElementById('authNavButtons');if(auth)auth.before(trigger);else {trigger.classList.add('manual-floating-trigger');document.body.append(trigger);}}
    }
    // Keep help within the top modal; use its existing toolbar when available.
    const addContext=()=>{
        if(embedded)return;
        for(const d of document.querySelectorAll('dialog[open], #detailModal .modal-content[role="dialog"]')){
            if(d===modal||d===viewer||d.querySelector('.manual-context-trigger'))continue;
            const b=button(true),bar=d.querySelector('.detail-toolbar,.role-menu-account-area');
            if(bar){b.classList.add('manual-toolbar-trigger');bar.insertBefore(b,bar.lastElementChild);}
            else d.prepend(b);
        }
    };
    const observer=new MutationObserver(addContext);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','role']});addContext();
    window.addEventListener('message',e=>{if(!embedded&&e.origin===location.origin&&e.data?.type==='cstu-manual-open'&&[...document.querySelectorAll('iframe')].some(f=>f.contentWindow===e.source))open(document.activeElement);});
    document.addEventListener('keydown',e=>{if(e.key==='F1'){e.preventDefault();if(embedded)window.parent.postMessage({type:'cstu-manual-open'},location.origin);else open(document.activeElement);}});
    window.addEventListener('authchange',()=>{data && modal?.open && close();});
    window.CstuManual={open:()=>open(document.activeElement)};
})();
