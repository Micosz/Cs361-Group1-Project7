/* Existing #96 form isolated from Exchange variables; server authorizes every request. */
(() => {
'use strict';
let userRoles=[], currentSubmissionKey=null, submissionFingerprint=null;
let relationshipComplete=true;
const staffInScope = scope => (window.CstuAuth.state()?.grants || []).some(g=>g.active!==false && g.scopeId===scope && g.role==='staff');
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
const activityOutcomeSummary = document.getElementById('activity-outcome-summary');
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
async function loadActivities() {
    if (!activitySection || activitySection.hidden) return;
    activityListStatus.textContent = 'กำลังโหลดรายการกิจกรรม...';
    activityList.replaceChildren();
    try {
        const res = await allWorkspaceRows('/activities');
        const activities = [...new Map((res.data || []).map(row=>[row.id,row])).values()];
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

            const isStaff = staffInScope(act.scopeId);
            const isAssigned = (act.responsibleUserIds || []).includes(currentUserId);
            const coordinator = (session.grants || []).some(g=>g.active!==false && g.scopeId===act.scopeId && g.role==='coordinator');
            if (isStaff || (coordinator && isAssigned)) {
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
    relationshipComplete=true;
    submissionFingerprint=null;
    activityCohostIds.disabled=false;activityAgreementIds.disabled=false;
    activityDialogTitle.textContent = 'เพิ่มกิจกรรม';
    activityId.value = '';
    activityVersion.value = '';
    activityTitle.value = '';
    activityType.value = 'academic_activity';
    activitySummary.value = '';
    activityFullDescription.value = '';
    activityOutcomeSummary.value = '';
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

    const isStaff = staffInScope(activityScope.value);
    if (staffActivityFields) staffActivityFields.hidden = !isStaff;
    currentSubmissionKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('key-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12));
    if (!activityDialog.open) activityDialog.showModal();
    window.ActivityLinks?.picker(activityForm, null, complete=>{relationshipComplete=complete;});
}

function openEditActivity(act) {
    relationshipComplete=act.relationshipsComplete === true;
    activityCohostIds.disabled=!relationshipComplete;activityAgreementIds.disabled=!relationshipComplete;
    activityDialogTitle.textContent = 'แก้ไขกิจกรรม';
    activityId.value = act.id;
    activityVersion.value = act.version;
    activityTitle.value = act.title || '';
    activityType.value = act.type || 'academic_activity';
    activitySummary.value = act.summary || '';
    activityFullDescription.value = act.fullDescription || '';
    activityOutcomeSummary.value = act.outcomeSummary || '';
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

    const isStaff = staffInScope(activityScope.value);
    if (staffActivityFields) staffActivityFields.hidden = !isStaff;

    if (!isStaff && act.publication === 'public') {
        activityStatus.textContent = 'กิจกรรมนี้เผยแพร่แล้ว ผู้ประสานงานไม่สามารถแก้ไขข้อมูลแสดงผลได้ กรุณาติดต่อเจ้าหน้าที่';
        activitySubmitBtn.disabled = true;
    } else {
        activitySubmitBtn.disabled = false;
    }

    if (!activityDialog.open) activityDialog.showModal();
    window.ActivityLinks?.picker(activityForm, act, complete=>{relationshipComplete=complete;});
}

if (activityCloseBtn) {
    activityCloseBtn.onclick = () => activityDialog.close();
}

if (activityForm) {
    activityForm.onsubmit = async event => {
        event.preventDefault();
        if (activitySubmitBtn.disabled) return;
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
        payload.fullDescription = activityFullDescription.value.trim();
        payload.outcomeSummary = activityOutcomeSummary.value.trim();
        payload.periodDate = activityPeriodDate.value || null;
        payload.periodText = activityPeriodText.value.trim();
        payload.imagePath = activityImagePath.value.trim();

        const parseCsv = v => v.split(',').map(s => s.trim()).filter(Boolean);
        const cohosts = parseCsv(activityCohostIds.value);
        if (relationshipComplete) payload.coHostPartnerIds = cohosts;
        const agreements = parseCsv(activityAgreementIds.value);
        if (relationshipComplete) payload.agreementIds = agreements;

        if (staffInScope(activityScope.value)) {
            payload.publication = activityPublication.value;
            const resp = parseCsv(activityResponsibleUsers.value);
            if (resp.length) payload.responsibleUserIds = resp;
        }

        const fingerprint=JSON.stringify(payload);
        if(isCreate && fingerprint!==submissionFingerprint){submissionFingerprint=fingerprint;currentSubmissionKey=crypto.randomUUID();}
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
            if(window.parent!==window)window.parent.postMessage({type:'activity-saved'},location.origin);
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
                    if(fresh?.data){const reload=document.createElement('button');reload.type='button';reload.textContent='โหลดข้อมูลล่าสุดเพื่อตรวจทาน';reload.onclick=()=>openEditActivity(fresh.data);activityStatus.appendChild(reload);}
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


async function refreshActivities() {
    if (!activitySection || !window.CstuAuth?.enabled()) return;
    activitySection.hidden=true;
    const session=await window.CstuAuth.refresh();
    if (!session?.user) return;
    userRoles=window.CstuAuth.roles(session);
    const readScopes=(session.grants || []).filter(g=>g.active!==false).map(g=>g.scopeId);
    const createScopes=[...new Set((session.grants || []).filter(g=>g.active!==false && readScopes.includes(g.scopeId) && ['staff','coordinator'].includes(g.role)).map(g=>g.scopeId))];
    if (!userRoles.some(r=>['staff','coordinator','executive'].includes(r)) || !readScopes.length) return;
    activitySection.hidden=false;openAddActivity.hidden=!createScopes.length;
    openAddActivity.onclick=()=>openAddActivityDialog(createScopes);
    await loadActivities();
    const query=new URLSearchParams(location.search);
    if(query.get('embed')==='activity' && !embeddedOpened){
        embeddedOpened=true;
        if(query.get('id')) openEditActivity((await window.CstuAuth.request('/activities/'+encodeURIComponent(query.get('id')))).data);
        else if(createScopes.length) openAddActivityDialog(createScopes);
    }
}
let embeddedOpened=false;
window.addEventListener('authchange',()=>refreshActivities().catch(()=>{}));
window.addEventListener('pageshow',()=>refreshActivities().catch(()=>{}));
refreshActivities().catch(()=>{activityListStatus.textContent='โหลดกิจกรรมไม่สำเร็จ';});
})();
