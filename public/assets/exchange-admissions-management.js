/* Staff use the existing, permission-scoped Exchange detail to create and review a round. */
(() => {
    'use strict';
    const ui = window.CstuAdmissions,
        auth = window.CstuAuth;
    const { node, field, action, date, status, message, api } = ui;
    const nameFor = { submitted: 'ส่งแล้ว', reviewing: 'อยู่ระหว่างพิจารณา', information: 'ขอข้อมูลเพิ่ม' };
    function input(type, required = false) {
        const el = node('input');
        el.type = type;
        el.required = required;
        return el;
    }
    function select(entries) {
        const el = node('select');
        el.required = true;
        for (const [value, label] of entries) {
            const o = node('option', label);
            o.value = value;
            el.append(o);
        }
        return el;
    }
    function time(value) {
        return value ? value + (value.length === 16 ? ':00' : '') + '+07:00' : null;
    }
    function roundForm(projectId, data, preferred, done) {
        const form = node('form'),
            grid = node('div', undefined, 'admission-fields'),
            notice = status();
        if (!data.activities.length) {
            form.append(node('p', 'ยังไม่มีกิจกรรมสาธารณะที่เชื่อมคู่ความร่วมมือของโครงการนี้'));
            return form;
        }
        const activity = select(data.activities.map((a) => [a.id, a.title]));
        if (data.activities.some((a) => a.id === preferred)) activity.value = preferred;
        const partner = select([]);
        function partners() {
            partner.replaceChildren();
            const row = data.activities.find((a) => a.id === activity.value);
            for (const p of row.partners) {
                const o = node('option', p.name);
                o.value = p.id;
                partner.append(o);
            }
        }
        partners();
        activity.onchange = partners;
        const title = input('text', true),
            eligible = node('textarea'),
            cap = input('number', true);
        title.maxLength = 160;
        eligible.required = true;
        eligible.maxLength = 1600;
        cap.min = '1';
        cap.max = '200';
        const channel = select([
            ['department', 'สมัครเพื่อให้สาขาคัดเลือก'],
            ['official', 'ยื่นผ่านหน่วยงานทางการ']
        ]);
        const office = input('text'),
            url = input('url'),
            question = input('text');
        question.maxLength = 300;
        const confirm = input('checkbox'),
            partnerGate = input('checkbox');
        confirm.checked = true;
        const cby = input('datetime-local'),
            opens = input('datetime-local', true),
            closes = input('datetime-local', true);
        const result = input('datetime-local', true),
            ends = input('datetime-local', true);
        function mode() {
            const official = channel.value === 'official';
            office.required = official;
            url.required = official;
            question.disabled = official;
            confirm.disabled = official;
            partnerGate.disabled = official;
            cby.disabled = official || !confirm.checked;
            cby.required = !cby.disabled;
        }
        mode();
        channel.onchange = mode;
        confirm.onchange = mode;
        for (const [label, control] of [
            ['กิจกรรมที่ประกาศ', activity],
            ['คู่ความร่วมมือ', partner],
            ['ชื่อรอบ', title],
            ['คุณสมบัติผู้สมัคร', eligible],
            ['จำนวนที่รับ', cap],
            ['ช่องทางสมัคร', channel],
            ['ชื่อหน่วยงานทางการ', office],
            ['ลิงก์ช่องทางทางการ (https)', url],
            ['เปิดรับสมัคร', opens],
            ['ปิดรับสมัคร', closes],
            ['เริ่มแจ้งผล', result],
            ['สิ้นสุดช่วงแจ้งผลส่วนตัว', ends],
            ['ให้ผู้ผ่านยืนยันสิทธิ์', confirm],
            ['วันสิ้นสุดการยืนยันสิทธิ์', cby],
            ['ต้องรอคู่สัญญาตอบรับ', partnerGate],
            ['คำถามเพิ่มเติมที่จำเป็น (ถ้ามี)', question]
        ])
            grid.append(field(label, control));
        const submit = node('button', 'เปิดรอบรับสมัคร', 'admission-button-primary');
        submit.type = 'submit';
        form.append(node('p', 'กรอกวันและเวลาทั้งหมดตามเวลาไทย (Asia/Bangkok, UTC+7)'), grid, submit, notice);
        let key = crypto.randomUUID();
        form.addEventListener('input', () => {
            key = crypto.randomUUID();
        });
        form.onsubmit = async (e) => {
            e.preventDefault();
            if (submit.disabled || !form.reportValidity()) return;
            submit.disabled = true;
            const local = channel.value === 'department';
            const payload = {
                activityId: activity.value,
                partnerId: partner.value,
                title: title.value,
                eligibility: eligible.value,
                capacity: Number(cap.value),
                channel: channel.value,
                officeName: office.value,
                officeUrl: url.value,
                opensAt: time(opens.value),
                closesAt: time(closes.value),
                resultsAt: time(result.value),
                noticeEndsAt: time(ends.value),
                needsConfirmation: local && confirm.checked,
                needsPartner: local && partnerGate.checked,
                confirmBy: local && confirm.checked ? time(cby.value) : null,
                question: local ? question.value : ''
            };
            try {
                const reply = await auth.create(
                    '/exchanges/' + encodeURIComponent(projectId) + '/admission-rounds',
                    payload,
                    key
                );
                await done(reply.data.id);
            } catch (err) {
                notice.textContent = message(err);
                submit.disabled = false;
            }
        };
        return form;
    }
    function applicationCard(row, round, reload) {
        const block = node('article', undefined, 'admission-card'),
            note = status();
        const header = node('h4', row.studentName);
        header.tabIndex = -1;
        block.append(header);
        if (round.question) block.append(node('p', round.question + ' · ' + row.answer));
        block.append(node('p', 'ใบสมัคร · ' + nameFor[row.progress]));
        if (row.information)
            block.append(
                node(
                    'p',
                    row.information.request +
                        ' · ' +
                        row.information.channel +
                        ' · ' +
                        date(row.information.dueAt)
                )
            );
        const path = api(round.id) + '/applications/' + encodeURIComponent(row.id);
        async function update(payload) {
            for (const b of block.querySelectorAll('button')) b.disabled = true;
            try {
                await auth.mutate(path, payload, row.version);
                await reload(row.id);
            } catch (e) {
                note.textContent = message(e);
                for (const b of block.querySelectorAll('button')) b.disabled = false;
            }
        }
        if (row.publishedAt) {
            block.append(
                node(
                    'strong',
                    'เผยแพร่แล้ว · ' + (row.decision === 'passed' ? 'ผ่านการคัดเลือก' : 'ไม่ผ่านการคัดเลือก')
                )
            );
            block.append(node('p', 'เผยแพร่เมื่อ ' + date(row.publishedAt) + ' เวลาไทย'));
            if (row.enrolledAt) block.append(node('p', 'เข้าร่วมโครงการแล้ว'));
            else if (row.decision === 'passed') {
                if (round.needsConfirmation && !row.confirmedAt)
                    block.append(node('p', 'รอนักศึกษายืนยันสิทธิ์'));
                else if (round.needsPartner)
                    block.append(
                        node('p', 'รอคู่สัญญาตอบรับ'),
                        action('บันทึกว่าคู่สัญญาตอบรับแล้ว', () => update({ action: 'partnerAccepted' }))
                    );
            }
        } else {
            block.append(action('เริ่มพิจารณา', () => update({ action: 'review' })));
            const more = node('details');
            more.append(node('summary', 'ขอข้อมูลเพิ่ม', 'admission-disclosure-secondary'));
            const form = node('form'),
                request = node('textarea'),
                channel = input('text', true),
                deadline = input('datetime-local', true);
            request.required = true;
            request.maxLength = 700;
            channel.maxLength = 300;
            const send = node('button', 'บันทึกคำขอข้อมูล', 'admission-button-secondary');
            send.type = 'submit';
            form.append(
                field('สิ่งที่ขอ', request),
                field('ช่องทางส่งข้อมูล', channel),
                field('กำหนดส่ง (เวลาไทย)', deadline),
                send
            );
            form.onsubmit = (e) => {
                e.preventDefault();
                if (form.reportValidity())
                    update({
                        action: 'information',
                        request: request.value,
                        channel: channel.value,
                        dueAt: time(deadline.value)
                    });
            };
            more.append(form);
            block.append(more);
            const decision = select([
                ['', 'เลือกผล'],
                ['passed', 'ผ่านการคัดเลือกของสาขา'],
                ['declined', 'ไม่ผ่านการคัดเลือกของสาขา']
            ]);
            if (row.decision) decision.value = row.decision;
            block.append(
                field('ผลคัดเลือกร่าง', decision),
                action('บันทึกร่างผล', () => {
                    if (decision.reportValidity()) update({ action: 'decide', decision: decision.value });
                }, 'secondary')
            );
            if (row.decision) {
                const preview = node('details');
                preview.append(
                    node('summary', 'ตรวจทานก่อนเผยแพร่'),
                    node(
                        'p',
                        row.studentName +
                            ' · ' +
                            (row.decision === 'passed' ? 'ผ่านการคัดเลือกของสาขา' : 'ไม่ผ่านการคัดเลือกของสาขา')
                    ),
                    node(
                        'p',
                        'แสดงผลส่วนตัวตั้งแต่ ' +
                            date(round.resultsAt) +
                            ' ถึง ' +
                            date(round.noticeEndsAt) +
                            ' เวลาไทย'
                    ),
                    action('เผยแพร่ผลให้ผู้สมัครคนนี้', () => update({ action: 'publish' }))
                );
                block.append(preview);
            }
        }
        block.append(note);
        return block;
    }
    function mount(parent, projectId) {
        const preferred = new URLSearchParams(location.search).get('admissionActivity');
        let current = null;
        ui.mount(parent, async (pane, c) => {
            const { data } = await auth.request(
                '/exchanges/' + encodeURIComponent(projectId) + '/admission-rounds'
            );
            if (!c.live()) return;
            pane.hidden = false;
            pane.append(node('h3', 'จัดการรอบสมัคร Exchange'));
            const details = node('details');
            details.open = Boolean(preferred && !current);
            details.append(
                node('summary', 'เปิดรอบสมัครใหม่'),
                roundForm(projectId, data, preferred, async (id) => {
                    current = id;
                    await c.refresh();
                })
            );
            pane.append(details);
            for (const r of data.rounds) {
                const b = action('ตรวจใบสมัคร · ' + r.title, async () => {
                    current = r.id;
                    await c.refresh('roster');
                });
                pane.append(b);
            }
            if (!current) return;
            const { data: roster } = await auth.request(api(current) + '/applications');
            if (!c.live()) return;
            const title = node('h4', roster.round.title);
            title.tabIndex = -1;
            pane.append(title);
            if (c.focusId === 'roster') title.focus();
            pane.append(
                node(
                    'p',
                    'เผยแพร่ผลผ่านแล้ว ' + roster.round.accepted + ' จาก ' + roster.round.capacity + ' ที่นั่ง'
                )
            );
            if (!roster.applications.length) pane.append(node('p', 'ยังไม่มีใบสมัคร'));
            for (const row of roster.applications) {
                const card = applicationCard(row, roster.round, c.refresh);
                pane.append(card);
                if (c.focusId === row.id) card.querySelector('h4').focus();
            }
        });
    }
    window.CstuAdmissionsManagement = { mount };
})();
