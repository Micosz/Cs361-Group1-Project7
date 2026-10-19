/* Reuse the existing activity form intact in the shared records screen. */
(() => {
    if (!window.CstuWork) return;
    let dialog, frame, trigger, reload;
    function close() { dialog?.close(); frame?.remove(); trigger?.focus(); }
    function open(options) {
        trigger = document.activeElement; reload = options.reload;
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.className = 'entry-frame-dialog';
            dialog.style.cssText = 'box-sizing:border-box;margin:auto;width:min(900px,95vw);height:90dvh;max-height:95dvh;max-width:95vw;padding:1rem;border:1px solid #ddd;border-radius:12px;overflow:hidden';
            dialog.setAttribute('aria-label', 'จัดการกิจกรรม');
            const button = document.createElement('button'); button.className = 'entry-frame-close'; button.type = 'button'; button.textContent = 'ปิด'; button.onclick = close;
            dialog.appendChild(button); document.body.appendChild(dialog);
            dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
            dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
        }
        frame?.remove(); frame = document.createElement('iframe');
        frame.title = 'ฟอร์มกิจกรรม'; frame.style.cssText = 'display:block;width:100%;height:calc(100% - 3rem);border:0';
        frame.src = 'workspace.html?embed=activity' + (options.record ? '&id=' + encodeURIComponent(options.record.id) : '');
        dialog.appendChild(frame); if (!dialog.open) dialog.showModal();
    }
    window.addEventListener('authchange', close);
    window.addEventListener('message', event => {
        if (event.origin === window.location.origin && event.source === frame?.contentWindow && ['activity-saved','activity-closed'].includes(event.data?.type)) {
            const saved = event.data.type === 'activity-saved';
            close(); if (saved) reload?.();
        }
    });
    window.CstuWork.register('activities', {create:open, edit:open});
})();
