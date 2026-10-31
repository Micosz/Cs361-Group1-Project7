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
        host.append(el('h2','ผลตอบรับจากแบบฟอร์ม (ข้อมูลภายใน)'),
            el('p','คำตอบที่นำเข้าจาก Google Forms / Excel แยกตามแบบฟอร์มและงานที่เกี่ยวข้อง'));
        const label=el('label','ค้นหาแบบฟอร์ม');
        const search=el('input'); search.type='search'; search.placeholder='ชื่อฟอร์ม ชื่องาน หรือผู้นำเข้า'; label.append(search);
        const status=el('p','กำลังโหลดแบบฟอร์ม'); status.setAttribute('role','status');
        const list=el('div',undefined,'form-batches');
        const more=el('button','โหลดแบบฟอร์มเพิ่มเติม'); more.type='button'; more.hidden=true;
        host.append(label,status,list,more);
        let cursor=null, request=0;
        function card(row) {
            const article=el('article',undefined,'feedback-inbox-card');
            article.append(el('h3',row.formName),el('p',row.parentTitle||'งานที่เกี่ยวข้อง'),
                el('p',`${kinds[row.parentType]||'งาน'} · ${row.responseCount} คำตอบ · นำเข้าโดย ${row.importedByName||'ไม่ระบุ'} · ${row.createdAt||''}`,'feedback-inbox-meta'));
            const toggle=el('button','อ่านคำตอบ'); toggle.type='button'; toggle.setAttribute('aria-expanded','false');
            const detail=el('div'); detail.hidden=true;
            let detailRequest=0;
            toggle.onclick=async()=>{
                const run=++detailRequest;
                detail.hidden=!detail.hidden; toggle.setAttribute('aria-expanded',String(!detail.hidden));
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
            article.append(toggle,detail); return article;
        }
        async function load(reset=false) {
            const run=++request;
            if(reset){cursor=null;list.replaceChildren();}
            more.disabled=true; status.textContent='กำลังโหลดแบบฟอร์ม';
            const query=new URLSearchParams({limit:'20',q:search.value.trim()});
            if(cursor) query.set('cursor',cursor);
            try {
                const result=await window.CstuAuth.request('/form-feedback?'+query);
                if(!alive() || run!==request) return;
                for(const row of result.data) list.append(card(row));
                cursor=result.page?.nextCursor||null; more.hidden=!cursor;
                status.textContent=result.count ? `พบ ${result.count} แบบฟอร์ม` : 'ยังไม่พบแบบฟอร์มตามเงื่อนไข';
            } catch(error) {
                if(!alive() || run!==request) return;
                status.textContent='โหลดแบบฟอร์มไม่ได้ กรุณาลองใหม่'; more.hidden=false;
                more.textContent='ลองโหลดอีกครั้ง';
            } finally {if(run===request)more.disabled=false;}
        }
        let timer;
        search.addEventListener('input',()=>{++request;clearTimeout(timer);timer=setTimeout(()=>{if(alive())load(true);},250);});
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
        const kindLabel = el('label', 'ประเภทงาน');
        const kind = el('select'); kind.setAttribute('aria-label','กรองตามประเภทงาน');
        for (const [value,label] of [['','ทุกประเภท'],...Object.entries(kinds)]) { const option=el('option',label); option.value=value; kind.appendChild(option); }
        kindLabel.appendChild(kind);
        const respondentLabel=el('label','ประเภทผู้ตอบ');
        const respondent=el('select'); respondent.setAttribute('aria-label','กรองตามประเภทผู้ตอบ');
        for (const [value,label] of [['','ทุกประเภทผู้ตอบ'],...Object.entries(respondents)]) { const option=el('option',label); option.value=value; respondent.appendChild(option); }
        respondentLabel.appendChild(respondent);
        const channelLabel=el('label','ช่องทาง');
        const channel=el('select'); channel.setAttribute('aria-label','กรองตามช่องทาง');
        for (const [value,label] of [['','ทุกช่องทาง'],['web','เว็บไซต์'],['other','ช่องทางเดิม']]) { const option=el('option',label); option.value=value; channel.appendChild(option); }
        channelLabel.appendChild(channel);
        const favoriteLabel = el('label', undefined, 'feedback-favorite-filter');
        const onlyFavorites = el('input'); onlyFavorites.type='checkbox'; onlyFavorites.setAttribute('aria-label','แสดงเฉพาะรายการที่กดหัวใจ');
        favoriteLabel.append(onlyFavorites,el('span','เฉพาะที่กดหัวใจไว้'));
        toolbar.append(searchLabel,kindLabel,respondentLabel,channelLabel,favoriteLabel);
        const summary = el('p',undefined,'feedback-inbox-summary'); summary.hidden=true;
        const message = el('p','กำลังโหลด Feedback','feedback-inbox-status'); message.setAttribute('role','status');
        const list = el('div',undefined,'feedback-inbox-list');
        container.append(el('h2','ความคิดเห็นจากเว็บไซต์และรายการเดิม'),toolbar,summary,message,list);
        const forms=el('section',undefined,'form-feedback'); container.append(forms);
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
                    (!channel.value || (channel.value==='web' ? row.origin==='web' : row.origin!=='web')) &&
                    (!onlyFavorites.checked || favorites.has(row.id)) &&
                    (!needle || [row.parentTitle,row.comment,row.improvement,sources[row.sourceType]||row.sourceType]
                        .some(value => String(value||'').toLocaleLowerCase().includes(needle))));
                list.replaceChildren();
                const filtered=Boolean(needle || kind.value || respondent.value || channel.value || onlyFavorites.checked);
                const withImprovement=visible.filter(row => String(row.improvement || '').trim()).length;
                summary.textContent=`Feedback ${filtered?'ตามตัวกรอง':'ทั้งหมด'} ${visible.length} รายการ · มีข้อเสนอแนะ ${withImprovement} รายการ`;
                summary.hidden=false;
                message.textContent=visible.length ? `แสดง ${visible.length} จาก ${rows.length} รายการ` :
                    onlyFavorites.checked && favorites.size===0 ? 'ยังไม่มี Feedback ที่กดหัวใจไว้' : 'ไม่พบ Feedback ตามตัวกรอง';
                for(const row of visible){
                    const card=el('article',undefined,'feedback-inbox-card');
                    const header=el('div',undefined,'feedback-inbox-card-header');
                    const meta=el('p',`${row.occurredOn||'ไม่ระบุวันที่'} · ${respondents[row.respondentType]||sources[row.sourceType]||row.sourceType||'ไม่ระบุแหล่งที่มา'}${row.origin==='web'?' · เว็บไซต์':''} · ${kinds[row.parentType]||'งาน'}`,'feedback-inbox-meta');
                    const favorite=el('button',favorites.has(row.id)?'♥ บันทึกแล้ว':'♡ เก็บไว้','feedback-favorite-button');
                    favorite.type='button'; favorite.setAttribute('aria-pressed',String(favorites.has(row.id)));
                    favorite.setAttribute('aria-label',favorites.has(row.id)?'นำออกจากรายการที่กดหัวใจ':'เพิ่มในรายการที่กดหัวใจ');
                    favorite.onclick=()=>{if(favorites.has(row.id))favorites.delete(row.id);else favorites.add(row.id);saveFavorites(userId,favorites);draw();};
                    header.append(meta,favorite); card.appendChild(header);
                    card.appendChild(el('h3',row.parentTitle||'งานที่เกี่ยวข้อง'));
                    card.appendChild(el('p',row.comment||''));
                    if(row.improvement) card.appendChild(el('p','สิ่งที่ควรปรับปรุง: '+row.improvement,'feedback-inbox-improvement'));
                    const link=el('a','เปิดงานที่เกี่ยวข้อง');
                    const relatedKind=row.parentType==='partner'?'partners':row.parentType==='activity'?'activities':'exchanges';
                    link.href=`index.html?kind=${relatedKind}&id=${encodeURIComponent(row.parentId)}#board-section`;
                    // Read the related work in a dialog so the inbox, filters and scroll position stay in place.
                    // Modified clicks keep the normal link behaviour (e.g. open in a new tab).
                    link.onclick=event=>{
                        if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||!window.CstuRecords?.openRelated)return;
                        event.preventDefault();
                        window.CstuRecords.openRelated(relatedKind,row.parentId,link);
                    };
                    card.appendChild(link); list.appendChild(card);
                }
            };
            search.addEventListener('input',draw); kind.addEventListener('change',draw); respondent.addEventListener('change',draw); channel.addEventListener('change',draw); onlyFavorites.addEventListener('change',draw);
            draw();
        } catch(error) {
            if (!alive()) return;
            message.textContent=error.status===401?'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่':error.status===403||error.status===404?'คุณไม่มีสิทธิ์อ่าน Feedback ในขอบเขตนี้':'โหลด Feedback ไม่สำเร็จ กรุณาลองใหม่';
        }
        await formsReady;
    }
    window.CstuFeedbackInbox={render};
})();
