/**
 * Agreement Form and Detail Component (Issue #98 / Parent #83).
 *
 * Provides a unified modal for viewing and editing Agreements (MoU / MoA).
 * Uses DOM textContent for all user-supplied data to prevent injection.
 * Manages loading, empty, saving, 401, 403, 404, 409 (conflict), 422, and 503 states.
 */
(() => {
    'use strict';

    let dialog = null;
    let currentAgreement = null;
    let currentVersion = null;
    let currentMode = 'detail'; // 'detail' | 'form'
    let lastActiveElement = null;
    let isSaving = false;

    function ensureDialog() {
        if (dialog) return dialog;
        dialog = document.getElementById('agreement-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'agreement-dialog';
            dialog.className = 'agreement-dialog';
            dialog.style.padding = '2rem';
            dialog.style.maxWidth = '680px';
            dialog.style.width = '90%';
            dialog.style.borderRadius = '8px';
            dialog.style.border = '1px solid var(--border-color, #dedede)';
            dialog.style.boxShadow = '0 10px 25px rgba(0,0,0,0.2)';
            document.body.appendChild(dialog);
        }

        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            close();
        });

        dialog.addEventListener('click', event => {
            if (event.target === dialog) {
                close();
            }
        });

        return dialog;
    }

    function createHeader(titleText) {
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '1.5rem';

        const h2 = document.createElement('h2');
        h2.style.margin = '0';
        h2.textContent = titleText;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'close-btn';
        closeBtn.setAttribute('aria-label', 'ปิดหน้าต่าง');
        closeBtn.textContent = '×';
        closeBtn.style.fontSize = '1.5rem';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = close;

        header.append(h2, closeBtn);
        return header;
    }

    function showStatus(container, message, isError = false) {
        let statusEl = container.querySelector('.agreement-status-msg');
        if (!statusEl) {
            statusEl = document.createElement('p');
            statusEl.className = 'agreement-status-msg';
            statusEl.setAttribute('role', 'status');
            container.appendChild(statusEl);
        }
        statusEl.textContent = message;
        statusEl.style.color = isError ? 'var(--tu-red, #C3002F)' : 'var(--text-gray, #595959)';
        statusEl.style.marginTop = '1rem';
        statusEl.style.fontWeight = isError ? '600' : 'normal';
    }

    function renderDetail(agreement) {
        const dlg = ensureDialog();
        dlg.replaceChildren();

        const header = createHeader(agreement.title || 'รายละเอียดข้อตกลง');
        dlg.appendChild(header);

        const content = document.createElement('div');
        content.className = 'agreement-detail-content';

        const addRow = (label, value) => {
            if (value === undefined || value === null || value === '') return;
            const row = document.createElement('div');
            row.style.marginBottom = '0.75rem';

            const strong = document.createElement('strong');
            strong.textContent = label + ': ';
            row.appendChild(strong);

            const span = document.createElement('span');
            span.textContent = Array.isArray(value) ? value.join(', ') : String(value);
            row.appendChild(span);

            content.appendChild(row);
        };

        addRow('ประเภทข้อตกลง', agreement.agreementType);
        addRow('สถานะ', agreement.status);
        addRow('ขอบเขตหลักสูตร (Scope)', agreement.scopeId);
        addRow('คู่ความร่วมมือ (Partner IDs)', agreement.partnerIds);

        const dates = [];
        if (agreement.startDate) dates.push('เริ่ม: ' + agreement.startDate);
        if (agreement.endDate) dates.push('สิ้นสุด: ' + agreement.endDate);
        if (dates.length) addRow('ระยะเวลา', dates.join(' — '));

        if (agreement.renewalDueOn) addRow('กำหนดพิจารณาต่ออายุ', agreement.renewalDueOn);
        if (agreement.renewalNote) addRow('บันทึกการต่ออายุ', agreement.renewalNote);
        if (agreement.internalNote) addRow('บันทึกภายใน', agreement.internalNote);
        if (agreement.responsibleUserIds?.length) addRow('ผู้รับผิดชอบ', agreement.responsibleUserIds);

        // Extension container for #100 (Status transitions and renewal)
        const statusSec = document.createElement('div');
        statusSec.id = 'agreement-status-section';
        statusSec.style.marginTop = '1rem';
        content.appendChild(statusSec);

        // Extension container for #102/#103 (Document attachments)
        const docsSec = document.createElement('div');
        docsSec.id = 'agreement-documents-section';
        docsSec.style.marginTop = '1rem';
        docsSec.style.borderTop = '1px solid var(--border-color, #dedede)';
        docsSec.style.paddingTop = '1rem';
        const docsHeading = document.createElement('h3');
        docsHeading.textContent = 'เอกสารแนบ';
        docsHeading.style.fontSize = '1.1rem';
        docsHeading.style.marginBottom = '0.5rem';
        const docsPlaceholder = document.createElement('p');
        docsPlaceholder.textContent = 'ยังไม่มีเอกสารแนบในข้อตกลงนี้';
        docsPlaceholder.style.color = 'var(--text-light, #646464)';
        docsSec.append(docsHeading, docsPlaceholder);
        content.appendChild(docsSec);

        dlg.appendChild(content);

        // Actions row
        const actions = document.createElement('div');
        actions.style.marginTop = '1.5rem';
        actions.style.display = 'flex';
        actions.style.gap = '1rem';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'hero-btn';
        editBtn.textContent = 'แก้ไขข้อตกลง';
        editBtn.onclick = () => renderForm(agreement);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'login-btn';
        closeBtn.style.background = 'var(--text-gray, #595959)';
        closeBtn.textContent = 'ปิด';
        closeBtn.onclick = close;

        actions.append(editBtn, closeBtn);
        dlg.appendChild(actions);

        currentMode = 'detail';
        if (!dlg.open) dlg.showModal();
    }

    function renderForm(agreement = null) {
        const dlg = ensureDialog();
        dlg.replaceChildren();

        const isCreate = !agreement;
        const header = createHeader(isCreate ? 'สร้างข้อตกลงความร่วมมือ (MoU / MoA)' : 'แก้ไขข้อตกลงความร่วมมือ');
        dlg.appendChild(header);

        const form = document.createElement('form');
        form.id = 'agreement-edit-form';

        const createField = (id, labelText, inputElement) => {
            const p = document.createElement('p');
            p.style.marginBottom = '1rem';

            const label = document.createElement('label');
            label.htmlFor = id;
            label.textContent = labelText;
            label.style.display = 'block';
            label.style.fontWeight = '600';
            label.style.marginBottom = '0.25rem';

            inputElement.id = id;
            inputElement.style.width = '100%';
            inputElement.style.padding = '8px 12px';
            inputElement.style.borderRadius = 'var(--radius-control, 6px)';
            inputElement.style.border = '1px solid var(--control-border, #858585)';

            p.append(label, inputElement);
            return p;
        };

        // Title
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.required = true;
        titleInput.maxLength = 200;
        titleInput.value = agreement?.title || '';
        form.appendChild(createField('agreement-form-title', 'ชื่อข้อตกลง *', titleInput));

        // Agreement Type
        const typeSelect = document.createElement('select');
        typeSelect.required = true;
        for (const t of ['MoU', 'MoA']) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            if (agreement?.agreementType === t) opt.selected = true;
            typeSelect.appendChild(opt);
        }
        form.appendChild(createField('agreement-form-type', 'ประเภทข้อตกลง *', typeSelect));

        // Scope ID (on create)
        let scopeInput = null;
        if (isCreate) {
            scopeInput = document.createElement('input');
            scopeInput.type = 'text';
            scopeInput.required = true;
            scopeInput.maxLength = 200;
            scopeInput.value = 'cs-demo'; // Default or prompt
            form.appendChild(createField('agreement-form-scope', 'ขอบเขตหลักสูตร (Scope ID) *', scopeInput));
        }

        // Partner IDs
        const partnerInput = document.createElement('input');
        partnerInput.type = 'text';
        partnerInput.required = isCreate;
        partnerInput.placeholder = 'ระบุ ID คู่ความร่วมมือ คั่นด้วยเครื่องหมายจุลภาค เช่น partner-001, partner-002';
        partnerInput.value = (agreement?.partnerIds || []).join(', ');
        form.appendChild(createField('agreement-form-partners', 'รหัสคู่ความร่วมมือ (Partner IDs) *', partnerInput));

        // Start Date & End Date Row
        const datesRow = document.createElement('div');
        datesRow.style.display = 'grid';
        datesRow.style.gridTemplateColumns = '1fr 1fr';
        datesRow.style.gap = '1rem';

        const startInput = document.createElement('input');
        startInput.type = 'date';
        startInput.value = agreement?.startDate || '';

        const endInput = document.createElement('input');
        endInput.type = 'date';
        endInput.value = agreement?.endDate || '';

        datesRow.append(
            createField('agreement-form-start-date', 'วันที่เริ่มต้น', startInput),
            createField('agreement-form-end-date', 'วันที่สิ้นสุด', endInput)
        );
        form.appendChild(datesRow);

        // Renewal Due Date
        const renewalDueInput = document.createElement('input');
        renewalDueInput.type = 'date';
        renewalDueInput.value = agreement?.renewalDueOn || '';
        form.appendChild(createField('agreement-form-renewal-due', 'กำหนดพิจารณาต่ออายุ', renewalDueInput));

        // Renewal Note
        const renewalNoteInput = document.createElement('textarea');
        renewalNoteInput.rows = 3;
        renewalNoteInput.maxLength = 20000;
        renewalNoteInput.value = agreement?.renewalNote || '';
        form.appendChild(createField('agreement-form-renewal-note', 'บันทึกการต่ออายุ', renewalNoteInput));

        // Internal Note
        const internalNoteInput = document.createElement('textarea');
        internalNoteInput.rows = 3;
        internalNoteInput.maxLength = 20000;
        internalNoteInput.value = agreement?.internalNote || '';
        form.appendChild(createField('agreement-form-internal-note', 'บันทึกภายใน', internalNoteInput));

        // Responsible Users (Staff can assign/reassign; Coordinator cannot)
        let isStaff = true;
        try {
            const authState = window.CstuAuth?.state ? window.CstuAuth.state() : null;
            const currentRoles = (authState && window.CstuAuth?.roles) ? window.CstuAuth.roles(authState) : [];
            if (currentRoles.length > 0 && !currentRoles.includes('staff')) {
                isStaff = false;
            }
        } catch {
            isStaff = true;
        }

        let respInput = null;
        if (isStaff) {
            respInput = document.createElement('input');
            respInput.type = 'text';
            respInput.placeholder = 'ระบุ ID ผู้รับผิดชอบ คั่นด้วยเครื่องหมายจุลภาค เช่น staff-001, coord-002';
            respInput.value = (agreement?.responsibleUserIds || []).join(', ');
            form.appendChild(createField('agreement-form-responsible', 'ผู้รับผิดชอบ (Responsible User IDs)', respInput));
        }

        // Status container
        const statusContainer = document.createElement('div');
        statusContainer.className = 'agreement-form-status';
        form.appendChild(statusContainer);

        // Action Buttons
        const actionRow = document.createElement('div');
        actionRow.style.display = 'flex';
        actionRow.style.gap = '1rem';
        actionRow.style.marginTop = '1.5rem';

        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.className = 'hero-btn';
        submitBtn.textContent = isCreate ? 'สร้างข้อตกลง' : 'บันทึกการแก้ไข';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'login-btn';
        cancelBtn.style.background = 'var(--text-gray, #595959)';
        cancelBtn.textContent = 'ยกเลิก';
        cancelBtn.onclick = () => {
            if (agreement) {
                renderDetail(agreement);
            } else {
                close();
            }
        };

        actionRow.append(submitBtn, cancelBtn);
        form.appendChild(actionRow);

        form.onsubmit = async event => {
            event.preventDefault();
            if (isSaving) return;

            // Date validation: start <= end
            const sDate = startInput.value.trim() || null;
            const eDate = endInput.value.trim() || null;
            if (sDate && eDate && sDate > eDate) {
                showStatus(statusContainer, 'วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด', true);
                return;
            }

            const parsedPartners = [...new Set(partnerInput.value
                .split(',')
                .map(p => p.trim())
                .filter(Boolean))];

            if (isCreate && parsedPartners.length === 0) {
                showStatus(statusContainer, 'กรุณาระบุรหัสคู่ความร่วมมืออย่างน้อย 1 รายการ', true);
                return;
            }
            if (parsedPartners.length > 20) {
                showStatus(statusContainer, 'ระบุคู่ความร่วมมือได้สูงสุดไม่เกิน 20 รายการ', true);
                return;
            }

            if (isStaff && respInput) {
                const parsedResp = [...new Set(respInput.value
                    .split(',')
                    .map(u => u.trim())
                    .filter(Boolean))];
                if (parsedResp.length > 20) {
                    showStatus(statusContainer, 'ระบุผู้รับผิดชอบได้สูงสุดไม่เกิน 20 รายการ', true);
                    return;
                }
            }

            const payload = {
                title: titleInput.value.trim(),
                agreementType: typeSelect.value,
                startDate: sDate,
                endDate: eDate,
                renewalDueOn: renewalDueInput.value.trim() || null,
                renewalNote: renewalNoteInput.value.trim() || null,
                internalNote: internalNoteInput.value.trim() || null,
            };

            if (parsedPartners.length > 0) {
                payload.partnerIds = parsedPartners;
            }

            if (isStaff && respInput) {
                const parsedResp = [...new Set(respInput.value
                    .split(',')
                    .map(u => u.trim())
                    .filter(Boolean))];
                if (parsedResp.length > 0) {
                    payload.responsibleUserIds = parsedResp;
                }
            }

            if (isCreate) {
                payload.scopeId = scopeInput.value.trim();
            }

            isSaving = true;
            submitBtn.disabled = true;
            showStatus(statusContainer, 'กำลังบันทึกข้อมูล...');

            try {
                if (isCreate) {
                    const idemKey = 'idem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
                    const res = await window.CstuAuth.create('/agreements', payload, idemKey);
                    currentAgreement = res.data;
                    currentVersion = res.data.version;
                    renderDetail(res.data);
                } else {
                    const res = await window.CstuAuth.mutate(
                        '/agreements/' + encodeURIComponent(agreement.id),
                        payload,
                        currentVersion
                    );
                    currentAgreement = res.data;
                    currentVersion = res.data.version;
                    renderDetail(res.data);
                }
            } catch (err) {
                const status = err.status;
                let message = 'บันทึกไม่สำเร็จ: ' + (err.message || 'ข้อผิดพลาดระบบ');

                if (status === 401) {
                    message = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
                } else if (status === 403) {
                    message = 'คุณไม่มีสิทธิ์ดำเนินการกับข้อตกลงนี้';
                } else if (status === 404) {
                    message = 'ไม่พบข้อมูลข้อตกลง หรืออยู่นอกขอบเขตที่คุณมีสิทธิ์';
                } else if (status === 409) {
                    message = 'ข้อมูลถูกแก้ไขโดยผู้อื่น (Version Conflict)';
                    showStatus(statusContainer, message, true);

                    // Add reload button to let user review latest data without silent overwrite
                    let reloadBtn = statusContainer.querySelector('.reload-conflict-btn');
                    if (!reloadBtn) {
                        reloadBtn = document.createElement('button');
                        reloadBtn.type = 'button';
                        reloadBtn.className = 'hero-btn reload-conflict-btn';
                        reloadBtn.style.marginTop = '0.5rem';
                        reloadBtn.textContent = 'โหลดข้อมูลล่าสุดเพื่อตรวจทาน';
                        reloadBtn.onclick = () => openDetail(agreement.id);
                        statusContainer.appendChild(reloadBtn);
                    }
                    return;
                } else if (status === 422) {
                    message = 'ข้อมูลที่ระบุไม่ถูกต้อง กรุณาตรวจสอบข้อมูลและวันที่';
                } else if (status === 503) {
                    message = 'ระบบไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่ภายหลัง';
                }

                showStatus(statusContainer, message, true);
            } finally {
                isSaving = false;
                submitBtn.disabled = false;
            }
        };

        dlg.appendChild(form);
        currentMode = 'form';
        if (!dlg.open) dlg.showModal();
    }

    async function openDetail(id) {
        lastActiveElement = document.activeElement;
        const dlg = ensureDialog();
        dlg.replaceChildren();

        const header = createHeader('ข้อตกลงความร่วมมือ');
        dlg.appendChild(header);

        const statusContainer = document.createElement('div');
        dlg.appendChild(statusContainer);
        showStatus(statusContainer, 'กำลังโหลดข้อมูลข้อตกลง...');

        if (!dlg.open) dlg.showModal();

        try {
            const res = await window.CstuAuth.request('/agreements/' + encodeURIComponent(id));
            currentAgreement = res.data;
            currentVersion = res.data.version;
            renderDetail(res.data);
        } catch (err) {
            let msg = 'ไม่สามารถโหลดข้อตกลงได้';
            if (err.status === 401) msg = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
            else if (err.status === 403) msg = 'คุณไม่มีสิทธิ์เข้าถึงข้อตกลงนี้';
            else if (err.status === 404) msg = 'ไม่พบข้อตกลง หรืออยู่นอกขอบเขตที่คุณมีสิทธิ์';
            else if (err.status === 503) msg = 'ระบบไม่พร้อมใช้งานในขณะนี้';
            showStatus(statusContainer, msg, true);
        }
    }

    function openCreate(scopeId = null) {
        lastActiveElement = document.activeElement;
        currentAgreement = null;
        currentVersion = null;
        renderForm();
        if (scopeId) {
            const scopeField = document.getElementById('agreement-form-scope');
            if (scopeField) scopeField.value = scopeId;
        }
    }

    function close() {
        if (!dialog) return;
        if (dialog.open) dialog.close();
        currentAgreement = null;
        currentVersion = null;
        if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
            lastActiveElement.focus();
        }
    }

    window.AgreementComponent = {
        openDetail,
        openCreate,
        renderDetail,
        renderForm,
        close,
    };
})();

