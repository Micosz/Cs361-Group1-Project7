const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const source = readFileSync('public/assets/private-documents.js', 'utf8');

function setup({url = 'https://bucket.s3.ap-southeast-2.amazonaws.com/', s3Status = 204, timeout = false, configError} = {}) {
    const calls = [], transfers = [];
    const ready = {uploadId: 'upload-example', state: 'ready', document: {id: 'document-example'}};
    const auth = {
        refresh: async () => ({csrfToken: 'app-only-csrf'}),
        create: async (...args) => { calls.push(['create', ...args]); return {data: {uploadId: 'upload-example',
            state: 'pending', upload: {url, fields: {key: 'documents/staging/example.pdf', policy: 'signed-policy'}}}}; },
        request: async (path, options) => {
            calls.push(['request', path, options]);
            if (path === '/documents/config') {
                if (configError) throw configError;
                return {data: {directUpload: true, documentMaxBytes: 52428800, imageMaxBytes: 10485760}};
            }
            if (path.endsWith('/complete') && timeout) throw Object.assign(new Error('gateway timeout'), {status: 504});
            return {data: ready};
        }
    };
    class XHR {
        constructor() { this.upload = {}; transfers.push(this); }
        open(method, target) { this.method = method; this.url = target; }
        setRequestHeader() { throw new Error('App headers must never go to S3'); }
        send(form) { this.form = Array.from(form.entries()); this.status = s3Status;
            this.upload.onprogress({lengthComputable: true, loaded: 50, total: 100});
            queueMicrotask(() => this.onload()); }
    }
    const context = {window: {CstuAuth: auth}, crypto: webcrypto, Uint8Array, URL, FormData,
        XMLHttpRequest: XHR, setTimeout: callback => queueMicrotask(callback)};
    vm.runInNewContext(source, context);
    return {helper: context.window.CstuPrivateDocuments, auth, calls, transfers, ready};
}

function item() {
    return {file: new File(['%PDF-1.4 client test'], 'real.pdf', {type: 'application/pdf'}),
        audience: 'internal', personal: false, requestKey: 'stable-upload-request-0001'};
}

test('raw transfer uses HTTPS S3, file last, no app credentials, checksum and progress', async () => {
    const {helper, calls, transfers} = setup();
    const messages = [], queued = item();
    const document = await helper.upload('exchange', {id: 'parent'}, queued, m => messages.push(m));
    assert.equal(document.id, 'document-example');
    assert.match(calls[0][2].sha256, /^[a-f0-9]{64}$/);
    assert.equal(calls[0][3], queued.requestKey);
    assert.equal(transfers[0].withCredentials, false);
    assert.equal(transfers[0].timeout, 300000);
    assert.equal(transfers[0].form.at(-1)[0], 'file');
    assert.ok(messages.some(m => m.includes('50%')));
    const complete = calls.find(c => c[0] === 'request' && c[1].endsWith('/complete'));
    assert.equal(complete[2].headers['X-CSRF-Token'], 'app-only-csrf');
});

test('gateway timeout reconciles existing ready document without uploading again', async () => {
    const {helper, transfers, calls} = setup({timeout: true});
    const document = await helper.upload('agreement', {id: 'parent'}, item(), () => {});
    assert.equal(document.id, 'document-example');
    assert.equal(transfers.length, 1);
    assert.ok(calls.some(c => c[1] === '/document-uploads/upload-example'));
});

test('ready idempotent retry never sends another S3 request', async () => {
    const {helper, auth, ready, transfers} = setup();
    auth.create = async () => ({data: ready});
    await helper.upload('exchange', {id: 'parent'}, item(), () => {});
    assert.equal(transfers.length, 0);
});

test('non-S3 URL and failed S3 response do not finalize', async () => {
    for (const opts of [{url: 'https://untrusted.example/upload'}, {s3Status: 403}]) {
        const {helper, calls} = setup(opts);
        await assert.rejects(helper.upload('exchange', {id: 'parent'}, item(), () => {}));
        assert.ok(!calls.some(c => c[0] === 'request' && c[1].endsWith('/complete')));
    }
});

test('fallback is only for disabled route, not a failing storage dependency', async () => {
    const disabled = setup({configError: Object.assign(new Error(), {status: 404})});
    assert.equal((await disabled.helper.configuration()).directUpload, false);
    const failing = setup({configError: Object.assign(new Error(), {status: 503})});
    await assert.rejects(failing.helper.configuration());
});

test('limits and JPEG alias follow declared config and tiny files display non-zero', () => {
    const {helper} = setup();
    const config = {directUpload: true, documentMaxBytes: 50, imageMaxBytes: 10};
    assert.equal(helper.sizeLimit({name: 'x.jpeg'}, config), 10);
    assert.equal(helper.sizeLimit({name: 'x.docx'}, config), 50);
    assert.equal(helper.formatSize(75), '1 KiB');
    assert.equal(helper.fileType({name: 'x.JPEG'}), 'image/jpeg');
});
