'use strict';
const workspaceStatus = document.getElementById('workspace-status');
const openRoles = document.getElementById('open-roles');
const scope = document.getElementById('role-scope');
const target = document.getElementById('role-target');
const choices = document.getElementById('role-choices');
const saveRoles = document.getElementById('save-roles');
const roleStatus = document.getElementById('role-status');
let version = null, selectedTarget = null, selectedScope = null;
let userRoles = [];
let currentSubmissionKey = null;

const exchangeSection = document.getElementById('exchange-section');
const openAddExchange = document.getElementById('open-add-exchange');
const exchangeListStatus = document.getElementById('exchange-list-status');
const exchangeList = document.getElementById('exchange-list');
const exchangeDialog = document.getElementById('exchange-dialog');
const exchangeForm = document.getElementById('exchange-form');
const exchangeDialogTitle = document.getElementById('exchange-dialog-title');
const exchangeId = document.getElementById('exchange-id');
const exchangeVersion = document.getElementById('exchange-version');
const exchangeScope = document.getElementById('exchange-scope');
const exchangeTitle = document.getElementById('exchange-title');
const exchangePartnerIds = document.getElementById('exchange-partner-ids');
const exchangeAgreementId = document.getElementById('exchange-agreement-id');
const exchangeStartDate = document.getElementById('exchange-start-date');
const exchangeEndDate = document.getElementById('exchange-end-date');
const exchangeParticipantUsers = document.getElementById('exchange-participant-users');
const exchangeSupportingInfo = document.getElementById('exchange-supporting-info');
const exchangeSupportingInfoParticipant = document.getElementById('exchange-supporting-info-participant');
const staffExchangeFields = document.getElementById('staff-exchange-fields');
const exchangeResponsibleUsers = document.getElementById('exchange-responsible-users');
const exchangeStatus = document.getElementById('exchange-status');
const exchangeSubmitBtn = document.getElementById('exchange-submit-btn');
const exchangeCloseBtn = document.getElementById('exchange-close-btn');

function invalidateSelection() {
    version = null; selectedTarget = null; selectedScope = null;
    choices.disabled = true; saveRoles.disabled = true;
    document.getElementById('role-user').textContent = '';
    document.getElementById('confirm-identity').checked = false;
}

async function loadExchanges() {
    if (!exchangeSection || exchangeSection.hidden) return;
    exchangeListStatus.textContent = 'กำลังโหลดโครงการแลกเปลี่ยน...';
    exchangeList.replaceChildren();
    try {
        const res = await window.CstuAuth.request('/exchanges');
        const exchanges = res.data || [];
        if (!exchanges.length) {
            exchangeListStatus.textContent = 'ไม่พบโครงการแลกเปลี่ยนในขอบเขตของคุณ';
            return;
        }
        exchangeListStatus.textContent = '';
        const session = await window.CstuAuth.refresh();
        const currentUserId = session?.user?.id;
        const isStaff = userRoles.includes('staff');

        for (const ex of exchanges) {
            const card = document.createElement('div');
            card.style.cssText = 'border:1px solid #ddd; border-radius:6px; padding:1rem; background:#fff;';

            const header = document.createElement('div');
            header.style.cssText = 'display:flex; justify-content:space-between; align-items:flex-start;';

            const titleEl = document.createElement('h3');
            titleEl.style.margin = '0';
            titleEl.textContent = ex.title;
            header.appendChild(titleEl);

            const statusBadge = document.createElement('span');
            statusBadge.style.cssText = 'padding:0.2rem 0.5rem; border-radius:4px; font-size:0.85rem; background:#e0e7ff; color:#3730a3;';
            statusBadge.textContent = ex.status || 'draft';
            header.appendChild(statusBadge);
            card.appendChild(header);

            if (ex.startDate || ex.endDate) {
                const datesEl = document.createElement('p');
                datesEl.style.cssText = 'margin:0.5rem 0 0; color:#555; font-size:0.9rem;';
                datesEl.textContent = 'ระยะเวลา: ' + (ex.startDate || '-') + ' ถึง ' + (ex.endDate || '-');
                card.appendChild(datesEl);
            }

            if (ex.supportingInfoForParticipant) {
                const infoEl = document.createElement('p');
                infoEl.style.cssText = 'margin:0.5rem 0 0; font-size:0.9rem;';
                infoEl.textContent = 'ข้อมูลสำหรับผู้เข้าร่วม: ' + ex.supportingInfoForParticipant;
                card.appendChild(infoEl);
            }

            const canEdit = isStaff || (userRoles.includes('coordinator') && (ex.responsibleUserIds || []).includes(currentUserId));
            if (canEdit && exchangeDialog) {
                const actions = document.createElement('div');
                actions.style.marginTop = '0.75rem';
                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.textContent = 'แก้ไข';
                editBtn.style.cssText = 'padding:0.3rem 0.6rem; cursor:pointer;';
                editBtn.onclick = () => openEditExchange(ex);
                actions.appendChild(editBtn);
                card.appendChild(actions);
            }

            exchangeList.appendChild(card);
        }
    } catch {
        exchangeListStatus.textContent = 'โหลดโครงการแลกเปลี่ยนไม่สำเร็จ';
    }
}

