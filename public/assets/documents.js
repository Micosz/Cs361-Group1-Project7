/* Shared private documents for Agreement, Exchange and read-only viewers. */
(() => {
    'use strict';
    function canUpload(session, record) {
        return (session?.grants || []).some(g => g.active !== false && g.scopeId === record.scopeId &&
            (g.role === 'staff' || (g.role === 'coordinator' && record.responsibleUserIds?.includes(session.user?.id))));
    }
    async function mount(container, kind, record) {
        container.replaceChildren();
        const title = document.createElement('h3'); title.textContent = 'เอกสารแนบ';
        const status = document.createElement('p'); status.setAttribute('role','status');
        const list = document.createElement('ul'); container.append(title,status,list);
        let requestKey = null, submission = null;
        async function load() {
            status.textContent = 'กำลังโหลดเอกสาร'; list.replaceChildren();
            try {
                let cursor = null, total = 0;
                do {
                    const result = await window.CstuAuth.request('/'+kind+'s/'+encodeURIComponent(record.id)+'/documents?limit=100'+(cursor ? '&cursor='+encodeURIComponent(cursor) : ''));
                    for (const doc of result.data) {
                        if (doc.uploadState !== 'ready') continue;
                        const li = document.createElement('li'), link = document.createElement('a');
                        link.textContent = doc.displayName + ' ('+Math.round(doc.size/1024)+' KB)';
                        link.href = '/api/documents/'+encodeURIComponent(doc.id)+'/content?disposition=attachment';
                        link.target = '_blank'; link.rel = 'noopener'; li.appendChild(link); list.appendChild(li); total++;
                    }
                    cursor = result.page?.nextCursor;
                } while (cursor);
                status.textContent = total ? '' : 'ยังไม่มีเอกสารแนบ';
            } catch (error) { status.textContent = 'โหลดเอกสารไม่ได้: '+error.message; }
        }
        await load();
        try {
            const session = await window.CstuAuth.refresh();
            if (!container.isConnected || !canUpload(session,record)) return;
            const form = document.createElement('form');
            const fileLabel = document.createElement('label'); fileLabel.textContent = 'แนบไฟล์ (PDF, DOCX, PNG, JPEG ไม่เกิน 3 MiB) ';
            const file = document.createElement('input'); file.type = 'file'; file.required = true; file.accept = '.pdf,.docx,.png,.jpg,.jpeg'; fileLabel.appendChild(file);
            const audienceLabel = document.createElement('label'); audienceLabel.textContent = ' ผู้ที่อ่านได้ ';
            const audience = document.createElement('select');
            for (const [value,label] of [['internal','ผู้มีสิทธิ์ภายใน'], ...(kind === 'exchange' ? [['participants','ผู้เข้าร่วมโครงการด้วย']] : [])]) {
                const option = document.createElement('option'); option.value = value; option.textContent = label; audience.appendChild(option);
            }
            audienceLabel.appendChild(audience);
            const personalLabel = document.createElement('label'), personal = document.createElement('input'); personal.type = 'checkbox';
            personalLabel.append(personal,document.createTextNode(' มีข้อมูลส่วนบุคคลของผู้เข้าร่วม'));
            personalLabel.hidden = kind !== 'exchange';
            const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'อัปโหลด';
            form.append(fileLabel,audienceLabel,personalLabel,submit); container.appendChild(form);
            form.onsubmit = async event => {
                event.preventDefault(); if (submit.disabled) return;
                const selected = file.files[0]; if (!selected) return;
                if (selected.size > 3*1024*1024) { status.textContent = 'ไฟล์ต้องไม่เกิน 3 MiB'; return; }
                if (personal.checked && audience.value !== 'participants') { status.textContent = 'เอกสารส่วนบุคคลต้องเลือกผู้เข้าร่วมโครงการ'; return; }
                const fingerprint = JSON.stringify([selected.name,selected.size,selected.lastModified,audience.value,personal.checked]);
                if (submission !== fingerprint) { submission = fingerprint; requestKey = crypto.randomUUID(); }
                const body = new FormData(); body.append('file',selected); body.append('displayName',selected.name);
                body.append('audience',audience.value); body.append('containsPersonal',String(personal.checked));
                submit.disabled = true; status.textContent = 'กำลังอัปโหลด';
                try {
                    const fresh = await window.CstuAuth.refresh();
                    await window.CstuAuth.request('/'+kind+'s/'+encodeURIComponent(record.id)+'/documents', {
                        method:'POST', body, headers:{'X-CSRF-Token':fresh.csrfToken,'Idempotency-Key':requestKey}});
                    requestKey = null; submission = null; file.value = ''; await load();
                } catch (error) { status.textContent = 'อัปโหลดไม่สำเร็จ: '+error.message; }
                finally { submit.disabled = false; }
            };
        } catch (error) { status.textContent = 'ตรวจสิทธิ์ไม่ได้: '+error.message; }
    }
    window.DocumentComponent = {mount};
})();
