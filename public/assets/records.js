/* Protected shared list/detail. No public backup or browser-owned permissions. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id), form = $('records-search'), dialog = $('record-detail');
    let params = new URLSearchParams(), kind = 'partners', overview = false, feedbackInbox = false, config = window.CstuWork.kinds.partners;
    const host = $('home-records');
    const eventKinds = ['activities','agreements'];
    const publicAgreements = (target = kind, identity = session) => target === 'agreements' && !window.CstuWork.roles(identity).some(role => ['staff','coordinator','executive'].includes(role));
    const listPath = target => publicAgreements(target) ? '/public/agreements' : target === 'exchanges' && !window.CstuWork.roles(session).some(role => ['coordinator','staff','executive'].includes(role)) ? '/me/exchanges' : '/'+target;
    let keyword = '';
    let partnerRows = [], eventRows = [];
    const boardParent = host.parentNode;
    let eventKind = 'activities', roleFrame = null;
    let revision = 0, detailRevision = 0, session = null, nextCursor = null, lastTrigger = null, moreRequest = null, autoLoadPaused = false;
    const sentinel = $('records-sentinel');
    const pageObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, {rootMargin:'400px 0px'}) : null;
    if (pageObserver) pageObserver.observe(sentinel);
    else window.addEventListener('scroll', () => {
        if (!sentinel.hidden && sentinel.getBoundingClientRect().top < window.innerHeight + 400) loadMore();
    }, {passive:true});
    const status = text => { $('records-status').textContent = text; };
    function showDetailDialog() {
        if (typeof window.closeModal === 'function') window.closeModal();
        if (!dialog.open) dialog.showModal();
    }
    function closeDetail() {
        lastTrigger = null;
        roleFrame?.remove(); roleFrame = null;
        ++detailRevision;
        if (dialog.open) dialog.close();
        $('detail-fields').replaceChildren(); $('detail-actions').replaceChildren(); $('detail-title').textContent = ''; $('detail-status').textContent = '';
    }
    function clear() {
        document.body.classList.toggle('feedback-inbox-view', feedbackInbox);
        partnerRows = []; eventRows = [];
        document.querySelectorAll('.protected-partner-card,.protected-event-card').forEach(card => card.remove());
        document.querySelectorAll('[data-protected-duplicate]').forEach(card => { card.hidden = false; card.removeAttribute('data-protected-duplicate'); });
        sentinel.remove(); $('records-content').replaceChildren(); sentinel.hidden = true;
        $('records-retry').hidden = true; nextCursor = null;
        closeDetail();
    }
    function errorMessage(error) {
        return ({401:'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่', 403:'คุณไม่มีสิทธิ์ใช้งานส่วนนี้', 404:'ไม่พบรายการหรือไม่มีสิทธิ์เข้าถึง',
            409:'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่', 422:'เงื่อนไขค้นหาไม่ถูกต้อง กรุณาตรวจวันที่หรือเริ่มค้นหาใหม่',
            503:'ระบบข้อมูลยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง'})[error.status] || 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่';
    }
    function redirectLogin() { location.replace('login.html'); }
    function nav() {
        const links = $('record-links');
        links.replaceChildren();
        links.setAttribute('aria-label', feedbackInbox ? 'การนำทางกลับหน้าหลัก' : 'ชนิดข้อมูล');
        if (!feedbackInbox) return;
        const back = document.createElement('a');
        back.href = 'index.html?kind=partners#board-section';
        back.className = 'feedback-inbox-back';
        back.textContent = '← กลับหน้าหลัก';
        links.appendChild(back);
    }
    function query(cursor = null) {
        const query = new URLSearchParams();
        if (['partners','activities','agreements'].includes(kind)) {
            const prefix = kind === 'partners' ? 'filterCollab' : 'filterEvent';
            const type = $(prefix).value;
            if (keyword.trim()) query.set('q',keyword.trim());
            if (kind !== 'agreements' && type !== 'all') query.set('type',type);
            if (kind !== 'partners') {
                for (const [name,suffix] of [['startDate','Date'],['endDate','DateEnd']]) {
                    const value = $(prefix+suffix).value; if (value) query.set(name,value);
                }
            }
        } else {
            for (const [key,value] of new FormData(form)) {
                const field = form.elements.namedItem(key);
                if (value && !field.disabled) query.set(key,value.trim());
            }
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
        for (const name of ['type','status']) form.elements.namedItem(name).replaceChildren(new Option('ทั้งหมด',''));
        const select = form.elements.namedItem(typed ? 'type':'status');
        for (const value of values) { const option = document.createElement('option'); option.value = value; option.textContent = value; select.appendChild(option); }
    }
    function validateList(result) {
        if (!Array.isArray(result?.data) || !Number.isInteger(result.count) || result.count < 0 || !result.page
            || (result.page.nextCursor !== null && typeof result.page.nextCursor !== 'string')
            || result.data.some(row => !row || typeof row.id !== 'string')) throw Error('INVALID_LIST');
        return result;
    }
    async function runForm(action, record, container, resourceKind = kind) {
        const handler = window.CstuWork.handler(resourceKind, action);
        if (!handler) { container.textContent = 'ส่วนนี้ยังไม่พร้อมใช้งาน'; return; }
        // Handler must reauthorize reads/writes through CstuAuth; no storage fallback.
        await handler({container, record, session, auth: window.CstuAuth, reload: () => {
            params.delete('action'); params.delete('id');
            window.invalidatePublicData?.();
            if (resourceKind === 'partners') window.renderCollaboratorCards?.(); if (resourceKind === 'activities') window.renderEventCards?.();
            return load();
        }});
    }
    async function partnerDetail(id, trigger) {
        const current = ++detailRevision, page = revision;
        lastTrigger = trigger;
        try {
            const fresh = await window.CstuAuth.refresh();
            if (!fresh?.user) { redirectLogin(); return; }
            const record = (await window.CstuAuth.request('/partners/'+encodeURIComponent(id))).data;
            if (current !== detailRevision || page !== revision) return;
            if (!record || record.id !== id) throw Error('INVALID_DETAIL');
            await window.openModal(id,'partner',record);
        } catch (error) {
            if (current !== detailRevision || page !== revision) return;
            host.hidden = false; status(errorMessage(error));
            if (error.status === 401) redirectLogin();
        }
    }
    async function attachPartnerManagement(container, id) {
        try {
            const fresh = await window.CstuAuth.refresh();
            if (!fresh?.user || !window.CstuWork.roles(fresh).some(role => ['staff','coordinator','executive'].includes(role))) return;
            const record = (await window.CstuAuth.request('/partners/'+encodeURIComponent(id))).data;
            if (!container.isConnected || record?.id !== id) return;
            container.className = 'partner-management';
            const editable = window.CstuWork.canEdit(fresh,record);
            mountFormFeedback(record, 'partners', fresh, container);
            if (window.CstuFeedback) {
                const feedback = document.createElement('section'); container.append(feedback);
                window.CstuFeedback.mount(feedback, record, 'partners', fresh, {hideCreate:true});
            }
            const actions = document.createElement('div'), editor = document.createElement('div');
            const message = document.createElement('p'); message.setAttribute('role','status');
            actions.className = 'partner-detail-actions';
            container.append(actions,message,editor);
            if (editable) {
                const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'แก้ไขคู่ความร่วมมือ';
                edit.disabled = !window.CstuWork.handler('partners','edit'); actions.appendChild(edit);
                edit.onclick = async () => {
                    edit.disabled = true; message.textContent = '';
                    const viewport = container.closest('.detail-panel') || container.closest('.modal-content');
                    const scrollTop = viewport?.scrollTop;
                    try {
                        const session = await window.CstuAuth.refresh();
                        const latest = (await window.CstuAuth.request('/partners/'+encodeURIComponent(id))).data;
                        if (!container.isConnected) return;
                        if (!window.CstuWork.canEdit(session,latest)) throw Object.assign(Error(),{status:403});
                        await window.CstuWork.handler('partners','edit')({container:editor, record:latest, session,
                            onCancel: () => {
                                if (!container.isConnected) return;
                                edit.focus({preventScroll:true});
                                if (viewport) viewport.scrollTop = scrollTop;
                            },
                            auth:window.CstuAuth, reload:async () => {
                                window.invalidatePublicData?.();
                                await window.renderCollaboratorCards?.();
                                await load();
                                await partnerDetail(id,edit);
                            }});
                        editor.querySelector('input,select,textarea')?.focus();
                    } catch (error) { message.textContent = errorMessage(error); }
                    finally { edit.disabled = !window.CstuWork.handler('partners','edit'); }
                };
            }
            if (window.PartnerContacts) {
                const contacts = document.createElement('section'); container.appendChild(contacts);
                window.PartnerContacts.mount(contacts,record,fresh);
            }
            if (window.PartnerHistory) {
                const history = document.createElement('section'); container.appendChild(history);
                window.PartnerHistory.mount(history,record,fresh);
            }
        } catch { /* Public details remain readable if management is unavailable. */ }
    }
    function mountDetailActions(fresh, record, resourceKind, current, page, target = $('detail-actions')) {
        const canEdit = (identity, item) => window.CstuWork.canEdit(identity,item) &&
            !(resourceKind === 'activities' && item.publication === 'public' &&
              !window.CstuWork.roles(identity,item.scopeId).some(r => ['staff','executive'].includes(r)));
        if (!canEdit(fresh,record)) return;
        for (const [action,label] of [['edit','แก้ไข']]) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
            button.disabled = !window.CstuWork.handler(resourceKind,action);
            button.onclick = async () => {
                button.disabled = true;
                try {
                    const identity = await window.CstuAuth.refresh();
                    const latest = (await window.CstuAuth.request('/'+resourceKind+'/'+encodeURIComponent(record.id))).data;
                    if (current !== detailRevision || page !== revision || !dialog.open) return;
                    if (!identity?.user || !canEdit(identity,latest)) throw Object.assign(Error(),{status:403});
                    session = identity;
                    await runForm(action,latest,$('detail-actions'),resourceKind);
                } catch (error) { if (current === detailRevision) $('detail-status').textContent = errorMessage(error); }
                finally { button.disabled = !window.CstuWork.handler(resourceKind,action); }
            };
            target.appendChild(button);
        }
    }
    function mountFeedback(record, resourceKind, identity) {
        mountFormFeedback(record, resourceKind, identity, $('detail-fields'));
        if (!['activities','exchanges'].includes(resourceKind) || !window.CstuFeedback) return;
        const container=document.createElement('section'); $('detail-fields').appendChild(container);
        window.CstuFeedback.mount(container,record,resourceKind,identity);
        window.CstuDetailSheet?.feedback(container);
    }
    function mountFormFeedback(record, resourceKind, identity, host) {
        if (!window.CstuFormFeedback || !window.CstuWork.canEdit(identity, record) ||
                !['partners', 'activities', 'exchanges'].includes(resourceKind)) return;
        const container = document.createElement('section'); host.appendChild(container);
        window.CstuFormFeedback.mount(container, record, resourceKind, identity);
        window.CstuDetailSheet?.forms(container, resourceKind === 'partners');
    }
    async function openPublicActivity(record, content, trigger) {
        window.CstuDetailSheet?.resetRecord();
        const current = ++detailRevision, page = revision;
        lastTrigger = trigger;
        $('detail-title').textContent = record.title;
        $('detail-status').textContent = '';
        $('detail-fields').replaceChildren(content);
        $('detail-actions').replaceChildren();
        window.CstuDetailSheet?.record(record, 'activities');
        showDetailDialog();
        const feedback = document.createElement('section'); feedback.className = 'feedback-section';
        $('detail-fields').appendChild(feedback);
        window.CstuPublicFeedback?.mount(feedback, record, 'activities');
        window.CstuDetailSheet?.feedback(feedback);
        try {
            const fresh = await window.CstuAuth.refresh();
            if (!fresh?.user || current !== detailRevision || page !== revision || !dialog.open) return;
            const latest = (await window.CstuAuth.request('/activities/'+encodeURIComponent(record.id))).data;
            if (current !== detailRevision || page !== revision || !dialog.open || latest?.id !== record.id) return;
            const actions = document.createElement('div'); actions.className = 'detail-record-actions';
            $('detail-fields').appendChild(actions);
            mountDetailActions(fresh,latest,'activities',current,page,actions);
            mountFormFeedback(latest, 'activities', fresh, $('detail-fields'));
            window.CstuFeedback?.mount(feedback, latest, 'activities', fresh, {hideCreate:true});
        } catch { /* A public article stays readable when management is unavailable. */ }
    }
    async function detail(row, trigger, resourceKind = kind) {
        if (resourceKind === 'partners' && typeof window.openModal === 'function') return partnerDetail(row.id,trigger);
        if (resourceKind === 'activities' && row.publication === 'public' && typeof window.openModal === 'function') return window.openModal(row.id,'activity');
        window.CstuDetailSheet?.resetRecord();
        const current = ++detailRevision, page = revision;
        lastTrigger = trigger; $('detail-title').textContent = 'กำลังโหลด'; $('detail-status').textContent = '';
        $('detail-fields').replaceChildren(); $('detail-actions').replaceChildren(); showDetailDialog();
        try {
            const fresh = await window.CstuAuth.refresh();
            if (!fresh?.user && resourceKind !== 'agreements') { redirectLogin(); return; }
            const prefix = publicAgreements(resourceKind, fresh) ? '/public/agreements' : '/'+resourceKind;
            const result = await window.CstuAuth.request(prefix + '/' + encodeURIComponent(row.id));
            if (current !== detailRevision || page !== revision || !dialog.open) return;
            session = fresh;
            const record = result.data;
            if (!record || record.id !== row.id || typeof record !== 'object') throw Error('INVALID_DETAIL');
            $('detail-title').textContent = record.name || record.title || 'รายละเอียด';
            if (resourceKind === 'activities') {
                $('detail-fields').appendChild(window.createActivityDetailContent({...record,businessRecord:true}));
                if (record.outcomeSummary) {
                    const outcome = document.createElement('section'), heading = document.createElement('h3'), text = document.createElement('p');
                    heading.textContent = 'ผลลัพธ์ที่เกิดขึ้น'; text.textContent = record.outcomeSummary;
                    outcome.append(heading,text); $('detail-fields').appendChild(outcome);
                }
            } else {
            const fields = {summary:'สรุป',fullDescription:'รายละเอียด',outcomeSummary:'ผลลัพธ์ที่เกิดขึ้น',location:'สถานที่',type:'ประเภท',agreementType:'ชนิดข้อตกลง',periodDate:'วันจัดกิจกรรม',startDate:'วันเริ่ม',endDate:'วันสิ้นสุด',status:'สถานะ',renewalDueOn:'วันต่ออายุ',renewalNote:'ข้อมูลต่ออายุ',internalNote:'หมายเหตุภายใน',supportingInfo:'ข้อมูลประกอบ',supportingInfoForParticipant:'ข้อมูลสำหรับผู้เข้าร่วม'};
            for (const [field,label] of Object.entries(fields)) if (typeof record[field] === 'string') {
                const dt = document.createElement('dt'), dd = document.createElement('dd');
                dt.textContent = label; dd.textContent = record[field]; $('detail-fields').append(dt,dd);
            }
            }
            if (resourceKind === 'partners' && window.PartnerContacts) {
                const contacts = document.createElement('section'); $('detail-fields').appendChild(contacts);
                window.PartnerContacts.mount(contacts,record,fresh);
            }
            if (resourceKind === 'partners' && window.PartnerHistory) {
                const history = document.createElement('section'); $('detail-fields').appendChild(history);
                window.PartnerHistory.mount(history, record, fresh);
            }
            const actions = document.createElement('div'); actions.className = 'detail-record-actions';
            mountDetailActions(fresh, record, resourceKind, current, page, actions);
            if (['agreements','exchanges'].includes(resourceKind) && window.DocumentComponent
                    && !(resourceKind === 'agreements' && !record.scopeId)) {
                const docs = document.createElement('section'); $('detail-fields').appendChild(docs);
                window.DocumentComponent.mount(docs, resourceKind === 'agreements' ? 'agreement' : 'exchange', record, {actions});
            } else {
                $('detail-fields').appendChild(actions);
            }
            window.CstuDetailSheet?.record(record, resourceKind);
            mountFeedback(record, resourceKind, fresh);
        } catch (error) {
            if (current !== detailRevision || page !== revision) return;
            $('detail-title').textContent = 'รายละเอียด'; $('detail-status').textContent = errorMessage(error);
            if (error.status === 401) redirectLogin();
        }
    }
    // Read a related record in place (e.g. from the Feedback Inbox) without changing the current view.
    async function openRelated(resourceKind, id, trigger = null) {
        if (!['partners','activities','exchanges'].includes(resourceKind) || typeof id !== 'string' || !id) return false;
        await detail({id}, trigger, resourceKind);
        return true;
    }
    // Share the public card grid while keeping protected reads and actions authorized.
    function renderPartnerCards(container = $('collaboratorGrid')) {
        if (!container || kind !== 'partners' || overview) return;
        container.querySelectorAll('.protected-partner-card').forEach(card => card.remove());
        if (partnerRows.length) container.querySelector('[data-public-empty]')?.remove();
        const cards = partnerRows.map(row => {
            const duplicate = Array.from(container.children).find(card => card.id === row.id);
            if (duplicate) { duplicate.hidden = true; duplicate.setAttribute('data-protected-duplicate',''); }
            const card = window.createBrowseCard(row,'partner',(record,button) => detail(record,button));
            card.classList.add('protected-partner-card');
            card.removeAttribute('id'); // The public twin keeps its source anchor.
            return card;
        });
        container.prepend(...cards);
    }
    function renderEventCards(container = $('eventGrid')) {
        if (!container || !eventKinds.includes(kind) || overview) return;
        container.querySelectorAll('.protected-event-card').forEach(card => card.remove());
        if (eventRows.length) container.querySelector('[data-public-event-empty]')?.remove();
        const cards=eventRows.map(row=>{
            const duplicate=Array.from(container.children).find(card=>card.id===row.id);
            if(duplicate){duplicate.hidden=true;duplicate.setAttribute('data-protected-duplicate','');}
            const card=window.createBrowseCard(row,kind==='agreements'?'agreement':'activity',
                (record,button)=>detail(record,button));
            card.classList.add('protected-event-card');card.removeAttribute('id');
            return card;
        });
        container.prepend(...cards);
    }
    function placeSentinel() {
        if (!nextCursor) { sentinel.hidden = true; sentinel.remove(); return; }
        sentinel.hidden = false;
        if (kind === 'partners') {
            const cards = $('collaboratorGrid').querySelectorAll('.protected-partner-card');
            if (cards.length) cards[cards.length - 1].after(sentinel);
            else $('collaboratorGrid').appendChild(sentinel);
        } else if (eventKinds.includes(kind)) {
            const cards = $('eventGrid').querySelectorAll('.protected-event-card');
            if (cards.length) cards[cards.length - 1].after(sentinel);
            else $('eventGrid').appendChild(sentinel);
        } else $('records-content').appendChild(sentinel);
    }
    async function loadMore() {
        if (!nextCursor || moreRequest || autoLoadPaused || host.hidden) return;
        const cursor = nextCursor, current = revision, targetKind = kind;
        const request = {cursor,current}; moreRequest = request;
        $('records-retry').hidden = true; status('กำลังโหลดรายการเพิ่มเติม');
        try {
            const result = validateList(await window.CstuAuth.request(listPath(targetKind)+'?'+query(cursor)));
            if (current !== revision || targetKind !== kind || nextCursor !== cursor) return;
            if (result.page.nextCursor === cursor) throw Error('CURSOR_DID_NOT_ADVANCE');
            if (targetKind === 'partners') {
                partnerRows = [...new Map([...partnerRows, ...result.data].map(row => [row.id,row])).values()];
                nextCursor = result.page.nextCursor; renderPartnerCards(); status('');
            } else if (eventKinds.includes(targetKind)) {
                eventRows = [...new Map([...eventRows, ...result.data].map(row => [row.id,row])).values()];
                nextCursor = result.page.nextCursor; renderEventCards(); status('');
            } else {
                let list = $('records-content').querySelector('.records-list');
                if (!list) { list = document.createElement('ul'); list.className = 'records-list'; $('records-content').appendChild(list); }
                for (const row of result.data) {
                    const li = document.createElement('li'), button = document.createElement('button');
                    button.type = 'button'; button.textContent = row.name || row.title || 'รายละเอียด'; button.onclick = () => detail(row,button);
                    li.appendChild(button);
                    const summary = document.createElement('small'); summary.textContent = [row.type || row.status, row.periodDate || row.startDate, row.endDate].filter(Boolean).join(' · '); li.appendChild(summary); list.appendChild(li);
                }
                nextCursor = result.page.nextCursor; status(`แสดงรายการเพิ่มเติม (${result.count} รายการทั้งหมด)`);
            }
            placeSentinel();
        } catch (error) {
            if (current !== revision) return;
            autoLoadPaused = true;
            status(errorMessage(error)); $('records-retry').hidden = false;
        } finally {
            if (moreRequest === request) moreRequest = null;
        }
    }
    async function load() {
        const current = ++revision; moreRequest = null; autoLoadPaused = false; clear(); host.hidden = false; form.hidden = true; status('กำลังตรวจสิทธิ์');
        if (feedbackInbox) { $('records-title').textContent = 'รวม Feedback'; nav(); }
        try {
            if (!window.CstuAuth.enabled()) { status('พื้นที่ผู้ใช้ยังไม่เปิดใช้งาน'); return; }
            session = await window.CstuAuth.refresh();
            if (current !== revision) return;
            if (!session?.user && kind !== 'agreements') { if (params.get('action') === 'create') { params.delete('action'); host.hidden = false; status('คุณไม่มีสิทธิ์เพิ่มข้อมูลนี้'); updateTabs([]); return; } host.hidden = true; updateTabs([]); return; }
            const roles = window.CstuWork.roles(session);
            updateTabs(roles);
            if (!roles.some(role => ['coordinator','staff','executive'].includes(role)) && kind !== 'agreements' && !(kind === 'exchanges' && roles.includes('student'))) {
                if (params.get('action') === 'create') { params.delete('action'); host.hidden = false; status('คุณไม่มีสิทธิ์เพิ่มข้อมูลนี้'); return; } host.hidden = true; return;
            }
            nav();
            if (overview) {
                if (!roles.some(role => ['staff','executive'].includes(role))) { status('คุณไม่มีสิทธิ์ใช้งานส่วนนี้'); return; }
                $('records-title').textContent = roles.includes('executive') ? 'ภาพรวมความร่วมมือ' : 'สรุปข้อมูลตามสิทธิ์';
                status('กำลังโหลดข้อมูลสรุป');
                if (!window.CstuOverview) { status('ส่วนภาพรวมยังโหลดไม่สำเร็จ'); return; }
                await window.CstuOverview.render($('records-content'),session);
                if (current !== revision) return;
                status(''); return;
            }
            if (feedbackInbox) {
                if (!roles.some(role => ['staff','executive'].includes(role))) { status('คุณไม่มีสิทธิ์ใช้งานส่วนนี้'); return; }
                $('records-title').textContent = 'รวม Feedback';
                status('กำลังโหลด Feedback');
                if (!window.CstuFeedbackInbox) { status('ส่วนรวม Feedback ยังโหลดไม่สำเร็จ'); return; }
                await window.CstuFeedbackInbox.render($('records-content'),session);
                if (current !== revision) return;
                status(''); host.hidden = false; document.body.classList.add('feedback-inbox-view'); return;
            }
            if (!config) { status('ไม่พบชนิดข้อมูล'); return; }
            $('records-title').textContent = config.label;
            form.hidden = kind !== 'exchanges'; status('กำลังโหลดข้อมูล');
            if (kind === 'activities' && !['all','academic_activity','event','research'].includes($('filterEvent').value)) {
                if (params.get('action') === 'create') { params.delete('action'); host.hidden = false; status('คุณไม่มีสิทธิ์เพิ่มข้อมูลนี้'); return; } host.hidden = true; return;
            }
            const result = validateList(await window.CstuAuth.request(listPath(kind)+'?'+query()));
            if (current !== revision) return;
            status(result.count ? `พบ ${result.count} รายการในขอบเขตที่มีสิทธิ์` : 'ไม่พบรายการตามเงื่อนไข');
            if (!result.count && ['partners','activities','agreements'].includes(kind)) host.hidden = true;
            if (kind === 'partners') {
                partnerRows = [...new Map(result.data.map(row=>[row.id,row])).values()]; nextCursor = result.page.nextCursor;
                renderPartnerCards();
                status('');
                host.hidden = !result.page.nextCursor;
            }
            if (eventKinds.includes(kind)) {
                eventRows = [...new Map(result.data.map(row=>[row.id,row])).values()]; nextCursor = result.page.nextCursor;
                renderEventCards();
                status('');
                host.hidden = !result.page.nextCursor;
            }
            const list = document.createElement('ul'); list.className = 'records-list';
            const displayRows = kind === 'partners' || eventKinds.includes(kind) ? [] : [...new Map(result.data.map(row=>[row.id,row])).values()];
            for (const row of displayRows) {
                const li = document.createElement('li'), button = document.createElement('button');
                button.type = 'button'; button.textContent = row.name || row.title || 'รายละเอียด'; button.onclick = () => detail(row,button);
                li.appendChild(button);
                const summary = document.createElement('small'); summary.textContent = [row.type || row.status, row.periodDate || row.startDate, row.endDate].filter(Boolean).join(' · '); li.appendChild(summary); list.appendChild(li);
            }
            $('records-content').appendChild(list); nextCursor = result.page.nextCursor; placeSentinel();
            if (params.get('action') === 'create') {
                if (!window.CstuWork.canCreate(session,kind)) { params.delete('action'); host.hidden = false; status('คุณไม่มีสิทธิ์เพิ่มข้อมูลนี้'); return; }
                if (!window.CstuWork.handler(kind,'create')) { status('ฟอร์มเพิ่มรายการนี้ยังไม่พร้อมใช้งาน'); return; }
                status(''); $('detail-title').textContent = config.create;
                lastTrigger = document.querySelector('#authNavButtons button');
                params.delete('action');
                if (kind === 'partners') showDetailDialog();
                await runForm('create',null,$('detail-actions')); return;
            }
            if (params.get('id')) await detail({id:params.get('id')}, null);
        } catch (error) {
            if (current !== revision) return;
            clear(); if (feedbackInbox) nav(); status(errorMessage(error)); $('records-retry').hidden = false;
            if (error.status === 401) redirectLogin();
        }
    }
    function syncBoard() {
        document.body.classList.toggle('feedback-inbox-view',feedbackInbox);
        const eventView = eventKinds.includes(kind);
        $('sectionCollaborator').style.display = kind === 'partners' ? 'block' : 'none';
        $('sectionEvent').style.display = eventView ? 'block' : 'none';
        if (kind === 'partners') $('collaboratorGrid').before(host);
        else if (eventView) $('eventGrid').before(host);
        else boardParent.appendChild(host);
        const active = overview || feedbackInbox ? '' : kind === 'exchanges' ? 'tabExchange' : eventView ? 'tabEvent' : 'tabCollab';
        for (const id of ['tabCollab','tabEvent','tabExchange']) {
            $(id).classList.toggle('active',id === active);
            $(id).setAttribute('aria-pressed',String(id === active));
        }
        $('board-overview').classList.toggle('active',overview);
        $('board-overview').setAttribute('aria-pressed',String(overview));
    }
    function updateTabs(roles) {
        const internal = roles.some(role => ['staff','coordinator','executive'].includes(role));
        $('tabExchange').hidden = !internal && !roles.includes('student');
        $('board-overview').hidden = !roles.some(role => ['staff','executive'].includes(role));
        $('board-overview').textContent = roles.includes('executive') ? 'ภาพรวมความร่วมมือ' : 'สรุปข้อมูลตามสิทธิ์';
        if ((kind === 'exchanges' && $('tabExchange').hidden) || ((overview || feedbackInbox) && !roles.some(role => ['staff','executive'].includes(role)))) {
            kind = 'activities'; overview = false; feedbackInbox = false; config = window.CstuWork.kinds.activities;
            params = new URLSearchParams(); setupFilters();
        }
        syncBoard();
    }
    async function open(target = 'partners', action = null, id = null, scroll = false) {
        kind = target === 'feedback' ? 'feedback' : target; overview = target === 'overview'; feedbackInbox = target === 'feedback'; config = window.CstuWork.kinds[kind];
        params = new URLSearchParams(); if (action) params.set('action',action); if (id) params.set('id',id);
        form.elements.namedItem('q').value = '';
        for (const name of ['startDate','endDate']) form.elements.namedItem(name).value = '';
        if (config) setupFilters();
        if (kind === 'partners' && action === 'create' && $('filterCollab').value !== 'all') { $('filterCollab').value = 'all'; if ($('filterCollabClear')) $('filterCollabClear').style.display = 'none'; window.renderCollaboratorCards?.(); }
        if (eventKinds.includes(kind)) {
            eventKind = kind;
            if (kind === 'activities' && (action === 'create' || $('filterEvent').value === 'mou')) { $('filterEvent').value = 'all'; window.renderEventCards?.(); }
            if (kind === 'agreements') { $('filterEvent').value = 'mou'; window.renderEventCards?.(); }
        }
        syncBoard();
        if (!feedbackInbox && location.search && new URLSearchParams(location.search).get('view') === 'feedback') {
            try { window.history?.replaceState?.(null, '', 'index.html#board-section'); } catch { /* Local previews may restrict History API. */ }
        }
        if (scroll) {
            if (feedbackInbox) window.scrollTo?.({top:0,behavior:'auto'});
            else window.dispatchEvent(new Event('cstu:board'));
        }
        await load();
        if (scroll && !feedbackInbox) window.dispatchEvent(new Event('cstu:board'));
    }
    async function openRoles() {
        if (!feedbackInbox) window.dispatchEvent(new Event('cstu:board'));
        const fresh = await window.CstuAuth.refresh().catch(() => null);
        const canManageRoles = window.CstuAuth?.managedScopes
            ? window.CstuAuth.managedScopes(fresh).length > 0
            : Boolean(fresh?.capabilities?.some(c => c.active !== false && c.name === 'manageRoles')
                || fresh?.grants?.some(g => g.active !== false && g.role === 'executive'));
        if (!canManageRoles) return;
        const trigger = document.querySelector('#authNavButtons button');
        closeDetail(); lastTrigger = trigger;
        $('detail-title').textContent = 'จัดการสิทธิ์ผู้ใช้';
        const frame = document.createElement('iframe'); frame.title = 'จัดการสิทธิ์ผู้ใช้';
        roleFrame = frame;
        frame.src = 'workspace.html?view=roles&embed=roles'; frame.style.cssText = 'width:100%;height:65vh;border:0';
        $('detail-actions').appendChild(frame); showDetailDialog();
    }
    window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.source !== roleFrame?.contentWindow
            || !['roles-saved','roles-closed'].includes(event.data?.type)) return;
        roleFrame.remove(); roleFrame = null;
        dialog.close(); lastTrigger?.focus();
    });
    window.CstuRecords = {open, openRelated, filter:browseFilter, renderPartnerCards, renderEventCards, attachPartnerManagement, openPublicActivity, closeDetail};
    $('tabExchange').addEventListener('click', () => open('exchanges'));
    function browseFilter(detail) {
        if (typeof detail?.keyword === 'string') keyword = detail.keyword;
        if (detail?.selectId && detail.selectId !== (kind === 'partners' ? 'filterCollab' : 'filterEvent')) return;
        if (!['partners','activities','agreements'].includes(kind)) return;
        if (eventKinds.includes(kind)) {
            const internal = window.CstuWork.roles(session).some(role => ['student','staff','coordinator','executive'].includes(role));
            kind = $('filterEvent').value === 'mou' ? 'agreements' : 'activities';
            eventKind = kind; config = window.CstuWork.kinds[kind]; setupFilters();
        }
        params.delete('id'); load();
    }
    $('board-overview').onclick = () => open('overview');
    $('tabCollab').addEventListener('click', () => open('partners'));
    $('tabEvent').addEventListener('click', () => open(eventKind));
    document.addEventListener('click', event => {
        const link = event.target.closest('a[href]'); if (!link || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin || !/\/(index|records)\.html$/.test(url.pathname)) return;
        if (url.searchParams.get('view') === 'roles') {
            event.preventDefault(); if ($('role-menu')?.open) $('role-menu').close();
            openRoles(); return;
        }
        const target = url.searchParams.get('kind') || (['overview','feedback'].includes(url.searchParams.get('view')) ? url.searchParams.get('view') : null);
        if (!target || (!window.CstuWork.kinds[target] && !['overview','feedback'].includes(target))) return;
        event.preventDefault();
        const menu = $('role-menu'); if (menu?.open) menu.close();
        if (typeof window.closeModal === 'function') window.closeModal();
        open(target,url.searchParams.get('action'),url.searchParams.get('id'),true);
    });
    form.onsubmit = event => { event.preventDefault(); params.delete('id'); load(); };
    form.onreset = () => queueMicrotask(() => { if (form.isConnected && !host.hidden) load(); });
    $('records-retry').onclick = () => { autoLoadPaused = false; nextCursor ? loadMore() : load(); };
    $('detail-close').onclick = () => dialog.close();
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    dialog.addEventListener('close', () => { roleFrame?.remove(); roleFrame = null; ++detailRevision; $('detail-fields').replaceChildren(); $('detail-actions').replaceChildren(); lastTrigger?.focus(); });
    window.addEventListener('authchange', () => { ++revision; clear(); host.hidden = true; updateTabs([]); load(); });
    window.addEventListener('pageshow', event => { if (event.persisted) load(); });
    const initial = new URLSearchParams(location.search);
    if (initial.get('view') === 'roles') { window.dispatchEvent(new Event('cstu:board')); openRoles(); }
    else open(initial.get('kind') || (['overview','feedback'].includes(initial.get('view')) ? initial.get('view') : 'partners'),initial.get('action'),initial.get('id'),Boolean(initial.size));
})();