function openAddExchangeDialog(scopes) {
    exchangeDialogTitle.textContent = 'เพิ่มโครงการแลกเปลี่ยน';
    exchangeId.value = '';
    exchangeVersion.value = '';
    exchangeTitle.value = '';
    exchangePartnerIds.value = '';
    exchangeAgreementId.value = '';
    exchangeStartDate.value = '';
    exchangeEndDate.value = '';
    exchangeParticipantUsers.value = '';
    exchangeSupportingInfo.value = '';
    exchangeSupportingInfoParticipant.value = '';
    exchangeResponsibleUsers.value = '';
    exchangeStatus.textContent = '';
    exchangeSubmitBtn.disabled = false;

    exchangeScope.replaceChildren();
    for (const sc of scopes) {
        const opt = document.createElement('option');
        opt.value = sc;
        opt.textContent = sc;
        exchangeScope.appendChild(opt);
    }
    exchangeScope.disabled = false;

    const isStaff = userRoles.includes('staff');
    if (staffExchangeFields) staffExchangeFields.hidden = !isStaff;

    currentSubmissionKey = 'ex-key-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    exchangeDialog.showModal();
}

function openEditExchange(ex) {
    exchangeDialogTitle.textContent = 'แก้ไขโครงการแลกเปลี่ยน';
    exchangeId.value = ex.id;
    exchangeVersion.value = ex.version;
    exchangeTitle.value = ex.title || '';
    exchangePartnerIds.value = (ex.partnerIds || []).join(', ');
    exchangeAgreementId.value = ex.agreementId || '';
    exchangeStartDate.value = ex.startDate || '';
    exchangeEndDate.value = ex.endDate || '';
    exchangeParticipantUsers.value = (ex.participantUserIds || []).join(', ');
    exchangeSupportingInfo.value = ex.supportingInfo || '';
    exchangeSupportingInfoParticipant.value = ex.supportingInfoForParticipant || '';
    exchangeResponsibleUsers.value = (ex.responsibleUserIds || []).join(', ');
    exchangeStatus.textContent = '';
    exchangeSubmitBtn.disabled = false;

    exchangeScope.replaceChildren();
    const opt = document.createElement('option');
    opt.value = ex.scopeId;
    opt.textContent = ex.scopeId;
    exchangeScope.appendChild(opt);
    exchangeScope.disabled = true;

    const isStaff = userRoles.includes('staff');
    if (staffExchangeFields) staffExchangeFields.hidden = !isStaff;

    currentSubmissionKey = null;
    exchangeDialog.showModal();
}

