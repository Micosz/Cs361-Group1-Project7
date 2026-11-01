/* Read-only feedback inbox; favorites remain private to this browser profile. */
(() => {
    'use strict';
    const sources = {participant:'ผู้เข้าร่วม',partner:'คู่ความร่วมมือ',other:'อื่น ๆ'};
    const respondents = {student:'นักศึกษา',teacher:'อาจารย์',partner:'คู่ความร่วมมือ',participant:'ผู้เข้าร่วม',other:'อื่น ๆ'};
    const kinds = {partner:'คู่ความร่วมมือ',activity:'กิจกรรม',exchange:'การแลกเปลี่ยน'};
    const el = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const icon = name => {
        const node = el('i', undefined, 'fa-solid fa-' + name);
        node.setAttribute('aria-hidden', 'true');
        return node;
    };
    const dateLabel = value => {
        if (!value) return 'ไม่ระบุวันที่';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('th-TH', {day:'numeric',month:'short',year:'numeric'});
    };
    function relatedLink(row) {
        const link = el('a', row.parentTitle || 'เปิดงานที่เกี่ยวข้อง', 'feedback-related-link');
        const kind = {partner:'partners',activity:'activities',exchange:'exchanges'}[row.parentType];
        link.href = `index.html?kind=${kind}&id=${encodeURIComponent(row.parentId)}#board-section`;
        link.onclick = event => {
            if(event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !window.CstuRecords?.openRelated) return;
            event.preventDefault();
            window.CstuRecords.openRelated(kind, row.parentId, link);
        };
        return link;
    }
    function relatedWork(row) {
        const line = el('p', undefined, 'feedback-inbox-related');
        line.append(el('span', 'เกี่ยวกับ '), relatedLink(row));
        const partners = row.parentType === 'activity' && Array.isArray(row.relatedPartners)
            ? row.relatedPartners.filter(partner => partner?.id && partner?.name) : [];
        if (partners.length) {
            line.append(el('span', ' · คู่ความร่วมมือ '));
            partners.forEach((partner, index) => {
                if (index) line.append(el('span', ', '));
                line.append(relatedLink({parentType:'partner', parentId:partner.id, parentTitle:partner.name}));
            });
        }
        return line;
    }
    function kindFilter() {
        const label = el('label', 'ประเภทงาน');
        const input = el('select'); input.setAttribute('aria-label', 'กรองตามประเภทงาน');
        for (const [value, text] of [['','ทุกประเภทงาน'], ...Object.entries(kinds)]) {
            const option = el('option', text); option.value = value; input.append(option);
        }
        label.append(input);
        return {label, input};
    }
    function favoriteStore(userId) {
        const key = 'cstuhub:feedback-favorites:' + encodeURIComponent(userId);
        try {
            return new Set(JSON.parse(localStorage.getItem(key) || '[]').filter(id => typeof id === 'string'));
        } catch { return new Set(); }
    }
    function saveFavorites(userId, favorites) {
        try { localStorage.setItem('cstuhub:feedback-favorites:' + encodeURIComponent(userId), JSON.stringify([...favorites])); }
        catch { /* The filter still works for this page view if storage is unavailable. */ }
    }
    async function renderForms(host, alive) {
        host.append(el('h2','ผลตอบรับจากแบบฟอร์ม', 'feedback-panel-title'),
            el('p','คำตอบที่นำเข้าจาก Google Forms / Excel แยกตามแบบฟอร์มและงานที่เกี่ยวข้อง'));
        const label=el('label','ค้นหาแบบฟอร์ม');
        const search=el('input'); search.type='search'; search.maxLength=200; search.placeholder='ชื่อฟอร์ม ชื่องาน หรือผู้นำเข้า'; label.append(search);
        const toolbar=el('div',undefined,'feedback-inbox-toolbar feedback-form-toolbar');
        const formKind=kindFilter(); toolbar.append(label,formKind.label);
        const status=el('p','กำลังโหลดแบบฟอร์ม'); status.setAttribute('role','status');
        const list=el('div',undefined,'feedback-inbox-list');
        const more=el('button','โหลดแบบฟอร์มเพิ่มเติม'); more.type='button'; more.hidden=true;
        more.className='feedback-read-button';
        host.append(toolbar,status,list,more);
        let cursor=null, request=0;
        function card(row) {
            const article=el('article',undefined,'feedback-inbox-card');
            const avatar=el('span',undefined,'feedback-inbox-avatar'); avatar.append(icon('file-lines'));
            const body=el('div',undefined,'feedback-inbox-body');
            const meta=el('p',`${sources[row.sourceType]||'ผู้ตอบแบบฟอร์ม'} · ${dateLabel(row.createdAt)} · ${row.responseCount} คำตอบ`,'feedback-inbox-meta');
            body.append(meta,el('h3',row.formName),relatedWork(row),
                el('p',`นำเข้าโดย ${row.importedByName||'ไม่ระบุ'}`,'feedback-inbox-meta'));
            const toggle=el('button','อ่านคำตอบ','feedback-read-button'); toggle.type='button'; toggle.setAttribute('aria-expanded','false');
            const detail=el('div',undefined,'feedback-form-detail'); detail.hidden=true;
            let detailRequest=0;
            toggle.onclick=async()=>{
                const run=++detailRequest;
                detail.hidden=!detail.hidden; toggle.setAttribute('aria-expanded',String(!detail.hidden));
                toggle.textContent=detail.hidden?'อ่านคำตอบ':'ซ่อนคำตอบ';
                detail.replaceChildren(); if(detail.hidden) return;
                detail.append(el('p','กำลังโหลดคำตอบ'));
                const collection={partner:'partners',activity:'activities',exchange:'exchanges'}[row.parentType];
                try {
                    if(!collection) throw Error('INVALID_PARENT');
                    const result=await window.CstuAuth.request('/'+collection+'/'+encodeURIComponent(row.parentId)+'/form-feedback/'+encodeURIComponent(row.id));
                    if(!alive() || !article.isConnected || run!==detailRequest) return;
                    detail.replaceChildren(el('p',`ไฟล์ ${result.data.fileName} · ชีต ${result.data.sheetName}`));
                    window.CstuFormFeedback.responseList(detail,result.data);
                } catch(error) {
                    if(alive() && article.isConnected && run===detailRequest) detail.replaceChildren(el('p','อ่านคำตอบไม่ได้ กรุณาตรวจสิทธิ์หรือเปิดใหม่'));
                }
            };
            body.append(toggle,detail); article.append(avatar,body); return article;
        }
        async function load(reset=false) {
            const run=++request;
            if(reset){cursor=null;list.replaceChildren();}
            more.disabled=true; status.textContent='กำลังโหลดแบบฟอร์ม';
            const query=new URLSearchParams({limit:'20',q:search.value.trim()});
            if(cursor) query.set('cursor',cursor);
            if(formKind.input.value) query.set('parentType',formKind.input.value);
            try {
                const result=await window.CstuAuth.request('/form-feedback?'+query);
                if(!alive() || run!==request) return;
                for(const row of result.data) list.append(card(row));
                cursor=result.page?.nextCursor||null; more.hidden=!cursor; more.textContent='โหลดแบบฟอร์มเพิ่มเติม';
                status.textContent=result.count ? `พบ ${result.count} แบบฟอร์ม` : 'ยังไม่พบแบบฟอร์มตามเงื่อนไข';
            } catch(error) {
                if(!alive() || run!==request) return;
                status.textContent='โหลดแบบฟอร์มไม่ได้ กรุณาลองใหม่'; more.hidden=false;
                more.textContent='ลองโหลดอีกครั้ง';
            } finally {if(run===request)more.disabled=false;}
        }
        let timer;
        search.addEventListener('input',()=>{++request;clearTimeout(timer);timer=setTimeout(()=>{if(alive())load(true);},250);});
        formKind.input.addEventListener('change',()=>{clearTimeout(timer);load(true);});
        more.onclick=()=>load(); await load(true);
    }
    let generation=0, activeHost=null;
    window.addEventListener('authchange',()=>{++generation;activeHost?.replaceChildren();});
    async function render(container, session) {
        const userId = session?.user?.id;
        if (!userId) return;
        const current=++generation; activeHost=container;
        const alive=()=>current===generation && container.isConnected;
        const favorites = favoriteStore(userId);
        container.replaceChildren();
        const toolbar = el('div', undefined, 'feedback-inbox-toolbar');
        const searchLabel = el('label', 'ค้นหา Feedback');
        const search = el('input'); search.type = 'search'; search.placeholder = 'คำสำคัญ ชื่องาน หรือข้อเสนอแนะ'; search.setAttribute('aria-label','ค้นหา Feedback');
        searchLabel.appendChild(search);
        const {label:kindLabel,input:kind}=kindFilter();
        const respondentLabel=el('label','ประเภทผู้ตอบ');
        const respondent=el('select'); respondent.setAttribute('aria-label','กรองตามประเภทผู้ตอบ');
        for (const [value,label] of [['','ทุกประเภทผู้ตอบ'],...Object.entries(respondents)]) { const option=el('option',label); option.value=value; respondent.appendChild(option); }
        respondentLabel.appendChild(respondent);
        const favoriteLabel = el('label', undefined, 'feedback-favorite-filter');
        const onlyFavorites = el('input'); onlyFavorites.type='checkbox'; onlyFavorites.setAttribute('aria-label','แสดงเฉพาะรายการที่กดหัวใจ');
        favoriteLabel.append(onlyFavorites,icon('heart'),el('span','เก็บไว้'));
        toolbar.append(searchLabel,kindLabel,respondentLabel,favoriteLabel);
        const summary = el('p',undefined,'feedback-inbox-summary'); summary.hidden=true;
        const message = el('p','กำลังโหลด Feedback','feedback-inbox-status'); message.setAttribute('role','status');
        const list = el('div',undefined,'feedback-inbox-list');
        const comments=el('section',undefined,'feedback-inbox-panel');
        const forms=el('section',undefined,'form-feedback feedback-inbox-panel');
        comments.id='feedback-comments-panel'; forms.id='feedback-forms-panel'; forms.hidden=true;
        comments.append(el('h2','ความคิดเห็นจากเว็บไซต์และรายการเดิม','feedback-panel-title'),toolbar,summary,message,list);
        const tabs=el('div',undefined,'feedback-inbox-tabs'); tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','ประเภท Feedback');
        const panels=[comments,forms];
        const buttons=['Comment','Form Feedback'].map((title,index)=>{
            const tab=el('button',title,'feedback-inbox-tab'); tab.type='button';
            tab.id='feedback-inbox-tab-'+index; tab.setAttribute('role','tab');
            tab.setAttribute('aria-controls',panels[index].id); tab.setAttribute('aria-selected',String(index===0)); tab.tabIndex=index===0?0:-1;
            panels[index].setAttribute('role','tabpanel'); panels[index].setAttribute('aria-labelledby',tab.id);
            tab.onclick=()=>select(index);
            tab.onkeydown=event=>{
                let target;
                if(event.key==='ArrowRight'||event.key==='ArrowLeft') target=1-index;
                else if(event.key==='Home') target=0;
                else if(event.key==='End') target=1;
                else return;
                event.preventDefault(); select(target); buttons[target].focus();
            };
            tabs.append(tab); return tab;
        });
        function select(index) {
            buttons.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;});
        }
        container.append(tabs,comments,forms);
        const formsReady=renderForms(forms,alive);
        try {
            const rows=[]; let cursor=null;
            do {
                const query=new URLSearchParams({limit:'100'}); if(cursor) query.set('cursor',cursor);
                const result=await window.CstuAuth.request('/feedback?'+query.toString());
                if (!alive()) return;
                if (!Array.isArray(result.data)) throw Error('INVALID_FEEDBACK_RESPONSE');
                rows.push(...result.data); cursor=result.page?.nextCursor || null;
            } while(cursor);
            const draw=()=>{
                const needle=search.value.trim().toLocaleLowerCase();
                const visible=rows.filter(row => (!kind.value || row.parentType===kind.value) &&
                    (!respondent.value || row.respondentType===respondent.value) &&
                    (!onlyFavorites.checked || favorites.has(row.id)) &&
                    (!needle || [row.parentTitle,row.comment,row.improvement,sources[row.sourceType]||row.sourceType]
                        .some(value => String(value||'').toLocaleLowerCase().includes(needle))));
                list.replaceChildren();
                const filtered=Boolean(needle || kind.value || respondent.value || onlyFavorites.checked);
                const withImprovement=visible.filter(row => String(row.improvement || '').trim()).length;
                summary.textContent=`Feedback ${filtered?'ตามตัวกรอง':'ทั้งหมด'} ${visible.length} รายการ · มีข้อเสนอแนะ ${withImprovement} รายการ`;
                summary.hidden=false;
                message.textContent=visible.length ? `แสดง ${visible.length} จาก ${rows.length} รายการ` :
                    onlyFavorites.checked && favorites.size===0 ? 'ยังไม่มี Feedback ที่กดหัวใจไว้' : 'ไม่พบ Feedback ตามตัวกรอง';
                for(const row of visible){
                    const card=el('article',undefined,'feedback-inbox-card');
                    const avatar=el('span',undefined,'feedback-inbox-avatar'); avatar.append(icon('user'));
                    const body=el('div',undefined,'feedback-inbox-body');
                    const meta=el('p',undefined,'feedback-inbox-meta');
                    meta.append(el('strong',respondents[row.respondentType]||sources[row.sourceType]||'ผู้แสดงความคิดเห็น'),
                        el('span',`${row.origin==='web'?' · เว็บไซต์':''} · ${dateLabel(row.occurredOn)}`));
                    const favorite=el('button',undefined,'feedback-favorite-button');
                    const heart=icon('heart'); heart.className=(favorites.has(row.id)?'fa-solid':'fa-regular')+' fa-heart'; favorite.append(heart);
                    favorite.type='button'; favorite.setAttribute('aria-pressed',String(favorites.has(row.id)));
                    favorite.setAttribute('aria-label',favorites.has(row.id)?'นำออกจากรายการที่กดหัวใจ':'เพิ่มในรายการที่กดหัวใจ');
                    favorite.title=favorites.has(row.id)?'บันทึกแล้ว':'เก็บไว้';
                    favorite.onclick=()=>{
                        if(favorites.has(row.id))favorites.delete(row.id);else favorites.add(row.id);
                        saveFavorites(userId,favorites);
                        if(onlyFavorites.checked) {draw();onlyFavorites.focus();return;}
                        favorite.setAttribute('aria-pressed',String(favorites.has(row.id)));
                        favorite.setAttribute('aria-label',favorites.has(row.id)?'นำออกจากรายการที่กดหัวใจ':'เพิ่มในรายการที่กดหัวใจ');
                        favorite.title=favorites.has(row.id)?'บันทึกแล้ว':'เก็บไว้';
                        heart.className=(favorites.has(row.id)?'fa-solid':'fa-regular')+' fa-heart';
                    };
                    body.append(meta,el('p',row.comment||'','feedback-inbox-comment'));
                    if(row.improvement) body.append(el('p','ข้อเสนอแนะ: '+row.improvement,'feedback-inbox-improvement'));
                    body.append(relatedWork(row));
                    card.append(avatar,body,favorite); list.appendChild(card);
                }
            };
            search.addEventListener('input',draw); kind.addEventListener('change',draw); respondent.addEventListener('change',draw); onlyFavorites.addEventListener('change',draw);
            draw();
        } catch(error) {
            if (!alive()) return;
            message.textContent=error.status===401?'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่':error.status===403||error.status===404?'คุณไม่มีสิทธิ์อ่าน Feedback ในขอบเขตนี้':'โหลด Feedback ไม่สำเร็จ กรุณาลองใหม่';
        }
        await formsReady;
    }
    window.CstuFeedbackInbox={render};
})();
