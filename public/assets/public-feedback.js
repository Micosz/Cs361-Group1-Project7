/* Public web comments; internal feedback and imported forms use separate scoped routes. */
(() => {
    'use strict';
    function mount(container, record, kind) {
        if (!record?.id || !['partners','activities'].includes(kind)) return;
        container.classList.add('feedback-section', 'public-feedback');
        const categories={student:'นักศึกษา',teacher:'อาจารย์',partner:'คู่ความร่วมมือ',participant:'ผู้เข้าร่วม',other:'อื่น ๆ'};
        const base='/public/'+kind+'/'+encodeURIComponent(record.id)+'/feedback';
        const heading=document.createElement('h3'); heading.textContent='ความคิดเห็น';
        const intro=document.createElement('p'); intro.className='feedback-hint';
        intro.textContent='ความคิดเห็นแสดงต่อสาธารณะโดยไม่ระบุชื่อ โปรดหลีกเลี่ยงข้อมูลส่วนบุคคล';
        const form=document.createElement('form'); form.className='public-comment-composer';
        const comment=document.createElement('textarea'); comment.required=true; comment.maxLength=5000;
        comment.setAttribute('aria-label','ความคิดเห็น'); comment.placeholder='เพิ่มความคิดเห็น…';
        const controls=document.createElement('div'); controls.className='feedback-composer-controls'; controls.hidden=true;
        const label=document.createElement('label'); label.textContent='คุณเป็น';
        const category=document.createElement('select'); category.required=true;
        for (const [value,text] of [['','เลือกประเภทผู้ตอบ'],...Object.entries(categories)]) {
            const option=document.createElement('option'); option.value=value; option.textContent=text; category.append(option);
        }
        label.append(category);
        const actions=document.createElement('div'); actions.className='feedback-composer-actions';
        const cancel=document.createElement('button'); cancel.type='button'; cancel.textContent='ยกเลิก';
        const send=document.createElement('button'); send.type='submit'; send.textContent='ส่งความคิดเห็น';
        actions.append(cancel,send); controls.append(label,actions);
        const status=document.createElement('p'); status.setAttribute('role','status');
        const listStatus=document.createElement('p'); listStatus.setAttribute('role','status');
        const filterLabel=document.createElement('label'); filterLabel.className='feedback-filter';
        filterLabel.textContent='กลุ่มผู้ตอบ ';
        const filter=document.createElement('select'); filter.setAttribute('aria-label','กรองตามกลุ่มผู้ตอบ');
        for(const [value,text] of [['','ทุกกลุ่มผู้ตอบ'],...Object.entries(categories)]) {
            const option=document.createElement('option');option.value=value;option.textContent=text;filter.append(option);
        }
        filterLabel.append(filter);
        const list=document.createElement('ol'); list.className='public-comment-list';
        const more=document.createElement('button'); more.type='button'; more.textContent='ดูเพิ่มเติม'; more.hidden=true;
        form.append(comment,controls,status); container.append(heading,intro,form,filterLabel,listStatus,list,more);
        window.CstuFeedback?.enhanceComposer(form, [comment]);
        let cursor=null, revision=0, key=null, fingerprint=null;
        async function load(reset=true) {
            const current=++revision;
            more.disabled=true; listStatus.textContent='กำลังโหลดความคิดเห็น';
            if(reset){cursor=null;list.replaceChildren();more.hidden=true;}
            try {
                try { await window.CstuAuth.refresh(); } catch { /* Public reading remains available. */ }
                const result=await window.CstuAuth.request(base+'?limit=20'+(filter.value?'&respondentType='+encodeURIComponent(filter.value):'')+(cursor?'&cursor='+encodeURIComponent(cursor):''));
                if(current!==revision || !container.isConnected)return;
                for(const row of result.data){
                    const li=document.createElement('li');
                    li.dataset.feedbackId=row.id;
                    const meta=document.createElement('p'); meta.className='feedback-comment-meta';
                    meta.textContent=(categories[row.respondentType]||'ผู้เยี่ยมชม')+' · '+(row.occurredOn||'');
                    const text=document.createElement('p'); text.textContent=row.comment;
                    const votes=document.createElement('div'); votes.className='feedback-reactions';
                    for (const [choice,icon,label,count] of [['like','👍','ถูกใจ',row.likes],['dislike','👎','ไม่ถูกใจ',row.dislikes]]) {
                        const button=document.createElement('button');button.type='button';
                        button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(row.myReaction===choice));
                        button.textContent=icon+' '+(Number(count)||0);
                        button.onclick=async()=>{
                            for(const b of votes.querySelectorAll('button'))b.disabled=true;
                            try {
                                const session=await window.CstuAuth.refresh();
                                await window.CstuAuth.request(base+'/'+encodeURIComponent(row.id)+'/reaction',{
                                    method:'PUT',headers:{'X-CSRF-Token':session.csrfToken},
                                    body:JSON.stringify({reaction:row.myReaction===choice?null:choice})});
                                await load();
                            } catch(error) {
                                listStatus.textContent=error.status===429?'กดบ่อยเกินไป กรุณาลองใหม่ภายหลัง':'บันทึกไม่ได้ กรุณาลองใหม่';
                                for(const b of votes.querySelectorAll('button'))b.disabled=false;
                            }
                        };
                        votes.append(button);
                    }
                    li.append(meta,text,votes);list.append(li);
                }
                cursor=result.page.nextCursor;more.hidden=!cursor;
                listStatus.textContent=list.children.length?'':'ยังไม่มีความคิดเห็น มาเป็นคนแรกกัน';
                container.dispatchEvent(new Event('cstu:public-feedback-loaded'));
            } catch(error) {
                if(current!==revision || !container.isConnected)return;
                if(!reset && error.message==='INVALID_CURSOR'){await load();return;}
                listStatus.textContent=error.status===404?'รายการนี้ไม่ได้เผยแพร่แล้ว':'โหลดความคิดเห็นไม่ได้ กรุณาลองใหม่';
                more.textContent='ลองใหม่'; more.hidden=false;
            } finally {
                if(current===revision)more.disabled=false;
            }
        }
        more.onclick=()=>{more.textContent='ดูเพิ่มเติม';load(!cursor);};
        filter.onchange=()=>load();
        container.addEventListener('cstu:public-feedback-refresh',()=>load());
        comment.addEventListener('focus',()=>{controls.hidden=false;});
        comment.addEventListener('input',()=>{controls.hidden=false;});
        function clear() {
            form.reset(); comment.style.height=''; controls.hidden=true; fingerprint=null; key=null;
        }
        cancel.onclick=()=>{clear();status.textContent='';comment.focus();controls.hidden=true;};
        form.onsubmit=async event=>{
            event.preventDefault(); if(send.disabled) return;
            const payload={respondentType:category.value,comment:comment.value.trim()};
            if (!payload.comment) { status.textContent='กรุณากรอกความคิดเห็น'; return; }
            const current=JSON.stringify(payload);
            if (fingerprint!==current) { fingerprint=current; key=crypto.randomUUID(); }
            send.disabled=true; cancel.disabled=true; comment.disabled=true; category.disabled=true;
            status.textContent='กำลังส่งความคิดเห็น';
            try {
                await window.CstuAuth.createPublicFeedback(base,payload,key);
                if(!container.isConnected)return;
                clear(); status.textContent='ส่งความคิดเห็นแล้ว ขอบคุณค่ะ';
                // Refresh from the server; the index can take a moment to show a new comment.
                await load();
            } catch(error) {
                status.textContent=error.status===429?'ส่งบ่อยเกินไป กรุณาลองใหม่ภายหลัง':
                    error.status===404?'รายการนี้ไม่เปิดรับความคิดเห็นแล้ว':'ส่งความคิดเห็นไม่ได้ กรุณาลองใหม่';
            } finally { send.disabled=false; cancel.disabled=false; comment.disabled=false; category.disabled=false; }
        };
        load();
    }
    window.CstuPublicFeedback={mount};
})();
