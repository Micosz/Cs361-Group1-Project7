/* Read-only feedback inbox; favorites remain private to this browser profile. */
(() => {
    'use strict';
    const sources = {participant:'ผู้เข้าร่วม',partner:'คู่ความร่วมมือ',other:'อื่น ๆ'};
    const kinds = {activity:'กิจกรรม',exchange:'การแลกเปลี่ยน'};
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
    async function render(container, session) {
        const userId = session?.user?.id;
        if (!userId) return;
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
        const favoriteLabel = el('label', undefined, 'feedback-favorite-filter');
        const onlyFavorites = el('input'); onlyFavorites.type='checkbox'; onlyFavorites.setAttribute('aria-label','แสดงเฉพาะรายการที่กดหัวใจ');
        favoriteLabel.append(onlyFavorites,el('span','เฉพาะที่กดหัวใจไว้'));
        toolbar.append(searchLabel,kindLabel,favoriteLabel);
        const message = el('p','กำลังโหลด Feedback','feedback-inbox-status'); message.setAttribute('role','status');
        const list = el('div',undefined,'feedback-inbox-list');
        container.append(toolbar,message,list);
        try {
            const rows=[]; let cursor=null;
            do {
                const query=new URLSearchParams({limit:'100'}); if(cursor) query.set('cursor',cursor);
                const result=await window.CstuAuth.request('/feedback?'+query.toString());
                if (!Array.isArray(result.data)) throw Error('INVALID_FEEDBACK_RESPONSE');
                rows.push(...result.data); cursor=result.page?.nextCursor || null;
            } while(cursor);
            const draw=()=>{
                const needle=search.value.trim().toLocaleLowerCase();
                const visible=rows.filter(row => (!kind.value || row.parentType===kind.value) &&
                    (!onlyFavorites.checked || favorites.has(row.id)) &&
                    (!needle || [row.parentTitle,row.comment,row.improvement,sources[row.sourceType]||row.sourceType]
                        .some(value => String(value||'').toLocaleLowerCase().includes(needle))));
                list.replaceChildren();
                message.textContent=visible.length ? `แสดง ${visible.length} จาก ${rows.length} รายการ` :
                    onlyFavorites.checked && favorites.size===0 ? 'ยังไม่มี Feedback ที่กดหัวใจไว้' : 'ไม่พบ Feedback ตามตัวกรอง';
                for(const row of visible){
                    const card=el('article',undefined,'feedback-inbox-card');
                    const header=el('div',undefined,'feedback-inbox-card-header');
                    const meta=el('p',`${row.occurredOn||'ไม่ระบุวันที่'} · ${sources[row.sourceType]||row.sourceType||'ไม่ระบุแหล่งที่มา'} · ${kinds[row.parentType]||'งาน'}`,'feedback-inbox-meta');
                    const favorite=el('button',favorites.has(row.id)?'♥ บันทึกแล้ว':'♡ เก็บไว้','feedback-favorite-button');
                    favorite.type='button'; favorite.setAttribute('aria-pressed',String(favorites.has(row.id)));
                    favorite.setAttribute('aria-label',favorites.has(row.id)?'นำออกจากรายการที่กดหัวใจ':'เพิ่มในรายการที่กดหัวใจ');
                    favorite.onclick=()=>{if(favorites.has(row.id))favorites.delete(row.id);else favorites.add(row.id);saveFavorites(userId,favorites);draw();};
                    header.append(meta,favorite); card.appendChild(header);
                    card.appendChild(el('h3',row.parentTitle||'งานที่เกี่ยวข้อง'));
                    card.appendChild(el('p',row.comment||''));
                    if(row.improvement) card.appendChild(el('p','สิ่งที่ควรปรับปรุง: '+row.improvement,'feedback-inbox-improvement'));
                    const link=el('a','เปิดงานที่เกี่ยวข้อง');
                    link.href=`index.html?kind=${row.parentType==='activity'?'activities':'exchanges'}&id=${encodeURIComponent(row.parentId)}#board-section`;
                    card.appendChild(link); list.appendChild(card);
                }
            };
            search.addEventListener('input',draw); kind.addEventListener('change',draw); onlyFavorites.addEventListener('change',draw);
            draw();
        } catch(error) {
            message.textContent=error.status===401?'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่':error.status===403||error.status===404?'คุณไม่มีสิทธิ์อ่าน Feedback ในขอบเขตนี้':'โหลด Feedback ไม่สำเร็จ กรุณาลองใหม่';
        }
    }
    window.CstuFeedbackInbox={render};
})();
