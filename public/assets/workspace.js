'use strict';
const workspaceStatus = document.getElementById('workspace-status');
const openRoles = document.getElementById('open-roles');
const scope = document.getElementById('role-scope');
const target = document.getElementById('role-target');
const roleSearch = document.getElementById('role-search');
const roleTargetStatus = document.getElementById('role-target-status');
const choices = document.getElementById('role-choices');
const saveRoles = document.getElementById('save-roles');
const roleStatus = document.getElementById('role-status');
const openAgreements = document.getElementById('open-agreements');
let version = null, selectedTarget = null, selectedScope = null, roleLoadRevision = 0;
let userRoles = [];
let currentSubmissionKey = null;
let submissionFingerprint = null;
let embeddedActionOpened = false;

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
const exchangeOutcomeSummary = document.getElementById('exchange-outcome-summary');
const staffExchangeFields = document.getElementById('staff-exchange-fields');
const exchangeResponsibleUsers = document.getElementById('exchange-responsible-users');
const exchangeStatus = document.getElementById('exchange-status');
const exchangeSubmitBtn = document.getElementById('exchange-submit-btn');
const exchangeCloseBtn = document.getElementById('exchange-close-btn');

const exchangeStatusSection = document.getElementById('exchange-status-transition-section');
const exchangeStatusDisplay = document.getElementById('exchange-current-status-display');
const exchangeBtnOngoing = document.getElementById('exchange-btn-ongoing');
const exchangeBtnCompleted = document.getElementById('exchange-btn-completed');
const exchangeBtnCancelled = document.getElementById('exchange-btn-cancelled');

const myExchangeSection = document.getElementById('my-exchange-section');
const myExchangeStatus = document.getElementById('my-exchange-status');
const myExchangeList = document.getElementById('my-exchange-list');
const myExchangeDialog = document.getElementById('my-exchange-dialog');
const myExchangeDetailTitle = document.getElementById('my-exchange-detail-title');
const myExchangeDetailStatusBadge = document.getElementById('my-exchange-detail-status-badge');
const myExchangeDetailDates = document.getElementById('my-exchange-detail-dates');
const myExchangeDetailInfo = document.getElementById('my-exchange-detail-info');
const myExchangeDetailDocsStatus = document.getElementById('my-exchange-detail-docs-status');
const myExchangeDetailDocsList = document.getElementById('my-exchange-detail-docs-list');
const myExchangeDetailCloseBtn = document.getElementById('my-exchange-detail-close-btn');

function invalidateSelection() {
    roleLoadRevision++;
    version = null; selectedTarget = null; selectedScope = null;
    choices.disabled = true; saveRoles.disabled = true;
    document.getElementById('role-user').textContent = '';
    document.getElementById('confirm-identity').checked = false;
}

