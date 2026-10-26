/* Small shared form for the existing Partner/Activity validators and API. */
(() => {
    if (!window.CstuWork) return;
    const schemas = {
        partners: [['name','ชื่อ',true],['type','ประเภท',true],['summary','สรุป',true],['location','สถานที่',true],['websiteUrl','เว็บไซต์'],['logoPath','ภาพโลโก้'],['fullDescription','รายละเอียด']],
        activities: [['title','ชื่อกิจกรรม',true],['type','ประเภท',true],['summary','สรุป',true],['partnerId','รหัสคู่ความร่วมมือหลัก',true],['coHostPartnerIds','รหัสผู้จัดร่วม คั่นด้วยจุลภาค'],['agreementIds','รหัสข้อตกลงที่เชื่อม คั่นด้วยจุลภาค'],['periodDate','วันจัดกิจกรรม'],['periodText','ช่วงเวลา'],['imagePath','ภาพกิจกรรม'],['fullDescription','รายละเอียด']]
    };
    function open(kind, {container,record,session,reload,onCancel}) {
        container.replaceChildren();
        const form = document.createElement('form'), fields = {};
        if (kind === 'partners') form.id = 'partner-entry-form';
        const allowedRoles = kind === 'partners' ? ['staff'] : ['staff','coordinator'];
        const active = session.grants.filter(g => g.active !== false && allowedRoles.includes(g.role));
        const scopeLabel = document.createElement('label'); scopeLabel.textContent = 'ขอบเขต ';
        const scope = document.createElement('select'); scope.id = `basic-${kind}-scope`; scope.disabled = Boolean(record);
        for (const id of [...new Set(record ? [record.scopeId] : active.map(g => g.scopeId))]) {
            const option = document.createElement('option'); option.value = id; option.textContent = id; scope.appendChild(option);
        }
        scopeLabel.appendChild(scope); form.appendChild(scopeLabel);
        for (const [name,label,required] of schemas[kind]) {
            const wrapper = document.createElement('p'), title = document.createElement('label'); title.textContent = label+' ';
            let input;
            if (name === 'type') {
                input = document.createElement('select');
                const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'เลือกประเภท'; input.appendChild(placeholder);
                const types = kind === 'partners' ? ['company','university','government','research_institute','internship'] : ['academic_activity','event','research'];
                for (const value of types) { const opt = document.createElement('option'); opt.value = value; opt.textContent = ({company:'บริษัท / ภาคเอกชน',university:'มหาวิทยาลัย',government:'หน่วยงานภาครัฐ',research_institute:'สถาบันวิจัย',internship:'สถานประกอบการฝึกงาน',academic_activity:'กิจกรรมวิชาการ',event:'งานกิจกรรม',research:'การวิจัย'})[value] || value; input.appendChild(opt); }
            } else {
                input = document.createElement(name === 'fullDescription' || name === 'summary' ? 'textarea' : 'input');
                if (name === 'periodDate') input.type = 'date';
            }
            input.required = Boolean(required); input.style.width = '100%';
            input.id = `basic-${kind}-${name}`;
            input.value = Array.isArray(record?.[name]) ? record[name].join(', ') : record?.[name] || '';
            fields[name] = input; title.appendChild(input); wrapper.appendChild(title); form.appendChild(wrapper);
        }
        const staff = active.some(g => g.role === 'staff' && g.scopeId === scope.value);
        if (staff) {
            const wrapper = document.createElement('p'), label = document.createElement('label'); label.textContent = 'ผู้รับผิดชอบ (เลือกจากรายชื่อ) ';
            fields.responsibleUserIds = document.createElement('input'); fields.responsibleUserIds.value = (record?.responsibleUserIds || [session.user.id]).join(', ');
            fields.responsibleUserIds.id = `basic-${kind}-responsibleUserIds`;
            label.appendChild(fields.responsibleUserIds); wrapper.appendChild(label); form.appendChild(wrapper);
            const publication = document.createElement('select'); publication.id = `basic-${kind}-publication`;
            for (const [value,text] of [['internal','ภายใน'],['public','สาธารณะ']]) { const option=document.createElement('option'); option.value=value;option.textContent=text;publication.appendChild(option); }
            publication.value = record?.publication || 'internal'; fields.publication = publication;
            const pubLabel = document.createElement('label'); pubLabel.textContent = ' การเผยแพร่ '; pubLabel.appendChild(publication);form.appendChild(pubLabel);
        }
        const status = document.createElement('p'); status.setAttribute('role','status');
        const save = document.createElement('button');save.type='submit';save.textContent='บันทึก';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'ยกเลิก';
        cancel.onclick = () => {
            if (save.disabled) return;
            container.replaceChildren();
            if (onCancel) onCancel();
            else {
                const dialog = container.closest('dialog');
                if (dialog?.open) dialog.close('cancel');
            }
        };
        const actions = document.createElement('div'); actions.append(save,cancel);
        form.append(status,actions);container.appendChild(form);
        let key = null, previous = null;
        form.onsubmit = async event => {
            event.preventDefault();if(save.disabled)return;
            const payload={};
            for (const [name,input] of Object.entries(fields)) {
                const value=input.value.trim();
                payload[name]=name.endsWith('Ids') ? value.split(',').map(v=>v.trim()).filter(Boolean) : name==='periodDate' ? value || null : value;
            }
            const canAssign = active.some(g=>g.role==='staff' && g.scopeId===scope.value);
            if(!canAssign){delete payload.responsibleUserIds;delete payload.publication;}
            if(!record)payload.scopeId=scope.value;
            const fingerprint=JSON.stringify(payload);if(previous!==fingerprint){previous=fingerprint;key=crypto.randomUUID();}
            save.disabled=true;cancel.disabled=true;status.textContent='กำลังบันทึก';
            try {
                if(record)await window.CstuAuth.mutate('/'+kind+'/'+encodeURIComponent(record.id),payload,record.version);
                else await window.CstuAuth.create('/'+kind,payload,key);
                status.textContent='บันทึกแล้ว';await reload();
            } catch(error) {
                status.textContent=error.status===409 ? 'ข้อมูลเปลี่ยนแล้ว กรุณาปิดและเปิดรายละเอียดใหม่เพื่อตรวจทาน' : 'บันทึกไม่ได้: '+error.message;
            } finally {save.disabled=false;cancel.disabled=false;}
        };
        if (kind === 'partners' && fields.responsibleUserIds && window.SelectionFields) {
            window.SelectionFields.mount({form,scope,fields:[{input:fields.responsibleUserIds,kind:'responsible',label:'ผู้รับผิดชอบ (เลือกได้หลายคน)'}],submit:save,status});
        }
    }
    for(const kind of Object.keys(schemas))window.CstuWork.register(kind,{create:options=>open(kind,options),edit:options=>open(kind,options)});
})();
