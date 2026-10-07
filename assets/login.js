/* Login UI and motion only. No authentication, credential storage or network requests. */
(() => {
    'use strict';
    const form = document.getElementById('login-form');
    const status = document.getElementById('login-status');
    const submit = document.getElementById('login-submit');
    const root = document.documentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const narrow = window.matchMedia('(max-width: 767px)');
    let dispose;
    function mount() {
        const controller = new AbortController();
        let frame = 0;
        const update = () => {
            frame = 0;
            const progress = reduced.matches ? 0 : Math.min(window.scrollY, window.innerHeight);
            const strength = narrow.matches ? .35 : 1;
            root.style.setProperty('--light-y', `${progress * .18 * strength}px`);
            root.style.setProperty('--heading-y', `${progress * .1 * strength}px`);
            root.style.setProperty('--panel-y', `${-progress * .035 * strength}px`);
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
        window.addEventListener('scroll', schedule, { passive: true, signal: controller.signal });
        window.addEventListener('resize', schedule, { passive: true, signal: controller.signal });
        reduced.addEventListener('change', schedule, { signal: controller.signal });
        narrow.addEventListener('change', schedule, { signal: controller.signal });
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            status.textContent = 'หน้านี้ยังไม่ได้เชื่อมต่อระบบยืนยันตัวตน จึงยังไม่สามารถเข้าสู่ระบบได้';
            status.hidden = false;
            // Never send, log, store, or pretend to authenticate the entered credentials.
        }, { signal: controller.signal });
        // Enable submission only after its local-only handler is installed.
        submit.disabled = false;
        document.body.classList.add('login-enter');
        update();
        return () => { controller.abort(); cancelAnimationFrame(frame); submit.disabled = true; document.body.classList.remove('login-enter'); };
    }
    const start = () => { dispose?.(); dispose = mount(); };
    start();
    window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; });
    window.addEventListener('pageshow', event => { if (event.persisted) start(); });
})();
