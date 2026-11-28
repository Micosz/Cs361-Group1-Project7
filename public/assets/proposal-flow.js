/* The server owns proposal stages and the revision an Executive is deciding. */
window.CstuProposalFlow = function (app) {
    'use strict';
    const {$, node, button, person, auth, dateTime, peopleCount, proposalPath, message} = app;
    const dialog = $('proposal-flow-dialog'), content = $('proposal-flow-content');
    const editForm = $('proposal-edit-form');
    const draftForm = $('proposal-draft-form'), submitForm = $('proposal-submit-form'), decisionForm = $('proposal-decision-form');
    const destination = window.CstuProposalDestination(app);
    let row = null, owner = null, ticket = 0, busy = false, expanded = false;
    const mayDraft = r => r.isOwner && r.kind === 'mou' && ['draft','open','closed','changes'].includes(r.status);
    const drafts = r => (r.files || []).filter(f => f.purpose === 'draft').sort((a,b) => b.revision - a.revision);
    function fileLink(r, file, text) {
        const link = node('a', text || file.displayName);
        link.href = '/api' + proposalPath(r) + '/files/' + encodeURIComponent(file.id);
        return link;
    }
    function setStatus(text) { $('proposal-flow-status').textContent = text; }
    function presentMeta() {
        const meta = $('proposal-detail-meta'); meta.replaceChildren();
        const add = (label,value) => { if (value) meta.append(node('dt',label), typeof value === 'string' ? node('dd',value) : value); };
        add('ผู้บันทึก',row.creator); add('คู่ความร่วมมือ',row.partner);
        if (row.partnerId) {
            const link = node('a','ดูประวัติใน Collaborator ↗');
            link.href = 'work.html?kind=partners&id=' + encodeURIComponent(row.partnerId) + '#board-section';
            link.target = '_blank'; link.rel = 'noopener';
            const dd = node('dd'); dd.append(link); add('ประวัติคู่เดิม',dd);
        }
        add('ขั้นที่คุยกับคู่',app.stages[row.stage]);
        add('เจ้าภาพหลัก',row.hostName || 'ยังไม่มีผู้รับเป็นเจ้าภาพ');
        add('ที่มาของเรื่อง',row.source === 'direct' ? 'ส่งตรง' : 'กระดานชวนบุคลากร');
        if (row.source !== 'direct') add('ปิดรับความสนใจ', row.closesAt && app.deadlineTime(row.closesAt) + ' น. (กรุงเทพฯ)');
        if (row.submittedAt) add('ส่งให้พิจารณา',dateTime(row.submittedAt));
        if (row.informedAt) add('แจ้งเพื่อทราบแล้ว',dateTime(row.informedAt));
        $('proposal-detail-summary').textContent = row.summary;
    }
    function support() {
        const box = $('proposal-flow-support'); box.replaceChildren();
        const files = (row.files || []).filter(f => f.purpose === 'support');
        if (row.supportLink || files.length || row.isOwner) {
            const details = node('details',null,'proposal-support');
            details.append(node('summary','เอกสารหรือลิงก์ประกอบ' + (files.length ? ' (' + files.length + ' ไฟล์)' : '')));
            if (row.supportLink) {
                try {
                    const url = new URL(row.supportLink);
                    if (['https:','http:'].includes(url.protocol)) {
                        const a = node('a', row.supportLink); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
                        details.append(a);
                    }
                } catch { /* An old row can have no usable link. */ }
            }
            files.forEach(file => details.append(fileLink(row,file)));
            if (row.isOwner && !row.legacy && ['draft','open','closed','changes'].includes(row.status)) {
                const form = node('form'), label = node('label','ไฟล์ประกอบเพิ่มเติม');
                const input = node('input'); input.type='file'; input.name='supportFile'; input.accept='.pdf,.jpg,.jpeg,.png'; input.required = true;
                const send = node('button','แนบไฟล์ประกอบ'); send.type = 'submit';
                label.append(input); form.append(label,send);
                form.onsubmit = e => { e.preventDefault(); act(() => app.upload(owner,row,'support',input.files[0]), 'แนบไฟล์ประกอบแล้ว'); };
                details.append(form);
            }
            box.append(details);
        }
    }
    for (const [value,label] of Object.entries(app.stages)) editForm.elements.stage.append(new Option(label,value));
    function editDetails() {
        const edit = $('proposal-edit');
        edit.hidden = !row.isOwner || row.legacy || !['open','draft','changes'].includes(row.status);
        edit.open = false;
        if (edit.hidden) return;
        for (const name of ['title','summary','stage','supportLink']) editForm.elements[name].value = row[name] || '';
    }
    editForm.onsubmit = event => {
        event.preventDefault();
        const payload = Object.fromEntries(new FormData(editForm));
        if (!payload.title.trim() || !payload.summary.trim()) { setStatus('กรุณากรอกชื่อและรายละเอียดข้อเสนอ'); return; }
        act(() => app.write(owner,row,'',payload,{method:'PATCH'}),'บันทึกรายละเอียดข้อเสนอแล้ว');
    };
    function history() {
        const names = {create:'เปิดเรื่อง',open:'เปิดรับความสนใจ',close:'ปิดรับความสนใจ',upload:'แนบไฟล์',
            draft:'แนบร่าง',auto:'ยืนยันการส่งเมื่อครบกำหนด',submit:'ส่งร่างให้พิจารณา',resubmit:'ส่งร่างฉบับแก้ไข',
            return:'ส่งกลับให้แก้',approve:'อนุมัติ',inform:'แจ้งผู้บริหารเพื่อทราบ',host:'รับเป็นเจ้าภาพหลัก',
            edit:'แก้ไขรายละเอียดข้อเสนอ',destination:'เชื่อมงานปลายทาง',sign:'บันทึกการลงนาม',signed:'บันทึกการลงนาม',
            'file-draft':'แนบร่าง MoU','file-support':'แนบไฟล์ประกอบ','file-evidence':'แนบหลักฐานการลงนาม',
            'auto-submit':'ส่งร่างอัตโนมัติเมื่อครบกำหนด'};
        const list = $('proposal-flow-history'); list.replaceChildren();
        for (const entry of row.history || []) {
            const li = node('li');
            const label = entry.action === 'auto' && !entry.revision ? 'ยกเลิกการส่งอัตโนมัติ' :
                names[entry.action] || app.statuses[entry.status] || 'บันทึกการดำเนินการ';
            li.append(node('strong',label + (entry.revision ? ' · ร่างฉบับที่ ' + entry.revision : '')),
                node('small',[entry.actor, entry.at && dateTime(entry.at)].filter(Boolean).join(' · ')));
            if (entry.note) li.append(node('p',entry.note));
            const file = drafts(row).find(f => f.revision === entry.revision);
            if (file) li.append(fileLink(row,file,'เปิดไฟล์ร่างฉบับที่ ' + file.revision));
            list.append(li);
        }
    }
    function draftPanel() {
        const files = drafts(row).filter(f => row.status !== 'changes' || f.revision > (row.resubmitAfterRevision || row.submittedRevision));
        const show = mayDraft(row) && expanded;
        $('proposal-draft-panel').hidden = !show;
        if (!show) return;
        const sel = submitForm.elements.revision;
        sel.replaceChildren(...files.map(f => new Option('ฉบับที่ ' + f.revision + ' · ' + f.displayName, f.revision)));
        if (row.autoRevision && files.some(f => f.revision === row.autoRevision)) sel.value = String(row.autoRevision);
        $('proposal-change-summary').hidden = row.status !== 'changes';
        submitForm.elements.note.required = row.status === 'changes';
        submitForm.hidden = !files.length;
        $('proposal-submit-revision').textContent = row.status === 'open' ? 'ส่งร่างฉบับนี้ให้พิจารณาเมื่อครบกำหนด' : 'ยืนยันส่งร่างฉบับนี้';
    }
    function actions() {
        const box = $('proposal-flow-actions'); box.replaceChildren();
        if (row.autoRevision && row.status === 'open') {
            box.append(node('p','ยืนยันส่งร่างฉบับที่ ' + row.autoRevision + ' เมื่อครบกำหนดแล้ว'));
            if (row.isOwner) box.append(button('ยกเลิกการส่งอัตโนมัติ', () =>
                act(() => app.write(owner,row,'/workflow',{action:'auto',revision:null}), 'ยกเลิกการส่งอัตโนมัติแล้ว')));
        }
        if (mayDraft(row) && !expanded) box.append(button(row.status === 'open' ? 'เตรียมร่าง MoU' : 'ส่ง MoU ให้พิจารณา', () => {
            expanded = true; draftPanel(); actions(); draftForm.elements.draftFile.focus();
        }));
        if (!row.legacy && !row.hostId && (row.isOwner || row.mine) && row.status === 'open') box.append(button('รับเป็นเจ้าภาพหลัก', () =>
            act(() => app.write(owner,row,'/host',{}, {method:'PUT'}), 'บันทึกเจ้าภาพหลักแล้ว')));
        if (!row.legacy && row.isOwner && row.source === 'board' && ['open','closed'].includes(row.status) && !row.informedAt)
            box.append(button('แจ้งผู้บริหารเพื่อทราบ', () => act(() => app.write(owner,row,'/workflow',{action:'inform'}), 'บันทึกการแจ้งเพื่อทราบแล้ว')));
    }
    function review() {
        const box = $('proposal-review-file'); box.replaceChildren();
        const revision = row.approvedRevision || row.submittedRevision;
        const file = drafts(row).find(f => f.revision === revision);
        if (revision) {
            box.append(node('h3', (row.approvedRevision ? 'ร่างที่อนุมัติ' : 'ร่างที่ส่งให้พิจารณา') + ' · ฉบับที่ ' + revision));
            if (file) box.append(fileLink(row,file,'ร่างฉบับที่ ' + revision + ' · เปิดไฟล์'),node('small',file.displayName));
        }
        decisionForm.hidden = !(row.status === 'review' && row.isReviewer && file);
        if (row.status === 'changes') {
            const decision = [...(row.history || [])].reverse().find(e => e.status === 'changes' && e.note);
            if (decision) box.append(node('p','เหตุผลที่ส่งกลับ · ' + decision.note));
        }
    }
    function render(reset = true) {
        $('proposal-flow-title').textContent = row.title;
        $('proposal-detail-kind').textContent = app.kinds[row.kind] || 'ข้อเสนอเดิม';
        $('proposal-flow-waiting').textContent = app.statusText(row);
        presentMeta(); support(); editDetails(); actions(); draftPanel(); review(); history();
        const people = $('proposal-flow-people'); people.replaceChildren();
        if (row.source !== 'direct') {
            people.append(node('strong',peopleCount(row)));
            if (row.canSeeParticipants) for (const p of row.participants || []) people.append(person(p.name, [p.isHost && 'เจ้าภาพหลัก',p.note].filter(Boolean).join(' · ')));
        }
        if (reset) {
            draftForm.reset(); submitForm.elements.confirmed.checked=false;
            submitForm.elements.note.value=''; decisionForm.reset();
        }
        destination.render({row, current:owner, act, fileLink, valid:() => dialog.open && owner === app.current()});
    }
    async function act(task, notice) {
        if (!row || busy) return;
        const run = ticket;
        busy = true; content.inert = true; setStatus('กำลังบันทึก…');
        try {
            const updated = await task();
            if (run !== ticket) return;
            row = updated; render(); setStatus(notice);
        } catch (error) {
            if (run !== ticket) return;
            setStatus(message(error));
            if (error.status === 409 || error.status === 412) $('proposal-flow-status').append(' ',button('โหลดรายละเอียดล่าสุด', () => open(row.id)));
        } finally { if (run === ticket) { busy = false; content.inert = false; } }
    }
    draftForm.onsubmit = event => {
        event.preventDefault();
        const file = draftForm.elements.draftFile.files[0];
        if (file) act(() => app.upload(owner,row,'draft',file),'แนบร่างแล้ว กรุณาตรวจฉบับที่จะส่ง');
    };
    submitForm.onsubmit = event => {
        event.preventDefault();
        const revision = Number(submitForm.elements.revision.value), automatic = row.status === 'open';
        if (!revision || !submitForm.elements.confirmed.checked) return;
        const payload = {action:automatic ? 'auto' : 'submit',revision};
        if (row.status === 'changes') {
            payload.note = submitForm.elements.note.value.trim();
            if (!payload.note) { setStatus('กรุณาระบุสิ่งที่แก้จากฉบับก่อน'); return; }
        }
        act(() => app.write(owner,row,'/workflow',payload),automatic ? 'ยืนยันฉบับที่จะส่งเมื่อครบกำหนดแล้ว' : 'ส่งร่างให้ผู้บริหารพิจารณาแล้ว');
    };
    submitForm.elements.revision.onchange = () => { submitForm.elements.confirmed.checked = false; };
    decisionForm.onsubmit = event => {
        event.preventDefault();
        const action = event.submitter?.value;
        if (!['approve','return'].includes(action)) return;
        const payload = {action, revision:row.submittedRevision};
        if (action === 'return') {
            payload.note = decisionForm.elements.reason.value.trim();
            if (!payload.note) { setStatus('กรุณาระบุเหตุผลที่ส่งกลับให้ผู้เสนอ'); decisionForm.elements.reason.focus(); return; }
        }
        act(() => app.write(owner,row,'/workflow',payload),action === 'approve' ? 'อนุมัติร่างแล้ว · รอลงนาม' : 'ส่งร่างกลับให้ผู้เสนอแก้ไขแล้ว');
    };
    async function open(id, notice = '') {
        const run = ++ticket, current = app.current();
        if (!current) return;
        owner = current; row = null; busy = false; expanded = false;
        content.hidden = true; content.inert = false;
        $('proposal-flow-title').textContent = 'รายละเอียดข้อเสนอ'; $('proposal-detail-kind').textContent = '';
        setStatus('กำลังโหลด…');
        if (!dialog.open) dialog.showModal();
        try {
            const {data} = await auth.request('/proposals/' + encodeURIComponent(id));
            if (ticket !== run || owner !== app.current()) return;
            row = data; app.replace(row);
            content.hidden = false; render(); setStatus(notice);
            $('proposal-flow-title').focus();
        } catch (error) { if (run === ticket) setStatus(message(error)); }
    }
    function reset() {
        ++ticket; row = null; owner = null; busy = false; expanded = false;
        content.inert = false; content.hidden = true; destination.clear();
        for (const field of [editForm,draftForm,submitForm,decisionForm]) field.reset();
        for (const id of ['proposal-flow-title','proposal-detail-kind','proposal-detail-meta','proposal-detail-summary','proposal-flow-waiting','proposal-flow-support','proposal-flow-people','proposal-flow-actions','proposal-review-file','proposal-flow-history','proposal-flow-status'])
            $(id).replaceChildren();
        submitForm.elements.revision.replaceChildren();
    }
    $('proposal-flow-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
        if (dialog.open) return;
        const id = row?.id; reset();
        if (id) $('proposal-cards').querySelector('[data-details="' + CSS.escape(id) + '"]')?.focus();
    });
    function clear() { if (dialog.open) dialog.close(); reset(); }
    function deadlineChanged(rows) {
        if (!row || !dialog.open || busy || row.status !== 'open') return;
        const fresh = rows.find(r => r.id === row.id);
        if (fresh && fresh.status !== 'open') open(row.id,'ครบกำหนดเปิดรับความสนใจแล้ว');
    }
    return {open, clear, deadlineChanged};
};
