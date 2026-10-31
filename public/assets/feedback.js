/* Scoped feedback uses the parent record's permissions; no public storage fallback. */
(() => {
    'use strict';
    function canCreateFeedback(session, parent) {
        if (!session?.user) return true;
        if (window.CstuWork.canEdit(session, parent)) return true;
        return window.CstuWork.roles(session, parent?.scopeId).includes('student');
    }
    async function mount(container, parent, kind, session) {
        if (!['partners','activities','exchanges'].includes(kind)) return;
        const heading=document.createElement('h3');heading.textContent='ความคิดเห็นและผลตอบรับ (Feedback)';
        const status=document.createElement('p');status.setAttribute('role','status');
        const list=document.createElement('ol'), editor=document.createElement('div');
        container.className='feedback-section';container.append(heading,status,list,editor);
        const base='/'+kind+'/'+encodeURIComponent(parent.id)+'/feedback';
        const sources={participant:'ผู้เข้าร่วม',partner:'คู่ความร่วมมือ',other:'อื่น ๆ'};
        const add=document.createElement('button');add.type='button';add.textContent='เพิ่ม Feedback';
        let addMounted=false;
        const syncAddButton=allowed=>{
            if(allowed && !addMounted){container.appendChild(add);addMounted=true;}
            else if(!allowed && addMounted){add.remove?.();addMounted=false;}
        };
        let revision=0;
        async function load() {
            const current=++revision;list.replaceChildren();status.textContent='กำลังโหลด Feedback';
            try {
                let cursor=null,total=0,firstPage=true;
                do {
                    const result=await window.CstuAuth.request(base+'?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
                    if(current!==revision || container.isConnected===false)return;
                    if(firstPage && typeof result.canCreate==='boolean'){syncAddButton(result.canCreate);firstPage=false;}
                    for(const row of result.data){
                        const li=document.createElement('li');
                        const meta=document.createElement('p');meta.textContent=row.occurredOn+' · '+(sources[row.sourceType]||row.sourceType);
                        const comment=document.createElement('p');comment.textContent=row.comment;
                        li.append(meta,comment);
                        if(row.improvement){const text=document.createElement('p');text.textContent='สิ่งที่ควรปรับปรุง: '+textValue(row.improvement);li.appendChild(text);}
                        if(row.respondentName){const name=document.createElement('p');name.textContent='ผู้ให้ผลตอบรับ (ภายใน): '+row.respondentName;li.appendChild(name);}
                        if(row.canEdit){const edit=document.createElement('button');edit.type='button';edit.textContent='แก้ไข Feedback';edit.onclick=()=>form(row);li.appendChild(edit);}
                        list.appendChild(li);total++;
                    }
                    cursor=result.page.nextCursor;
                }while(cursor);
                status.textContent=total?'':'ยังไม่มี Feedback';
            }catch(error){
                if(current===revision && container.isConnected!==false){
                    if(error.status===403||error.status===404)syncAddButton(false);
                    status.textContent='โหลด Feedback ไม่ได้: '+error.message;
                }
            }
        }
        function textValue(value){return String(value??'');}
        function form(row=null){
            editor.replaceChildren();const form=document.createElement('form');
            const field=(label,node)=>{const p=document.createElement('p'),l=document.createElement('label');l.textContent=label+' ';l.appendChild(node);p.appendChild(l);form.appendChild(p);return node;};
            const today=new Date().toISOString().slice(0, 10);
            const date=field('วันที่รับ Feedback (บันทึกอัตโนมัติ)',document.createElement('input'));date.type='text';date.readOnly=true;date.required=true;date.value=row?.occurredOn||today;date.style.backgroundColor='#f7f2ee';date.style.cursor='default';
            const source=field('แหล่งที่มา',document.createElement('select'));
            for(const [value,label] of Object.entries(sources)){const option=document.createElement('option');option.value=value;option.textContent=label;source.appendChild(option);}source.value=row?.sourceType||'participant';
            const comment=field('ความคิดเห็น (ไม่ใส่ข้อมูลระบุตัวบุคคล)',document.createElement('textarea'));comment.required=true;comment.maxLength=10000;comment.value=row?.comment||'';
            const improvement=field('สิ่งที่ควรปรับปรุง (ไม่ใส่ข้อมูลระบุตัวบุคคล)',document.createElement('textarea'));improvement.maxLength=10000;improvement.value=row?.improvement||'';
            const name=field('ชื่อผู้ให้ผลตอบรับ (ไม่บังคับ เฉพาะผู้จัดการงานเห็น)',document.createElement('input'));name.maxLength=200;name.value=row?.respondentName||'';
            const message=document.createElement('p');message.setAttribute('role','status');
            const save=document.createElement('button');save.type='submit';save.textContent='บันทึก Feedback';
            const cancel=document.createElement('button');cancel.type='button';cancel.textContent='ยกเลิก';cancel.onclick=()=>editor.replaceChildren();
            form.append(message,save,cancel);editor.appendChild(form);
            let fingerprint=null,key=null;
            form.onsubmit=async event=>{
                event.preventDefault();if(save.disabled)return;
                const payload={occurredOn:date.value||today,sourceType:source.value,comment:comment.value.trim(),improvement:improvement.value.trim()};
                if(!row || 'respondentName' in row || name.value.trim())payload.respondentName=name.value.trim();
                if(!payload.comment){message.textContent='กรุณากรอกความคิดเห็น';return;}
                const next=JSON.stringify(payload);if(next!==fingerprint){fingerprint=next;key=crypto.randomUUID();}
                save.disabled=true;message.textContent='กำลังบันทึก';
                try{
                    if(row)await window.CstuAuth.mutate(base+'/'+encodeURIComponent(row.id),payload,row.version);
                    else await window.CstuAuth.create(base,payload,key);
                    if(container.isConnected===false)return;
                    editor.replaceChildren();await load();
                }catch(error){message.textContent=error.status===409?'ข้อมูลเปลี่ยนแล้ว กรุณายกเลิกและเปิด Feedback ล่าสุดเพื่อตรวจทาน':error.status===403||error.status===404?'คุณไม่มีสิทธิ์จัดการ Feedback นี้แล้ว':'บันทึกไม่ได้: '+error.message;}
                finally{save.disabled=false;}
            };
            comment.focus?.();
        }
        add.onclick=()=>form();
        syncAddButton(canCreateFeedback(session,parent));
        await load();
    }
    window.CstuFeedback={mount};
})();