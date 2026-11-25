/* Public notices and private application status on the existing activity/Exchange views. */
(() => {
    'use strict';
    const auth = window.CstuAuth;
    const encode = encodeURIComponent;
    const dateFormat = new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok',
        dateStyle: 'medium',
        timeStyle: 'short'
    });
    const date = (epoch) => dateFormat.format(new Date(epoch * 1000)) + ' น.';
    const api = (id) => '/admission-rounds/' + encode(id);
    const node = (tag, text, cls) => {
        const el = document.createElement(tag);
        if (text !== undefined) el.textContent = text;
        if (cls) el.className = cls;
        return el;
    };
    const message = (e) =>
        ({
            ROUND_CLOSED: 'หมดเวลารับสมัครแล้ว',
            CONFIRMATION_CLOSED: 'หมดเวลายืนยันสิทธิ์แล้ว',
            PUBLICATION_CLOSED: 'อยู่นอกช่วงเผยแพร่ผล',
            PROJECT_CLOSED: 'โครงการนี้ปิดแล้ว',
            PROJECT_FULL: 'รายชื่อผู้เข้าร่วมโครงการเต็ม',
            ROUND_FULL: 'ครบจำนวนที่รับตามประกาศแล้ว',
            RESULT_FINAL: 'ผลนี้เผยแพร่แล้ว',
            NO_DRAFT: 'กรุณาบันทึกร่างผลก่อนเผยแพร่',
            VERSION_CONFLICT: 'รายการเปลี่ยนแปลง กรุณาเปิดใหม่เพื่อตรวจข้อมูลล่าสุด',
            INVALID_DATES: 'ตรวจลำดับวันที่และเวลาอีกครั้ง',
            INVALID_FIELDS: 'ตรวจข้อมูลที่กรอกอีกครั้ง',
            STUDENT_REQUIRED: 'ต้องใช้บัญชีนักศึกษา TU ที่มีสิทธิ์ในหลักสูตรนี้',
            INVALID_REFERENCE: 'กิจกรรม คู่ความร่วมมือ หรือโครงการไม่ตรงกัน'
        })[e.message] || 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง';
    const action = (label, fn) => {
        const b = node('button', label);
        b.type = 'button';
        b.onclick = fn;
        return b;
    };
    const link = (label, href) => {
        const a = node('a', label);
        a.href = href;
        return a;
    };
    const status = () => {
        const el = node('p');
        el.setAttribute('role', 'status');
        return el;
    };
    const field = (label, input) => {
        const el = node('label');
        el.append(node('span', label), input);
        return el;
    };
    const returnParams = (activityId, roundId) =>
        new URLSearchParams({ admissionActivity: activityId, admissionRound: roundId });
    const activityUrl = (activityId, roundId) =>
        'index.html?public=1&' + returnParams(activityId, roundId) + '#board-section';
    async function write(path, method, payload) {
        const session = await auth.refresh();
        if (!session?.user) throw Error('STUDENT_REQUIRED');
        return auth.request(path, {
            method,
            headers: { 'X-CSRF-Token': session.csrfToken },
            body: JSON.stringify(payload)
        });
    }
    const stateText = {
        submitted: 'ส่งใบสมัครแล้ว',
        reviewing: 'อยู่ระหว่างพิจารณา',
        information: 'ต้องส่งข้อมูลเพิ่ม',
        declined: 'ไม่ผ่านการคัดเลือกของสาขา',
        confirm: 'ผ่านการคัดเลือกของสาขา · รอยืนยันสิทธิ์',
        confirmationClosed: 'ผ่านการคัดเลือกของสาขา · หมดเวลายืนยันสิทธิ์',
        awaitingPartner: 'ผ่านการคัดเลือกของสาขา · รอคู่สัญญาตอบรับ',
        enrolled: 'เข้าร่วมโครงการแล้ว'
    };
    const views = new Set();
    function mount(parent, draw) {
        for (const old of views) {
            if (!old.pane.isConnected) {
                old.clear();
                views.delete(old);
            }
        }
        const pane = node('section', undefined, 'exchange-admissions');
        pane.hidden = true;
        parent.append(pane);
        let serial = 0,
            timer;
        function clear() {
            ++serial;
            clearTimeout(timer);
            pane.replaceChildren();
            pane.hidden = true;
        }
        async function refresh(focusId) {
            clear();
            if (!pane.isConnected) {
                views.delete(view);
                return;
            }
            const mark = serial,
                live = () => mark === serial && pane.isConnected;
            const start = performance.now();
            const schedule = (seconds, deadlines) => {
                const future = deadlines.filter((t) => t && t > seconds);
                if (!future.length || !live()) return;
                const delay = Math.max(0, (Math.min(...future) - seconds) * 1000 - (performance.now() - start));
                clearTimeout(timer);
                timer = setTimeout(() => refresh(), Math.min(2147483647, Math.ceil(delay)));
            };
            try {
                await draw(pane, { live, refresh, schedule, focusId });
            } catch (e) {
                if (!live()) return;
                pane.replaceChildren(
                    node('p', message(e)),
                    action('ลองโหลดรอบสมัครอีกครั้ง', () => refresh())
                );
                pane.hidden = false;
            }
        }
        const view = { refresh, clear, pane };
        views.add(view);
        refresh();
        return view;
    }
    function cleanViews(reload) {
        for (const v of views) {
            if (!v.pane.isConnected) {
                v.clear();
                views.delete(v);
            } else if (reload) v.refresh();
            else v.clear();
        }
    }
    window.addEventListener('authchange', () => cleanViews(false));
    window.addEventListener('pagehide', () => cleanViews(false));
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) cleanViews(true);
    });
    document.addEventListener('visibilitychange', () => cleanViews(!document.hidden));
    document.addEventListener(
        'close',
        () =>
            queueMicrotask(() => {
                for (const v of views)
                    if (!v.pane.isConnected) {
                        v.clear();
                        views.delete(v);
                    }
            }),
        true
    );

    function application(box, own, refresh) {
        box.append(node('strong', stateText[own.state], 'admission-result'));
        if (own.state === 'information') {
            box.append(
                node('p', 'สิ่งที่ต้องส่ง: ' + own.information.request),
                node('p', 'ช่องทาง: ' + own.information.channel),
                node('p', 'ส่งภายใน ' + date(own.information.dueAt) + ' เวลาไทย')
            );
        } else if (own.state === 'declined') {
            box.append(node('p', 'แสดงผลส่วนตัวถึง ' + date(own.noticeEndsAt) + ' เวลาไทย'));
        } else if (own.state === 'confirm') {
            const note = status(),
                b = action('ยืนยันสิทธิ์ของฉัน', async () => {
                    b.disabled = true;
                    try {
                        await write(api(own.roundId) + '/mine/confirm', 'PUT', {});
                        await refresh(own.roundId);
                    } catch (e) {
                        note.textContent = message(e);
                        b.disabled = false;
                    }
                });
            box.append(node('p', 'ยืนยันภายใน ' + date(own.confirmBy) + ' เวลาไทย'), b, note);
        } else if (own.state === 'enrolled') {
            box.append(
                link(
                    'เปิดโครงการแลกเปลี่ยนของฉัน',
                    'index.html?kind=exchanges&id=' + encode(own.exchangeId) + '#board-section'
                )
            );
        } else if (own.state === 'awaitingPartner') {
            box.append(node('p', 'ผู้รับผิดชอบจะบันทึกเมื่อได้รับการตอบรับจากคู่สัญญา'));
        } else if (['submitted', 'reviewing'].includes(own.state)) {
            box.append(node('p', 'ติดตามผลส่วนตัวได้ตั้งแต่ ' + date(own.resultsAt) + ' เวลาไทย'));
        }
    }
    function applyForm(box, r, refresh) {
        const form = node('form'),
            answer = node('textarea'),
            feedback = status(),
            b = node('button', 'ส่งใบสมัคร');
        b.type = 'submit';
        answer.maxLength = 1200;
        answer.required = Boolean(r.question);
        if (r.question) form.append(field(r.question, answer));
        form.append(b, feedback);
        const reveal = action('สมัครเข้าร่วมเพื่อให้สาขาคัดเลือก', () => {
            form.hidden = false;
            reveal.hidden = true;
            (r.question ? answer : b).focus();
        });
        form.hidden = true;
        form.onsubmit = async (e) => {
            e.preventDefault();
            if (b.disabled || !form.reportValidity()) return;
            b.disabled = true;
            try {
                await write(api(r.id) + '/mine', 'POST', r.question ? { answer: answer.value } : {});
                await refresh(r.id);
            } catch (err) {
                feedback.textContent = message(err);
                b.disabled = false;
            }
        };
        box.append(reveal, form);
    }
    function renderRound(r, own, session, controls, eligible) {
        const card = node('article', undefined, 'admission-card'),
            heading = node('h4', r.title);
        heading.tabIndex = -1;
        card.dataset.round = r.id;
        card.append(
            heading,
            node('p', r.partner.name),
            node('p', 'คุณสมบัติ: ' + r.eligibility),
            node('p', 'จำนวนที่รับ ' + r.capacity + ' คน'),
            node('p', 'รับสมัคร ' + date(r.opensAt) + ' – ' + date(r.closesAt) + ' เวลาไทย'),
            node(
                'p',
                'แจ้งผล ' + date(r.resultsAt) + ' · สิ้นสุดช่วงแจ้งผล ' + date(r.noticeEndsAt) + ' เวลาไทย'
            )
        );
        const phase = { scheduled: 'ยังไม่เปิดรับสมัคร', open: 'เปิดรับสมัคร', closed: 'ปิดรับสมัครแล้ว' };
        card.append(node('strong', phase[r.phase], 'admission-phase'));
        if (r.officeUrl) card.append(link('ช่องทางทางการของ' + r.officeName, r.officeUrl));
        if (r.channel === 'official') {
            card.append(node('p', 'รอบนี้ยื่นผ่าน ' + r.officeName + ' ตามขั้นตอนของผู้รับสมัคร'));
        } else {
            if (r.needsConfirmation)
                card.append(
                    node('p', 'ผู้ผ่านการคัดเลือกของสาขายืนยันสิทธิ์ภายใน ' + date(r.confirmBy) + ' เวลาไทย')
                );
            if (r.needsPartner) card.append(node('p', 'สาขาคัดเลือกก่อน แล้วจึงรอมหาวิทยาลัยคู่สัญญาตอบรับ'));
            else if (!r.needsConfirmation) card.append(node('p', 'ผู้ผ่านเข้าร่วมโครงการเมื่อสาขาเผยแพร่ผล'));
            if (own) {
                const detail = node('details'),
                    summary = node('summary', 'ดูสถานะใบสมัคร');
                detail.append(summary);
                application(detail, own, controls.refresh);
                card.append(detail);
                detail.open = true;
            } else if (r.phase === 'open') {
                if (!session?.user)
                    card.append(
                        link('เข้าสู่ระบบ TU เพื่อสมัคร', 'login.html?' + returnParams(r.activityId, r.id))
                    );
                else if (eligible) applyForm(card, r, controls.refresh);
            }
        }
        return card;
    }
    function activity(parent, activityId) {
        mount(parent, async (pane, c) => {
            const { data, serverTime } = await auth.request(
                '/public/activities/' + encode(activityId) + '/admission-rounds'
            );
            if (!c.live()) return;
            const session = await auth.refresh();
            const student =
                session?.user &&
                session.user.accountType !== 'demo' &&
                window.CstuWork.roles(session).includes('student');
            const projects = auth.isInternal(session)
                ? (await auth.request('/activities/' + encode(activityId) + '/admission-projects')).data
                : [];
            const rows = await Promise.all(
                data.map(async (r) => {
                    let own = null,
                        eligible = student;
                    if (student && r.channel === 'department') {
                        try {
                            own = (await auth.request(api(r.id) + '/mine')).data;
                        } catch (e) {
                            if (e.status === 403) eligible = false;
                            else if (e.status !== 404) throw e;
                        }
                    }
                    return [r, own, eligible];
                })
            );
            if (!c.live() || (!rows.length && !projects.length)) return;
            pane.hidden = false;
            pane.append(node('h3', 'รอบรับสมัคร Exchange'));
            const selected = c.focusId || new URLSearchParams(location.search).get('admissionRound');
            for (const [r, own, eligible] of rows) {
                const card = renderRound(r, own, session, c, eligible);
                pane.append(card);
                if (selected === r.id) card.querySelector('h4').focus({ preventScroll: false });
            }
            for (const p of projects) {
                const q = new URLSearchParams({ kind: 'exchanges', id: p.id, admissionActivity: activityId });
                pane.append(link('จัดการรอบสมัคร · ' + p.title, 'work.html?' + q + '#board-section'));
            }
            c.schedule(
                serverTime,
                rows.flatMap(([r, own]) => [r.opensAt, r.closesAt, r.resultsAt, r.noticeEndsAt, own?.confirmBy])
            );
        });
    }
    function personal(parent) {
        mount(parent, async (pane, c) => {
            const { data, serverTime } = await auth.request('/me/admission-applications');
            if (!c.live() || !data.length) return;
            pane.hidden = false;
            pane.append(node('h3', 'ใบสมัคร Exchange ของฉัน'));
            for (const own of data) {
                const item = node('article', undefined, 'admission-card');
                item.append(link(own.roundTitle, activityUrl(own.activityId, own.roundId)));
                application(item, own, c.refresh);
                pane.append(item);
            }
            c.schedule(
                serverTime,
                data.flatMap((a) => [a.noticeEndsAt, a.confirmBy])
            );
        });
    }
    window.CstuAdmissions = {
        activity,
        personal,
        node,
        field,
        action,
        link,
        status,
        date,
        message,
        api,
        mount,
        stateText
    };
})();
