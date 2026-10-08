'use strict';
const form = document.getElementById('login-form');
const status = document.getElementById('login-status');
const submit = document.getElementById('login-submit');
const usernameInput = document.getElementById('student-id');
const passwordInput = document.getElementById('student-password');
function mount() {
    const controller = new AbortController();
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!form.reportValidity() || submit.disabled) return;
        if (!window.CstuAuth?.enabled()) {
            status.textContent = 'ยังไม่ได้เชื่อมต่อระบบยืนยันตัวตน กรุณารอเปิดใช้งาน';
            status.hidden = false;
            return;
        }
        const username = usernameInput?.value || '';
        const password = passwordInput?.value || '';
        if (!username.trim() || !password) return;
        submit.disabled = true;
        status.hidden = true;
        try {
            const session = await window.CstuAuth.login(username, password, { signal: controller.signal });
            if (controller.signal.aborted) return;
            if (!session.user) throw new Error('คำตอบ Login ไม่ถูกต้อง');
            // No password/profile/Session credential in browser storage.
            window.location.href = 'index.html';
        } catch (error) {
            if (controller.signal.aborted) return;
            const messages = {
                INVALID_CREDENTIALS: 'ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง',
                RATE_LIMITED: 'เข้าสู่ระบบถี่เกินไป กรุณารอสักครู่',
                IDENTITY_REVIEW_REQUIRED: 'บัญชีนี้ต้องให้ผู้รับผิดชอบตรวจสอบตัวตนก่อน',
                ACCOUNT_DISABLED: 'บัญชีนี้ถูกระงับการใช้งาน'
            };
            status.textContent = error.name === 'AbortError' ? 'หมดเวลารอ กรุณาลองใหม่'
                : messages[error.message] || 'เข้าสู่ระบบไม่ได้ กรุณาลองใหม่ภายหลัง';
            status.hidden = false;
        } finally {
            if (passwordInput) passwordInput.value = '';
            submit.disabled = controller.signal.aborted;
        }
    }, { signal: controller.signal });
    submit.disabled = false;
    document.body.classList.add('login-enter');
    return () => {
        controller.abort();
        submit.disabled = true;
        if (passwordInput) passwordInput.value = '';
        document.body.classList.remove('login-enter');
    };
}
let dispose;
const start = () => { dispose?.(); dispose = mount(); };
start();
window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; });
window.addEventListener('pageshow', event => { if (event.persisted) start(); });
