/* Private S3 transfer: app cookies and CSRF tokens never go to S3. */
(() => {
    'use strict';
    const TYPES = {pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg'};
    function fileType(file) { return TYPES[file.name.split('.').pop().toLowerCase()]; }
    function sizeLimit(file, config) {
        return !config?.directUpload ? 3 * 1024 * 1024
            : (fileType(file) || '').startsWith('image/') ? config.imageMaxBytes : config.documentMaxBytes;
    }
    function formatSize(size) {
        return size >= 1024 * 1024 ? (size / 1024 / 1024).toFixed(1) + ' MiB'
            : Math.max(1, Math.ceil(size / 1024)) + ' KiB';
    }
    async function configuration() {
        try { return (await window.CstuAuth.request('/documents/config')).data; }
        catch (error) { if (error.status === 404) return {directUpload: false}; throw error; }
    }
    async function checksum(file) {
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }
    function send(upload, file, onProgress) {
        return new Promise((resolve, reject) => {
            const url = new URL(upload.url);
            if (url.protocol !== 'https:' || !/\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname)) {
                reject(new Error('ที่อยู่อัปโหลดไม่ถูกต้อง')); return;
            }
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url.href); xhr.withCredentials = false; xhr.timeout = 300000;
            xhr.upload.onprogress = event => {
                if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
            };
            xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve()
                : reject(new Error('S3 รับไฟล์ไม่สำเร็จ (HTTP ' + xhr.status + ') กรุณาลองใหม่'));
            xhr.onerror = () => reject(new Error('ส่งไฟล์ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'));
            xhr.ontimeout = () => reject(new Error('ส่งไฟล์นานเกินกำหนด กรุณาลองใหม่'));
            xhr.onabort = () => reject(new Error('ยกเลิกการส่งไฟล์แล้ว'));
            const form = new FormData();
            for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
            form.append('file', file); // S3 requires the file field last.
            xhr.send(form);
        });
    }
    function finished(ticket) {
        if (ticket.state === 'ready') return ticket.document;
        if (ticket.state === 'failed') throw new Error(ticket.error || 'INVALID_UPLOAD');
        return null;
    }
    async function complete(id) {
        const fresh = await window.CstuAuth.refresh();
        return (await window.CstuAuth.request('/document-uploads/' + encodeURIComponent(id) + '/complete', {
            method: 'POST', body: '{}', headers: {'X-CSRF-Token': fresh.csrfToken}, timeoutMs: 30000
        })).data;
    }
    async function upload(kind, record, item, onProgress) {
        const mime = fileType(item.file);
        if (!mime) throw new Error('รองรับเฉพาะ PDF, DOCX, PNG และ JPEG');
        onProgress('กำลังตรวจไฟล์');
        item.sha256 = item.sha256 || await checksum(item.file);
        let ticket = (await window.CstuAuth.create('/' + kind + 's/' + encodeURIComponent(record.id) + '/document-uploads', {
            fileName: item.file.name, contentType: mime, size: item.file.size, sha256: item.sha256,
            displayName: item.file.name, audience: item.audience, containsPersonal: item.personal
        }, item.requestKey)).data;
        let document = finished(ticket);
        if (document) return document;
        if (ticket.upload) await send(ticket.upload, item.file, percent => onProgress('กำลังส่งไฟล์ ' + percent + '%'));
        onProgress('กำลังตรวจและบันทึกไฟล์');
        try { ticket = await complete(ticket.uploadId); }
        catch (error) {
            // A gateway timeout can race a successful commit. Reconcile first.
            if (error.status && error.status < 500) throw error;
        }
        for (let attempt = 0; attempt < 60; attempt++) {
            document = finished(ticket);
            if (document) return document;
            await new Promise(resolve => setTimeout(resolve, 2000));
            ticket = (await window.CstuAuth.request('/document-uploads/' + encodeURIComponent(ticket.uploadId))).data;
            if (ticket.state === 'pending' && attempt < 2) {
                try { ticket = await complete(ticket.uploadId); }
                catch (error) { if (error.status && error.status < 500) throw error; }
            }
        }
        throw new Error('ระบบยังตรวจไฟล์อยู่ กรุณาลองใหม่ภายหลัง จะไม่แนบไฟล์ซ้ำ');
    }
    window.CstuPrivateDocuments = {configuration, fileType, sizeLimit, formatSize, upload};
})();
