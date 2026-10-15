/* Reuse the existing activity form intact in the shared records screen. */
(() => {
    if (!window.CstuWork) return;
    let dialog, frame, trigger, reload;
    function close() { dialog?.close(); frame?.remove(); trigger?.focus(); }
    function open(options) {
        trigger = document.activeElement; reload = options.reload;
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.style.cssText = 'width:min(900px,95vw);height:85vh;padding:1rem;border-radius:12px';
            dialog.setAttribute('aria-label', 'จัดการกิจกรรม');
            const button = document.createElement('button'); button.type = 'button'; button.textContent = 'ปิด'; button.onclick = close;
            dialog.appendChild(button); document.body.appendChild(dialog);
            dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
            dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
        }
        frame?.remove(); frame = document.createElement('iframe');
        frame.title = 'ฟอร์มกิจกรรม'; frame.style.cssText = 'width:100%;height:calc(100% - 3rem);border:0';
        frame.src = 'workspace.html?embed=activity' + (options.record ? '&id=' + encodeURIComponent(options.record.id) : '');
        dialog.appendChild(frame); if (!dialog.open) dialog.showModal();
    }
    window.addEventListener('authchange', close);
    window.addEventListener('message', event => {
        if (event.origin === window.location.origin && event.source === frame?.contentWindow && event.data?.type === 'activity-saved') {
            close(); reload?.();
        }
    });
    window.CstuWork.register('activities', {create:open, edit:open});
})();
