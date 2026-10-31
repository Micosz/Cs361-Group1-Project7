/* Small shared form for the existing Partner/Activity validators and API. */
(() => {
    if (!window.CstuWork) return;
    const schemas = {
        partners: [['name','ชื่อ',true],['type','ประเภท',true],['summary','สรุป',true],['location','สถานที่',true],['websiteUrl','เว็บไซต์'],['logoPath','ภาพโลโก้'],['fullDescription','รายละเอียด']],
        activities: [['title','ชื่อกิจกรรม',true],['type','ประเภท',true],['summary','สรุป',true],['partnerId','รหัสคู่ความร่วมมือหลัก',true],['coHostPartnerIds','รหัสผู้จัดร่วม คั่นด้วยจุลภาค'],['agreementIds','รหัสข้อตกลงที่เชื่อม คั่นด้วยจุลภาค'],['periodDate','วันจัดกิจกรรม'],['periodText','ช่วงเวลา'],['imagePath','ภาพกิจกรรม'],['fullDescription','รายละเอียด']]
    };
    const maxLengths = {
        name: 200, title: 200, location: 200, summary: 2000, periodText: 2000,
        websiteUrl: 2000, logoPath: 500, imagePath: 500, fullDescription: 20000
    };
    function validHttpUrl(value) {
        if (/\s/.test(value)) return false;
        try {
            const parsed = new URL(value);
            return ['http:','https:'].includes(parsed.protocol) && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
        } catch { return false; }
    }
    function validAssetPath(value) {
        return /^resources\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(value);
    }
    function open(kind, {container,record,session,reload,onCancel}) {
        container.replaceChildren();
        const form = document.createElement('form'), fields = {};
        if (kind === 'partners') form.id = 'partner-entry-form';
        const allowedRoles = ['staff','executive','coordinator'];
        const active = (session?.grants || []).filter(g => g.active !== false && allowedRoles.includes(g.role));
        const canAssignIn = scopeId => active.some(g => ['staff','executive'].includes(g.role) && g.scopeId === scopeId);
        const scopeLabel = document.createElement('label'); scopeLabel.textContent = 'ขอบเขต ';
        const scope = document.createElement('select'); scope.id = `basic-${kind}-scope`; scope.disabled = Boolean(record);
        for (const id of [...new Set(record ? [record.scopeId] : active.map(g => g.scopeId))].filter(Boolean)) {
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
                if (maxLengths[name]) input.maxLength = maxLengths[name];
            }
            input.required = Boolean(required); input.style.width = '100%';
            input.id = `basic-${kind}-${name}`;
            input.value = Array.isArray(record?.[name]) ? record[name].join(', ') : record?.[name] || '';
            fields[name] = input; title.appendChild(input); wrapper.appendChild(title); form.appendChild(wrapper);
        }
        let responsibleWrapper = null, pubLabel = null;
        const hasStaffScope = active.some(g => ['staff','executive'].includes(g.role));
        if (hasStaffScope) {
            responsibleWrapper = document.createElement('p');
            const label = document.createElement('label'); label.textContent = 'ผู้รับผิดชอบ (เลือกจากรายชื่อ) ';
            fields.responsibleUserIds = document.createElement('input'); fields.responsibleUserIds.value = (record?.responsibleUserIds || [session.user.id]).join(', ');
            fields.responsibleUserIds.id = `basic-${kind}-responsibleUserIds`;
            label.appendChild(fields.responsibleUserIds); responsibleWrapper.appendChild(label); form.appendChild(responsibleWrapper);
            const publication = document.createElement('select'); publication.id = `basic-${kind}-publication`;
            for (const [value,text] of [['internal','ภายใน'],['public','สาธารณะ']]) { const option=document.createElement('option'); option.value=value;option.textContent=text;publication.appendChild(option); }
            publication.value = record?.publication || 'internal'; fields.publication = publication;
            pubLabel = document.createElement('label'); pubLabel.textContent = ' การเผยแพร่ '; pubLabel.appendChild(publication); form.appendChild(pubLabel);
        }
        const status = document.createElement('p'); status.setAttribute('role','status');
        const save = document.createElement('button'); save.type='submit'; save.textContent='บันทึก';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'ยกเลิก';
        let saving = false;
        cancel.onclick = () => {
            if (saving) return;
            container.replaceChildren();
            if (onCancel) onCancel();
            else {
                const dialog = container.closest?.('dialog');
                if (dialog?.open) dialog.close('cancel');
            }
        };
        const actions = document.createElement('div'); actions.append(save,cancel);
        form.append(status,actions); container.appendChild(form);
        if (!scope.value) {
            save.disabled = true;
            status.textContent = 'คุณไม่มีสิทธิ์เพิ่มข้อมูลในขอบเขตใด';
        }
        let key = null, previous = null;
        form.onsubmit = async event => {
            event.preventDefault(); if (saving || save.disabled) return;
            if (!scope.value || (!record && !active.some(g => g.scopeId === scope.value))) {
                status.textContent = 'คุณไม่มีสิทธิ์เพิ่มข้อมูลในขอบเขตนี้';
                return;
            }
            for (const [name, label, required] of schemas[kind]) {
                if (required && !fields[name].value.trim()) {
                    status.textContent = `กรุณากรอกข้อมูลช่อง${label}`;
                    fields[name].focus?.();
                    return;
                }
            }
            const payload = {};
            for (const [name,input] of Object.entries(fields)) {
                const value = input.value.trim();
                payload[name] = name.endsWith('Ids') ? value.split(',').map(v=>v.trim()).filter(Boolean) : name==='periodDate' ? value || null : value;
            }
            if (payload.websiteUrl && !validHttpUrl(payload.websiteUrl)) {
                status.textContent = 'กรุณากรอกเว็บไซต์เป็นลิงก์ http:// หรือ https:// ที่ถูกต้อง';
                fields.websiteUrl.focus?.();
                return;
            }
            const assetField = kind === 'partners' ? 'logoPath' : 'imagePath';
            if (payload[assetField] && !validAssetPath(payload[assetField])) {
                status.textContent = 'ที่อยู่รูปภาพต้องอยู่ในรูปแบบ resources/ชื่อไฟล์.jpg (.jpeg, .png, .webp)';
                fields[assetField].focus?.();
                return;
            }
            const canAssign = canAssignIn(scope.value);
            if (!canAssign) { delete payload.responsibleUserIds; delete payload.publication; }
            if (!record) payload.scopeId = scope.value;
            const fingerprint = JSON.stringify(payload); if (previous !== fingerprint) { previous = fingerprint; key = crypto.randomUUID(); }
            saving = true; save.disabled = true; cancel.disabled = true; status.textContent = 'กำลังบันทึก';
            try {
                if (record) await window.CstuAuth.mutate('/'+kind+'/'+encodeURIComponent(record.id),payload,record.version);
                else await window.CstuAuth.create('/'+kind,payload,key);
                status.textContent = 'บันทึกแล้ว'; await reload();
            } catch (error) {
                status.textContent = error.status === 409 ? 'ข้อมูลเปลี่ยนแล้ว กรุณาปิดและเปิดรายละเอียดใหม่เพื่อตรวจทาน'
                    : error.status === 403 ? 'คุณไม่มีสิทธิ์บันทึกข้อมูลนี้'
                    : error.status === 404 ? 'ไม่พบขอบเขตหรือรายการที่มีสิทธิ์บันทึก'
                    : error.status === 422 ? 'ข้อมูลไม่ถูกต้องหรือไม่ครบถ้วน กรุณาตรวจสอบฟิลด์อีกครั้ง'
                    : 'บันทึกไม่ได้: '+error.message;
            } finally { saving = false; save.disabled = !scope.value; cancel.disabled = false; }
        };
        if (hasStaffScope) {
            let selectionMounted = false;
            const syncPublicationVisibility = canAssign => {
                if (!pubLabel || !fields.publication) return;
                pubLabel.hidden = !canAssign;
                fields.publication.disabled = !canAssign;
                const pubSection = fields.publication.closest?.('fieldset.entry-section');
                if (pubSection) pubSection.hidden = !canAssign;
            };
            const syncScopeRole = (reset = false) => {
                const canAssign = canAssignIn(scope.value);
                syncPublicationVisibility(canAssign);
                queueMicrotask(() => syncPublicationVisibility(canAssignIn(scope.value)));
                if (kind === 'partners' && fields.responsibleUserIds) {
                    if (canAssign) {
                        if (reset) fields.responsibleUserIds.value = '';
                        if (window.SelectionFields) {
                            selectionMounted = true;
                            window.SelectionFields.mount({form, scope: () => scope.value, fields:[{input:fields.responsibleUserIds,kind:'responsible',label:'ผู้รับผิดชอบ (เลือกได้หลายคน)'}], submit:save, status});
                        } else {
                            responsibleWrapper.hidden = false;
                            fields.responsibleUserIds.disabled = false;
                        }
                    } else {
                        responsibleWrapper.hidden = true;
                        fields.responsibleUserIds.disabled = true;
                        if (selectionMounted && window.SelectionFields) {
                            selectionMounted = false;
                            window.SelectionFields.mount({form, scope: () => scope.value, fields:[], submit:save, status, onReady: () => {
                                form.querySelector('[data-selection-fields]')?.remove();
                                save.disabled = !scope.value;
                            }});
                        } else {
                            save.disabled = !scope.value;
                            if (scope.value) status.textContent = '';
                        }
                    }
                } else if (responsibleWrapper && fields.responsibleUserIds) {
                    responsibleWrapper.hidden = !canAssign;
                    fields.responsibleUserIds.disabled = !canAssign;
                }
            };
            scope.addEventListener('change', () => syncScopeRole(true));
            syncScopeRole(false);
        }
    }
    for(const kind of Object.keys(schemas))window.CstuWork.register(kind,{create:options=>open(kind,options),edit:options=>open(kind,options)});
})();
