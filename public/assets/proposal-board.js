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
    const flow = window.CstuProposalFlow;
    const flowDialog = byId('proposal-flow-dialog');
    let flowTarget = null;
    let editingRow = null;
    let interestTarget = null;
    let state = null;
    let generation = 0;
    function clear() {
        generation++;
        state = null;
        if (dialog.open) dialog.close();
        if (interestDialog.open) interestDialog.close();
        interestTarget = null;
        if (flowDialog.open) flowDialog.close();
        flowTarget = null; editingRow = null;
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
    function openWorkflow(row,current) {
        flowTarget={row,current};
        byId('proposal-flow-note').value='';
        renderWorkflow();
        flowDialog.showModal();
    }
    function renderWorkflow() {
        const {row,current}=flowTarget;
        byId('proposal-flow-title').textContent=row.title;
        const active = row.status === 'changes' ? 'review' : row.status;
        const position = flow.steps.indexOf(active);
        byId('proposal-flow-steps').replaceChildren(...flow.steps.map((step,index)=>{
            const item=node('li',flow.labels[step]);
            if (step===active) item.setAttribute('aria-current','step');
            if (position>index) item.className='complete';
            return item;
        }));
        byId('proposal-flow-waiting').textContent=flow.labels[row.status]+' · '+flow.waiting(row);
        const people=participants(row,current);
        byId('proposal-flow-people').replaceChildren(node('p','ผู้สนใจ '+people.length+' คน'));
        for (const person of people) byId('proposal-flow-people').append(personLine(person.name,person.note));
        const actions=byId('proposal-flow-actions');
        actions.replaceChildren();
        for (const action of flow.actions(row,current)) {
            const button=node('button',action.label);
            button.type='button';
            button.onclick=()=>changeStage(action.key);
            actions.append(button);
        }
        if (flow.editable(row,current)) {
            const edit=node('button','แก้ไขข้อเสนอ');
            edit.type='button';
            edit.onclick=()=>{flowDialog.close();openEditor(row);};
            actions.append(edit);
        }
        byId('proposal-flow-history').replaceChildren(...row.history.map(entry=>{
            const item=node('li');
            item.append(node('strong',flow.labels[entry.status]),
                node('small',entry.actor+' · '+new Date(entry.at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})));
            if (entry.note) item.append(node('p',entry.note));
            return item;
        }));
        byId('proposal-flow-status').textContent='';
    }
    async function changeStage(key) {
        const target=flowTarget;
        if (!target || !state) return;
        const {row,current}=target;
        const buttons=[...byId('proposal-flow-actions').querySelectorAll('button')];
        if (buttons.some(button=>button.disabled)) return;
        buttons.forEach(button=>{button.disabled=true;});
        try {
            const updated=await current.store.transition(row,key,byId('proposal-flow-note').value);
            if (state!==current || flowTarget!==target) return;
            current.rows=current.rows.map(item=>item.id===updated.id ? updated : item);
            flowTarget={row:updated,current};
            render(current);renderWorkflow();
            byId('proposal-flow-note').value='';
        } catch(err) {
            if (state===current && flowTarget===target) byId('proposal-flow-status').textContent=err.message;
        } finally { buttons.forEach(button=>{button.disabled=false;}); }
    }
    byId('proposal-flow-close').onclick=()=>flowDialog.close();
    flowDialog.addEventListener('close',()=>{flowTarget=null;});
    const isOpen = row => (!row.status || row.status==='open') && row.deadline >= day();
    function card(row, current) {
        const open = isOpen(row);
        const el = node('article','', 'proposal-card' + (open ? '' : ' closed'));
        const people = participants(row, current);
        if (current.demo) el.append(node('span',flow.labels[row.status],'proposal-stage'));
        el.append(personLine(row.creator, 'ผู้เสนอ · ' + dateLabel(row.createdAt)),
            node('h3',row.title), node('strong',row.partner), node('p',row.summary,'proposal-summary'),
            node('small',(row.status==='draft' || row.status==='changes' ? 'กำหนดปิดรับ ' : open ? 'เปิดรับถึง ' : 'ปิดรับแล้ว · ') + dateLabel(row.deadline)));
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
        if (current.demo) {
            const details=node('button','ดูขั้นตอน');
            details.type='button';details.className='proposal-flow-trigger';
            details.setAttribute('aria-label','ดูขั้นตอน '+row.title);
            details.onclick=()=>openWorkflow(row,current);
            el.append(details);
        }
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
        const reviewId='example-review-v1';
        if (!rows.some(row=>row.id===reviewId)) rows.push({
            ...fixture(),id:reviewId,title:'ตัวอย่างข้อเสนอที่รอพิจารณา',
            createdBy:'sample-author',status:'review',interested:[],
            history:[{status:'open',at:new Date().toISOString(),actor:'ผู้ประสานงานตัวอย่าง',note:'ตัวอย่างสำหรับทดลอง Flow'},
                {status:'review',at:new Date().toISOString(),actor:'ระบบต้นแบบ',note:'ครบกำหนดและไม่มีผู้สนใจ'}]
        });
        rows=rows.map(row=>flow.initialize(row,current,day()));
        save(rows);
        return {
            list:async()=>rows,
            create:async (payload,id)=>{
                const row=flow.event({...payload,id,createdBy:current.session.user.id,
                    creator:current.name,createdAt:new Date().toISOString(),mine:false,interested:[]},
                    payload.status,current.name);
                save([row,...rows]); return row;
            },
            update:async(row,payload)=>{
                const latest=rows.find(item=>item.id===row.id);
                if (!latest || !flow.editable(latest,current)) throw Error('แก้ไขได้เฉพาะร่างหรือข้อเสนอที่ส่งกลับของคุณ');
                const updated=flow.event({...latest,...payload},payload.status,current.name,'แก้ไขข้อเสนอ');
                save(rows.map(item=>item.id===row.id ? updated : item));return updated;
            },
            transition:async(row,action,note)=>{
                const latest=rows.find(item=>item.id===row.id);
                if (!latest || latest.status!==row.status) throw Error('สถานะเปลี่ยนแล้ว กรุณาเปิดรายละเอียดอีกครั้ง');
                const updated=flow.transition(latest,action,current,day(),note);
                save(rows.map(item=>item.id===row.id ? updated : item));return updated;
            },
            interest:async(row,join,note = '')=>{
                row=rows.find(item=>item.id===row.id);
                if (!row || !isOpen(row)) throw Error('ปิดรับความสนใจแล้ว');
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
    function openEditor(row = null) {
        if (!state) return;
        form.reset(); postKey=crypto.randomUUID(); editingRow=row;
        form.elements.scopeId.replaceChildren(...state.scopes.map(s=>new Option(s,s)));
        form.elements.deadline.min=day();
        form.elements.deadline.value=day(new Date(Date.now()+7*86400000));
        if (row) for (const key of ['title','partner','summary','scopeId','deadline']) form.elements[key].value=row[key];
        form.elements.scopeId.disabled=Boolean(row);
        byId('proposal-save-draft').hidden=!state.demo;
        byId('proposal-form-title').textContent=row ? 'แก้ไขข้อเสนอ' : 'สร้างข้อเสนอความร่วมมือ';
        byId('proposal-author').textContent='ผู้เสนอ · '+(row?.creator || state.name)+(state.demo ? ' · ข้อมูลตัวอย่างเก็บในแท็บนี้' : '');
        byId('proposal-form-status').textContent='';
        dialog.showModal();
    }
    byId('proposal-new').onclick=()=>openEditor();
    byId('proposal-cancel').onclick=()=>dialog.close();
    form.addEventListener('input',()=>{postKey=crypto.randomUUID();});
    form.onsubmit=async event=>{
        event.preventDefault();
        const current=state;
        if (!current) return;
        const payload=Object.fromEntries(new FormData(form));
        payload.scopeId=form.elements.scopeId.value;
        if (current.demo) payload.status=event.submitter?.value==='draft' ? 'draft' : 'open';
        for (const k of ['title','partner','summary']) payload[k]=payload[k].trim();
        if (!payload.title || !payload.partner || !payload.summary) {
            byId('proposal-form-status').textContent='กรุณากรอกข้อมูลให้ครบ'; return;
        }
        const buttons=[...form.querySelectorAll('[type=submit]')];
        if (buttons.some(button=>button.disabled)) return;
        buttons.forEach(button=>{button.disabled=true;});
        try {
            const row=editingRow ? await current.store.update(editingRow,payload) : await current.store.create(payload,postKey);
            if (state!==current) return;
            current.rows=[row,...current.rows.filter(x=>x.id!==row.id)];
            render(current);dialog.close();
            byId('proposal-status').textContent=payload.status==='draft' ? 'บันทึกร่างแล้ว' : 'โพสต์ข้อเสนอแล้ว';
        } catch(err) {
            if (state===current) byId('proposal-form-status').textContent='โพสต์ไม่ได้ · '+err.message;
        } finally { buttons.forEach(button=>{button.disabled=false;}); }
    };
    window.CstuProposals={mount,clear};
})();
