/* Internal form batches. Rendering uses text nodes only, including spreadsheet text. */
(() => {
    'use strict';
    const workerURL = new URL('form-import-worker.js', document.currentScript.src);
    const sources = {partner: 'คู่ความร่วมมือ', participant: 'ผู้เข้าร่วม', other: 'อื่น ๆ'};
    const node = (tag, className, text) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    };
    function icon(name) { const el = node('i', 'fas fa-' + name); el.setAttribute('aria-hidden', 'true'); return el; }
    function button(label, className = '', symbol) {
        const el = node('button', className); el.type = 'button';
        if (symbol) el.append(icon(symbol));
        el.append(document.createTextNode(label)); return el;
    }
    function errorText(error) {
        return ({DUPLICATE_FORM_IMPORT: 'ชุดคำตอบนี้นำเข้าในรายการนี้แล้ว กรุณาเปิดฟอร์มเดิม',
            FORM_IMPORT_TOO_LARGE: 'ข้อมูลที่เลือกเกิน 200 KiB กรุณาแบ่งไฟล์',
            INVALID_FORM_IMPORT: 'ข้อมูลนำเข้าไม่ถูกต้อง กรุณาตรวจไฟล์และคอลัมน์',
            VERSION_CONFLICT: 'ข้อมูลหรือสิทธิ์เปลี่ยนแล้ว กรุณาโหลดรายการใหม่',
            AUTH_REQUIRED: 'กรุณาเข้าสู่ระบบอีกครั้ง',
            NOT_FOUND: 'ไม่พบรายการ หรือคุณไม่มีสิทธิ์เข้าถึงแล้ว',
            FORBIDDEN: 'คุณไม่มีสิทธิ์จัดการผลตอบรับของรายการนี้'
        })[error.message] || error.message || 'ระบบไม่พร้อมใช้งาน กรุณาลองใหม่';
    }
    const date = value => {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('th-TH', {day: 'numeric', month: 'short', year: 'numeric'});
    };
    function responseList(host, data, start = 0, count = 20) {
        const list = node('ol', 'form-response-list');
        data.rows.slice(start, start + count).forEach((row, offset) => {
            const li = node('li', 'form-response');
            const avatar = node('span', 'form-response-avatar'); avatar.append(icon('user'));
            const body = node('div', 'form-response-body');
            const head = node('div', 'form-response-heading');
            head.append(node('h4', '', 'ผู้ตอบคนที่ ' + (start + offset + 1)));
            if (row.respondedAt) head.append(node('span', 'form-muted', 'เวลาตอบตามไฟล์: ' + row.respondedAt));
            body.append(head);
            data.columns.forEach((question, index) => {
                const answer = row.answers[index];
                if (!answer.trim()) return;
                const line = node('p', 'form-answer');
                line.append(node('strong', '', question + ': '), document.createTextNode(answer)); body.append(line);
            });
            li.append(avatar, body); list.append(li);
        });
        host.append(list);
        if (start + count < data.rows.length) {
            const more = button('อ่านคำตอบถัดไป (' + (data.rows.length - start - count) + ')', 'form-more');
            more.onclick = () => { more.remove(); responseList(host, data, start + count, count); }; host.append(more);
        }
    }
    async function mount(container, parent, kind, session) {
        if (!['partners', 'activities', 'exchanges'].includes(kind) || !window.CstuWork.roles(session, parent.scopeId).some(role => ['coordinator','staff','executive'].includes(role))) return false;
        container.className = 'form-feedback';
        const top = node('div', 'form-feedback-heading');
        const intro = node('div'); intro.append(node('h3', '', 'ผลตอบรับจากแบบฟอร์ม'), node('p', 'form-muted', 'ข้อมูลภายในของรายการนี้'));
        const add = button('นำเข้าแบบฟอร์ม', 'form-primary', 'plus'); add.hidden = true; top.append(intro, add);
        const status = node('p', 'form-status'); status.setAttribute('role', 'status');
        const editor = node('div'), list = node('div', 'form-batches');
        container.append(top, status, editor, list);
        const base = '/' + kind + '/' + encodeURIComponent(parent.id) + '/form-feedback';
        let revision = 0;
        const alive = () => container.isConnected;
        async function load() {
            const current = ++revision; status.textContent = 'กำลังโหลดแบบฟอร์ม'; list.replaceChildren();
            try {
                let cursor, total = 0;
                do {
                    const result = await window.CstuAuth.request(base + '?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
                    if (!alive() || current !== revision) return;
                    add.hidden = !result.canCreate;
                    result.data.forEach(row => list.append(batch(row))); total += result.data.length;
                    cursor = result.page.nextCursor;
                } while (cursor);
                status.textContent = total ? '' : 'ยังไม่มีผลตอบรับจากแบบฟอร์ม';
            } catch (error) {
                if (!alive() || current !== revision) return;
                list.replaceChildren(); status.textContent = errorText(error);
                if ([401, 403, 404].includes(error.status)) { editor.replaceChildren(); add.hidden = true; }
                const retry = button('ลองโหลดใหม่'); retry.onclick = load; list.append(retry);
            }
        }
        function batch(row) {
            const article = node('article', 'form-batch');
            const header = node('div', 'form-batch-header');
            const toggle = button('', 'form-batch-toggle'); toggle.setAttribute('aria-expanded', 'false');
            const info = node('span', 'form-batch-info');
            info.append(node('strong', 'form-batch-title', row.formName),
                node('span', 'form-muted', ['นำเข้า ' + date(row.createdAt), sources[row.sourceType], row.responseCount + ' คำตอบ'].join(' · ')));
            const arrow = icon('chevron-down'); toggle.append(info, arrow);
            const content = node('div', 'form-batch-content'); content.id = 'form-content-' + row.id; content.hidden = true;
            toggle.setAttribute('aria-controls', content.id);
            header.append(toggle);
            const confirm = node('div', 'form-delete-confirm'); confirm.hidden = true;
            if (row.canDelete) {
                const remove = button('', 'form-delete', 'trash-alt');
                remove.setAttribute('aria-label', 'ลบแบบฟอร์ม ' + row.formName); remove.title = 'ลบแบบฟอร์ม';
                remove.onclick = () => { confirm.hidden = !confirm.hidden; };
                const yes = button('ยืนยันลบ', 'form-danger'), no = button('ยกเลิก');
                const message = node('p', '', 'ลบ “' + row.formName + '” และคำตอบทั้งหมดในเว็บนี้? ไฟล์ต้นฉบับจะไม่ถูกลบ');
                const feedback = node('p', 'form-status'); feedback.setAttribute('role', 'status');
                no.onclick = () => { confirm.hidden = true; remove.focus(); };
                yes.onclick = async () => {
                    yes.disabled = no.disabled = true; feedback.textContent = 'กำลังลบ';
                    try { await window.CstuAuth.remove(base + '/' + encodeURIComponent(row.id), row.version); if (alive()) { await load(); add.focus(); } }
                    catch (error) { feedback.textContent = errorText(error); }
                    finally { yes.disabled = no.disabled = false; }
                };
                confirm.append(message, yes, no, feedback); header.append(remove);
            }
            let pending = false;
            toggle.onclick = async () => {
                if (pending) return;
                const opening = content.hidden;
                content.hidden = !opening; toggle.setAttribute('aria-expanded', String(opening));
                arrow.className = 'fas fa-chevron-' + (opening ? 'up' : 'down');
                // Fetch on every open so revocation/deletion is never bypassed by a local cache.
                content.replaceChildren(); if (!opening) return;
                pending = true; content.append(node('p', 'form-muted', 'กำลังโหลดคำตอบ'));
                try {
                    const result = await window.CstuAuth.request(base + '/' + encodeURIComponent(row.id));
                    if (!alive()) return;
                    content.replaceChildren();
                    content.append(node('p', 'form-provenance', 'นำเข้าโดย ' + (result.data.importedByName || result.data.createdBy) +
                        ' · ' + result.data.fileName + ' · ชีต ' + result.data.sheetName));
                    responseList(content, result.data);
                } catch (error) { content.replaceChildren(node('p', 'form-status', errorText(error))); }
                finally { pending = false; }
            };
            article.append(header, confirm, content); return article;
        }
        add.onclick = () => {
            add.disabled = true;
            importForm(editor, parent, async (payload, retryKey) => {
                await window.CstuAuth.create(base, payload, retryKey);
                if (alive()) { editor.replaceChildren(); add.disabled = false; await load(); }
            }, () => { editor.replaceChildren(); add.disabled = false; add.focus(); });
        };
        await load(); return true;
    }
    function importForm(host, parent, onSave, onCancel) {
        host.replaceChildren(); const form = node('form', 'form-import-editor');
        const title = node('h4', '', 'นำเข้าคำตอบใน ' + (parent.name || parent.title || 'รายการนี้'));
        const help = node('p', 'form-muted', 'เลือก Excel (.xlsx) หรือ CSV จาก Google Forms ได้โดยไม่ต้องเปิด Excel ไฟล์ไม่เกิน 5 MiB');
        form.append(title, help);
        function field(label, control) {
            const wrap = node('label', 'form-import-field'); wrap.append(node('span', '', label), control); form.append(wrap); return control;
        }
        const file = field('ไฟล์คำตอบ', node('input')); file.type = 'file'; file.accept = '.xlsx,.csv'; file.required = true;
        const formName = field('ชื่อแบบฟอร์ม', node('input')); formName.required = true; formName.maxLength = 200;
        const source = field('คำตอบจาก', node('select'));
        Object.entries(sources).forEach(([value, label]) => { const option = node('option', '', label); option.value = value; source.append(option); });
        const sheet = field('ชีต', node('select')); sheet.disabled = true;
        const header = field('แถวหัวคำถาม', node('input')); header.type = 'number'; header.min = '1'; header.max = '100'; header.value = '1'; header.disabled = true; header.required = true;
        const time = field('คอลัมน์เวลาตอบ (ไม่บังคับ)', node('select')); time.disabled = true;
        const columns = node('fieldset', 'form-column-picker'); columns.append(node('legend', '', 'เลือกคำถามที่จะนำเข้า'));
        form.append(columns, node('p', 'form-muted', 'ระบบเว้นคอลัมน์ที่ชื่อสื่อถึงข้อมูลส่วนบุคคลไว้ก่อน แต่อาจตรวจไม่ครบ โปรดตรวจทุกคอลัมน์ก่อนยืนยัน'));
        const message = node('p', 'form-status'); message.setAttribute('role', 'status');
        const preview = node('div', 'form-import-preview'); preview.hidden = true;
        const actions = node('div', 'form-import-actions');
        const review = button('ดูตัวอย่าง', 'form-primary'), back = button('กลับไปแก้ไข'), cancel = button('ยกเลิก');
        const save = button('ยืนยันนำเข้า', 'form-primary'); save.hidden = back.hidden = true;
        actions.append(review, back, save, cancel); form.append(message, preview, actions); host.append(form);
        const controls = [file, formName, source, sheet, header, time, columns];
        let sheets = [], chosen = null, prepared = null, retryKey, worker, timer, readRevision = 0, saving = false;
        function stopRead() { worker?.terminate(); clearTimeout(timer); worker = null; }
        function edit() {
            prepared = null; preview.hidden = true; preview.replaceChildren();
            save.hidden = back.hidden = true; review.hidden = false;
            controls.forEach(control => control.hidden = false);
            form.querySelectorAll('.form-import-field').forEach(control => control.hidden = false);
        }
        function configure() {
            edit(); columns.replaceChildren(node('legend', '', 'เลือกคำถามที่จะนำเข้า')); time.replaceChildren();
            const none = node('option', '', 'ไม่ระบุ'); none.value = '-1'; time.append(none);
            const matrix = sheets[Number(sheet.value)]?.rows || [], offset = Number(header.value) - 1;
            if (!Number.isInteger(offset) || offset < 0 || offset >= Math.min(matrix.length, 100)) { message.textContent = 'เลือกแถวหัวคำถามที่มีอยู่ในชีต'; return; }
            const labels = matrix[offset] || [];
            labels.forEach((label, index) => {
                const text = String(label ?? ''); const item = node('label', 'form-column');
                const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.value = String(index);
                checkbox.checked = Boolean(text.trim()) && !/ชื่อ|นามสกุล|name|mail|เมล|เมล์|โทร|phone|ที่อยู่|address|รหัส|เลขประจำตัว|\bid\b|timestamp|ประทับเวลา|วันที่ตอบ|เวลาตอบ/i.test(text);
                item.append(checkbox, node('span', '', text || 'คอลัมน์ ' + (index + 1) + ' (ไม่มีหัวคำถาม)')); columns.append(item);
                const option = node('option', '', text || 'คอลัมน์ ' + (index + 1)); option.value = String(index); time.append(option);
                if (/^(timestamp|ประทับเวลา|วันที่ตอบ|เวลาตอบ)$/i.test(text.trim())) time.value = String(index);
            });
            message.textContent = 'อ่านได้ ' + Math.max(0, matrix.length - offset - 1) + ' แถว · เลือกเฉพาะข้อมูลที่ต้องการเก็บ';
        }
        file.onchange = async () => {
            stopRead(); const current = ++readRevision; edit(); sheets = []; chosen = file.files[0];
            sheet.replaceChildren(); columns.replaceChildren(); sheet.disabled = header.disabled = time.disabled = true;
            if (!chosen) return;
            if (!/\.(xlsx|csv)$/i.test(chosen.name) || chosen.size > 5 * 1024 * 1024) { message.textContent = 'เลือกไฟล์ .xlsx หรือ .csv ขนาดไม่เกิน 5 MiB'; return; }
            formName.value = chosen.name.replace(/\.(xlsx|csv)$/i, '').slice(0, 200); message.textContent = 'กำลังอ่านไฟล์ในเครื่อง';
            try {
                const buffer = await chosen.arrayBuffer();
                if (current !== readRevision || !host.isConnected) return;
                worker = new Worker(workerURL);
                timer = setTimeout(() => { stopRead(); message.textContent = 'อ่านไฟล์นานเกินไป กรุณาลดขนาดไฟล์หรือใช้ CSV'; }, 15000);
                worker.onerror = () => { stopRead(); message.textContent = 'เปิดตัวอ่านไฟล์ไม่ได้ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง'; };
                worker.onmessage = event => {
                    stopRead(); if (current !== readRevision || !host.isConnected) return;
                    if (event.data.error) { message.textContent = event.data.error; return; }
                    sheets = event.data.sheets; sheet.replaceChildren();
                    sheets.forEach((entry, index) => { const option = node('option', '', entry.name); option.value = String(index); sheet.append(option); });
                    sheet.disabled = header.disabled = time.disabled = false; header.value = '1'; configure();
                };
                worker.postMessage({buffer, name: chosen.name}, [buffer]);
            } catch (error) { stopRead(); message.textContent = errorText(error); }
        };
        sheet.onchange = () => { header.value = '1'; configure(); }; header.onchange = configure;
        review.onclick = () => {
            if (!form.reportValidity()) return;
            try {
                if (!sheets.length) throw Error('เลือกไฟล์และรอให้อ่านเสร็จก่อน');
                const selected = [...columns.querySelectorAll('input:checked')].map(input => Number(input.value));
                const selectedSheet = sheets[Number(sheet.value)];
                const data = window.CstuFormImportData.prepare(selectedSheet.rows, Number(header.value) - 1, selected, Number(time.value));
                prepared = {formName: formName.value.trim(), sourceType: source.value, fileName: chosen.name, sheetName: selectedSheet.name, columns: data.columns, rows: data.rows};
                window.CstuFormImportData.assertSize(prepared);
                retryKey = crypto.randomUUID();
                preview.replaceChildren(node('h4', '', 'ตรวจตัวอย่างก่อนนำเข้า'),
                    node('p', '', prepared.formName + ' · ' + sources[prepared.sourceType] + ' · ' + data.rows.length + ' คำตอบ'),
                    node('p', 'form-muted', 'ข้าม ' + data.skipped + ' แถวที่ไม่มีคำตอบในคอลัมน์ที่เลือก · บันทึกเฉพาะข้อมูลที่แสดงนี้'));
                responseList(preview, data, 0, 5); preview.hidden = false;
                controls.forEach(control => control.hidden = true);
                form.querySelectorAll('.form-import-field').forEach(control => control.hidden = true);
                save.textContent = 'ยืนยันนำเข้า ' + data.rows.length + ' คำตอบ'; save.hidden = back.hidden = false; review.hidden = true;
                message.textContent = ''; save.focus();
            } catch (error) { prepared = null; message.textContent = errorText(error); }
        };
        back.onclick = edit;
        cancel.onclick = () => { if (!saving) { ++readRevision; stopRead(); onCancel(); } };
        save.onclick = async () => {
            if (!prepared || saving) return;
            saving = true; save.disabled = back.disabled = cancel.disabled = true; message.textContent = 'กำลังนำเข้า';
            try { await onSave(prepared, retryKey); }
            catch (error) { message.textContent = errorText(error); }
            finally { saving = false; save.disabled = back.disabled = cancel.disabled = false; }
        };
        form.onsubmit = event => { event.preventDefault(); if (!review.hidden) review.click(); };
        file.focus();
    }
    // Remove internal response DOM immediately on logout/account switch.
    window.addEventListener('authchange', () => document.querySelectorAll('.form-feedback').forEach(el => el.replaceChildren()));
    window.CstuFormFeedback = {mount, responseList};
})();