async function allWorkspaceRows(path) {
    const data = []; let cursor = null;
    do {
        const result = await window.CstuAuth.request(path + '?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
        data.push(...result.data); cursor = result.page?.nextCursor;
    } while (cursor);
    return {data};
}

async function loadExchanges() {
    if (!exchangeSection || exchangeSection.hidden) return;
    exchangeListStatus.textContent = 'กำลังโหลดโครงการแลกเปลี่ยน...';
    exchangeList.replaceChildren();
    try {
        const res = await allWorkspaceRows('/exchanges');
        const exchanges = [...new Map((res.data || []).map(row=>[row.id,row])).values()];
        if (!exchanges.length) {
            exchangeListStatus.textContent = 'ไม่พบโครงการแลกเปลี่ยนในขอบเขตของคุณ';
            return;
        }
        exchangeListStatus.textContent = '';
        const session = await window.CstuAuth.refresh();
        const currentUserId = session?.user?.id;
        const isStaff = (session.grants || []).some(g => ['staff','executive'].includes(g.role) && g.active !== false);

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

            const scopedRoles = (session.grants || []).filter(g => g.active !== false && g.scopeId === ex.scopeId).map(g => g.role);
            const canEdit = scopedRoles.some(r => ['staff','executive'].includes(r)) || (scopedRoles.includes('coordinator') && (ex.responsibleUserIds || []).includes(currentUserId));
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

async function openMyExchangeDetail(ex) {
    if (!myExchangeDialog) return;
    myExchangeDetailTitle.textContent = ex.title || 'รายละเอียดโครงการแลกเปลี่ยน';
    myExchangeDetailStatusBadge.textContent = ex.status || 'draft';
    myExchangeDetailDates.textContent = (ex.startDate || ex.endDate)
        ? 'ระยะเวลา: ' + (ex.startDate || '-') + ' ถึง ' + (ex.endDate || '-')
        : '';
    myExchangeDetailInfo.textContent = ex.supportingInfoForParticipant
        ? 'ข้อมูลสำหรับผู้เข้าร่วม: ' + ex.supportingInfoForParticipant
        : '';

    myExchangeDetailDocsStatus.textContent = 'กำลังโหลดเอกสาร...';
    myExchangeDetailDocsList.replaceChildren();
    const myExchangeDetailFeedback = document.getElementById('my-exchange-detail-feedback');
    if (myExchangeDetailFeedback) myExchangeDetailFeedback.replaceChildren();

    myExchangeDialog.showModal();

    // Fetch individual detail for freshest projection
    try {
        const fresh = await window.CstuAuth.request('/me/exchanges/' + encodeURIComponent(ex.id));
        if (fresh?.data) {
            const d = fresh.data;
            myExchangeDetailTitle.textContent = d.title || 'รายละเอียดโครงการแลกเปลี่ยน';
            myExchangeDetailStatusBadge.textContent = d.status || 'draft';
            myExchangeDetailDates.textContent = (d.startDate || d.endDate)
                ? 'ระยะเวลา: ' + (d.startDate || '-') + ' ถึง ' + (d.endDate || '-')
                : '';
            myExchangeDetailInfo.textContent = d.supportingInfoForParticipant
                ? 'ข้อมูลสำหรับผู้เข้าร่วม: ' + d.supportingInfoForParticipant
                : '';
        }
    } catch (err) {
        if (err.status === 401) {
            window.location.replace('login.html');
            return;
        } else if (err.status === 404) {
            myExchangeDetailInfo.textContent = 'ไม่พบโครงการแลกเปลี่ยน หรือคุณไม่ได้เป็นผู้เข้าร่วมโครงการนี้แล้ว';
            myExchangeDetailDocsStatus.textContent = '';
            return;
        }
    }

    // Fetch documents for participants
    try {
        const docRes = await allWorkspaceRows('/me/exchanges/' + encodeURIComponent(ex.id) + '/documents');
        const docs = docRes.data || [];
        if (!docs.length) {
            myExchangeDetailDocsStatus.textContent = 'ไม่มีเอกสารแนบสำหรับผู้เข้าร่วม';
        } else {
            myExchangeDetailDocsStatus.textContent = '';
            for (const doc of docs) {
                const li = document.createElement('li');
                li.style.cssText = 'padding:0.5rem; border:1px solid #eee; border-radius:4px; display:flex; justify-content:space-between; align-items:center;';

                const nameSpan = document.createElement('span');
                const sizeText = doc.size ? ' (' + Math.round(doc.size / 1024) + ' KB)' : '';
                nameSpan.textContent = (doc.displayName || 'เอกสาร') + sizeText;
                li.appendChild(nameSpan);

                const downloadLink = document.createElement('a');
                downloadLink.href = '/api/documents/' + encodeURIComponent(doc.id) + '/content?disposition=attachment';
                downloadLink.target = '_blank';
                downloadLink.rel = 'noopener';
                downloadLink.textContent = 'ดาวน์โหลด';
                downloadLink.style.cssText = 'padding:0.2rem 0.5rem; background:#2563eb; color:#fff; text-decoration:none; border-radius:4px; font-size:0.85rem;';
                li.appendChild(downloadLink);

                myExchangeDetailDocsList.appendChild(li);
            }
        }
    } catch (err) {
        if (err.status === 401) {
            window.location.replace('login.html');
            return;
        }
        myExchangeDetailDocsStatus.textContent = 'โหลดเอกสารไม่สำเร็จ';
    }
    if (myExchangeDetailFeedback && window.CstuFeedback) {
        const session = await window.CstuAuth.refresh().catch(() => null);
        if (session?.user && myExchangeDialog.open) {
            await window.CstuFeedback.mount(myExchangeDetailFeedback, ex, 'exchanges', session);
        }
    }
}

async function loadMyExchanges() {
    if (!myExchangeSection || myExchangeSection.hidden) return;
    myExchangeStatus.textContent = 'กำลังโหลดโครงการแลกเปลี่ยนของคุณ...';
    myExchangeList.replaceChildren();
    try {
        const res = await allWorkspaceRows('/me/exchanges');
        const exchanges = [...new Map((res.data || []).map(row=>[row.id,row])).values()];
        if (!exchanges.length) {
            myExchangeStatus.textContent = 'ไม่พบโครงการแลกเปลี่ยนที่คุณเข้าร่วม';
            return;
        }
        myExchangeStatus.textContent = '';
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

            if (myExchangeDialog) {
                const actions = document.createElement('div');
                actions.style.marginTop = '0.75rem';
                const detailBtn = document.createElement('button');
                detailBtn.type = 'button';
                detailBtn.textContent = 'ดูรายละเอียดและเอกสาร';
                detailBtn.style.cssText = 'padding:0.3rem 0.6rem; cursor:pointer;';
                detailBtn.onclick = () => openMyExchangeDetail(ex);
                actions.appendChild(detailBtn);
                card.appendChild(actions);
            }

            myExchangeList.appendChild(card);
        }
    } catch (err) {
        if (err.status === 401) {
            window.location.replace('login.html');
            return;
        }
        myExchangeStatus.textContent = 'โหลดโครงการแลกเปลี่ยนไม่สำเร็จ';
    }
}

function mountExchangeChoices() {
    if (!window.SelectionFields) return;
    const fields = [
        {input:exchangePartnerIds,kind:'partners',label:'คู่ความร่วมมือ (เลือกได้หลายรายการ)',required:true},
        {input:exchangeAgreementId,kind:'agreements',label:'ข้อตกลงที่เกี่ยวข้อง',multiple:false},
        {input:exchangeParticipantUsers,kind:'participant',label:'นักศึกษาผู้เข้าร่วม (เลือกได้หลายคน)'}
    ];
    const staffInScope = (window.CstuAuth.state()?.grants || []).some(g=>g.active!==false&&g.scopeId===exchangeScope.value&&['staff','executive'].includes(g.role));
    if (staffInScope) fields.push({input:exchangeResponsibleUsers,kind:'responsible',label:'ผู้รับผิดชอบโครงการ (เลือกได้หลายคน)'});
    const setTransitions = ready => {
        const state = exchangeStatusDisplay?.textContent;
        if (exchangeBtnOngoing) exchangeBtnOngoing.disabled = !ready || state !== 'draft';
        if (exchangeBtnCompleted) exchangeBtnCompleted.disabled = !ready || state !== 'ongoing';
        if (exchangeBtnCancelled) exchangeBtnCancelled.disabled = !ready || !['draft','ongoing'].includes(state);
    };
    setTransitions(false);
    window.SelectionFields.mount({form:exchangeForm,scope:exchangeScope,fields,submit:exchangeSubmitBtn,status:exchangeStatus,
        onReady:()=>setTransitions(true)});
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
    exchangeOutcomeSummary.value = '';
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

    const isStaff = (window.CstuAuth.state()?.grants || []).some(g=>g.active!==false&&g.scopeId===exchangeScope.value&&['staff','executive'].includes(g.role));
    if (staffExchangeFields) staffExchangeFields.hidden = !isStaff;
    if (exchangeStatusSection) exchangeStatusSection.hidden = true;

    currentSubmissionKey = 'ex-key-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    if (!exchangeDialog.open) exchangeDialog.showModal();
    mountExchangeChoices();
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
    exchangeOutcomeSummary.value = ex.outcomeSummary || '';
    exchangeResponsibleUsers.value = (ex.responsibleUserIds || []).join(', ');
    exchangeStatus.textContent = '';
    exchangeSubmitBtn.disabled = false;

    exchangeScope.replaceChildren();
    const opt = document.createElement('option');
    opt.value = ex.scopeId;
    opt.textContent = ex.scopeId;
    exchangeScope.appendChild(opt);
    exchangeScope.disabled = true;

    const isStaff = (window.CstuAuth.state()?.grants || []).some(g=>g.active!==false&&g.scopeId===exchangeScope.value&&['staff','executive'].includes(g.role));
    if (staffExchangeFields) staffExchangeFields.hidden = !isStaff;

    if (exchangeStatusSection && exchangeStatusDisplay) {
        exchangeStatusSection.hidden = false;
        const curStatus = ex.status || 'draft';
        exchangeStatusDisplay.textContent = curStatus;

        // Button availability based on current status
        if (exchangeBtnOngoing) exchangeBtnOngoing.disabled = true;
        if (exchangeBtnCompleted) exchangeBtnCompleted.disabled = true;
        if (exchangeBtnCancelled) exchangeBtnCancelled.disabled = true;
    }

    currentSubmissionKey = null;
    if (window.DocumentComponent) {
        let docs = document.getElementById('exchange-documents');
        if (!docs) { docs = document.createElement('section'); docs.id = 'exchange-documents'; exchangeDialog.appendChild(docs); }
        window.DocumentComponent.mount(docs, 'exchange', ex);
    }
    if (!exchangeDialog.open) exchangeDialog.showModal();
    mountExchangeChoices();
}

async function refreshWorkspace() {
    openRoles.hidden = true;
    if (exchangeSection) exchangeSection.hidden = true;
    if (myExchangeSection) myExchangeSection.hidden = true;
    if (openAgreements) openAgreements.hidden = true;
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
        const managed = window.CstuAuth?.managedScopes
            ? window.CstuAuth.managedScopes(session)
            : [...new Set([
                ...(session.capabilities || []).filter(c => c.active !== false && c.name === 'manageRoles').map(c => c.scopeId),
                ...(session.grants || []).filter(g => g.active !== false && g.role === 'executive').map(g => g.scopeId)
            ].filter(Boolean))];
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
        if (new URLSearchParams(location.search).get('embed') === 'roles' && managed.length) {
            const roleDialog = document.getElementById('role-dialog');
            if (roleDialog && !roleDialog.open) roleDialog.showModal();
            loadRoleTargets();
        }

        // Exchange section handling
        const readScopes = (session.grants || []).filter(g => g.active !== false).map(g => g.scopeId);
        const activeScopes = [...new Set((session.grants || []).filter(g => g.active !== false && readScopes.includes(g.scopeId) && ['coordinator','staff','executive'].includes(g.role)).map(g => g.scopeId))];
        const canManageExchanges = (session.grants || []).some(g => g.active !== false && readScopes.includes(g.scopeId) && ['coordinator','staff','executive'].includes(g.role));
        if (exchangeSection && canManageExchanges && readScopes.length) {
            exchangeSection.hidden = false;
            const canAddScopes = [...new Set((session.grants || []).filter(g => g.active !== false && readScopes.includes(g.scopeId) && ['coordinator','staff','executive'].includes(g.role)).map(g => g.scopeId))];
            if (openAddExchange) {
                openAddExchange.hidden = !canAddScopes.length;
                openAddExchange.onclick = () => openAddExchangeDialog(canAddScopes);
            }
            await loadExchanges();
        }

        const query = new URLSearchParams(window.location.search);
        if (query.get('embed') === 'exchange' && !embeddedActionOpened) {
            embeddedActionOpened = true;
            if (query.get('id')) {
                const fresh = (await window.CstuAuth.request('/exchanges/' + encodeURIComponent(query.get('id')))).data;
                openEditExchange(fresh);
            } else if (activeScopes.length) openAddExchangeDialog(activeScopes);
        }

        // My Exchange section handling (students)
        const isStudent = userRoles.includes('student');
        if (myExchangeSection && isStudent && readScopes.length) {
            myExchangeSection.hidden = false;
            await loadMyExchanges();
        }
        const canAgreement = (session.grants || []).some(g => g.active !== false && readScopes.includes(g.scopeId) && ['coordinator','staff','executive'].includes(g.role));
        if (openAgreements) {
            openAgreements.hidden = !canAgreement;
            openAgreements.onclick = () => {
                if (window.AgreementComponent) {
                    const defaultScope = session.grants.find(g => g.active !== false && readScopes.includes(g.scopeId) && ['staff','executive','coordinator'].includes(g.role))?.scopeId;
                    window.AgreementComponent.openCreate(defaultScope);
                }
            };
        }
    } catch { workspaceStatus.textContent = 'ตรวจสิทธิ์ไม่ได้ กรุณาลองใหม่ภายหลัง'; }
}
openRoles.onclick = () => {
    document.getElementById('role-dialog').showModal();
    loadRoleTargets();
};
function closeRoles(saved = false) {
    invalidateSelection();
    document.getElementById('role-dialog').close();
    if (new URLSearchParams(location.search).get('embed') === 'roles' && window.parent !== window) {
        window.parent.postMessage({type: saved ? 'roles-saved' : 'roles-closed'}, location.origin);
    }
}
document.getElementById('close-roles').onclick = () => closeRoles();
document.getElementById('role-dialog').addEventListener('cancel', event => { event.preventDefault(); closeRoles(); });
async function loadRoleTargets(term = '') {
    invalidateSelection(); roleStatus.textContent = '';
    const scopeId = scope.value, requestRevision = roleLoadRevision;
    if (!scopeId) return;
    target.replaceChildren(new Option('กำลังโหลดบัญชี...', ''));
    target.disabled = true;
    roleTargetStatus.textContent = term ? 'กำลังค้นหาบัญชีในขอบเขตนี้...' : 'กำลังโหลดรายชื่อบัญชี...';
    try {
        const query = term ? '&q=' + encodeURIComponent(term) : '';
        const result = await window.CstuAuth.request('/role-targets?scopeId=' + encodeURIComponent(scopeId) + query);
        if (requestRevision !== roleLoadRevision || scope.value !== scopeId) return;
        const items = Array.isArray(result?.data) ? result.data : [];
        target.replaceChildren(new Option(items.length ? 'เลือกบัญชี' : 'ไม่พบบัญชีในขอบเขตนี้', ''));
        for (const user of items) {
            const identity = user.identityVerified ? '' : ' · ต้องตรวจตัวตน';
            const suffix = String(user.id).slice(-6);
            target.appendChild(new Option(user.displayName + identity + ' · #' + suffix, user.id));
        }
        target.disabled = items.length === 0;
        roleTargetStatus.textContent = items.length ? `พบ ${items.length} บัญชีที่จัดการได้` : 'ไม่พบบัญชีในขอบเขตนี้';
    } catch {
        if (requestRevision !== roleLoadRevision || scope.value !== scopeId) return;
        target.replaceChildren(new Option('ค้นหาชื่อก่อน', ''));
        roleTargetStatus.textContent = 'ค้นหาไม่ได้ หรือคุณไม่มีสิทธิ์จัดการขอบเขตนี้';
    }
}
function clearRoleTargets() {
    loadRoleTargets();
}
roleSearch.addEventListener('input', () => {
    invalidateSelection();
    if (!roleSearch.value.trim()) {
        loadRoleTargets();
    }
});
scope.addEventListener('change', () => { invalidateSelection(); loadRoleTargets(); });
target.addEventListener('change', () => loadSelectedRoleUser());
document.getElementById('search-role-targets').onclick = async () => {
    const term = roleSearch.value.trim();
    if (term.length > 0 && term.length < 2) {
        roleTargetStatus.textContent = 'พิมพ์ชื่ออย่างน้อย 2 ตัวอักษรและเลือกขอบเขตก่อน';
        return;
    }
    await loadRoleTargets(term);
};
async function loadSelectedRoleUser() {
    invalidateSelection(); roleStatus.textContent = '';
    const id = target.value, scopeId = scope.value, requestRevision = roleLoadRevision;
    if (!id || !scopeId) return;
    roleStatus.textContent = 'กำลังโหลดสิทธิ์บัญชี';
    try {
        const result = await window.CstuAuth.request('/users/' + encodeURIComponent(id)
            + '/roles?scopeId=' + encodeURIComponent(scopeId));
        if (requestRevision !== roleLoadRevision || target.value.trim() !== id || scope.value !== scopeId) return;
        const user = result.data;
        version = user.authzVersion; selectedTarget = id; selectedScope = scopeId;
        document.getElementById('role-user').textContent = user.displayName + (user.identityVerified ? ' · ยืนยันตัวตนแล้ว' : ' · ยังไม่ยืนยันตัวตน โปรดตรวจหลักฐานก่อนบันทึก');
        const active = user.grants.filter(g => g.active !== false && g.scopeId === scopeId);
        for (const input of choices.querySelectorAll('input')) input.checked = active.length <= 1 && input.value === (active[0]?.role || '');
        roleStatus.textContent = active.length > 1 ? 'บัญชีเดิมมีหลายบทบาท กรุณาเลือกหนึ่งบทบาทก่อนบันทึก' : '';
        choices.disabled = false; saveRoles.disabled = false;
    } catch { if (requestRevision === roleLoadRevision) roleStatus.textContent = 'ไม่พบบัญชี หรือคุณไม่มีสิทธิ์จัดการบัญชีนี้'; }
}
document.getElementById('role-form').onsubmit = async event => {
    event.preventDefault();
    if (version === null || saveRoles.disabled || selectedTarget !== target.value || selectedScope !== scope.value) return;
    const checked = [...choices.querySelectorAll('input:checked')];
    if (checked.length !== 1) { roleStatus.textContent = 'กรุณาเลือกหนึ่งบทบาท หรือเลือกถอนสิทธิ์'; return; }
    if (!document.getElementById('confirm-identity').checked) { roleStatus.textContent = 'กรุณาตรวจหลักฐานและติ๊กยืนยันก่อนบันทึก'; return; }
    saveRoles.disabled = true;
    try {
        const result = await window.CstuAuth.mutate('/users/' + encodeURIComponent(selectedTarget) + '/roles', {
            scopeId: selectedScope, roles: checked.map(i => i.value).filter(Boolean),
            confirmIdentity: document.getElementById('confirm-identity').checked
        }, version);
        version = result.data.authzVersion;
        closeRoles(true);
    } catch {
        invalidateSelection(); roleStatus.textContent = 'บันทึกไม่ได้ กรุณาตรวจสิทธิ์/การยืนยันตัวตนและค้นหาบัญชีใหม่';
    } finally { saveRoles.disabled = version === null; }
};

if (exchangeCloseBtn && exchangeDialog) {
    exchangeCloseBtn.onclick = () => exchangeDialog.close();
}

if (myExchangeDetailCloseBtn && myExchangeDialog) {
    myExchangeDetailCloseBtn.onclick = () => myExchangeDialog.close();
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

        // Selecting 'ไม่ระบุ' clears a previous optional agreement too.
        payload.agreementId = exchangeAgreementId.value.trim() || null;

        if (exchangeStartDate.value) {
            payload.startDate = exchangeStartDate.value;
        }

        if (exchangeEndDate.value) {
            payload.endDate = exchangeEndDate.value;
        }

        const participants = parseCsv(exchangeParticipantUsers.value);
        payload.participantUserIds = participants;

        payload.supportingInfo = exchangeSupportingInfo.value.trim();
        payload.supportingInfoForParticipant = exchangeSupportingInfoParticipant.value.trim();
        payload.outcomeSummary = exchangeOutcomeSummary.value.trim();

        if ((window.CstuAuth.state()?.grants || []).some(g => g.active !== false && g.scopeId === exchangeScope.value && ['staff','executive'].includes(g.role))) {
            const resp = parseCsv(exchangeResponsibleUsers.value);
            if (resp.length) {
                payload.responsibleUserIds = resp;
            }
        }

        if (exchangeSubmitBtn.disabled) return;
        const fingerprint = JSON.stringify(payload);
        if (isCreate && submissionFingerprint !== fingerprint) {
            submissionFingerprint = fingerprint;
            currentSubmissionKey = 'ex-key-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
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
            if (window.parent !== window) window.parent.postMessage({type:'exchange-saved'}, window.location.origin);
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
                    if (fresh?.data) {
                        const reload = document.createElement('button'); reload.type = 'button'; reload.textContent = 'โหลดข้อมูลล่าสุดเพื่อตรวจทาน';
                        reload.onclick = () => openEditExchange(fresh.data); exchangeStatus.appendChild(reload);
                    }
                } catch {
                    exchangeStatus.textContent = 'โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาลองใหม่';
                }
            } else if (error.status === 422) {
                exchangeStatus.textContent = 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบวันที่ รหัสคู่ความร่วมมือ หรือรหัสผู้ใช้/ผู้เข้าร่วม';
            } else {
                exchangeStatus.textContent = error.message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
            }
        }
    };
}

