'use strict';
const workspaceStatus = document.getElementById('workspace-status');
const openRoles = document.getElementById('open-roles');
const scope = document.getElementById('role-scope');
const target = document.getElementById('role-target');
const choices = document.getElementById('role-choices');
const saveRoles = document.getElementById('save-roles');
const roleStatus = document.getElementById('role-status');
let version = null, selectedTarget = null, selectedScope = null;
function invalidateSelection() {
    version = null; selectedTarget = null; selectedScope = null;
    choices.disabled = true; saveRoles.disabled = true;
    document.getElementById('role-user').textContent = '';
    document.getElementById('confirm-identity').checked = false;
}
async function refreshWorkspace() {
    openRoles.hidden = true;
    invalidateSelection();
    if (!window.CstuAuth?.enabled()) {
        workspaceStatus.textContent = 'พื้นที่ผู้ใช้ยังไม่เปิดใช้งาน กรุณากลับหน้าหลัก';
        return;
    }
    try {
        const session = await window.CstuAuth.refresh();
        if (!session?.user) { window.location.replace('login.html'); return; }
        const view = new URLSearchParams(window.location.search).get('view');
        const roles = window.CstuAuth.roles(session);
        const managed = [...new Set(session.capabilities.filter(c => c.name === 'manageRoles').map(c => c.scopeId))];
        if (view && (view === 'roles' ? !managed.length : !roles.includes(view))) {
            workspaceStatus.textContent = 'คุณไม่มีสิทธิ์เข้าพื้นที่นี้'; return;
        }
        workspaceStatus.textContent = roles.length
            ? 'เข้าสู่ระบบแล้ว ส่วนงานธุรกิจจะเปิดเมื่อฟีเจอร์ที่เกี่ยวข้องพร้อม'
            : 'เข้าสู่ระบบแล้ว รอผู้มีสิทธิ์มอบหมายบทบาทงานภายใน';
        scope.replaceChildren();
        for (const id of managed) {
            const option = document.createElement('option'); option.value = id; option.textContent = id; scope.append(option);
        }
        openRoles.hidden = !managed.length;
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
window.addEventListener('focus', refreshWorkspace);
window.addEventListener('pageshow', refreshWorkspace);
window.addEventListener('authchange', refreshWorkspace);
refreshWorkspace();