async function refreshWorkspace() {
    openRoles.hidden = true;
    if (exchangeSection) exchangeSection.hidden = true;
    invalidateSelection();
    if (!window.CstuAuth?.enabled()) {
        workspaceStatus.textContent = 'พื้นที่ผู้ใช้ยังไม่เปิดใช้งาน กรุณากลับหน้าหลัก';
        return;
    }
    try {
        const session = await window.CstuAuth.refresh();
        if (!session?.user) { window.location.replace('login.html'); return; }
        const view = new URLSearchParams(window.location.search).get('view');
        userRoles = window.CstuAuth.roles(session);
        const managed = [...new Set(session.capabilities.filter(c => c.name === 'manageRoles').map(c => c.scopeId))];
        if (view && (view === 'roles' ? !managed.length : !userRoles.includes(view))) {
            workspaceStatus.textContent = 'คุณไม่มีสิทธิ์เข้าพื้นที่นี้'; return;
        }
        workspaceStatus.textContent = userRoles.length
            ? 'เข้าสู่ระบบแล้ว ข้อมูลการทำงานแสดงตามสิทธิ์และขอบเขตหลักสูตร'
            : 'เข้าสู่ระบบแล้ว รอผู้มีสิทธิ์มอบหมายบทบาทงานภายใน';
        scope.replaceChildren();
        for (const id of managed) {
            const option = document.createElement('option'); option.value = id; option.textContent = id; scope.append(option);
        }
        openRoles.hidden = !managed.length;

        // Exchange section handling
        const activeScopes = [...new Set((session.grants || []).filter(g => g.active).map(g => g.scopeId))];
        const canManageExchanges = userRoles.some(r => ['coordinator', 'staff', 'executive'].includes(r));
        if (exchangeSection && canManageExchanges && activeScopes.length) {
            exchangeSection.hidden = false;
            const canAdd = userRoles.some(r => ['coordinator', 'staff'].includes(r));
            if (openAddExchange) {
                openAddExchange.hidden = !canAdd;
                openAddExchange.onclick = () => openAddExchangeDialog(activeScopes);
            }
            await loadExchanges();
        }
    } catch { workspaceStatus.textContent = 'ตรวจสิทธิ์ไม่ได้ กรุณาลองใหม่ภายหลัง'; }
}
openRoles.onclick = () => document.getElementById('role-dialog').showModal();
document.getElementById('close-roles').onclick = () => document.getElementById('role-dialog').close();
target.addEventListener('input', invalidateSelection);
scope.addEventListener('change', invalidateSelection);
document.getElementById('load-user').onclick = async () => {
    invalidateSelection(); roleStatus.textContent = '';
    const id = target.value.trim(), scopeId = scope.value;
    if (!id || !scopeId) return;
    try {
        const result = await window.CstuAuth.request('/users/' + encodeURIComponent(id)
            + '/roles?scopeId=' + encodeURIComponent(scopeId));
        if (target.value.trim() !== id || scope.value !== scopeId) return;
        const user = result.data;
        version = user.authzVersion; selectedTarget = id; selectedScope = scopeId;
        document.getElementById('role-user').textContent = user.displayName;
        for (const input of choices.querySelectorAll('input')) input.checked = user.grants.some(g => g.role === input.value && g.active);
        choices.disabled = false; saveRoles.disabled = false;
    } catch { roleStatus.textContent = 'ไม่พบบัญชี หรือคุณไม่มีสิทธิ์จัดการบัญชีนี้'; }
};
document.getElementById('role-form').onsubmit = async event => {
    event.preventDefault();
    if (version === null || saveRoles.disabled || selectedTarget !== target.value.trim() || selectedScope !== scope.value) return;
    saveRoles.disabled = true;
    try {
        const result = await window.CstuAuth.mutate('/users/' + encodeURIComponent(selectedTarget) + '/roles', {
            scopeId: selectedScope, roles: [...choices.querySelectorAll('input:checked')].map(i => i.value),
            confirmIdentity: document.getElementById('confirm-identity').checked
        }, version);
        version = result.data.authzVersion;
        roleStatus.textContent = 'บันทึกสิทธิ์แล้ว Session เดิมของผู้ใช้ต้องเข้าสู่ระบบใหม่';
    } catch {
        invalidateSelection(); roleStatus.textContent = 'บันทึกไม่ได้ กรุณาตรวจสิทธิ์/การยืนยันตัวตนและค้นหาบัญชีใหม่';
    } finally { saveRoles.disabled = version === null; }
};