async function handleStatusTransition(toStatus) {
    if (!exchangeId.value || !exchangeVersion.value) return;
    let reason = null;
    let suppInfo = null;

    if (toStatus === 'cancelled') {
        reason = window.prompt('กรุณาระบุเหตุผลการยกเลิกโครงการ:');
        if (!reason || !reason.trim()) {
            exchangeStatus.textContent = 'การยกเลิกโครงการต้องระบุเหตุผล';
            return;
        }
    } else if (toStatus === 'completed') {
        suppInfo = exchangeSupportingInfo.value.trim();
        if (!suppInfo) {
            suppInfo = window.prompt('กรุณาระบุข้อมูลสนับสนุนการเสร็จสิ้นโครงการ (Supporting Info):');
            if (!suppInfo || !suppInfo.trim()) {
                exchangeStatus.textContent = 'การเสร็จสิ้นโครงการต้องระบุข้อมูลสนับสนุน';
                return;
            }
        }
    }

    const payload = { to: toStatus };
    if (reason) payload.reason = reason.trim();
    if (suppInfo) payload.supportingInfo = suppInfo.trim();

    if (exchangeSubmitBtn.disabled) return;
    exchangeSubmitBtn.disabled = true;
    exchangeStatus.textContent = 'กำลังเปลี่ยนสถานะ...';
    try {
        const session = await window.CstuAuth.refresh();
        await window.CstuAuth.request('/exchanges/' + encodeURIComponent(exchangeId.value) + '/status', {
            method: 'POST',
            headers: {
                'X-CSRF-Token': session.csrfToken,
                'If-Match': '"' + exchangeVersion.value + '"'
            },
            body: JSON.stringify(payload)
        });
        exchangeDialog.close();
        await loadExchanges();
        if (window.parent !== window) window.parent.postMessage({type:'exchange-saved'}, window.location.origin);
    } catch (error) {
        if (error.status === 401) {
            window.location.replace('login.html');
        } else if (error.status === 403) {
            exchangeStatus.textContent = 'คุณไม่มีสิทธิ์เปลี่ยนสถานะนี้';
        } else if (error.status === 409) {
            exchangeStatus.textContent = 'ไม่สามารถเปลี่ยนสถานะได้ตามเงื่อนไข (Conflict) กำลังโหลดข้อมูลล่าสุด...';
            try {
                const fresh = await window.CstuAuth.request('/exchanges/' + encodeURIComponent(exchangeId.value));
                if (fresh?.data) openEditExchange(fresh.data);
            } catch {
                exchangeStatus.textContent = 'โหลดข้อมูลล่าสุดไม่สำเร็จ';
            }
        } else if (error.status === 422) {
            exchangeStatus.textContent = 'ข้อมูลสำหรับเปลี่ยนสถานะไม่ถูกต้อง';
        } else {
            exchangeStatus.textContent = error.message || 'เปลี่ยนสถานะไม่สำเร็จ';
        }
    } finally { exchangeSubmitBtn.disabled = false; }
}

if (exchangeBtnOngoing) exchangeBtnOngoing.onclick = () => handleStatusTransition('ongoing');
if (exchangeBtnCompleted) exchangeBtnCompleted.onclick = () => handleStatusTransition('completed');
if (exchangeBtnCancelled) exchangeBtnCancelled.onclick = () => handleStatusTransition('cancelled');

window.addEventListener('focus', refreshWorkspace);
window.addEventListener('pageshow', refreshWorkspace);
window.addEventListener('authchange', refreshWorkspace);
refreshWorkspace();
