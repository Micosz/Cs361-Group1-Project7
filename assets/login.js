/* Fixed-viewport login UI only: no authentication, storage, requests or scroll choreography. */
(() => {
    'use strict';
    const form = document.getElementById('login-form');
    const status = document.getElementById('login-status');
    const submit = document.getElementById('login-submit');
    let dispose;
    function mount() {
        const controller = new AbortController();
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            status.textContent = 'หน้านี้ยังไม่ได้เชื่อมต่อระบบยืนยันตัวตน จึงยังไม่สามารถเข้าสู่ระบบได้';
            status.hidden = false;
        }, { signal: controller.signal });
        // Enable only after the local-only submit handler is installed.
        submit.disabled = false;
        document.body.classList.add('login-enter');
        return () => { controller.abort(); submit.disabled = true; document.body.classList.remove('login-enter'); };
    }
    const start = () => { dispose?.(); dispose = mount(); };
    start();
    window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; });
    window.addEventListener('pageshow', event => { if (event.persisted) start(); });
})();
