/* Protected shared list/detail. No public backup or browser-owned permissions. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id), form = $('records-search'), dialog = $('record-detail');
    const params = new URLSearchParams(location.search), kind = params.get('kind'), overview = params.get('view') === 'overview';
    const config = window.CstuWork.kinds[kind];
    let revision = 0, detailRevision = 0, session = null, nextCursor = null, lastTrigger = null;
    const status = text => { $('records-status').textContent = text; };
    function clear() {
        $('records-content').replaceChildren(); $('records-next').hidden = true;
        $('records-retry').hidden = true; nextCursor = null;
        ++detailRevision; if (dialog.open) dialog.close();
        $('detail-fields').replaceChildren(); $('detail-actions').replaceChildren(); $('detail-title').textContent = '';
    }
    function errorMessage(error) {
        return ({401:'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่', 403:'คุณไม่มีสิทธิ์ใช้งานส่วนนี้', 404:'ไม่พบรายการหรือไม่มีสิทธิ์เข้าถึง',
            409:'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่', 422:'เงื่อนไขค้นหาไม่ถูกต้อง กรุณาตรวจวันที่หรือเริ่มค้นหาใหม่',
            503:'ระบบข้อมูลยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง'})[error.status] || 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่';
    }
    function redirectLogin() { location.replace('login.html'); }
    function nav() {
        $('record-links').replaceChildren();
        for (const item of window.CstuWork.menu(session).filter(item => !item.href.includes('action=create'))) {
            const link = document.createElement('a'); link.href = item.href; link.textContent = item.label;
            $('record-links').appendChild(link);
        }
    }
    function query(cursor) {
        const query = new URLSearchParams();
        for (const [key, value] of new FormData(form)) {
            const field = form.elements.namedItem(key);
            if (value && !field.disabled) query.set(key, value.trim());
        }
        query.set('limit','20'); if (cursor) query.set('cursor',cursor);
        return query.toString();
    }
    function setupFilters() {
        const typed = ['partners','activities'].includes(kind), dated = kind !== 'partners';
        for (const [id, field, visible] of [['type-field','type',typed], ['status-field','status',!typed], ['start-field','startDate',dated], ['end-field','endDate',dated]]) {
            $(id).hidden = !visible; form.elements.namedItem(field).disabled = !visible;
        }
        const values = kind === 'partners' ? ['company','university','government','research_institute','internship']
            : kind === 'activities' ? ['academic_activity','event','research'] : kind === 'agreements' ? ['draft','active','expired','terminated'] : ['draft','ongoing','completed','cancelled'];
        const select = form.elements.namedItem(typed ? 'type':'status');
        for (const value of values) { const option = document.createElement('option'); option.value = value; option.textContent = value; select.appendChild(option); }
    }
    function validateList(result) {
        if (!Array.isArray(result?.data) || !Number.isInteger(result.count) || result.count < 0 || !result.page
            || (result.page.nextCursor !== null && typeof result.page.nextCursor !== 'string')
            || result.data.some(row => !row || typeof row.id !== 'string')) throw Error('INVALID_LIST');
        return result;
    }
    async function runForm(action, record, container) {
        const handler = window.CstuWork.handler(kind, action);
        if (!handler) { container.textContent = 'ส่วนนี้ยังไม่พร้อมใช้งาน'; return; }
        // Handler must reauthorize reads/writes through CstuAuth; no storage fallback.
        await handler({container, record, session, auth: window.CstuAuth, reload: () => {
            if (params.get('action') === 'create') window.location.assign('records.html?kind='+kind);
            else return load();
        }});
    }
    async function detail(row, trigger) {
        const current = ++detailRevision, page = revision;
        lastTrigger = trigger; $('detail-title').textContent = 'กำลังโหลด'; $('detail-status').textContent = '';
        $('detail-fields').replaceChildren(); $('detail-actions').replaceChildren(); dialog.showModal();
        try {
            const fresh = await window.CstuAuth.refresh();
            if (!fresh?.user) { redirectLogin(); return; }
            const result = await window.CstuAuth.request('/' + kind + '/' + encodeURIComponent(row.id));
            if (current !== detailRevision || page !== revision || !dialog.open) return;
            session = fresh;
            const record = result.data;
            if (!record || record.id !== row.id || typeof record !== 'object') throw Error('INVALID_DETAIL');
            $('detail-title').textContent = record.name || record.title || 'รายละเอียด';
            const fields = {summary:'สรุป',fullDescription:'รายละเอียด',location:'สถานที่',type:'ประเภท',agreementType:'ชนิดข้อตกลง',periodDate:'วันจัดกิจกรรม',startDate:'วันเริ่ม',endDate:'วันสิ้นสุด',status:'สถานะ',renewalDueOn:'วันต่ออายุ',renewalNote:'ข้อมูลต่ออายุ',internalNote:'หมายเหตุภายใน',supportingInfo:'ข้อมูลประกอบ',supportingInfoForParticipant:'ข้อมูลสำหรับผู้เข้าร่วม'};
            for (const [field,label] of Object.entries(fields)) if (typeof record[field] === 'string') {
                const dt = document.createElement('dt'), dd = document.createElement('dd');
                dt.textContent = label; dd.textContent = record[field]; $('detail-fields').append(dt,dd);
            }
            if (kind === 'activities' && window.ActivityLinks) window.ActivityLinks.render($('detail-fields'), record);
            if (kind === 'partners' && window.PartnerHistory) {
                const history = document.createElement('section'); $('detail-fields').appendChild(history);
                window.PartnerHistory.mount(history, record, fresh);
            }
            if (['agreements','exchanges'].includes(kind) && window.DocumentComponent) {
                const docs = document.createElement('section'); $('detail-fields').appendChild(docs);
                window.DocumentComponent.mount(docs, kind === 'agreements' ? 'agreement' : 'exchange', record);
            }
            if (window.CstuWork.canEdit(fresh, record)) {
                for (const [action,label] of [['edit','แก้ไข'], ...(['agreements','exchanges'].includes(kind) ? [['status','จัดการสถานะ'],['documents','จัดการเอกสาร']] : [])]) {
                    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
                    button.disabled = !window.CstuWork.handler(kind,action); if (button.disabled) button.title = 'ส่วนนี้ยังไม่พร้อมใช้งาน';
                    button.onclick = async () => {
                        button.disabled = true;
                        try {
                            const freshSession = await window.CstuAuth.refresh();
                            if (!freshSession?.user) { redirectLogin(); return; }
                            const latest = (await window.CstuAuth.request('/'+kind+'/'+encodeURIComponent(row.id))).data;
                            if (current !== detailRevision || page !== revision || !dialog.open) return;
                            if (!window.CstuWork.canEdit(freshSession, latest)) throw Object.assign(Error(),{status:403});
                            session = freshSession; await runForm(action,latest,$('detail-actions'));
                        } catch (error) { $('detail-status').textContent = errorMessage(error); }
                        finally { button.disabled = !window.CstuWork.handler(kind,action); }
                    };
                    $('detail-actions').appendChild(button);
                }
            }
        } catch (error) {
            if (current !== detailRevision || page !== revision) return;
            $('detail-title').textContent = 'รายละเอียด'; $('detail-status').textContent = errorMessage(error);
            if (error.status === 401) redirectLogin();
        }
    }
    async function load(cursor = null) {
        const current = ++revision; clear(); form.hidden = true; status('กำลังตรวจสิทธิ์');
        try {
            if (!window.CstuAuth.enabled()) { status('พื้นที่ผู้ใช้ยังไม่เปิดใช้งาน'); return; }
            session = await window.CstuAuth.refresh();
            if (current !== revision) return;
            if (!session?.user) { redirectLogin(); return; }
            const roles = window.CstuWork.roles(session);
            if (!roles.some(role => ['coordinator','staff','executive'].includes(role))) { status('คุณไม่มีสิทธิ์ใช้งานส่วนนี้'); return; }
            nav();
            if (overview) {
                if (!roles.includes('executive')) { status('คุณไม่มีสิทธิ์ใช้งานส่วนนี้'); return; }
                $('records-title').textContent = 'ภาพรวมความร่วมมือ'; status('กำลังโหลดภาพรวม');
                const totals = (await window.CstuAuth.request('/overview')).data;
                if (current !== revision) return;
                for (const [name,item] of Object.entries(window.CstuWork.kinds)) {
                    const result = totals[name];
                    const line = document.createElement('p'), link = document.createElement('a');
                    link.href = 'records.html?kind='+name; link.textContent = `${item.label}: ${result.count} รายการ`; line.appendChild(link);
                    const detail = document.createElement('small'); detail.textContent = Object.entries(result.statuses).map(([state,count])=>`${state}: ${count}`).join(' · ');
                    line.appendChild(detail); $('records-content').appendChild(line);
                }
                status('จำนวนเฉพาะรายการที่คุณมีสิทธิ์อ่าน'); return;
            }
            if (!config) { status('ไม่พบชนิดข้อมูล'); return; }
            $('records-title').textContent = config.label;
            if (params.get('action') === 'create') {
                if (!window.CstuWork.canCreate(session,kind)) { status('คุณไม่มีสิทธิ์เพิ่มข้อมูลนี้'); return; }
                $('records-title').textContent = config.create;
                if (!window.CstuWork.handler(kind,'create')) { status('ฟอร์มเพิ่มรายการนี้ยังไม่พร้อมใช้งาน'); return; }
                status(''); await runForm('create',null,$('records-content')); return;
            }
            form.hidden = false; status('กำลังโหลดข้อมูล');
            const result = validateList(await window.CstuAuth.request('/'+kind+'?'+query(cursor)));
            if (current !== revision) return;
            status(result.count ? `พบ ${result.count} รายการในขอบเขตที่มีสิทธิ์` : 'ไม่พบรายการตามเงื่อนไข');
            const list = document.createElement('ul'); list.className = 'records-list';
            for (const row of result.data) {
                const li = document.createElement('li'), button = document.createElement('button');
                button.type = 'button'; button.textContent = row.name || row.title || 'รายละเอียด'; button.onclick = () => detail(row,button);
                li.appendChild(button);
                const summary = document.createElement('small'); summary.textContent = [row.type || row.status, row.periodDate || row.startDate, row.endDate].filter(Boolean).join(' · '); li.appendChild(summary); list.appendChild(li);
            }
            $('records-content').appendChild(list); nextCursor = result.page.nextCursor; $('records-next').hidden = !nextCursor;
            if (params.get('id')) await detail({id:params.get('id')}, null);
        } catch (error) {
            if (current !== revision) return;
            clear(); status(errorMessage(error)); $('records-retry').hidden = false;
            if (error.status === 401) redirectLogin();
        }
    }
    if (config) setupFilters();
    form.onsubmit = event => { event.preventDefault(); load(); };
    form.onreset = () => { queueMicrotask(() => load()); };
    $('records-retry').onclick = () => load(); $('records-next').onclick = () => load(nextCursor);
    $('detail-close').onclick = () => dialog.close();
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    dialog.addEventListener('close', () => { ++detailRevision; $('detail-fields').replaceChildren(); $('detail-actions').replaceChildren(); lastTrigger?.focus(); });
    window.addEventListener('authchange', () => load()); window.addEventListener('pageshow', () => load()); window.addEventListener('focus', () => window.CstuAuth.refresh().catch(() => {}));
    load();
})();
