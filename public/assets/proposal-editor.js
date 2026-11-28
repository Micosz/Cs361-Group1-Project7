/* Create one proposal before attaching optional supporting documents. */
window.CstuProposalEditor = function (app) {
    'use strict';
    const {$, auth, deadlineTime, message} = app;
    const dialog = $('proposal-dialog'), form = $('proposal-form'), f = form.elements;
    let current = null, postKey, preview = null;
    let partnerRequest = 0, deadlineRequest = 0, busy = false;
    const setStatus = text => { $('proposal-form-status').textContent = text; };
    function clear() {
        current = null; partnerRequest++; deadlineRequest++; preview = null;
        if (dialog.open) dialog.close();
        form.reset(); f.partnerId.replaceChildren(); f.scopeId.replaceChildren();
        $('proposal-partner-history').removeAttribute('href');
        $('proposal-author').textContent = '';
        form.querySelector('details').open = false;
    }
    function partnerMode() {
        const existing = f.partnerMode.value === 'existing';
        $('proposal-partner-existing').hidden = !existing;
        $('proposal-partner-new').hidden = existing;
        f.partnerId.required = existing; f.partner.required = !existing;
        const link = $('proposal-partner-history');
        link.hidden = !existing || !f.partnerId.value;
        if (!link.hidden) link.href = 'work.html?kind=partners&id=' + encodeURIComponent(f.partnerId.value) + '#board-section';
        else link.removeAttribute('href');
        if (!existing) $('proposal-partner-status').replaceChildren();
    }
    async function loadPartners() {
        const run = ++partnerRequest, owner = current;
        f.partnerId.replaceChildren(new Option('เลือกคู่ความร่วมมือ', ''));
        partnerMode();
        if (!owner || f.partnerMode.value !== 'existing') return;
        $('proposal-partner-status').textContent = 'กำลังโหลดคู่ความร่วมมือ…';
        try {
            const {data} = await auth.request('/selection-partners?scopeId=' + encodeURIComponent(f.scopeId.value));
            if (current !== owner || run !== partnerRequest) return;
            for (const row of data) f.partnerId.append(new Option(row.name, row.id));
            $('proposal-partner-status').textContent = data.length ? '' : 'ยังไม่มีคู่ความร่วมมือเดิมในหลักสูตรนี้';
        } catch (error) {
            if (current === owner && run === partnerRequest)
                $('proposal-partner-status').replaceChildren(app.node('span', message(error) + ' '), app.button('โหลดคู่ความร่วมมืออีกครั้ง', loadPartners));
        }
    }
    function direct() { return f.kind.value === 'mou' && f.source.value === 'direct'; }
    async function deadline() {
        const run = ++deadlineRequest, owner = current;
        preview = null;
        $('proposal-source-label').hidden = f.kind.value !== 'mou';
        if (f.kind.value !== 'mou') f.source.value = 'board';
        $('proposal-duration').hidden = direct(); f.days.required = !direct();
        $('proposal-post').textContent = direct() ? 'บันทึกและเลือกร่าง' : 'โพสต์ข้อเสนอ';
        $('proposal-deadline').replaceChildren();
        if (!owner || direct() || !f.days.value || !f.days.validity.valid) return;
        $('proposal-deadline').textContent = 'กำลังคำนวณเวลาปิด…';
        try {
            const {data} = await auth.request('/proposals/deadline?days=' + encodeURIComponent(f.days.value));
            if (current !== owner || run !== deadlineRequest) return;
            preview = data;
            $('proposal-deadline').textContent = 'ปิดรับ ' + deadlineTime(data.closesAt) + ' น. ตามเวลากรุงเทพฯ';
        } catch (error) {
            if (current === owner && run === deadlineRequest)
                $('proposal-deadline').replaceChildren(app.node('span',message(error) + ' '),app.button('คำนวณเวลาปิดอีกครั้ง',deadline));
        }
    }
    function open() {
        clear();
        current = app.current();
        if (!current) return;
        postKey = crypto.randomUUID();
        f.scopeId.replaceChildren(...current.scopes.map(scope => new Option(scope,scope)));
        $('proposal-author').textContent = 'ผู้บันทึก · ' + current.session.user.displayName;
        setStatus(''); dialog.showModal();
        loadPartners(); deadline();
    }
    f.partnerMode.onchange = loadPartners; f.partnerId.onchange = partnerMode; f.scopeId.onchange = loadPartners;
    f.kind.onchange = deadline; f.source.onchange = deadline; f.days.oninput = deadline;
    form.addEventListener('input', () => { postKey = crypto.randomUUID(); });
    $('proposal-cancel').onclick = () => dialog.close();
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    form.onsubmit = async event => {
        event.preventDefault();
        const owner = current;
        if (!owner || busy) return;
        if (!f.title.value.trim() || !f.summary.value.trim() || (f.partnerMode.value !== 'existing' && !f.partner.value.trim())) {
            setStatus('กรุณากรอกชื่อ คู่ความร่วมมือ และรายละเอียดข้อเสนอ'); return;
        }
        if (!direct() && (!preview || preview.openDays !== Number(f.days.value))) {
            setStatus('กรุณาตรวจวันและเวลาปิดก่อนโพสต์'); await deadline(); return;
        }
        const existing = f.partnerMode.value === 'existing';
        const payload = {scopeId:f.scopeId.value,title:f.title.value.trim(),summary:f.summary.value.trim(),kind:f.kind.value,
            stage:f.stage.value,source:direct() ? 'direct' : 'board',partnerType:f.partnerMode.value,hostSelf:f.hostSelf.checked,
            ...(existing ? {partnerId:f.partnerId.value} : {partner:f.partner.value.trim()}),
            ...(f.supportUrl.value.trim() ? {supportLink:f.supportUrl.value.trim()} : {}), ...(direct() ? {} : preview)};
        const support = f.supportFile.files[0];
        busy = true; $('proposal-post').disabled = true; $('proposal-cancel').disabled = true;
        setStatus('กำลังบันทึก…');
        try {
            let row = await app.write(owner, null, '', payload, {key:postKey});
            let notice = direct() ? 'บันทึกเรื่องแล้ว เลือกร่างที่จะส่งให้พิจารณา' : 'โพสต์ข้อเสนอแล้ว';
            if (support) {
                try { row = await app.upload(owner, row, 'support', support); }
                catch (error) { notice = 'บันทึกข้อเสนอแล้ว แต่ยังแนบไฟล์ประกอบไม่ได้ · ' + message(error) + ' เลือกไฟล์อีกครั้งในรายละเอียด'; }
            }
            if (owner !== current || owner !== app.current()) return;
            dialog.close(); await app.openDetail(row.id, notice);
        } catch (error) {
            if (owner === current) setStatus(message(error));
        } finally {
            busy = false; $('proposal-post').disabled = false; $('proposal-cancel').disabled = false;
        }
    };
    return {clear, open};
};
