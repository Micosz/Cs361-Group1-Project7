/* The authenticated workspace owns this panel and clears it on account changes. */
(() => {
    'use strict';
    const byId = id => document.getElementById(id);
    const panel = byId('proposal-board');
    if (!panel) return;
    const form = byId('proposal-form');
    const dialog = byId('proposal-dialog');
    const internal = new Set(['coordinator', 'staff', 'executive']);
    const day = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit'
    }).format(date);
    const dateLabel = iso => new Intl.DateTimeFormat('th-TH', {
        day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Bangkok'
    }).format(new Date(iso.length === 10 ? iso + 'T12:00:00+07:00' : iso));
    const node = (tag, value, cls) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (value) el.textContent = value;
        return el;
    };
    // Match full names, including the surname. Never guess a person's identity by first name.
    const normalized = name => name.normalize('NFC').replace(/^(?:(?:ผศ\.|รศ\.|ศ\.|อ\.|ดร\.|คุณ|นาย|นางสาว|นาง|ว่าที่ร้อยเอก)\s*)+/u, '').replace(/\s+/g,'');
    const avatarNames = new Map(Object.entries(window.CstuProposalAvatars).map(([name,id]) => [normalized(name), id]));
    function avatar(name) {
        // Unmatched and demo accounts get a stable, unrelated cartoon from the original random set.
        const seed = Array.from(name).reduce((n,ch)=>(n*31+ch.codePointAt(0))>>>0,0);
        const fallback = ['demo','generic-2','generic-3','generic-4','generic-5','generic-6'];
        const id = avatarNames.get(normalized(name)) || fallback[seed % fallback.length];
        const img = node('img', '', 'proposal-avatar');
        img.alt = ''; img.src = 'resources/personnel-mock/' + id + '.png';
        return img;
    }
    const interestDialog = byId('proposal-interest-dialog');
    const interestForm = byId('proposal-interest-form');
    let interestTarget = null;
    let state = null;
    let generation = 0;
    function clear() {
        generation++;
        state = null;
        if (dialog.open) dialog.close();
        if (interestDialog.open) interestDialog.close();
        interestTarget = null;
        panel.hidden = true;
        byId('proposal-cards').replaceChildren();
        byId('proposal-status').textContent = '';
    }
    function personLine(name, subtitle) {
        const line = node('div','','proposal-person');
        const label = node('div'); label.append(node('strong',name));
        if (subtitle) label.append(node('small',subtitle));
        line.append(avatar(name),label);
        return line;
    }
    function participants(row,current) {
        if (Array.isArray(row.participants)) return row.participants;
        // Preserve browser samples and API rows created before notes were introduced.
        const ownIndex = row.mine ? row.interested.lastIndexOf(current.name) : -1;
        return row.interested.map((name,index)=>({name,note:'',mine:index===ownIndex}));
    }
    function openInterest(row,current) {
        interestTarget = {row,current};
        interestForm.reset();
        byId('proposal-interest-title').textContent = row.mine ? 'การร่วมดำเนินการของคุณ' : 'สนใจร่วมดำเนินการ';
        byId('proposal-interest-context').textContent = row.title;
        byId('proposal-interest-note').value = row.myNote || participants(row,current).find(p=>p.mine)?.note || '';
        byId('proposal-interest-status').textContent = '';
        byId('proposal-interest-withdraw').hidden = !row.mine;
        byId('proposal-interest-save').textContent = row.mine ? 'บันทึก' : 'ยืนยันเข้าร่วม';
        interestDialog.showModal();
    }
    async function saveInterest(join) {
        const target = interestTarget;
        if (!target || byId('proposal-interest-save').disabled) return;
        const {row,current} = target;
        const buttons = [...interestForm.querySelectorAll('button')];
        buttons.forEach(button=>{button.disabled=true;});
        try {
            const updated = await current.store.interest(row,join,byId('proposal-interest-note').value.trim());
            if (state !== current || interestTarget !== target) return;
            current.rows = current.rows.map(item=>item.id === updated.id ? updated : item);
            render(current);
            interestDialog.close();
            const trigger = [...byId('proposal-cards').querySelectorAll('[data-proposal-id]')]
                .find(button=>button.dataset.proposalId===row.id);
            trigger?.focus();
            byId('proposal-status').textContent = join ? (row.mine ? 'แก้ไขข้อมูลการร่วมดำเนินการแล้ว' : 'เพิ่มชื่อในรายชื่อผู้สนใจแล้ว') : 'ถอนความสนใจแล้ว';
        } catch (err) {
            if (state === current && interestTarget === target) byId('proposal-interest-status').textContent = 'บันทึกไม่ได้ · '+err.message;
        } finally { buttons.forEach(button=>{button.disabled=false;}); }
    }
    byId('proposal-interest-cancel').onclick=()=>interestDialog.close();
    interestDialog.addEventListener('close',()=>{interestTarget=null;});
    interestForm.onsubmit=event=>{event.preventDefault();saveInterest(true);};
    byId('proposal-interest-withdraw').onclick=()=>saveInterest(false);
    const isOpen = row => row.deadline >= day();
    function card(row, current) {
        const open = isOpen(row);
        const el = node('article','', 'proposal-card' + (open ? '' : ' closed'));
        const people = participants(row, current);
        el.append(personLine(row.creator, 'ผู้เสนอ · ' + dateLabel(row.createdAt)),
            node('h3',row.title), node('strong',row.partner), node('p',row.summary,'proposal-summary'),
            node('small',(open ? 'เปิดรับถึง ' : 'ปิดรับแล้ว · ') + dateLabel(row.deadline)));
        const footer = node('div','','proposal-foot');
        const list = node('ul','','proposal-list'); list.hidden = true;
        if (people.length) {
            const reveal = node('button','','proposal-stack proposal-people');
            reveal.type='button'; reveal.setAttribute('aria-expanded','false');
            for (const person of people.slice(0,3)) reveal.append(avatar(person.name));
            reveal.append(node('span',(people.length > 3 ? '+'+(people.length-3)+' · ' : '')+'สนใจ '+people.length+' คน'));
            for (const person of people) {
                const item = node('li');
                item.append(personLine(person.name, person.note));
                list.append(item);
            }
            reveal.onclick = () => { list.hidden = !list.hidden; reveal.setAttribute('aria-expanded',String(!list.hidden)); };
            footer.append(reveal);
        } else footer.append(node('small','ยังไม่มีผู้สนใจ'));
        if (open) {
            const toggle = node('button',row.mine ? '✓ สนใจแล้ว' : '+ สนใจร่วมดำเนินการ');
            toggle.type='button'; toggle.setAttribute('aria-pressed',String(row.mine));
            toggle.setAttribute('aria-label',row.mine ? 'แก้ไขการร่วมดำเนินการ '+row.title : 'สนใจร่วมดำเนินการ '+row.title);
            toggle.dataset.proposalId = row.id;
            toggle.onclick = () => openInterest(row,current);
            footer.append(toggle);
        }
        el.append(footer,list);
        return el;
    }
    function render(current) {
        const rows = current.rows;
        const count = rows.filter(isOpen).length;
        const label = 'เปิดรับความสนใจ '+count+' ข้อเสนอ';
        byId('proposal-count').textContent = label + (current.demo ? ' · ตัวอย่างในแท็บนี้' : '');
        const hint = byId('proposal-shortcut')?.querySelector('small');
        if (hint) hint.textContent = label;
        const shown = current.view === 'home' ? rows.slice(0,2) : rows;
        byId('proposal-cards').replaceChildren(...(shown.length ? shown.map(row=>card(row,current)) : [node('p','ยังไม่มีข้อเสนอในหลักสูตรของคุณ')]));
    }
    function apiStore() {
        const auth = window.CstuAuth;
        return {
            list: async () => (await auth.request('/proposals')).data,
            create: async (payload,key) => (await auth.create('/proposals',payload,key)).data,
            interest: async (row,interested,note = '') => {
                const fresh = await auth.refresh();
                if (!auth.isInternal(fresh)) throw Error('กรุณาเข้าสู่ระบบ');
                return (await auth.request('/proposals/'+encodeURIComponent(row.id)+'/interest',{
                    method:'PUT',headers:{'X-CSRF-Token':fresh.csrfToken},body:JSON.stringify({interested,note})
                })).data;
            }
        };
    }
    // A labelled sandbox for the preview branch while the shared Lambda has no board route.
    function sampleStore(current) {
        const key = 'cstu.proposal-demo.v1:'+JSON.stringify([current.session.user.id,current.scopes.slice().sort()]);
        const fixture = () => ({
            id:'example',scopeId:current.scopes[0],title:'ชวนออกแบบกิจกรรม AI กับ AGICAFET',partner:'AGICAFET',
            summary:'ตัวอย่างข้อเสนอสำหรับชวนอาจารย์ร่วมกำหนดหัวข้ออบรมและรูปแบบกิจกรรม',
            createdAt:new Date().toISOString(),deadline:day(new Date(Date.now()+7*86400000)),
            creator:'ผู้ประสานงานตัวอย่าง',interested:['อาจารย์ตัวอย่าง'],mine:false
        });
        const saved = sessionStorage.getItem(key);
        let rows = saved ? JSON.parse(saved) : [fixture()];
        const save = next => { sessionStorage.setItem(key,JSON.stringify(next)); rows=next; };
        if (!saved) save(rows);
        return {
            list:async()=>rows,
            create:async (payload,id)=>{
                const row={...payload,id,creator:current.name,createdAt:new Date().toISOString(),mine:false,interested:[]};
                save([row,...rows]); return row;
            },
            interest:async(row,join,note = '')=>{
                if (!isOpen(row)) throw Error('ปิดรับความสนใจแล้ว');
                const people = participants(row,current).filter(person=>!person.mine);
                if (join) people.push({name:current.name,note,mine:true});
                const updated={...row,participants:people,interested:people.map(p=>p.name),mine:join,myNote:join ? note : ''};
                save(rows.map(item=>item.id===row.id ? updated : item));return updated;
            }
        };
    }
    async function mount(session,view) {
        const run = generation;
        const scopes = [...new Set(session.grants.filter(g=>g.active!==false && internal.has(g.role)).map(g=>g.scopeId))];
        if (!scopes.length) return;
        const current = {session,scopes,view,name:session.user.displayName || 'ผู้ใช้งานภายใน',store:apiStore(),rows:[],demo:false};
        state = current;
        panel.hidden=false;
        byId('proposal-see-all').hidden=view!=='home';
        byId('proposal-new').disabled=true;
        byId('proposal-count').textContent='กำลังโหลดข้อเสนอ…';
        try {
            try { current.rows=await current.store.list(); }
            catch (err) {
                const preview = ['role-home.d1d0za87xu48iv.amplifyapp.com','localhost','127.0.0.1'].includes(location.hostname);
                if (!preview || err.status !== 404 || err.message !== 'NOT_FOUND') throw err;
                current.demo=true; current.store=sampleStore(current); current.rows=await current.store.list();
            }
            if (generation!==run || state!==current) return;
            byId('proposal-new').disabled=false;
            render(current);
        } catch(err) {
            if (generation!==run || state!==current) return;
            byId('proposal-count').textContent='โหลดกระดานไม่ได้';
            byId('proposal-status').textContent=err.message;
            const retry=node('button','ลองอีกครั้ง');retry.onclick=()=>{clear();mount(session,view);};
            byId('proposal-status').append(' ',retry);
        }
    }
    let postKey = '';
    byId('proposal-new').onclick = () => {
        if (!state) return;
        form.reset(); postKey=crypto.randomUUID();
        form.elements.scopeId.replaceChildren(...state.scopes.map(s=>new Option(s,s)));
        form.elements.deadline.min=day();
        form.elements.deadline.value=day(new Date(Date.now()+7*86400000));
        byId('proposal-author').textContent='ผู้เสนอ · '+state.name+(state.demo ? ' · ข้อมูลตัวอย่างเก็บในแท็บนี้' : '');
        byId('proposal-form-status').textContent='';
        dialog.showModal();
    };
    byId('proposal-cancel').onclick=()=>dialog.close();
    form.addEventListener('input',()=>{postKey=crypto.randomUUID();});
    form.onsubmit=async event=>{
        event.preventDefault();
        const current=state;
        if (!current) return;
        const payload=Object.fromEntries(new FormData(form));
        for (const k of ['title','partner','summary']) payload[k]=payload[k].trim();
        if (!payload.title || !payload.partner || !payload.summary) {
            byId('proposal-form-status').textContent='กรุณากรอกข้อมูลให้ครบ'; return;
        }
        const btn=form.querySelector('[type=submit]');
        if (btn.disabled) return;
        btn.disabled=true;
        try {
            const row=await current.store.create(payload,postKey);
            if (state!==current) return;
            current.rows=[row,...current.rows.filter(x=>x.id!==row.id)];
            render(current);dialog.close();
            byId('proposal-status').textContent='โพสต์ข้อเสนอแล้ว';
        } catch(err) {
            if (state===current) byId('proposal-form-status').textContent='โพสต์ไม่ได้ · '+err.message;
        } finally { btn.disabled=false; }
    };
    window.CstuProposals={mount,clear};
})();
