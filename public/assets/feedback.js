/* Scoped feedback uses the parent record's permissions; no public storage fallback. */
(() => {
    'use strict';
    function enhanceComposer(form, fields) {
        form.className += ' feedback-composer';
        const resize = textarea => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.max(36, Math.min(textarea.scrollHeight, 200)) + 'px';
        };
        fields.forEach(textarea => {
            textarea.rows = 1;
            textarea.placeholder = textarea.placeholder || 'เพิ่มความคิดเห็น…';
            textarea.oninput = () => resize(textarea);
            textarea.onfocus = () => resize(textarea);
            if (textarea.value) resize(textarea);
        });
    }
    async function mount(container, parent, kind, session, options = {}) {
        if (!['partners','activities','exchanges'].includes(kind) || !session?.user) return;
        if (!options.excludePublic) {
            window.CstuPublicFeedback?.mount(container, parent, kind, {scoped:true, hideCreate:options.hideCreate});
            return;
        }
        // Public comments keep their public reader; only authorized owner edits use this route.
        container.className='public-comment-editor';
        const editor=document.createElement('div');container.append(editor);
        const base='/'+kind+'/'+encodeURIComponent(parent.id)+'/feedback';
        let revision=0, publicArea=null;
        async function load() {
            const current=++revision;
            try {
                let cursor=null;const rows=[];
                do {
                    const result=await window.CstuAuth.request(base+'?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
                    if(current!==revision || !container.isConnected)return;
                    rows.push(...result.data.filter(row=>row.origin==='web' && row.canEdit));
                    cursor=result.page.nextCursor;
                }while(cursor);
                if(!publicArea){
                    publicArea=container.closest('.detail-comments')?.querySelector('.public-feedback');
                    publicArea?.addEventListener('cstu:public-feedback-loaded',load);
                }
                publicArea?.querySelectorAll('.public-comment-list > li').forEach(li=>{
                    li.querySelector('[data-feedback-edit]')?.remove();
                    li.querySelector('[data-feedback-delete]')?.remove();
                    const row=rows.find(item=>item.id===li.dataset.feedbackId);
                    if(!row)return;
                    let footer=li.querySelector('.feedback-comment-footer');
                    if(!footer){
                        footer=document.createElement('div');
                        footer.className='feedback-comment-footer';
                        const votes=li.querySelector('.feedback-reactions');
                        if(votes) footer.append(votes);
                        li.append(footer);
                    }
                    let actions=footer.querySelector('.feedback-comment-actions');
                    if(!actions){
                        actions=document.createElement('div');
                        actions.className='feedback-comment-actions';
                        footer.append(actions);
                    }
                    const edit=document.createElement('button');edit.type='button';
                    edit.className='feedback-action-btn feedback-edit-btn';
                    edit.dataset.feedbackEdit='';
                    edit.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> แก้ไข';
                    edit.onclick=()=>editComment(row);

                    const del=document.createElement('button');del.type='button';
                    del.className='feedback-action-btn feedback-delete-btn';
                    del.dataset.feedbackDelete='';
                    del.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> ลบ';
                    del.onclick=async()=>{
                        if(!window.confirm('คุณต้องการลบความคิดเห็นนี้ใช่หรือไม่?')) return;
                        del.disabled=true;
                        try {
                            await window.CstuAuth.remove(base+'/'+encodeURIComponent(row.id), row.version);
                            editor.replaceChildren();
                            publicArea?.dispatchEvent(new Event('cstu:public-feedback-refresh'));
                        } catch(error) {
                            del.disabled=false;
                        }
                    };
                    actions.append(edit,del);
                });
            } catch {
                publicArea?.querySelectorAll('[data-feedback-edit]').forEach(button=>button.remove());
            }
        }
        function editComment(row) {
            const form=document.createElement('form'),comment=document.createElement('textarea');
            comment.setAttribute('aria-label','แก้ไขความคิดเห็น');comment.required=true;comment.maxLength=5000;
            comment.value=row.comment||'';
            const actions=document.createElement('div');actions.className='feedback-composer-actions';
            const status=document.createElement('p');status.setAttribute('role','status');
            const save=document.createElement('button');save.type='submit';save.textContent='บันทึกความคิดเห็น';
            const cancel=document.createElement('button');cancel.type='button';cancel.textContent='ยกเลิก';
            cancel.onclick=()=>editor.replaceChildren();
            actions.append(cancel,save);form.append(comment,actions,status);editor.replaceChildren(form);
            enhanceComposer(form,[comment]);comment.focus();
            form.onsubmit=async event=>{
                event.preventDefault();if(save.disabled)return;
                const value=comment.value.trim();
                if(!value){status.textContent='กรุณากรอกความคิดเห็น';return;}
                save.disabled=true;cancel.disabled=true;
                try {
                    await window.CstuAuth.mutate(base+'/'+encodeURIComponent(row.id),{comment:value},row.version);
                    if(!container.isConnected)return;
                    editor.replaceChildren();
                    publicArea?.dispatchEvent(new Event('cstu:public-feedback-refresh'));
                }catch(error){
                    status.textContent=error.status===409?'ความคิดเห็นเปลี่ยนแล้ว กรุณาเปิดรายการใหม่':'บันทึกไม่ได้ กรุณาลองใหม่';
                }finally{save.disabled=false;cancel.disabled=false;}
            };
        }
        await load();
    }
    window.CstuFeedback={mount,enhanceComposer};
})();
