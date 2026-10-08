'use strict';
const byId = id => document.getElementById(id);
const show = (id, value) => { byId(id).textContent = JSON.stringify(value, null, 2); };
async function refresh() {
    try {
        const state = await CstuAuth.refresh();
        // Never display CSRF or the raw HttpOnly Session token.
        show('session', {user: state.user, grants: state.grants, capabilities: state.capabilities});
        byId('status').textContent = state.user ? 'เข้าสู่ระบบแล้ว: ' + state.user.displayName : 'สถานะผู้ไม่ Login';
    } catch { byId('status').textContent = 'อ่าน Session ไม่ได้ ลองอ่านสถานะใหม่'; }
}
byId('login').onclick = async () => {
    byId('login').disabled = true;
    try { await CstuAuth.login(byId('account').value, 'mock'); await refresh(); }
    catch { byId('status').textContent = 'เข้าสู่ระบบไม่ได้ หรือเรียกถี่เกินไป ลองรีสตาร์ต mock server'; }
    finally { byId('login').disabled = false; byId('result').textContent = 'เลือก API เพื่ออ่านข้อมูลด้วยบัญชีปัจจุบัน'; }
};
byId('logout').onclick = async () => {
    try { await CstuAuth.logout(); await refresh(); byId('result').textContent = 'ออกจากระบบแล้ว'; }
    catch { byId('status').textContent = 'ออกจากระบบไม่ได้ กรุณาลองใหม่'; }
};
byId('refresh').onclick = refresh;
for (const button of document.querySelectorAll('[data-api]')) button.onclick = async () => {
    try { show('result', await CstuAuth.request(button.dataset.api)); }
    catch (error) { show('result', {status: error.status, error: error.message}); }
};
window.addEventListener('focus', refresh);
window.addEventListener('authchange', refresh);
(async () => {
    const response = await fetch('/__mock/users', {cache:'no-store'});
    if (!response.ok) throw new Error('Mock server unavailable');
    for (const user of await response.json()) {
        const option = document.createElement('option'); option.value = user.username; option.textContent = user.name; byId('account').append(option);
        const row = document.createElement('tr');
        for (const value of [user.name, user.id]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
        byId('users').append(row);
    }
    await refresh();
})().catch(() => { byId('status').textContent = 'เปิดหน้านี้ผ่าน python3 tools/mock-auth/server.py เท่านั้น'; });
