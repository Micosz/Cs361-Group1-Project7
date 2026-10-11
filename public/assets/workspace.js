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

const activitySection = document.getElementById('activity-section');
const openAddActivity = document.getElementById('open-add-activity');
const activityListStatus = document.getElementById('activity-list-status');
const activityList = document.getElementById('activity-list');
const activityDialog = document.getElementById('activity-dialog');
const activityForm = document.getElementById('activity-form');
const activityDialogTitle = document.getElementById('activity-dialog-title');
const activityId = document.getElementById('activity-id');
const activityVersion = document.getElementById('activity-version');
const activityScope = document.getElementById('activity-scope');
const activityTitle = document.getElementById('activity-title');
const activityType = document.getElementById('activity-type');
const activitySummary = document.getElementById('activity-summary');
const activityFullDescription = document.getElementById('activity-full-description');
const activityPartnerId = document.getElementById('activity-partner-id');
const activityCohostIds = document.getElementById('activity-cohost-ids');
const activityAgreementIds = document.getElementById('activity-agreement-ids');
const activityPeriodDate = document.getElementById('activity-period-date');
const activityPeriodText = document.getElementById('activity-period-text');
const activityImagePath = document.getElementById('activity-image-path');
const staffActivityFields = document.getElementById('staff-activity-fields');
const activityPublication = document.getElementById('activity-publication');
const activityResponsibleUsers = document.getElementById('activity-responsible-users');
const activityStatus = document.getElementById('activity-status');
const activitySubmitBtn = document.getElementById('activity-submit-btn');
const activityCloseBtn = document.getElementById('activity-close-btn');

function invalidateSelection() {
    version = null; selectedTarget = null; selectedScope = null;
    choices.disabled = true; saveRoles.disabled = true;
    document.getElementById('role-user').textContent = '';
    document.getElementById('confirm-identity').checked = false;
}

async function loadActivities() {
    if (!activitySection || activitySection.hidden) return;
    activityListStatus.textContent = 'กำลังโหลดรายการกิจกรรม...';
    activityList.replaceChildren();
    try {
        const res = await window.CstuAuth.request('/activities');
        const activities = res.data || [];
        if (!activities.length) {
            activityListStatus.textContent = 'ไม่พบรายการกิจกรรมในขอบเขตของคุณ';
            return;
        }
        activityListStatus.textContent = '';
        const session = await window.CstuAuth.refresh();
        const currentUserId = session?.user?.id;
        for (const act of activities) {
            const card = document.createElement('div');
            card.style.cssText = 'border:1px solid #ddd;border-radius:6px;padding:1rem;background:#fafafa;';

            const header = document.createElement('div');
            header.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;';

            const titleGroup = document.createElement('div');
            const title = document.createElement('h3');
            title.style.cssText = 'margin:0 0 0.25rem 0;color:var(--text-dark,#222);';
            title.textContent = act.title;

            const meta = document.createElement('div');
            meta.style.cssText = 'font-size:0.85rem;color:#666;';
            const typeLabels = {
                academic_activity: 'กิจกรรมวิชาการ',
                event: 'อีเวนต์ / ทั่วไป',
                research: 'งานวิจัย'
            };
            meta.textContent = (typeLabels[act.type] || act.type) + (act.periodDate ? ' · ' + act.periodDate : '');
            titleGroup.append(title, meta);

            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:0.5rem;';

            const isStaff = userRoles.includes('staff');
            const isAssigned = (act.responsibleUserIds || []).includes(currentUserId);
            if (isStaff || (userRoles.includes('coordinator') && isAssigned)) {
                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'login-btn';
                editBtn.style.cssText = 'padding:0.25rem 0.75rem;font-size:0.85rem;';
                editBtn.textContent = 'แก้ไข';
                editBtn.onclick = () => openEditActivity(act);
                actions.append(editBtn);
            }
            header.append(titleGroup, actions);

            const summary = document.createElement('p');
            summary.style.cssText = 'margin:0.5rem 0 0.25rem 0;font-size:0.95rem;color:#333;';
            summary.textContent = act.summary;

            const footer = document.createElement('div');
            footer.style.cssText = 'font-size:0.8rem;color:#777;margin-top:0.5rem;display:flex;gap:1.5rem;';
            const pubBadge = document.createElement('span');
            pubBadge.textContent = 'สถานะ: ' + (act.publication === 'public' ? 'เผยแพร่สาธารณะ' : 'ใช้งานภายใน');
            const partnerSpan = document.createElement('span');
            partnerSpan.textContent = 'คู่ความร่วมมือ: ' + act.partnerId;
            footer.append(pubBadge, partnerSpan);

            card.append(header, summary, footer);
            activityList.append(card);
        }
    } catch {
        activityListStatus.textContent = 'ไม่สามารถโหลดรายการกิจกรรมได้';
    }
}

