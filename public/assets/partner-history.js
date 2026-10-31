/* Internal Partner history stays inside the authorized detail screen. */
(() => {
    'use strict';
    async function mount(container, partner, session) {
        container.classList.add('partner-history-section');
        container.replaceChildren();

        const header = document.createElement('div');
        header.className = 'partner-section-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'partner-title-wrap';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'partner-title-icon';
        iconSpan.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

        const title = document.createElement('h3');
        title.textContent = 'ประวัติความสัมพันธ์ภายใน';

        const countBadge = document.createElement('span');
        countBadge.className = 'partner-count-badge';
        countBadge.hidden = true;

        titleWrap.append(iconSpan, title, countBadge);

        const canEdit = window.CstuWork.canEdit(session, partner);
        let addBtn = null;
        if (canEdit) {
            addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'partner-btn-add';
            addBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> <span>บันทึกเหตุการณ์</span>';
            addBtn.onclick = () => form();
        }

        if (addBtn) header.append(titleWrap, addBtn);
        else header.append(titleWrap);

        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        status.className = 'partner-status-msg';

        const list = document.createElement('div');
        list.className = 'partner-history-list';

        const editor = document.createElement('div');
        editor.className = 'partner-editor-container';

        container.append(header, status, list, editor);

        const base = '/partners/' + encodeURIComponent(partner.id) + '/history';

        const kindLabels = {
            meeting: 'การประชุม (meeting)',
            agreement: 'ข้อตกลง (agreement)',
            activity: 'กิจกรรม (activity)',
            other: 'อื่นๆ (other)'
        };

        async function load() {
            list.replaceChildren();
            status.textContent = 'กำลังโหลดประวัติ';
            countBadge.hidden = true;
            try {
                let cursor = null, total = 0;
                do {
                    const result = await window.CstuAuth.request(base + '?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
                    for (const row of result.data) {
                        const card = document.createElement('div');
                        card.className = 'partner-history-card';

                        const cardHeader = document.createElement('div');
                        cardHeader.className = 'history-card-header';

                        const badges = document.createElement('div');
                        badges.className = 'history-badges';

                        const dateBadge = document.createElement('span');
                        dateBadge.className = 'history-date';
                        dateBadge.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> <span>' + row.occurredOn + '</span>';

                        const kindBadge = document.createElement('span');
                        kindBadge.className = 'history-kind kind-' + (row.kind || 'other');
                        kindBadge.textContent = kindLabels[row.kind] || row.kind;

                        badges.append(dateBadge, kindBadge);
                        cardHeader.appendChild(badges);

                        if (canEdit) {
                            const edit = document.createElement('button');
                            edit.type = 'button';
                            edit.className = 'btn-edit-sm';
                            edit.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> <span>แก้ไขเหตุการณ์</span>';
                            edit.onclick = () => form(row);
                            cardHeader.appendChild(edit);
                        }
                        card.appendChild(cardHeader);

                        const noteP = document.createElement('div');
                        noteP.className = 'history-note';
                        noteP.textContent = row.note;
                        card.appendChild(noteP);

                        if (row.referenceId) {
                            const refPill = document.createElement('div');
                            refPill.className = 'history-ref-row';
                            const link = document.createElement('a');
                            link.className = 'history-ref-pill';
                            link.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> <span>' + (row.referenceLabel || 'เปิดรายการอ้างอิง') + '</span>';
                            link.href = 'index.html?kind=' + (row.referenceType === 'activity' ? 'activities' : 'agreements') + '&id=' + encodeURIComponent(row.referenceId);
                            refPill.appendChild(link);
                            card.appendChild(refPill);
                        }

                        list.appendChild(card);
                        total++;
                    }
                    cursor = result.page.nextCursor;
                } while (cursor);

                if (total > 0) {
                    countBadge.textContent = `${total} รายการ`;
                    countBadge.hidden = false;
                    status.textContent = '';
                } else {
                    countBadge.hidden = true;
                    status.textContent = 'ยังไม่มีประวัติความสัมพันธ์ภายใน';
                }
            } catch (error) {
                status.textContent = 'โหลดประวัติไม่ได้: ' + error.message;
            }
        }

        async function form(row = null) {
            editor.replaceChildren();
            const card = document.createElement('div');
            card.className = 'partner-editor-card';

            const formTitle = document.createElement('div');
            formTitle.className = 'partner-editor-title';
            formTitle.textContent = row ? 'แก้ไขเหตุการณ์ความสัมพันธ์' : 'บันทึกเหตุการณ์ความสัมพันธ์ใหม่';
            card.appendChild(formTitle);

            const form = document.createElement('form');
            form.className = 'partner-form';
            const grid = document.createElement('div');
            grid.className = 'partner-form-grid';

            function createField(label, inputNode, isRequired = false, isFullWidth = false) {
                const f = document.createElement('div');
                f.className = 'partner-form-field' + (isFullWidth ? ' full-width' : '');
                const l = document.createElement('label');
                l.textContent = label;
                if (isRequired) {
                    const req = document.createElement('span');
                    req.style.color = 'var(--tu-red, #c3002f)';
                    req.textContent = ' *';
                    l.appendChild(req);
                }
                f.append(l, inputNode);
                grid.appendChild(f);
                return inputNode;
            }

            const date = document.createElement('input');
            date.type = 'date';
            date.required = true;
            date.value = row?.occurredOn || '';
            createField('วันที่', date, true);

            const kind = document.createElement('select');
            for (const [val, label] of Object.entries(kindLabels)) {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = label;
                kind.appendChild(opt);
            }
            kind.value = row?.kind || 'meeting';
            createField('ประเภทเหตุการณ์', kind);

            const note = document.createElement('textarea');
            note.rows = 3;
            note.required = true;
            note.maxLength = 20000;
            note.placeholder = 'ระบุรายละเอียดหรือข้อสรุปของเหตุการณ์';
            note.value = row?.note || '';
            createField('สรุปเหตุการณ์', note, true, true);

            const refType = document.createElement('select');
            for (const [value, label] of [['', 'ไม่เชื่อมรายการ'], ['activity', 'กิจกรรม'], ['agreement', 'ข้อตกลง']]) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                refType.appendChild(option);
            }
            refType.value = row?.referenceType || '';
            createField('ประเภทรายการอ้างอิง', refType);

            const ref = document.createElement('select');
            createField('เลือกข้อมูลอ้างอิงที่มีสิทธิ์', ref);

            let unlink = null;
            if (row?.referenceId) {
                const unlinkWrap = document.createElement('div');
                unlinkWrap.className = 'partner-form-field full-width';
                const unlinkLabel = document.createElement('label');
                unlinkLabel.style.display = 'inline-flex';
                unlinkLabel.style.alignItems = 'center';
                unlinkLabel.style.gap = '0.5rem';
                unlinkLabel.style.cursor = 'pointer';
                unlink = document.createElement('input');
                unlink.type = 'checkbox';
                unlink.style.width = 'auto';
                unlinkLabel.append(unlink, document.createTextNode(' ถอดรายการอ้างอิงเดิม'));
                unlinkWrap.appendChild(unlinkLabel);
                grid.appendChild(unlinkWrap);
            }

            form.appendChild(grid);

            const message = document.createElement('p');
            message.setAttribute('role', 'status');
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
            save.textContent = row ? 'บันทึกการแก้ไข' : 'บันทึกเหตุการณ์';

            actionsDiv.append(cancel, save);
            form.append(message, actionsDiv);
            card.appendChild(form);
            editor.appendChild(card);

            async function options() {
                save.disabled = true;
                ref.replaceChildren();
                ref.disabled = !refType.value;
                try {
                    if (refType.value) {
                        let cursor = null;
                        do {
                            const response = await window.CstuAuth.request('/' + (refType.value === 'activity' ? 'activities' : 'agreements') + '?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
                            for (const item of response.data) {
                                if (item.scopeId !== partner.scopeId) continue;
                                const option = document.createElement('option');
                                option.value = item.id;
                                option.textContent = item.title || item.id;
                                ref.appendChild(option);
                            }
                            cursor = response.page.nextCursor;
                        } while (cursor);
                        if (row?.referenceType === refType.value && row.referenceId) ref.value = row.referenceId;
                    }
                } catch (error) {
                    message.textContent = 'โหลดตัวเลือกไม่ได้: ' + error.message;
                } finally {
                    save.disabled = false;
                }
            }

            refType.onchange = options;
            await options();

            let key = null, fingerprint = null;
            form.onsubmit = async event => {
                event.preventDefault();
                if (save.disabled) return;
                const payload = { occurredOn: date.value, kind: kind.value, note: note.value.trim() };
                if (unlink?.checked) {
                    payload.referenceType = null;
                    payload.referenceId = null;
                } else if (refType.value) {
                    if (!ref.value) {
                        message.textContent = 'กรุณาเลือกรายการอ้างอิง';
                        return;
                    }
                    payload.referenceType = refType.value;
                    payload.referenceId = ref.value;
                } else if (row?.referenceId) {
                    payload.referenceType = null;
                    payload.referenceId = null;
                }

                const next = JSON.stringify(payload);
                if (fingerprint !== next) { fingerprint = next; key = crypto.randomUUID(); }
                save.disabled = true;
                message.textContent = 'กำลังบันทึก...';
                try {
                    if (row) await window.CstuAuth.mutate(base + '/' + encodeURIComponent(row.id), payload, row.version);
                    else await window.CstuAuth.create(base, payload, key);
                    editor.replaceChildren();
                    await load();
                } catch (error) {
                    message.textContent = error.status === 409
                        ? 'ข้อมูลเปลี่ยนแล้ว กรุณายกเลิกและเปิดเหตุการณ์ล่าสุดเพื่อตรวจทาน'
                        : 'บันทึกไม่ได้: ' + error.message;
                } finally {
                    save.disabled = false;
                }
            };
        }

        await load();
    }
    window.PartnerHistory = { mount };
})();
