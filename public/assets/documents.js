/* Shared private documents for Agreement, Exchange and read-only viewers. */
(() => {
    'use strict';
    // Let API Gateway return its 25-second integration timeout before the browser aborts.
    const UPLOAD_TIMEOUT_MS = 30000;

    function canUpload(session, record) {
        return (session?.grants || []).some(g => g.active !== false && g.scopeId === record.scopeId &&
            (g.role === 'staff' || (g.role === 'coordinator' && record.responsibleUserIds?.includes(session.user?.id))));
    }

    async function mount(container, kind, record, {actions} = {}) {
        container.replaceChildren();
        const title = document.createElement('h3'); title.textContent = 'เอกสารแนบ';
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        const list = document.createElement('ul'); list.className = 'document-list'; container.append(title, status, list);
        const queued = [];
        let identity = null;
        let uploadConfig = {directUpload: false};

        async function load() {
            status.textContent = 'กำลังโหลดเอกสาร'; list.replaceChildren();
            try {
                let cursor = null, total = 0;
                do {
                    const result = await window.CstuAuth.request('/' + kind + 's/' + encodeURIComponent(record.id) + '/documents?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
                    for (const doc of result.data) {
                        if (doc.uploadState !== 'ready') continue;
                        const li = document.createElement('li');
                        li.className = 'document-item';

                        const info = document.createElement('div');
                        info.className = 'document-info';

                        const icon = document.createElement('span');
                        const isPdf = /\.pdf$/i.test(doc.displayName) || doc.mime === 'application/pdf';
                        icon.className = 'document-icon ' + (isPdf ? 'doc-pdf' : 'doc-image');
                        icon.setAttribute('aria-hidden', 'true');
                        icon.innerHTML = isPdf
                            ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>'
                            : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>';

                        const meta = document.createElement('div');
                        meta.className = 'document-meta';

                        const link = document.createElement('a');
                        link.className = 'document-link';
                        link.textContent = doc.displayName;
                        link.href = '/api/documents/' + encodeURIComponent(doc.id) + '/content?disposition=attachment';
                        link.target = '_blank'; link.rel = 'noopener';

                        const size = document.createElement('span');
                        size.className = 'document-size';
                        size.textContent = window.CstuPrivateDocuments.formatSize(doc.size);

                        meta.append(link, size);
                        info.append(icon, meta);
                        li.appendChild(info);

                        if (canUpload(identity, record)) {
                            const remove = document.createElement('button'); remove.type = 'button';
                            remove.className = 'document-remove-image';
                            remove.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg><span>ลบ</span>';
                            remove.setAttribute('aria-label', 'ลบเอกสาร ' + doc.displayName);
                            remove.title = 'ลบเอกสาร ' + doc.displayName;
                            remove.onclick = async () => {
                                if (!window.confirm('ลบเอกสาร “' + doc.displayName + '” ออกจากรายการนี้?')) return;
                                remove.disabled = true;
                                try {
                                    const fresh = await window.CstuAuth.refresh();
                                    if (!canUpload(fresh, record)) throw Error('คุณไม่มีสิทธิ์ลบเอกสารนี้');
                                    await window.CstuAuth.request('/documents/' + encodeURIComponent(doc.id), {
                                        method: 'DELETE', headers: {'X-CSRF-Token': fresh.csrfToken, 'If-Match': '"' + doc.version + '"'}
                                    });
                                    await load(); status.textContent = 'ลบเอกสารเรียบร้อย';
                                } catch (error) {
                                    status.textContent = 'ลบเอกสารไม่ได้: ' + error.message;
                                    remove.disabled = false;
                                }
                            };
                            li.appendChild(remove);
                        }
                        list.appendChild(li); total++;
                    }
                    cursor = result.page?.nextCursor;
                } while (cursor);
                status.textContent = total ? '' : 'ยังไม่มีเอกสารแนบ';
            } catch (error) { status.textContent = 'โหลดเอกสารไม่ได้: ' + error.message; }
        }

        try {
            identity = await window.CstuAuth.refresh();
            await load();
            const session = identity;
            if (!container.isConnected || !canUpload(session, record)) return;
            uploadConfig = await window.CstuPrivateDocuments.configuration();

            const form = document.createElement('form');
            const fileLabel = document.createElement('label');
            fileLabel.textContent = uploadConfig.directUpload
                ? 'แนบไฟล์ (PDF/DOCX ไม่เกิน ' + window.CstuPrivateDocuments.formatSize(uploadConfig.documentMaxBytes)
                    + ', PNG/JPEG ไม่เกิน ' + window.CstuPrivateDocuments.formatSize(uploadConfig.imageMaxBytes) + ') '
                : 'แนบไฟล์ (PDF, DOCX, PNG, JPEG ไม่เกิน 3 MiB) ';
            const fileInput = document.createElement('input');
            fileInput.type = 'file'; fileInput.multiple = true; fileInput.accept = '.pdf,.docx,.png,.jpg,.jpeg';
            fileLabel.appendChild(fileInput);

            const queueTitle = document.createElement('h4'); queueTitle.textContent = 'ตรวจไฟล์และสิทธิ์ก่อนอัปโหลด';
            const help = document.createElement('p');
            help.textContent = kind === 'exchange'
                ? 'ไฟล์ใหม่เป็นส่วนตัวสำหรับผู้มีสิทธิ์ภายใน คุณเลือกแชร์กับผู้เข้าร่วมเป็นรายไฟล์ได้ (ไม่ใช่ลิงก์สาธารณะ)'
                : 'ไฟล์ใหม่เป็นส่วนตัวสำหรับผู้มีสิทธิ์ภายใน';
            const queue = document.createElement('ul'); queue.className = 'document-upload-queue';
            const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'อัปโหลดไฟล์';
            submit.disabled = true;
            const buttons = document.createElement('div'); buttons.className = 'document-form-actions';
            buttons.appendChild(submit); if (actions) buttons.appendChild(actions);
            form.append(fileLabel, queueTitle, help, queue, buttons); container.appendChild(form);

            function renderQueue() {
                queue.replaceChildren();
                for (const item of queued) {
                    const row = document.createElement('li'); row.className = 'document-upload-item';
                    const preview = document.createElement('span'); preview.className = 'document-upload-preview';
                    preview.setAttribute('aria-hidden', 'true');
                    const image = /^image\/(png|jpeg)$/i.test(item.file.type || '');
                    if (image && window.URL?.createObjectURL) {
                        const thumbnail = document.createElement('img'); thumbnail.alt = ''; thumbnail.width = 48; thumbnail.height = 48;
                        thumbnail.src = item.previewUrl || (item.previewUrl = window.URL.createObjectURL(item.file));
                        preview.appendChild(thumbnail);
                    } else {
                        preview.textContent = (item.file.name.split('.').pop() || 'FILE').slice(0, 5).toUpperCase();
                    }
                    const details = document.createElement('span'); details.className = 'document-upload-details';
                    const name = document.createElement('strong'); name.textContent = item.file.name;
                    const size = document.createElement('small'); size.textContent = ' (' + Math.max(1, Math.ceil(item.file.size / 1024)) + ' KB)';
                    details.append(name, size);

                    const accessLabel = document.createElement('label'); accessLabel.textContent = 'สิทธิ์การอ่าน ';
                    const access = document.createElement('select'); access.value = item.audience;
                    let personalControl = null;
                    const audiences = [['internal', 'ส่วนตัว · ผู้มีสิทธิ์ภายใน']];
                    if (kind === 'exchange') audiences.push(['participants', 'แชร์กับผู้เข้าร่วมโครงการ']);
                    for (const [value, label] of audiences) {
                        const option = document.createElement('option'); option.value = value; option.textContent = label; access.appendChild(option);
                    }
                    access.value = item.audience;
                    access.onchange = () => {
                        if (item.audience !== access.value) item.requestKey = crypto.randomUUID();
                        item.audience = access.value;
                        if (item.audience !== 'participants' && item.personal) {
                            item.personal = false;
                            if (personalControl) personalControl.checked = false;
                        }
                        if (personalControl) personalControl.disabled = item.audience !== 'participants';
                    };
                    accessLabel.appendChild(access);

                    row.append(preview, details, accessLabel);
                    if (kind === 'exchange') {
                        const personalLabel = document.createElement('label'), personal = document.createElement('input');
                        personal.type = 'checkbox'; personal.checked = item.personal;
                        personal.disabled = item.audience !== 'participants';
                        personalControl = personal;
                        personal.onchange = () => {
                            if (item.personal !== personal.checked) item.requestKey = crypto.randomUUID();
                            item.personal = personal.checked;
                        };
                        personalLabel.append(personal, document.createTextNode(' มีข้อมูลส่วนบุคคลของผู้เข้าร่วม'));
                        row.appendChild(personalLabel);
                    }
                    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'นำออก';
                    remove.setAttribute('aria-label', 'นำ ' + item.file.name + ' ออกจากรายการ');
                    remove.onclick = () => {
                        if (item.previewUrl) window.URL?.revokeObjectURL?.(item.previewUrl);
                        queued.splice(queued.indexOf(item), 1); renderQueue();
                    };
                    row.appendChild(remove); queue.appendChild(row);
                }
                submit.disabled = queued.length === 0;
            }

            fileInput.onchange = () => {
                const files = Array.from(fileInput.files || []);
                for (const selected of files) {
                    const limit = window.CstuPrivateDocuments.sizeLimit(selected, uploadConfig);
                    if (selected.size > limit) {
                        status.textContent = 'ไฟล์ ' + selected.name + ' ต้องไม่เกิน ' + window.CstuPrivateDocuments.formatSize(limit); continue;
                    }
                    if (queued.some(item => item.file.name === selected.name && item.file.size === selected.size && item.file.lastModified === selected.lastModified)) continue;
                    queued.push({file: selected, audience: 'internal', personal: false, requestKey: crypto.randomUUID()});
                }
                fileInput.value = '';
                renderQueue();
                if (queued.length) status.textContent = '';
            };

            form.onsubmit = async event => {
                event.preventDefault(); if (submit.disabled || queued.length === 0) return;
                submit.disabled = true; fileInput.disabled = true;
                const errors = [];
                try {
                    const fresh = await window.CstuAuth.refresh();
                    for (const item of [...queued]) {
                        if (item.personal && item.audience !== 'participants') {
                            errors.push(item.file.name + ': เอกสารส่วนบุคคลต้องแชร์กับผู้เข้าร่วมโครงการ'); continue;
                        }
                        status.textContent = 'กำลังอัปโหลด ' + item.file.name;
                        const body = new FormData(); body.append('file', item.file); body.append('displayName', item.file.name);
                        body.append('audience', item.audience); body.append('containsPersonal', String(item.personal));
                        try {
                            if (uploadConfig.directUpload) {
                                await window.CstuPrivateDocuments.upload(kind, record, item,
                                    message => { status.textContent = item.file.name + ': ' + message; });
                            } else {
                                await window.CstuAuth.request('/' + kind + 's/' + encodeURIComponent(record.id) + '/documents', {
                                    method: 'POST', body, timeoutMs: UPLOAD_TIMEOUT_MS,
                                    headers: {'X-CSRF-Token': fresh.csrfToken, 'Idempotency-Key': item.requestKey}
                                });
                            }
                            if (item.previewUrl) window.URL?.revokeObjectURL?.(item.previewUrl);
                            queued.splice(queued.indexOf(item), 1);
                        } catch (error) { errors.push(item.file.name + ': ' + error.message); }
                    }
                    await load();
                    status.textContent = errors.length ? 'อัปโหลดบางไฟล์ไม่สำเร็จ — ' + errors.join(' · ') : 'อัปโหลดเอกสารเรียบร้อย';
                    renderQueue();
                } catch (error) { status.textContent = 'ตรวจสิทธิ์หรืออัปโหลดไม่ได้: ' + error.message; }
                finally { fileInput.disabled = false; submit.disabled = queued.length === 0; }
            };
        } catch (error) { status.textContent = 'ตรวจสิทธิ์ไม่ได้: ' + error.message; }
    }

    window.DocumentComponent = {mount};
})();
