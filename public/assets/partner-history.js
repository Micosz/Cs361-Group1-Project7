/* Internal Partner history stays inside the authorized detail screen. */
(() => {
    'use strict';
    async function mount(container, partner, session) {
        const title=document.createElement('h3');title.textContent='ประวัติความสัมพันธ์ภายใน';
        const status=document.createElement('p');status.setAttribute('role','status');
        const list=document.createElement('ol'), editor=document.createElement('div');container.append(title,status,list,editor);
        const canEdit=window.CstuWork.canEdit(session,partner);
        const base='/partners/'+encodeURIComponent(partner.id)+'/history';
        async function load() {
            list.replaceChildren();status.textContent='กำลังโหลดประวัติ';
            try {
                let cursor=null,total=0;
                do {
                    const result=await window.CstuAuth.request(base+'?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
                    for(const row of result.data){
                        const li=document.createElement('li'), text=document.createElement('p');
                        text.textContent=row.occurredOn+' · '+row.kind+' · '+row.note;li.appendChild(text);
                        if(row.referenceId){const link=document.createElement('a');link.textContent=row.referenceLabel||'เปิดรายการอ้างอิง';link.href='records.html?kind='+(row.referenceType==='activity'?'activities':'agreements')+'&id='+encodeURIComponent(row.referenceId);li.appendChild(link);}
                        if(canEdit){const edit=document.createElement('button');edit.type='button';edit.textContent='แก้ไขเหตุการณ์';edit.onclick=()=>form(row);li.appendChild(edit);}
                        list.appendChild(li);total++;
                    }
                    cursor=result.page.nextCursor;
                }while(cursor);
                status.textContent=total?'':'ยังไม่มีประวัติภายใน';
            }catch(error){status.textContent='โหลดประวัติไม่ได้: '+error.message;}
        }
        async function form(row=null){
            editor.replaceChildren();const form=document.createElement('form');
            function field(label,node){const p=document.createElement('p'),l=document.createElement('label');l.textContent=label+' ';l.appendChild(node);p.appendChild(l);form.appendChild(p);return node;}
            const date=field('วันที่',document.createElement('input'));date.type='date';date.required=true;date.value=row?.occurredOn||'';
            const kind=field('ประเภทเหตุการณ์',document.createElement('select'));
            for(const value of ['meeting','agreement','activity','other']){const option=document.createElement('option');option.value=value;option.textContent=value;kind.appendChild(option);}kind.value=row?.kind||'meeting';
            const note=field('สรุปเหตุการณ์',document.createElement('textarea'));note.required=true;note.maxLength=20000;note.value=row?.note||'';
            const refType=field('รายการอ้างอิง',document.createElement('select'));
            for(const [value,label] of [['','ไม่เชื่อมรายการ'],['activity','กิจกรรม'],['agreement','ข้อตกลง']]){const option=document.createElement('option');option.value=value;option.textContent=label;refType.appendChild(option);}
            refType.value=row?.referenceType||'';
            const ref=field('เลือกข้อมูลที่มีสิทธิ์',document.createElement('select'));
            const unlink=field('ถอดรายการอ้างอิงเดิม',document.createElement('input'));unlink.type='checkbox';
            const message=document.createElement('p');message.setAttribute('role','status');
            const save=document.createElement('button');save.type='submit';save.textContent='บันทึกเหตุการณ์';
            const cancel=document.createElement('button');cancel.type='button';cancel.textContent='ยกเลิก';cancel.onclick=()=>editor.replaceChildren();
            form.append(message,save,cancel);editor.appendChild(form);
            async function options(){
                save.disabled=true;ref.replaceChildren();ref.disabled=!refType.value;
                try{if(refType.value){let cursor=null;do{const response=await window.CstuAuth.request('/'+(refType.value==='activity'?'activities':'agreements')+'?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));for(const item of response.data){if(item.scopeId!==partner.scopeId)continue;const option=document.createElement('option');option.value=item.id;option.textContent=item.title||item.id;ref.appendChild(option);}cursor=response.page.nextCursor;}while(cursor);if(row?.referenceType===refType.value&&row.referenceId)ref.value=row.referenceId;}}
                catch(error){message.textContent='โหลดตัวเลือกไม่ได้: '+error.message;}
                finally{save.disabled=false;}
            }
            refType.onchange=options;await options();let key=null,fingerprint=null;
            form.onsubmit=async event=>{
                event.preventDefault();if(save.disabled)return;
                const payload={occurredOn:date.value,kind:kind.value,note:note.value.trim()};
                if(unlink.checked){payload.referenceType=null;payload.referenceId=null;}
                else if(refType.value){if(!ref.value){message.textContent='กรุณาเลือกรายการอ้างอิง';return;}payload.referenceType=refType.value;payload.referenceId=ref.value;}
                else if(row?.referenceId){payload.referenceType=null;payload.referenceId=null;}
                const next=JSON.stringify(payload);if(fingerprint!==next){fingerprint=next;key=crypto.randomUUID();}
                save.disabled=true;message.textContent='กำลังบันทึก';
                try{if(row)await window.CstuAuth.mutate(base+'/'+encodeURIComponent(row.id),payload,row.version);else await window.CstuAuth.create(base,payload,key);editor.replaceChildren();await load();}
                catch(error){message.textContent=error.status===409?'ข้อมูลเปลี่ยนแล้ว กรุณายกเลิกและเปิดเหตุการณ์ล่าสุดเพื่อตรวจทาน':'บันทึกไม่ได้: '+error.message;}
                finally{save.disabled=false;}
            };
        }
        if(canEdit){const add=document.createElement('button');add.type='button';add.textContent='บันทึกเหตุการณ์';add.onclick=()=>form();container.insertBefore(add,editor);}
        await load();
    }
    window.PartnerHistory={mount};
})();
