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
                    const row=rows.find(item=>item.id===li.dataset.feedbackId);
                    if(!row)return;
                    const edit=document.createElement('button');edit.type='button';edit.textContent='แก้ไข';
                    edit.dataset.feedbackEdit='';edit.onclick=()=>editComment(row);li.append(edit);
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
