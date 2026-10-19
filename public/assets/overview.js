/* Permission-scoped dashboard. Data comes only from the protected /overview API. */
(() => {
    'use strict';
    const labels = {
        company: 'บริษัท / ภาคเอกชน', university: 'มหาวิทยาลัย', government: 'หน่วยงานภาครัฐ',
        research_institute: 'สถาบันวิจัย', internship: 'สถานประกอบการฝึกงาน',
        academic_activity: 'กิจกรรมวิชาการ', event: 'กิจกรรมทั่วไป', research: 'งานวิจัย',
        draft: 'ร่าง', active: 'มีผล', expired: 'หมดอายุ', terminated: 'ยุติ',
        ongoing: 'กำลังดำเนินการ', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิก',
        participant: 'ผู้เข้าร่วม', partner: 'คู่ความร่วมมือ', other: 'อื่น ๆ',
        activity: 'กิจกรรม', exchange: 'การแลกเปลี่ยน'
    };
    const text = (tag, value, className) => {
        const item = document.createElement(tag);
        if (className) item.className = className;
        if (value !== undefined && value !== null) item.textContent = String(value);
        return item;
    };
    const select = (labelText, options, name) => {
        const label = text('label', labelText), input = document.createElement('select');
        input.name = name;
        for (const [value, caption] of options) {
            const option = document.createElement('option'); option.value = value; option.textContent = caption; input.appendChild(option);
        }
        label.appendChild(input); return {label, input};
    };
    const counter = (container, value) => {
        const row = text('p', `${labels[value[0]] || value[0]} · ${value[1]} รายการ`, 'overview-breakdown-row');
        container.appendChild(row);
    };
    const countRows = values => Object.entries(values || {}).sort(([a], [b]) => a.localeCompare(b));
    const section = (title, description) => {
        const block = text('section', undefined, 'overview-panel');
        block.append(text('h3', title), text('p', description, 'overview-muted'));
        return block;
    };
    function csvCell(value) { return '"' + String(value ?? '').replaceAll('"', '""') + '"'; }
    function exportCsv(data) {
        const rows = [['หมวด', 'รายการ', 'จำนวน']];
        rows.push(['รายงาน', 'บทบาท', labels[data.role] || data.role]);
        for (const [key, value] of Object.entries(data.filters || {})) rows.push(['ตัวกรอง', labels[key] || key, value]);
        rows.push(['ภาพรวม', 'คู่ความร่วมมือ / Stakeholder', data.stakeholders?.count || 0]);
        rows.push(['ภาพรวม', 'กิจกรรม', data.activities?.count || 0]);
        rows.push(['ภาพรวม', 'ข้อตกลง', data.agreements?.count || 0]);
        rows.push(['ภาพรวม', 'การแลกเปลี่ยน', data.exchanges?.count || 0]);
        rows.push(['Feedback', 'ทั้งหมด', data.feedback?.count || 0]);
        rows.push(['Feedback', 'มีข้อเสนอแนะเพื่อปรับปรุง', data.feedback?.withImprovement || 0]);
        rows.push(['ผลลัพธ์', 'รายการที่บันทึกผลลัพธ์', data.outcomes?.count || 0]);
        for (const [type, count] of countRows(data.stakeholders?.byType)) rows.push(['Stakeholder', labels[type] || type, count]);
        for (const [type, count] of countRows(data.activities?.byType)) rows.push(['กิจกรรม', labels[type] || type, count]);
        for (const [status, count] of countRows(data.agreements?.statuses)) rows.push(['สถานะข้อตกลง', labels[status] || status, count]);
        for (const [status, count] of countRows(data.exchanges?.statuses)) rows.push(['สถานะแลกเปลี่ยน', labels[status] || status, count]);
        for (const [source, count] of countRows(data.feedback?.bySource)) rows.push(['แหล่ง Feedback', labels[source] || source, count]);
        const content = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([content], {type: 'text/csv;charset=utf-8'}));
        const link = document.createElement('a'); link.href = url; link.download = 'cstuhub-overview.csv';
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function render(container, session) {
        const role = window.CstuWork.roles(session).includes('executive') ? 'executive' : 'staff';
        const isExecutive = role === 'executive';
        const root = text('div', undefined, 'overview-dashboard');
        const intro = text('p', isExecutive
            ? 'ภาพรวมความร่วมมือและ Stakeholder ในขอบเขตที่คุณได้รับสิทธิ์'
            : 'สรุปข้อมูลสำหรับเจ้าหน้าที่ เฉพาะขอบเขตที่คุณได้รับสิทธิ์', 'overview-intro');
        const filters = document.createElement('form'); filters.className = 'overview-filters';
        const scopeOptions = [['', 'ทุกขอบเขตที่มีสิทธิ์'], ...[...new Set((session.grants || [])
            .filter(g => g.active !== false && g.role === role).map(g => g.scopeId))].sort().map(scope => [scope, scope])];
        const scope = select('ขอบเขต', scopeOptions, 'scopeId');
        const stakeholderType = select('ประเภท Stakeholder', [['', 'ทั้งหมด'], ...['company','university','government','research_institute','internship'].map(value => [value, labels[value]])], 'stakeholderType');
        const activityType = select('ประเภทกิจกรรม', [['', 'ทั้งหมด'], ...['academic_activity','event','research'].map(value => [value, labels[value]])], 'activityType');
        const status = select('สถานะข้อตกลง / แลกเปลี่ยน', [['', 'ทั้งหมด'], ...['draft','active','expired','terminated','ongoing','completed','cancelled'].map(value => [value, labels[value]])], 'status');
        const startLabel = text('label', 'ตั้งแต่'), start = document.createElement('input'); start.type = 'date'; start.name = 'startDate'; startLabel.appendChild(start);
        const endLabel = text('label', 'ถึง'), end = document.createElement('input'); end.type = 'date'; end.name = 'endDate'; endLabel.appendChild(end);
        const dateHint = text('small', 'ช่วงวันที่กรองกิจกรรม ข้อตกลง การแลกเปลี่ยน และ Feedback; ยอด Stakeholder นับตามประเภทที่เลือก', 'overview-filter-hint');
        for (const field of [scope, stakeholderType, activityType, status]) filters.appendChild(field.label);
        filters.append(startLabel, endLabel, dateHint);
        const actions = text('div', undefined, 'overview-actions');
        const apply = text('button', 'แสดงผล'); apply.type = 'submit';
        const reset = text('button', 'ล้างตัวกรอง'); reset.type = 'reset';
        const download = text('button', 'ส่งออกรายงาน CSV'); download.type = 'button'; download.disabled = true;
        actions.append(apply, reset, download); filters.appendChild(actions);
        const statusText = text('p', 'กำลังโหลดข้อมูลสรุป', 'overview-status'); statusText.setAttribute('role', 'status');
        const tabs = text('nav', undefined, 'overview-tabs'); tabs.setAttribute('aria-label', 'ส่วนของภาพรวม'); tabs.setAttribute('role', 'tablist');
        const tabButtons = new Map();
        const tabList = [['summary', 'สรุป'], ...(isExecutive ? [['stakeholders', 'Stakeholder']] : []), ['feedback', 'Feedback'], ['outcomes', 'ผลลัพธ์']];
        let activeTab = 'summary', result = null, requestNumber = 0;
        const pane = text('div', undefined, 'overview-tab-content'); pane.setAttribute('role', 'tabpanel');
        const setTab = key => {
            activeTab = key;
            for (const [name, button] of tabButtons) {
                button.classList.toggle('active', name === key); button.setAttribute('aria-selected', String(name === key));
            }
            drawPane();
        };
        for (const [key, caption] of tabList) {
            const button = text('button', caption); button.type = 'button'; button.setAttribute('role', 'tab');
            button.onclick = () => setTab(key); tabButtons.set(key, button); tabs.appendChild(button);
        }
        function drawPane() {
            pane.replaceChildren(); if (!result) return;
            if (activeTab === 'summary') {
                const cards = text('div', undefined, 'overview-cards');
                const items = [
                    ['คู่ความร่วมมือ / Stakeholder', result.stakeholders?.count],
                    ['กิจกรรม', result.activities?.count], ['ข้อตกลง', result.agreements?.count],
                    ['การแลกเปลี่ยน', result.exchanges?.count]
                ];
                if (isExecutive) items.push(['Feedback', result.feedback?.count || 0]);
                items.push(['บันทึกผลลัพธ์แล้ว', result.outcomes?.count || 0]);
                for (const [label, value] of items) {
                    const card = text('article', undefined, 'overview-card'); card.append(text('span', label), text('strong', value ?? 0)); cards.appendChild(card);
                }
                pane.appendChild(cards);
                const grid = text('div', undefined, 'overview-breakdowns');
                for (const [key, title] of [['agreements','สถานะข้อตกลง'], ['exchanges','สถานะการแลกเปลี่ยน']]) {
                    const block = section(title, 'จำนวนรายการในผลการค้นหาปัจจุบัน');
                    const rows = countRows(result[key]?.statuses);
                    if (!rows.length) block.appendChild(text('p', 'ไม่มีรายการตามเงื่อนไข', 'overview-empty'));
                    for (const row of rows) counter(block, row);
                    grid.appendChild(block);
                }
                pane.appendChild(grid);
            } else if (activeTab === 'stakeholders') {
                const block = section('Stakeholder ตามประเภท', 'จำนวนคู่ความร่วมมือที่อ่านได้ตามสิทธิ์ของคุณ');
                const rows = countRows(result.stakeholders?.byType);
                if (!rows.length) block.appendChild(text('p', 'ไม่พบข้อมูล Stakeholder ตามเงื่อนไข', 'overview-empty'));
                for (const row of rows) counter(block, row);
                pane.appendChild(block);
            } else if (activeTab === 'feedback') {
                const block = section('สรุป Feedback', 'แสดงจำนวนตามแหล่งที่มาและข้อความล่าสุดที่คุณมีสิทธิ์อ่าน โดยไม่แสดงชื่อผู้ให้ Feedback');
                block.append(text('p', `Feedback ทั้งหมด ${result.feedback?.count || 0} รายการ · มีข้อเสนอแนะ ${result.feedback?.withImprovement || 0} รายการ`, 'overview-highlight'));
                for (const row of countRows(result.feedback?.bySource)) counter(block, row);
                const list = text('ol', undefined, 'overview-latest-list');
                for (const item of result.feedback?.latest || []) {
                    const li = document.createElement('li');
                    li.append(text('p', `${item.date || 'ไม่ระบุวันที่'} · ${labels[item.sourceType] || item.sourceType || 'Feedback'} · ${labels[item.parentType] || item.parentType}: ${item.parentTitle || ''}`, 'overview-muted'));
                    if (item.comment) li.append(text('p', item.comment));
                    if (item.improvement) li.append(text('p', `ข้อเสนอแนะ: ${item.improvement}`));
                    list.appendChild(li);
                }
                if (!list.children.length) block.appendChild(text('p', 'ยังไม่มี Feedback ในข้อมูลที่ตรงกับเงื่อนไข', 'overview-empty'));
                else block.appendChild(list);
                pane.appendChild(block);
            } else {
                const block = section('ผลลัพธ์ของกิจกรรมและโครงการแลกเปลี่ยน', 'สรุปจากช่อง “ผลลัพธ์ที่เกิดขึ้น” ที่ผู้รับผิดชอบบันทึกไว้');
                block.append(text('p', `บันทึกผลลัพธ์แล้ว ${result.outcomes?.count || 0} รายการ · กิจกรรม ${result.activities?.outcomesRecorded || 0} / ${result.activities?.count || 0} · แลกเปลี่ยน ${result.exchanges?.outcomesRecorded || 0} / ${result.exchanges?.count || 0}`, 'overview-highlight'));
                const list = text('ol', undefined, 'overview-latest-list');
                for (const item of result.outcomes?.records || []) {
                    const li = document.createElement('li');
                    li.append(text('p', `${item.date || 'ไม่ระบุวันที่'} · ${labels[item.recordType] || item.recordType}: ${item.title || 'ไม่มีชื่อ'}`, 'overview-muted'));
                    li.append(text('p', item.summary)); list.appendChild(li);
                }
                if (!list.children.length) block.appendChild(text('p', 'ยังไม่มีการบันทึกผลลัพธ์ในรายการที่คุณมีสิทธิ์ดู', 'overview-empty'));
                else block.appendChild(list);
                pane.appendChild(block);
            }
        }
        async function load() {
            const current = ++requestNumber; statusText.textContent = 'กำลังโหลดข้อมูลสรุป'; download.disabled = true;
            const query = new URLSearchParams();
            for (const input of [scope.input, stakeholderType.input, activityType.input, status.input, start, end]) if (input.value) query.set(input.name, input.value);
            try {
                const response = await window.CstuAuth.request('/overview' + (query.size ? '?' + query.toString() : ''));
                if (current !== requestNumber) return;
                result = response?.data;
                if (!result || result.role !== role || !result.stakeholders || !result.feedback || !result.outcomes) throw Error('ข้อมูลสรุปไม่ครบ');
                drawPane(); statusText.textContent = 'แสดงเฉพาะข้อมูลในขอบเขตที่คุณมีสิทธิ์'; download.disabled = false;
            } catch (error) {
                if (current !== requestNumber) return;
                if (error.status === 401) { location.replace('login.html'); return; }
                result = null; pane.replaceChildren(text('p', error.status === 403 || error.status === 404
                    ? 'คุณไม่มีสิทธิ์ดูข้อมูลตามเงื่อนไขนี้' : 'โหลดข้อมูลสรุปไม่สำเร็จ กรุณาลองใหม่', 'overview-empty'));
                statusText.textContent = 'ไม่สามารถโหลดภาพรวมได้';
            }
        }
        filters.addEventListener('submit', event => { event.preventDefault(); load(); });
        filters.addEventListener('reset', () => setTimeout(load, 0));
        download.onclick = () => { if (result) exportCsv(result); };
        root.append(intro, filters, statusText, tabs, pane);
        container.replaceChildren(root);
        setTab('summary'); load();
    }
    window.CstuOverview = {render};
})();