function openAddActivityDialog(scopes) {
    activityDialogTitle.textContent = 'เพิ่มกิจกรรม';
    activityId.value = '';
    activityVersion.value = '';
    activityTitle.value = '';
    activityType.value = 'academic_activity';
    activitySummary.value = '';
    activityFullDescription.value = '';
    activityPartnerId.value = '';
    activityCohostIds.value = '';
    activityAgreementIds.value = '';
    activityPeriodDate.value = '';
    activityPeriodText.value = '';
    activityImagePath.value = '';
    activityPublication.value = 'internal';
    activityResponsibleUsers.value = '';
    activityStatus.textContent = '';
    activitySubmitBtn.disabled = false;

    activityScope.disabled = false;
    activityScope.replaceChildren();
    for (const s of scopes) {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        activityScope.append(opt);
    }

    const isStaff = userRoles.includes('staff');
    if (staffActivityFields) staffActivityFields.hidden = !isStaff;
    currentSubmissionKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('key-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12));
    activityDialog.showModal();
}

function openEditActivity(act) {
    activityDialogTitle.textContent = 'แก้ไขกิจกรรม';
    activityId.value = act.id;
    activityVersion.value = act.version;
    activityTitle.value = act.title || '';
    activityType.value = act.type || 'academic_activity';
    activitySummary.value = act.summary || '';
    activityFullDescription.value = act.fullDescription || '';
    activityPartnerId.value = act.partnerId || '';
    activityCohostIds.value = (act.coHostPartnerIds || []).join(', ');
    activityAgreementIds.value = (act.agreementIds || []).join(', ');
    activityPeriodDate.value = act.periodDate || '';
    activityPeriodText.value = act.periodText || '';
    activityImagePath.value = act.imagePath || '';
    activityPublication.value = act.publication || 'internal';
    activityResponsibleUsers.value = (act.responsibleUserIds || []).join(', ');
    activityStatus.textContent = '';

    activityScope.replaceChildren();
    const opt = document.createElement('option');
    opt.value = act.scopeId || '';
    opt.textContent = act.scopeId || '';
    activityScope.append(opt);
    activityScope.disabled = true;

    const isStaff = userRoles.includes('staff');
    if (staffActivityFields) staffActivityFields.hidden = !isStaff;

    if (!isStaff && act.publication === 'public') {
        activityStatus.textContent = 'กิจกรรมนี้เผยแพร่แล้ว ผู้ประสานงานไม่สามารถแก้ไขข้อมูลแสดงผลได้ กรุณาติดต่อเจ้าหน้าที่';
        activitySubmitBtn.disabled = true;
    } else {
        activitySubmitBtn.disabled = false;
    }

    activityDialog.showModal();
}

async function refreshWorkspace() {
    openRoles.hidden = true;
    if (activitySection) activitySection.hidden = true;
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

        // Activity section handling
        const activeScopes = [...new Set((session.grants || []).filter(g => g.active).map(g => g.scopeId))];
        const canManageActivities = userRoles.some(r => ['coordinator', 'staff', 'executive'].includes(r));
        if (activitySection && canManageActivities && activeScopes.length) {
            activitySection.hidden = false;
            const canAdd = userRoles.some(r => ['coordinator', 'staff'].includes(r));
            if (openAddActivity) {
                openAddActivity.hidden = !canAdd;
                openAddActivity.onclick = () => openAddActivityDialog(activeScopes);
            }
            await loadActivities();
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

if (activityCloseBtn) {
    activityCloseBtn.onclick = () => activityDialog.close();
}

if (activityForm) {
    activityForm.onsubmit = async event => {
        event.preventDefault();
        activityStatus.textContent = '';
        const titleVal = activityTitle.value.trim();
        const summaryVal = activitySummary.value.trim();
        const partnerIdVal = activityPartnerId.value.trim();
        if (!titleVal || !summaryVal || !partnerIdVal) {
            activityStatus.textContent = 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน';
            return;
        }

        const payload = {
            title: titleVal,
            type: activityType.value,
            summary: summaryVal,
            partnerId: partnerIdVal,
        };

        const isCreate = !activityId.value;
        if (isCreate) {
            payload.scopeId = activityScope.value;
        }
        if (activityFullDescription.value.trim()) payload.fullDescription = activityFullDescription.value.trim();
        if (activityPeriodDate.value) payload.periodDate = activityPeriodDate.value;
        if (activityPeriodText.value.trim()) payload.periodText = activityPeriodText.value.trim();
        if (activityImagePath.value.trim()) payload.imagePath = activityImagePath.value.trim();

        const parseCsv = v => v.split(',').map(s => s.trim()).filter(Boolean);
        const cohosts = parseCsv(activityCohostIds.value);
        if (cohosts.length) payload.coHostPartnerIds = cohosts;
        const agreements = parseCsv(activityAgreementIds.value);
        if (agreements.length) payload.agreementIds = agreements;

        if (userRoles.includes('staff')) {
            payload.publication = activityPublication.value;
            const resp = parseCsv(activityResponsibleUsers.value);
            if (resp.length) payload.responsibleUserIds = resp;
        }

        activitySubmitBtn.disabled = true;
        activityStatus.textContent = 'กำลังบันทึกข้อมูล...';

        try {
            if (isCreate) {
                await window.CstuAuth.create('/activities', payload, currentSubmissionKey);
            } else {
                await window.CstuAuth.mutate('/activities/' + encodeURIComponent(activityId.value), payload, Number(activityVersion.value));
            }
            activityDialog.close();
            await loadActivities();
        } catch (error) {
            activitySubmitBtn.disabled = false;
            if (error.status === 401) {
                window.location.replace('login.html');
            } else if (error.status === 403) {
                activityStatus.textContent = 'คุณไม่มีสิทธิ์ดำเนินการนี้';
            } else if (error.status === 409) {
                activityStatus.textContent = 'ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว (Version Conflict) กำลังโหลดข้อมูลล่าสุด...';
                try {
                    const fresh = await window.CstuAuth.request('/activities/' + encodeURIComponent(activityId.value));
                    if (fresh?.data) openEditActivity(fresh.data);
                } catch {
                    activityStatus.textContent = 'โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาลองใหม่';
                }
            } else if (error.status === 422) {
                activityStatus.textContent = 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบวันที่ ข้อมูลคู่ความร่วมมือ หรือผู้รับผิดชอบ';
            } else {
                activityStatus.textContent = error.message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
            }
        }
    };
}

window.addEventListener('focus', refreshWorkspace);
window.addEventListener('pageshow', refreshWorkspace);
window.addEventListener('authchange', refreshWorkspace);
refreshWorkspace();
