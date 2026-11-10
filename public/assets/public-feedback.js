/* Public web comments; internal feedback and imported forms use separate scoped routes. */
(() => {
    'use strict';
    function mount(container, record, kind, options = {}) {
        const scoped = options.scoped === true;
        if (!record?.id || !(scoped ? ['partners','activities','exchanges'] : ['partners','activities']).includes(kind)) return;
        container.classList.add('feedback-section', 'public-feedback');
        const categories={student:'นักศึกษา',teacher:'อาจารย์',partner:'คู่ความร่วมมือ',participant:'ผู้เข้าร่วม',other:'อื่น ๆ'};
        const base=(scoped ? '/' : '/public/')+kind+'/'+encodeURIComponent(record.id)+'/feedback';
        const heading=document.createElement('h3'); heading.textContent='ความคิดเห็น';
        const intro=document.createElement('p'); intro.className='feedback-hint';
        intro.textContent=scoped ? 'ความคิดเห็นแสดงเฉพาะผู้มีสิทธิ์ในรายการนี้ โปรดหลีกเลี่ยงข้อมูลส่วนบุคคล' : 'ความคิดเห็นแสดงต่อสาธารณะโดยไม่ระบุชื่อ โปรดหลีกเลี่ยงข้อมูลส่วนบุคคล';
        const form=document.createElement('form'); form.className='public-comment-composer'; form.hidden=scoped;
        const comment=document.createElement('textarea'); comment.required=true; comment.maxLength=5000;
        comment.setAttribute('aria-label','ความคิดเห็น'); comment.placeholder='เพิ่มความคิดเห็น…';
        const controls=document.createElement('div'); controls.className='feedback-composer-controls'; controls.hidden=true;
        const label=document.createElement('label'); label.textContent='คุณเป็น';
        const category=document.createElement('select'); category.required=true;
        for (const [value,text] of [['','เลือกประเภทของผู้แสดงความคิดเห็น'],...Object.entries(categories)]) {
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
        // Staff and executives may ask for an AI summary; it is off unless the backend has a model configured.
        const summaryBox=document.createElement('div'); summaryBox.className='feedback-summary'; summaryBox.hidden=true;
        const summarize=document.createElement('button'); summarize.type='button'; summarize.className='feedback-action-btn feedback-summary-btn';
        summarize.textContent='สรุปความคิดเห็นด้วย AI';
        const summaryText=document.createElement('p'); summaryText.className='feedback-summary-text'; summaryText.setAttribute('role','status');
        const summaryNote=document.createElement('p'); summaryNote.className='feedback-summary-note'; summaryNote.hidden=true;
        summaryNote.textContent='สรุปโดย AI จากความคิดเห็นที่แสดงอยู่ อาจคลาดเคลื่อนได้ โปรดอ่านความคิดเห็นจริงประกอบ';
        summaryBox.append(summarize,summaryText,summaryNote);
        summarize.onclick=async()=>{
            summarize.disabled=true; summaryNote.hidden=true; summaryText.textContent='กำลังสรุปความคิดเห็น อาจใช้เวลาสักครู่';
            try {
                const result=(await window.CstuAuth.request('/'+kind+'/'+encodeURIComponent(record.id)+'/feedback-summary',{timeoutMs:30000})).data;
                if(!container.isConnected)return;
                if(typeof result?.summary==='string' && result.summary){
                    summaryText.textContent=result.summary; summaryNote.hidden=false;
                } else summaryText.textContent='ต้องมีความคิดเห็นอย่างน้อย '+(result?.minimum||3)+' รายการจึงจะสรุปได้ (ขณะนี้มี '+(result?.count||0)+' รายการ)';
            } catch(error) {
                summaryText.textContent=error.message==='SUMMARY_UNAVAILABLE'?'ระบบนี้ยังไม่ได้เปิดใช้การสรุปด้วย AI':
                    error.status===429?'ขอสรุปบ่อยเกินไป กรุณาลองใหม่ภายหลัง':
                    error.status===403||error.status===404?'คุณไม่มีสิทธิ์ขอสรุปความคิดเห็นของรายการนี้':'สรุปความคิดเห็นไม่ได้ กรุณาลองใหม่';
            } finally { summarize.disabled=false; }
        };
        const reportReasons={spam:'สแปมหรือโฆษณา',abuse:'ข้อความไม่เหมาะสมหรือคุกคาม',personal_data:'มีข้อมูลส่วนบุคคล',other:'อื่น ๆ'};
        form.append(comment,controls,status); container.append(heading,intro,form,summaryBox,filterLabel,listStatus,list,more);
        window.CstuFeedback?.enhanceComposer(form, [comment]);
        let cursor=null, revision=0, key=null, fingerprint=null, editing=null, canCreate=!scoped;
        async function load(reset=true) {
            const current=++revision;
            more.disabled=true; listStatus.textContent='กำลังโหลดความคิดเห็น';
            if(reset){cursor=null;list.replaceChildren();more.hidden=true;}
            try {
                try { await window.CstuAuth.refresh(); } catch { /* Public reading remains available. */ }
                let result;
                if(scoped){
                    const rows=[];let next=null;
                    do{
                        const page=await window.CstuAuth.request(base+'?limit=100'+(next?'&cursor='+encodeURIComponent(next):''));
                        if(current!==revision || !container.isConnected)return;
                        if(next===null){
                            canCreate=page.canCreate===true && !options.hideCreate;
                            summaryBox.hidden=page.canModerate!==true;
                            result=page;
                            form.hidden=!canCreate && !editing;
                        }
                        rows.push(...page.data);
                        next=page.page.nextCursor;
                    }while(next);
                    result={...result,data:rows.filter(row=>!filter.value || (row.respondentType||row.sourceType||'other')===filter.value),page:{nextCursor:null}};
                }else{
                    result=await window.CstuAuth.request(base+'?limit=20'+(filter.value?'&respondentType='+encodeURIComponent(filter.value):'')+(cursor?'&cursor='+encodeURIComponent(cursor):''));
                }
                if(current!==revision || !container.isConnected)return;
                for(const row of result.data){
                    const li=document.createElement('li');
                    li.dataset.feedbackId=row.id;
                    const meta=document.createElement('p'); meta.className='feedback-comment-meta';
                    meta.textContent=(categories[row.respondentType||row.sourceType]||'ผู้เยี่ยมชม')+' · '+(row.occurredOn||'');
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
                    li.append(meta,text);
                    const footer=document.createElement('div'); footer.className='feedback-comment-footer';
                    if(!scoped || result.canReact===true) footer.append(votes);
                    if(!scoped){
                        // Reporting never deletes: enough reports hide the comment until staff review it.
                        const report=document.createElement('button'); report.type='button'; report.className='feedback-action-btn feedback-report-btn';
                        report.textContent='รายงาน'; report.setAttribute('aria-label','รายงานความคิดเห็นนี้');
                        report.onclick=()=>{
                            if(li.querySelector('.feedback-report-form'))return;
                            const reportForm=document.createElement('form'); reportForm.className='feedback-report-form';
                            const reasonLabel=document.createElement('label'); reasonLabel.textContent='เหตุผล ';
                            const reason=document.createElement('select'); reason.setAttribute('aria-label','เหตุผลที่รายงาน');
                            for(const [value,label] of Object.entries(reportReasons)){
                                const option=document.createElement('option');option.value=value;option.textContent=label;reason.append(option);
                            }
                            reasonLabel.append(reason);
                            const sendReport=document.createElement('button'); sendReport.type='submit'; sendReport.className='feedback-action-btn'; sendReport.textContent='ส่งรายงาน';
                            const cancelReport=document.createElement('button'); cancelReport.type='button'; cancelReport.className='feedback-action-btn'; cancelReport.textContent='ยกเลิก';
                            cancelReport.onclick=()=>{reportForm.remove();report.focus();};
                            reportForm.append(reasonLabel,sendReport,cancelReport);
                            reportForm.onsubmit=async event=>{
                                event.preventDefault(); sendReport.disabled=true; cancelReport.disabled=true;
                                try {
                                    const session=await window.CstuAuth.refresh();
                                    await window.CstuAuth.request(base+'/'+encodeURIComponent(row.id)+'/report',{
                                        method:'PUT',headers:{'X-CSRF-Token':session.csrfToken},
                                        body:JSON.stringify({reason:reason.value})});
                                    reportForm.remove(); report.disabled=true; report.textContent='รายงานแล้ว';
                                    listStatus.textContent='ได้รับรายงานแล้ว เจ้าหน้าที่จะตรวจสอบ ขอบคุณค่ะ';
                                } catch(error) {
                                    listStatus.textContent=error.status===429?'รายงานบ่อยเกินไป กรุณาลองใหม่ภายหลัง':
                                        error.status===404?'ความคิดเห็นนี้ไม่อยู่ในรายการแล้ว':'ส่งรายงานไม่ได้ กรุณาลองใหม่';
                                    sendReport.disabled=false; cancelReport.disabled=false;
                                }
                            };
                            li.append(reportForm); reason.focus();
                        };
                        footer.append(report);
                    }
                    if(scoped && row.canModerate===true){
                        const reports=Number(row.reports)||0;
                        if(row.publiclyHidden)li.classList.add('is-hidden-comment');
                        if(reports>0 || row.moderation){
                            const note=document.createElement('p'); note.className='feedback-moderation-note';
                            note.textContent=[reports>0?'ถูกรายงาน '+reports+' ครั้ง':'',
                                row.publiclyHidden?'ซ่อนจากสาธารณะอยู่':row.moderation==='visible'?'เจ้าหน้าที่อนุญาตให้แสดง':''].filter(Boolean).join(' · ');
                            li.append(note);
                        }
                        const moderate=document.createElement('button'); moderate.type='button'; moderate.className='feedback-action-btn feedback-moderate-btn';
                        moderate.textContent=row.publiclyHidden?'แสดงต่อสาธารณะ':'ซ่อนจากสาธารณะ';
                        moderate.onclick=async()=>{
                            moderate.disabled=true;
                            try {
                                const session=await window.CstuAuth.refresh();
                                await window.CstuAuth.request(base+'/'+encodeURIComponent(row.id)+'/moderation',{
                                    method:'PUT',headers:{'X-CSRF-Token':session.csrfToken,'If-Match':'"'+row.version+'"'},
                                    body:JSON.stringify({state:row.publiclyHidden?'visible':'hidden'})});
                                await load();
                            } catch(error) {
                                listStatus.textContent=error.status===409?'ความคิดเห็นเปลี่ยนแล้ว กรุณาโหลดรายการใหม่':
                                    error.status===403||error.status===404?'คุณไม่มีสิทธิ์จัดการความคิดเห็นนี้':'บันทึกไม่ได้ กรุณาลองใหม่';
                                moderate.disabled=false;
                            }
                        };
                        footer.append(moderate);
                    }
                    const canEdit = scoped && row.canEdit;
                    const canDelete = scoped && (row.canDelete ?? row.canEdit);
                    if(canEdit || canDelete){
                        const actions=document.createElement('div'); actions.className='feedback-comment-actions';
                        if(canEdit){
                            const edit=document.createElement('button'); edit.type='button';
                            edit.className='feedback-action-btn feedback-edit-btn';
                            edit.setAttribute('aria-label','แก้ไขความคิดเห็น');
                            edit.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> แก้ไข';
                            edit.onclick=()=>{
                                editing=row;form.hidden=false;comment.value=row.comment||'';
                                category.value=row.respondentType||row.sourceType||'other';
                                controls.hidden=false;send.textContent='บันทึกความคิดเห็น';comment.focus();
                            };
                            actions.append(edit);
                        }
                        if(canDelete){
                            const del=document.createElement('button'); del.type='button';
                            del.className='feedback-action-btn feedback-delete-btn';
                            del.setAttribute('aria-label','ลบความคิดเห็น');
                            del.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> ลบ';
                            del.onclick=async()=>{
                                if(!window.confirm('คุณต้องการลบความคิดเห็นนี้ใช่หรือไม่?')) return;
                                del.disabled=true;
                                try {
                                    await window.CstuAuth.remove(base+'/'+encodeURIComponent(row.id), row.version);
                                    if(editing?.id===row.id) clear();
                                    await load();
                                } catch(error) {
                                    console.error('Delete feedback failed:', error);
                                    listStatus.textContent=error.status===409?'ความคิดเห็นเปลี่ยนแล้ว กรุณาโหลดรายการใหม่ก่อนลบ':
                                        error.status===403||error.status===404?'คุณไม่มีสิทธิ์ลบความคิดเห็นนี้':'ลบความคิดเห็นไม่ได้ กรุณาลองใหม่ ('+(error.status||error.message)+')';
                                    del.disabled=false;
                                }
                            };
                            actions.append(del);
                        }
                        footer.append(actions);
                    }
                    if(footer.children.length) li.append(footer);
                    list.append(li);
                }
                cursor=result.page.nextCursor;more.hidden=!cursor;
                listStatus.textContent=list.children.length?'':'ยังไม่มีความคิดเห็น มาเป็นคนแรกกัน';
                container.dispatchEvent(new Event('cstu:public-feedback-loaded'));
            } catch(error) {
                if(current!==revision || !container.isConnected)return;
                if(!reset && error.message==='INVALID_CURSOR'){await load();return;}
                if(scoped && [401,403,404].includes(error.status)){clear();form.hidden=true;canCreate=false;}
                listStatus.textContent=error.status===404?(scoped?'คุณไม่มีสิทธิ์เข้าถึงความคิดเห็นของรายการนี้แล้ว':'รายการนี้ไม่ได้เผยแพร่แล้ว'):'โหลดความคิดเห็นไม่ได้ กรุณาลองใหม่';
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
            editing=null;send.textContent='ส่งความคิดเห็น';form.hidden=!canCreate;
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
                if(scoped){
                    const data={comment:payload.comment,respondentType:payload.respondentType};
                    if(editing)await window.CstuAuth.mutate(base+'/'+encodeURIComponent(editing.id),data,editing.version);
                    else await window.CstuAuth.create(base,{...data,occurredOn:new Date().toISOString().slice(0,10),
                        sourceType:payload.respondentType==='partner'?'partner':payload.respondentType==='other'?'other':'participant'},key);
                }else await window.CstuAuth.createPublicFeedback(base,payload,key);
                if(!container.isConnected)return;
                clear(); status.textContent='ส่งความคิดเห็นแล้ว ขอบคุณค่ะ';
                // Refresh from the server; the index can take a moment to show a new comment.
                await load();
            } catch(error) {
                status.textContent=error.status===429?'ส่งบ่อยเกินไป กรุณาลองใหม่ภายหลัง':
                    error.status===409?'ความคิดเห็นเปลี่ยนแล้ว กรุณาโหลดรายการใหม่ก่อนแก้ไข':
                    error.status===403||error.status===404?'คุณไม่มีสิทธิ์ส่งความคิดเห็นในรายการนี้แล้ว':'ส่งความคิดเห็นไม่ได้ กรุณาลองใหม่';
            } finally { send.disabled=false; cancel.disabled=false; comment.disabled=false; category.disabled=false; }
        };
        load();
    }
    window.CstuPublicFeedback={mount};
})();