if (exchangeCloseBtn && exchangeDialog) {
    exchangeCloseBtn.onclick = () => exchangeDialog.close();
}

if (exchangeForm) {
    exchangeForm.onsubmit = async event => {
        event.preventDefault();
        const isCreate = !exchangeId.value;
        const parseCsv = v => v.split(',').map(s => s.trim()).filter(Boolean);

        const partners = parseCsv(exchangePartnerIds.value);
        if (!partners.length) {
            exchangeStatus.textContent = 'กรุณาระบุรหัสคู่ความร่วมมืออย่างน้อย 1 รายการ';
            return;
        }

        const payload = {
            title: exchangeTitle.value.trim(),
            partnerIds: partners,
        };

        if (isCreate) {
            payload.scopeId = exchangeScope.value;
        }

        if (exchangeAgreementId.value.trim()) {
            payload.agreementId = exchangeAgreementId.value.trim();
        }

        if (exchangeStartDate.value) {
            payload.startDate = exchangeStartDate.value;
        }

        if (exchangeEndDate.value) {
            payload.endDate = exchangeEndDate.value;
        }

        const participants = parseCsv(exchangeParticipantUsers.value);
        if (participants.length) {
            payload.participantUserIds = participants;
        }

        if (exchangeSupportingInfo.value.trim()) {
            payload.supportingInfo = exchangeSupportingInfo.value.trim();
        }

        if (exchangeSupportingInfoParticipant.value.trim()) {
            payload.supportingInfoForParticipant = exchangeSupportingInfoParticipant.value.trim();
        }

        if (userRoles.includes('staff')) {
            const resp = parseCsv(exchangeResponsibleUsers.value);
            if (resp.length) {
                payload.responsibleUserIds = resp;
            }
        }

        exchangeSubmitBtn.disabled = true;
        exchangeStatus.textContent = 'กำลังบันทึกข้อมูล...';

        try {
            if (isCreate) {
                await window.CstuAuth.create('/exchanges', payload, currentSubmissionKey);
            } else {
                await window.CstuAuth.mutate('/exchanges/' + encodeURIComponent(exchangeId.value), payload, Number(exchangeVersion.value));
            }
            exchangeDialog.close();
            await loadExchanges();
        } catch (error) {
            exchangeSubmitBtn.disabled = false;
            if (error.status === 401) {
                window.location.replace('login.html');
            } else if (error.status === 403) {
                exchangeStatus.textContent = 'คุณไม่มีสิทธิ์ดำเนินการนี้';
            } else if (error.status === 409) {
                exchangeStatus.textContent = 'ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว (Version Conflict) กำลังโหลดข้อมูลล่าสุด...';
                try {
                    const fresh = await window.CstuAuth.request('/exchanges/' + encodeURIComponent(exchangeId.value));
                    if (fresh?.data) openEditExchange(fresh.data);
                } catch {
                    exchangeStatus.textContent = 'โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาลองใหม่';
                }
            } else if (error.status === 422) {
                exchangeStatus.textContent = 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบวันที่ หรือรหัสคู่ความร่วมมือ';
            } else {
                exchangeStatus.textContent = error.message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
            }
        }
    };
}

window.addEventListener('focus', refreshWorkspace);
window.addEventListener('pageshow', refreshWorkspace);
window.addEventListener('authchange', refreshWorkspace);
refreshWorkspace();
