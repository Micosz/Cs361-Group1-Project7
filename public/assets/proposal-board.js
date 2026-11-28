/* Internal board views use the authenticated API. The session owns every open dialog. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const panel = $('proposal-board');
    if (!panel) return;
    const auth = window.CstuAuth;
    const internal = ['coordinator', 'staff', 'executive'];
    const kinds = {activity:'กิจกรรม', exchange:'โครงการ Exchange', mou:'MoU'};
    const stages = {idea:'อยู่ระหว่างเสนอแนวคิด', contacted:'คุยกับคู่ความร่วมมือแล้ว', planning:'กำลังวางแผนร่วมกัน'};
    const statuses = {draft:'รอเจ้าของส่งร่าง', open:'เปิดรับความสนใจ', closed:'ปิดรับความสนใจแล้ว',
        review:'รอผู้บริหารพิจารณา', changes:'ส่งกลับให้แก้', signing:'รอลงนาม', signed:'ลงนามแล้ว'};
    const formatter = new Intl.DateTimeFormat('th-TH', {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Bangkok'});
    const deadlineFormatter = new Intl.DateTimeFormat('th-TH', {dateStyle:'medium', timeStyle:'medium', timeZone:'Asia/Bangkok'});
    const deadlineTime = iso => iso ? deadlineFormatter.format(new Date(iso)) : '';
    const dateTime = iso => iso ? formatter.format(new Date(iso)) : '';
    function node(tag, value, cls) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (value !== undefined && value !== null) el.textContent = value;
        return el;
    }
    function button(label, click) {
        const el = node('button', label);
        el.type = 'button'; el.onclick = click;
        return el;
    }
    const avatarKey = name => name.normalize('NFC').replace(/^(?:(?:ผศ\.|รศ\.|ศ\.|อ\.|ดร\.|คุณ|นาย|นางสาว|นาง|ว่าที่ร้อยเอก)\s*)+/u, '').replace(/\s+/g,'');
    const avatars = new Map(Object.entries(window.CstuProposalAvatars).map(([name,id]) => [avatarKey(name), id]));
    function person(name, note) {
        const line = node('div', null, 'proposal-person');
        const img = node('img', null, 'proposal-avatar');
        const fallback = ['demo','generic-2','generic-3','generic-4','generic-5','generic-6'];
        const seed = Array.from(name).reduce((n,ch) => (n*31 + ch.codePointAt(0)) >>> 0, 0);
        img.alt = ''; img.src = 'resources/personnel-mock/' + (avatars.get(avatarKey(name)) || fallback[seed % fallback.length]) + '.png';
        const label = node('div'); label.append(node('strong', name));
        if (note) label.append(node('small', note));
        line.append(img, label);
        return line;
    }
    let state = null;
    let interestTarget = null;
    let deadlineTimer;
    const proposalPath = row => '/proposals/' + encodeURIComponent(row.id);
    const peopleCount = row => 'สนใจช่วย ' + row.interestCount + ' คน · ' + row.notedCount + ' คนระบุสิ่งที่ช่วยได้';
    function statusText(row) {
        if (row.status === 'closed' && row.kind === 'mou')
            return row.awaitingDraft ? 'ปิดรับความสนใจแล้ว · รอเจ้าของแนบร่าง' : 'ปิดรับความสนใจแล้ว · รอเจ้าของส่งร่าง';
        return statuses[row.status] || 'ข้อเสนอเดิม';
    }
    const messages = {VERSION_CONFLICT:'ข้อมูลเปลี่ยนแล้ว กรุณาเปิดรายละเอียดล่าสุด', PROPOSAL_CLOSED:'ครบกำหนดเปิดรับความสนใจแล้ว',
        NEW_REVISION_REQUIRED:'เลือกฉบับที่แก้ไขหลังจากฉบับที่ส่งกลับ', INVALID_REVISION:'ไม่พบร่างฉบับที่เลือก',
        REVISION_CONFLICT:'ฉบับที่รอพิจารณาเปลี่ยนแล้ว กรุณาเปิดรายละเอียดล่าสุด', HOST_ASSIGNED:'มีผู้รับเป็นเจ้าภาพแล้ว',
        INVALID_TRANSITION:'สถานะข้อเสนอเปลี่ยนแล้ว กรุณาเปิดรายละเอียดล่าสุด', PDF_REQUIRED:'กรุณาเลือกไฟล์ร่าง PDF',
        FILE_TOO_LARGE:'ไฟล์เกินขนาดที่ระบบรับได้', INVALID_UPLOAD:'อ่านไฟล์ไม่ได้ กรุณาเลือกไฟล์ที่รองรับ',
        AGREEMENT_DATES_CONFIRMATION_REQUIRED:'กรุณายืนยันการเปลี่ยนช่วงวันที่ในทะเบียนข้อตกลง',
        FORBIDDEN:'บัญชีนี้ไม่มีสิทธิ์ดำเนินการ', NOT_FOUND:'ไม่พบรายการในขอบเขตของบัญชีนี้',
        INVALID_FIELDS:'กรุณาตรวจสอบข้อมูลที่กรอก', AUTH_REQUIRED:'กรุณาเข้าสู่ระบบอีกครั้ง'};
    const message = error => messages[error.message] || error.message || 'กรุณาลองใหม่';
    function replace(row) {
        state.listRevision++;
        const index = state.rows.findIndex(r => r.id === row.id);
        if (index < 0) state.rows.unshift(row);
        else if (Number(row.version || 0) >= Number(state.rows[index].version || 0)) state.rows[index] = row;
        render();
    }
    async function write(current, row, suffix, body, options = {}) {
        if (state !== current) throw Error('AUTH_REQUIRED');
        const fresh = await auth.refresh();
        if (state !== current || !auth.isInternal(fresh) || fresh.user.id !== current.session.user.id)
            throw Error('AUTH_REQUIRED');
        const headers = {'X-CSRF-Token':fresh.csrfToken};
        if (row && row.version != null) headers['If-Match'] = '"' + row.version + '"';
        if (options.key) headers['Idempotency-Key'] = options.key;
        const result = await auth.request((row ? proposalPath(row) : '/proposals') + suffix, {
            method:options.method || 'POST', headers, body:body instanceof FormData ? body : JSON.stringify(body)
        });
        if (state !== current) throw Error('AUTH_REQUIRED');
        replace(result.data);
        return result.data;
    }
    function upload(current, row, purpose, file) {
        const data = new FormData();
        data.append('file', file); data.append('displayName', file.name);
        return write(current, row, '/files/' + purpose, data);
    }
    const app = {$, auth, node, button, person, peopleCount, kinds, stages, statuses,
        dateTime, deadlineTime, statusText, message, proposalPath, write, upload, current:() => state,
        openDetail:(id, note) => detail.open(id, note), replace};
    const editor = window.CstuProposalEditor(app);
    const detail = window.CstuProposalFlow(app);
    function clear() {
        state = null; interestTarget = null;
        clearTimeout(deadlineTimer);
        editor.clear(); detail.clear();
        if ($('proposal-interest-dialog').open) $('proposal-interest-dialog').close();
        $('proposal-interest-form').reset();
        $('proposal-interest-context').textContent = '';
        $('proposal-interest-status').textContent = '';
        panel.hidden = true;
        $('proposal-cards').replaceChildren();
        $('proposal-count').textContent = '';
        $('proposal-status').replaceChildren();
    }
    function openInterest(row) {
        interestTarget = row;
        $('proposal-interest-form').reset();
        $('proposal-interest-title').textContent = row.mine ? 'แก้ไขความสนใจ' : 'สนใจช่วยงาน';
        $('proposal-interest-context').textContent = row.title;
        $('proposal-interest-note').value = row.myNote || '';
        $('proposal-interest-status').textContent = '';
        $('proposal-interest-withdraw').hidden = !row.mine;
        $('proposal-interest-dialog').showModal();
    }
    const interestForm = $('proposal-interest-form');
    let savingInterest = false;
    async function interest(join) {
        const row = interestTarget, current = state;
        if (!row || !current || savingInterest) return;
        savingInterest = true;
        try {
            const updated = await write(current, row, '/interest', {
                interested:join, note:join ? $('proposal-interest-note').value.trim() : ''
            }, {method:'PUT'});
            if (interestTarget !== row || current !== state) return;
            $('proposal-interest-dialog').close();
            $('proposal-status').textContent = join ? 'บันทึกความสนใจแล้ว' : 'ถอนความสนใจแล้ว';
            $('proposal-cards').querySelector('[data-interest="' + CSS.escape(updated.id) + '"]')?.focus();
        } catch (error) {
            if (current === state && interestTarget === row) $('proposal-interest-status').textContent = message(error);
        } finally { savingInterest = false; }
    }
    interestForm.onsubmit = event => { event.preventDefault(); interest(true); };
    $('proposal-interest-withdraw').onclick = () => interest(false);
    $('proposal-interest-cancel').onclick = () => $('proposal-interest-dialog').close();
    $('proposal-interest-dialog').addEventListener('close', () => { interestTarget = null; });
    function card(row) {
        const el = node('article', null, 'proposal-card' + (row.status === 'open' ? '' : ' closed'));
        const stage = node('div', null, 'proposal-tags');
        stage.append(node('span', kinds[row.kind] || 'ข้อเสนอเดิม', 'proposal-kind'), node('span', statusText(row), 'proposal-stage'));
        el.append(stage, node('h3', row.title), node('strong', row.partner), node('p', row.summary, 'proposal-summary'));
        if (stages[row.stage]) el.append(node('small', stages[row.stage]));
        el.append(person(row.creator, 'ผู้บันทึก' + (row.createdAt ? ' · ' + dateTime(row.createdAt) : '')));
        if (row.hostName) el.append(node('small', 'เจ้าภาพหลัก · ' + row.hostName));
        if (row.source === 'direct') el.append(node('small', 'ส่งตรง' + (row.submittedAt ? ' · ' + dateTime(row.submittedAt) : '')));
        else if (row.closesAt) el.append(node('small', 'ปิดรับ · ' + deadlineTime(row.closesAt) + ' น. (กรุงเทพฯ)'));
        const foot = node('div', null, 'proposal-foot');
        if (row.source !== 'direct') foot.append(node('small', peopleCount(row)));
        if (row.status === 'open' && (row.mine || !row.isOwner && row.hostId !== state.session.user.id)) {
            const toggle = button(row.mine ? 'แก้ไขความสนใจ' : 'สนใจช่วยงาน', () => openInterest(row));
            toggle.dataset.interest = row.id;
            foot.append(toggle);
        }
        const more = button('ดูรายละเอียด', () => detail.open(row.id));
        more.dataset.details = row.id; more.setAttribute('aria-label','ดูรายละเอียด ' + row.title);
        foot.append(more); el.append(foot); return el;
    }
    function render() {
        if (!state) return;
        const open = state.rows.filter(r => r.status === 'open').length;
        const label = 'เปิดรับความสนใจ ' + open + ' ข้อเสนอ';
        $('proposal-count').textContent = label;
        const shortcut = $('proposal-shortcut')?.querySelector('small');
        if (shortcut) shortcut.textContent = label;
        const executive = state.session.grants.some(g => g.active !== false && g.role === 'executive');
        const canQueue = executive && state.view === 'proposals';
        $('proposal-queue-tools').hidden = !canQueue;
        const queue = canQueue && $('proposal-view').value === 'review';
        $('proposal-sort-label').hidden = !queue;
        let shown = state.rows;
        if (queue) {
            shown = shown.filter(row => row.status === 'review' && state.session.grants.some(g =>
                g.active !== false && g.role === 'executive' && g.scopeId === row.scopeId));
            const interestOrder = $('proposal-sort').value === 'interest';
            shown.sort((a,b) => (interestOrder ? b.interestCount - a.interestCount : 0) ||
                Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || a.id.localeCompare(b.id));
        } else {
            shown = [...shown].sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
            if (state.view === 'home') shown = shown.slice(0,2);
        }
        $('proposal-cards').replaceChildren(...(shown.length ? shown.map(card) : [node('p', queue ? 'ไม่มีร่างรอพิจารณา' : 'ยังไม่มีข้อเสนอในหลักสูตรของคุณ')]));
        scheduleDeadline();
    }
    function scheduleDeadline() {
        clearTimeout(deadlineTimer);
        if (!state) return;
        const dates = state.rows.filter(row => row.status === 'open' && row.closesAt).map(row => Date.parse(row.closesAt));
        if (!dates.length) return;
        const now = Date.now();
        const wait = Math.min(...dates) - now;
        // A fast client clock can see an overdue item that is still open on the server.
        const delay = wait > 0 ? wait + 50 : Math.max(1000, state.lastDeadlineCheck + 60000 - now);
        deadlineTimer = setTimeout(() => refreshRows(state), Math.min(2147483647, delay));
    }
    async function refreshRows(current) {
        if (!current || current !== state) return;
        current.lastDeadlineCheck = Date.now();
        const revision = ++current.listRevision;
        try {
            const {data} = await auth.request('/proposals');
            if (current !== state) return;
            if (revision !== current.listRevision) { scheduleDeadline(); return; }
            current.rows = data; render(); detail.deadlineChanged(data);
        } catch (error) {
            if (current === state) $('proposal-status').replaceChildren(node('span', message(error) + ' '), button('ลองอีกครั้ง', () => refreshRows(current)));
        }
    }
    async function mount(session, view) {
        clear();
        const scopes = [...new Set(session.grants.filter(g => g.active !== false && internal.includes(g.role)).map(g => g.scopeId))];
        if (!scopes.length) return;
        const current = {session, view, scopes, rows:[],listRevision:0,lastDeadlineCheck:0}; state = current;
        panel.hidden = false; $('proposal-count').textContent = 'กำลังโหลดข้อเสนอ…';
        $('proposal-new').disabled = true; $('proposal-see-all').hidden = view !== 'home';
        $('proposal-view').value = 'all'; $('proposal-sort').value = 'time';
        try {
            const {data} = await auth.request('/proposals');
            if (state !== current) return;
            current.rows = data; $('proposal-new').disabled = false; render();
            const id = new URLSearchParams(location.search).get('proposal');
            if (id) await detail.open(id);
        } catch (error) {
            if (state !== current) return;
            $('proposal-count').textContent = 'โหลดกระดานไม่ได้';
            $('proposal-status').replaceChildren(node('span', message(error) + ' '), button('ลองอีกครั้ง', () => mount(session, view)));
        }
    }
    $('proposal-view').onchange = render; $('proposal-sort').onchange = render;
    $('proposal-new').onclick = () => editor.open();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state) scheduleDeadline(); });
    window.CstuProposals = {mount, clear};
})();
