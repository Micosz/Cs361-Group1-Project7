/* Contact records stay behind the same parent authorization as their API. */
(() => {
    async function mount(host, partner, session) {
        if (!window.CstuWork.roles(session,partner.scopeId).some(role => ['staff','coordinator'].includes(role))) return;
        const title = document.createElement('h3'); title.textContent = 'ผู้ติดต่อภายใน';
        const status = document.createElement('p'); status.setAttribute('role','status');
        const list = document.createElement('div'), editor = document.createElement('div');
        host.append(title,status,list,editor);
        const base = '/partners/'+encodeURIComponent(partner.id)+'/contacts';
        const editable = window.CstuWork.canEdit(session,partner);
        async function load() {
            list.replaceChildren(); status.textContent = 'กำลังโหลดผู้ติดต่อ';
            try {
                const result = await window.CstuAuth.request(base);
                if (!host.isConnected) return;
                for (const row of result.data) {
                    const line = document.createElement('p');
                    line.textContent = [row.name,row.position,row.email,row.phone].filter(Boolean).join(' · ');
                    if (editable) { const edit = document.createElement('button'); edit.type='button'; edit.textContent='แก้ไขผู้ติดต่อ'; edit.onclick=()=>form(row); line.append(' ',edit); }
                    list.appendChild(line);
                }
                status.textContent = result.data.length ? '' : 'ยังไม่มีผู้ติดต่อ';
            } catch { status.textContent = 'โหลดผู้ติดต่อไม่สำเร็จ'; }
        }
        function form(record) {
            editor.replaceChildren(); const form=document.createElement('form'), fields={};
            for (const [key,text] of [['name','ชื่อผู้ติดต่อ'],['position','ตำแหน่ง'],['email','อีเมล'],['phone','โทรศัพท์']]) {
                const label=document.createElement('label'), input=document.createElement('input');
                input.required=key==='name'; input.value=record?.[key] || ''; if(key==='email') input.type='email';
                label.textContent=text+' ';label.appendChild(input);form.appendChild(label);fields[key]=input;
            }
            const save=document.createElement('button');save.type='submit';save.textContent='บันทึกผู้ติดต่อ';
            const cancel=document.createElement('button');cancel.type='button';cancel.textContent='ยกเลิก';cancel.onclick=()=>editor.replaceChildren();
            const message=document.createElement('p');message.setAttribute('role','status');form.append(message,save,cancel);editor.appendChild(form);
            let key, fingerprint;
            form.onsubmit=async event=>{
                event.preventDefault();if(save.disabled)return;
                const payload=Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value.trim()]));
                const next=JSON.stringify(payload);if(next!==fingerprint){fingerprint=next;key=crypto.randomUUID();}
                save.disabled=true;message.textContent='กำลังบันทึก';
                try { if(record) await window.CstuAuth.mutate(base+'/'+encodeURIComponent(record.id),payload,record.version);
                    else await window.CstuAuth.create(base,payload,key);
                    editor.replaceChildren();await load();
                } catch(error){message.textContent=error.status===409?'ข้อมูลเปลี่ยนแล้ว กรุณาเปิดรายละเอียดใหม่':'บันทึกผู้ติดต่อไม่สำเร็จ';}
                finally{save.disabled=false;}
            };
        }
        if(editable){const add=document.createElement('button');add.type='button';add.textContent='เพิ่มผู้ติดต่อ';add.onclick=()=>form();host.appendChild(add);}
        await load();
    }
    window.PartnerContacts={mount};
})();
