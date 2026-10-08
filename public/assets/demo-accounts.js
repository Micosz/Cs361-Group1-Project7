/* Display-only course account help. Authentication stays in the normal Login form. */
(() => {
    const trigger = document.getElementById('open-demo-accounts');
    const dialog = document.getElementById('demo-accounts-dialog');
    const close = document.getElementById('close-demo-accounts');
    if (!trigger || !dialog || !close) return;
    trigger.addEventListener('click', () => {
        if (!dialog.open) dialog.showModal();
        trigger.setAttribute('aria-expanded', 'true');
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
        const bounds = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right
            || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    });
    dialog.addEventListener('close', () => {
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
    });
    window.addEventListener('pagehide', () => { if (dialog.open) dialog.close(); });
})();
