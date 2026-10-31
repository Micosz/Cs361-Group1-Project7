/* Contact records stay behind the same parent authorization as their API. */
(() => {
    async function mount(host, partner, session) {
        if (!window.CstuWork.roles(session,partner.scopeId).some(role => ['staff','coordinator','executive'].includes(role))) return;
        host.classList.add('partner-contacts-section');
        host.replaceChildren();

        const header = document.createElement('div');
        header.className = 'partner-section-header';
        
        const titleWrap = document.createElement('div');
        titleWrap.className = 'partner-title-wrap';
        
        const iconSpan = document.createElement('span');
        iconSpan.className = 'partner-title-icon';
        iconSpan.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
        
        const title = document.createElement('h3');
        title.textContent = 'ผู้ติดต่อภายใน';
        
        const countBadge = document.createElement('span');
        countBadge.className = 'partner-count-badge';
        countBadge.hidden = true;
        
        titleWrap.append(iconSpan, title, countBadge);
        
        const editable = window.CstuWork.canEdit(session,partner);
        let addBtn = null;
        if (editable) {
            addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'partner-btn-add';
            addBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> <span>เพิ่มผู้ติดต่อ</span>';
            addBtn.onclick = () => form();
        }
        
        if (addBtn) header.append(titleWrap, addBtn);
        else header.append(titleWrap);
        
        const status = document.createElement('p');
        status.setAttribute('role','status');
        status.className = 'partner-status-msg';
        
        const list = document.createElement('div');
        list.className = 'partner-contacts-list';
        
        const editor = document.createElement('div');
        editor.className = 'partner-editor-container';
        
        host.append(header, status, list, editor);
        
        const base = '/partners/'+encodeURIComponent(partner.id)+'/contacts';
        
        async function load() {
            list.replaceChildren();
            status.textContent = 'กำลังโหลดผู้ติดต่อ';
            countBadge.hidden = true;
            try {
                const result = await window.CstuAuth.request(base);
                if (!host.isConnected) return;
                const rows = result.data || [];
                if (rows.length > 0) {
                    countBadge.textContent = `${rows.length} คน`;
                    countBadge.hidden = false;
                    status.textContent = '';
                } else {
                    countBadge.hidden = true;
                    status.textContent = 'ยังไม่มีผู้ติดต่อ';
                }
                for (const row of rows) {
                    const card = document.createElement('div');
                    card.className = 'partner-contact-card';
                    
                    const main = document.createElement('div');
                    main.className = 'contact-card-main';
                    
                    const avatar = document.createElement('div');
                    avatar.className = 'contact-avatar';
                    const initials = (row.name || '').trim().slice(0, 2).toUpperCase() || 'CP';
                    avatar.textContent = initials;
                    
                    const info = document.createElement('div');
                    info.className = 'contact-info';
                    
                    const nameRow = document.createElement('div');
                    nameRow.className = 'contact-name-row';
                    
                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'contact-name';
                    nameSpan.textContent = row.name;
                    nameRow.appendChild(nameSpan);
                    
                    if (row.position && row.position !== '-') {
                        const posBadge = document.createElement('span');
                        posBadge.className = 'contact-pos-badge';
                        posBadge.textContent = row.position;
                        nameRow.appendChild(posBadge);
                    }
                    info.appendChild(nameRow);
                    
                    const commsRow = document.createElement('div');
                    commsRow.className = 'contact-comms-row';
                    
                    if (row.email && row.email !== '-') {
                        const emailSpan = document.createElement('span');
                        emailSpan.className = 'contact-comm-item';
                        emailSpan.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
                        const emailText = document.createElement('span');
                        emailText.textContent = row.email;
                        emailSpan.appendChild(emailText);
                        commsRow.appendChild(emailSpan);
                    }
                    
                    if (row.phone && row.phone !== '-') {
                        const phoneSpan = document.createElement('span');
                        phoneSpan.className = 'contact-comm-item';
                        phoneSpan.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
                        const phoneText = document.createElement('span');
                        phoneText.textContent = row.phone;
                        phoneSpan.appendChild(phoneText);
                        commsRow.appendChild(phoneSpan);
                    }
                    
                    if (commsRow.children.length > 0) info.appendChild(commsRow);
                    main.append(avatar, info);
                    card.appendChild(main);
                    
                    if (editable) {
                        const actions = document.createElement('div');
                        actions.className = 'contact-actions';
                        
                        const edit = document.createElement('button');
                        edit.type = 'button';
                        edit.className = 'btn-edit-sm';
                        edit.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> <span>แก้ไข</span>';
                        edit.onclick = () => form(row);
                        
                        const remove = document.createElement('button');
                        remove.type = 'button';
                        remove.className = 'btn-del-sm';
                        remove.setAttribute('aria-label', 'ลบผู้ติดต่อ ' + row.name);
                        remove.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> <span>ลบ</span>';
                        remove.onclick = async () => {
                            if (!window.confirm('ยืนยันลบผู้ติดต่อ ' + row.name + ' ใช่ไหม')) return;
                            remove.disabled = true;
                            status.textContent = 'กำลังลบผู้ติดต่อ';
                            try {
                                await window.CstuAuth.remove(base+'/'+encodeURIComponent(row.id),row.version);
                                await load();
                            } catch(error) {
                                status.textContent = error.status===409
                                    ? 'ข้อมูลเปลี่ยนแล้ว กรุณาเปิดรายละเอียดใหม่'
                                    : 'ลบผู้ติดต่อไม่สำเร็จ';
                                remove.disabled = false;
                            }
                        };
                        actions.append(edit, remove);
                        card.appendChild(actions);
                    }
                    list.appendChild(card);
                }
            } catch { status.textContent = 'โหลดผู้ติดต่อไม่สำเร็จ'; }
        }
        
        function form(record) {
            editor.replaceChildren();
            const card = document.createElement('div');
            card.className = 'partner-editor-card';
            
            const formTitle = document.createElement('div');
            formTitle.className = 'partner-editor-title';
            formTitle.textContent = record ? `แก้ไขผู้ติดต่อ: ${record.name}` : 'เพิ่มผู้ติดต่อใหม่';
            card.appendChild(formTitle);
            
            const form = document.createElement('form');
            form.className = 'partner-form';
            const grid = document.createElement('div');
            grid.className = 'partner-form-grid';
            
            const fields = {};
            const defs = [
                ['name', 'ชื่อผู้ติดต่อ', true, 'ระบุชื่อ-นามสกุล', 'text'],
                ['position', 'ตำแหน่ง', false, 'เช่น ผู้ประสานงาน', 'text'],
                ['email', 'อีเมล', false, 'example@dome.tu.ac.th', 'email'],
                ['phone', 'โทรศัพท์', false, 'เช่น 02-xxx-xxxx', 'text']
            ];
            
            for (const [key, text, isReq, placeholder, inputType] of defs) {
                const fieldDiv = document.createElement('div');
                fieldDiv.className = 'partner-form-field';
                
                const label = document.createElement('label');
                label.textContent = text;
                if (isReq) {
                    const reqSpan = document.createElement('span');
                    reqSpan.style.color = 'var(--tu-red, #c3002f)';
                    reqSpan.textContent = ' *';
                    label.appendChild(reqSpan);
                }
                
                const input = document.createElement('input');
                input.type = inputType;
                input.required = isReq;
                input.placeholder = placeholder;
                input.value = record?.[key] || '';
                
                fieldDiv.append(label, input);
                grid.appendChild(fieldDiv);
                fields[key] = input;
            }
            form.appendChild(grid);
            
            const message = document.createElement('p');
            message.setAttribute('role','status');
            message.className = 'partner-form-status';
            
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'partner-form-actions';
            
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'btn-cancel-ghost';
            cancel.textContent = 'ยกเลิก';
            cancel.onclick = () => editor.replaceChildren();
            
            const save = document.createElement('button');
            save.type = 'submit';
            save.className = 'btn-save-primary';
            save.textContent = record ? 'บันทึกการแก้ไข' : 'บันทึกผู้ติดต่อ';
            
            actionsDiv.append(cancel, save);
            form.append(message, actionsDiv);
            card.appendChild(form);
            editor.appendChild(card);
            
            let key, fingerprint;
            form.onsubmit = async event => {
                event.preventDefault();
                if (save.disabled) return;
                const payload = Object.fromEntries(Object.entries(fields).map(([k, inp]) => [k, inp.value.trim()]));
                const next = JSON.stringify(payload);
                if (next !== fingerprint) { fingerprint = next; key = crypto.randomUUID(); }
                save.disabled = true;
                message.textContent = 'กำลังบันทึก...';
                try {
                    if (record) await window.CstuAuth.mutate(base+'/'+encodeURIComponent(record.id), payload, record.version);
                    else await window.CstuAuth.create(base, payload, key);
                    editor.replaceChildren();
                    await load();
                } catch(error) {
                    message.textContent = error.status === 409
                        ? 'ข้อมูลเปลี่ยนแล้ว กรุณาเปิดรายละเอียดใหม่'
                        : 'บันทึกผู้ติดต่อไม่สำเร็จ';
                } finally {
                    save.disabled = false;
                }
            };
        }
        
        await load();
    }
    window.PartnerContacts = { mount };
})();
