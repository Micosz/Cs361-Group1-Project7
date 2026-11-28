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
        activity: 'กิจกรรม', agreement: 'ข้อตกลง', exchange: 'การแลกเปลี่ยน'
    };
    const text = (tag, value, className) => {
        const item = document.createElement(tag);
        if (className) item.className = className;
        if (value !== undefined && value !== null) item.textContent = String(value);
        return item;
    };
    const icon = name => {
        const item = text('i', undefined, `fa-${name}`);
        item.classList.add(['file-lines', 'calendar-days', 'comment-dots'].includes(name) ? 'fa-regular' : 'fa-solid');
        item.setAttribute('aria-hidden', 'true');
        return item;
    };
    const statusColors = {active:'#2eb48e', draft:'#ffc43b', expired:'#fa6488', terminated:'#af8d98',
        ongoing:'#416bff', completed:'#12aa83', cancelled:'#8990a6'};
    const statusOrder = {agreements:['active','draft','expired','terminated'], exchanges:['ongoing','completed','draft','cancelled']};
    const stakeholderTypes = {
        company: {color:'#c90032', icon:'building'},
        university: {color:'#ffc233', icon:'graduation-cap'},
        government: {color:'#8750d6', icon:'landmark'},
        research_institute: {color:'#347dff', icon:'flask'},
        internship: {color:'#12aa83', icon:'briefcase'}
    };
    let chartLibrary;
    function loadChartLibrary() {
        if (window.Chart) return Promise.resolve(window.Chart);
        if (!chartLibrary) chartLibrary = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = new URL('assets/vendor/chart.umd.min.js?v=4.5.1', location.href).href;
            script.onload = () => resolve(window.Chart);
            script.onerror = () => { script.remove(); chartLibrary = null; reject(Error('Chart unavailable')); };
            document.head.appendChild(script);
        });
        return chartLibrary;
    }
    const select = (labelText, options, name) => {
        const label = text('label', labelText), input = document.createElement('select');
        input.name = name;
        for (const [value, caption] of options) {
            const option = document.createElement('option'); option.value = value; option.textContent = caption; input.appendChild(option);
        }
        label.appendChild(input); return {label, input};
    };
    const countRows = values => Object.entries(values || {}).sort(([a], [b]) => a.localeCompare(b));
    const filterLabels = {scopeId: 'ขอบเขต', stakeholderType: 'ประเภท Stakeholder', activityType: 'ประเภทกิจกรรม',
        status: 'สถานะ', startDate: 'ตั้งแต่วันที่', endDate: 'ถึงวันที่', agreementId: 'ข้อตกลง'};
    // null means the server could not read admission results; never show it as zero.
    const studentCount = value => (Number.isInteger(value) ? value : '—');
    function csvCell(value) {
        const textValue = String(value ?? '');
        // Spreadsheet formula injection guard for user-entered titles.
        return '"' + (/^[=+\-@\t\r]/.test(textValue) ? "'" + textValue : textValue).replaceAll('"', '""') + '"';
    }
    function exportCsv(data) {
        const rows = [['หมวด', 'รายการ', 'จำนวน']];
        const agreementTitles = new Map((data.agreementSummary || []).map(row => [row.id, row.title || row.id]));
        rows.push(['รายงาน', 'บทบาท', labels[data.role] || data.role]);
        for (const [key, value] of Object.entries(data.filters || {})) {
            rows.push(['ตัวกรอง', filterLabels[key] || labels[key] || key,
                key === 'agreementId' ? agreementTitles.get(value) || value : labels[value] || value]);
        }
        rows.push(['ภาพรวม', 'คู่ความร่วมมือ / Stakeholder', data.stakeholders?.count || 0]);
        rows.push(['ภาพรวม', 'กิจกรรม', data.activities?.count || 0]);
        rows.push(['ภาพรวม', 'ข้อตกลง', data.agreements?.count || 0]);
        rows.push(['ภาพรวม', 'การแลกเปลี่ยน', data.exchanges?.count || 0]);
        rows.push(['ภาพรวม', 'นักศึกษายืนยันสิทธิ์ Exchange', studentCount(data.exchanges?.confirmedStudents)]);
        rows.push(['ภาพรวม', 'ผ่านแต่ยังไม่ยืนยันสิทธิ์ (ไม่นับรวม)', studentCount(data.exchanges?.awaitingConfirmation)]);
        for (const agr of data.agreementSummary || []) {
            const group = `ข้อตกลง: ${agr.agreementType || 'MoU'} ${agr.title || agr.id}`;
            rows.push([group, 'กิจกรรม', agr.activityCount || 0]);
            rows.push([group, 'การแลกเปลี่ยน', agr.exchangeCount || 0]);
            rows.push([group, 'นักศึกษายืนยันสิทธิ์ Exchange', studentCount(agr.confirmedStudents)]);
            rows.push([group, 'ผ่านแต่ยังไม่ยืนยันสิทธิ์ (ไม่นับรวม)', studentCount(agr.awaitingConfirmation)]);
            rows.push([group, 'Feedback ความคิดเห็น', agr.commentCount || 0]);
            rows.push([group, 'Feedback ชุดแบบฟอร์ม', agr.batchCount || 0]);
            rows.push([group, 'Feedback คำตอบจากแบบฟอร์ม', agr.responseCount || 0]);
        }
        const unspecified = data.formFeedback?.unspecifiedAgreement;
        if (unspecified) {
            const group = unspecified.label || 'ยังไม่ระบุข้อตกลง';
            rows.push([group, 'Feedback ความคิดเห็น', unspecified.commentCount || 0]);
            rows.push([group, 'Feedback ชุดแบบฟอร์ม', unspecified.batchCount || 0]);
            rows.push([group, 'Feedback คำตอบจากแบบฟอร์ม', unspecified.responseCount || 0]);
        }
        rows.push(['Feedback', 'ทั้งหมด', data.feedback?.count || 0]);
        rows.push(['Feedback', 'มีข้อเสนอแนะเพื่อปรับปรุง', data.feedback?.withImprovement || 0]);
        for (const [type, count] of countRows(data.stakeholders?.byType)) rows.push(['Stakeholder', labels[type] || type, count]);
        for (const [type, count] of countRows(data.activities?.byType)) rows.push(['กิจกรรม', labels[type] || type, count]);
        for (const [status, count] of countRows(data.agreements?.statuses)) rows.push(['สถานะข้อตกลง', labels[status] || status, count]);
        for (const [status, count] of countRows(data.exchanges?.statuses)) rows.push(['สถานะแลกเปลี่ยน', labels[status] || status, count]);
        for (const [source, count] of countRows(data.feedback?.bySource)) rows.push(['แหล่ง Feedback', labels[source] || source, count]);
        if (data.formFeedback) {
            rows.push(['Form Feedback', 'ชุดแบบฟอร์มนำเข้าทั้งหมด', data.formFeedback.batchCount || 0]);
            rows.push(['Form Feedback', 'จำนวนคำตอบนำเข้าทั้งหมด', data.formFeedback.responseCount || 0]);
            for (const agr of data.formFeedback.byAgreement || []) {
                rows.push(['ผลตอบรับตามข้อตกลง', agr.title || agr.id, agr.responseCount || 0]);
            }
            if (data.formFeedback.unspecifiedAgreement) {
                rows.push(['ผลตอบรับตามข้อตกลง', data.formFeedback.unspecifiedAgreement.label || 'ยังไม่ระบุข้อตกลง', data.formFeedback.unspecifiedAgreement.responseCount || 0]);
            }
            for (const [source, count] of countRows(data.formFeedback.bySource)) {
                rows.push(['แหล่งคำตอบแบบฟอร์ม', labels[source] || source, count]);
            }
        }
        const content = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([content], {type: 'text/csv;charset=utf-8'}));
        const suffix = [data.filters?.agreementId, data.filters?.startDate, data.filters?.endDate]
            .filter(Boolean).join('_').replace(/[^A-Za-z0-9_-]/g, '');
        const link = document.createElement('a'); link.href = url; link.download = `cstuhub-overview${suffix ? '-' + suffix : ''}.csv`;
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    /** #265 answer panel: activities, confirmed Exchange students and Feedback per agreement. */
    function agreementReport(data) {
        const section = text('section', undefined, 'overview-panel overview-agreement-report');
        const header = text('div', undefined, 'overview-panel-heading');
        const badge = text('span', undefined, 'overview-panel-icon'); badge.appendChild(icon('file-lines'));
        const copy = text('div', undefined, 'overview-panel-title');
        const period = [data.filters?.startDate, data.filters?.endDate].filter(Boolean).join(' – ');
        copy.append(text('h3', 'สรุปตามข้อตกลง'),
            text('p', `กิจกรรม นักศึกษายืนยันสิทธิ์ Exchange และ Feedback${period ? ' ช่วง ' + period : ' ทุกช่วงเวลา'}`, 'overview-muted'));
        header.append(badge, copy, text('span', `นักศึกษายืนยันสิทธิ์ ${studentCount(data.exchanges?.confirmedStudents)} คน`, 'overview-panel-total'));
        section.appendChild(header);
        const rows = data.agreementSummary || [];
        if (!rows.length) {
            section.appendChild(text('p', 'ไม่มีข้อตกลงตามเงื่อนไขที่เลือก', 'overview-empty'));
            return section;
        }
        const table = text('table', undefined, 'overview-agreement-table');
        table.setAttribute('aria-label', 'สรุปกิจกรรม นักศึกษา และ Feedback ตามข้อตกลง');
        const head = document.createElement('thead'), headRow = document.createElement('tr');
        for (const title of ['ข้อตกลง', 'กิจกรรม', 'นักศึกษายืนยันสิทธิ์', 'ผ่านแต่ยังไม่ยืนยัน', 'ความคิดเห็น', 'แบบฟอร์ม (ชุด · คำตอบ)']) {
            const th = text('th', title); th.setAttribute('scope', 'col'); headRow.appendChild(th);
        }
        head.appendChild(headRow); table.appendChild(head);
        const body = document.createElement('tbody');
        const addRow = (cells, dataset) => {
            const tr = document.createElement('tr');
            Object.assign(tr.dataset, dataset);
            cells.forEach((value, index) => {
                const cell = text(index ? 'td' : 'th', value);
                if (!index) cell.setAttribute('scope', 'row');
                tr.appendChild(cell);
            });
            body.appendChild(tr);
        };
        for (const agr of rows) {
            addRow([`${agr.agreementType || 'MoU'} · ${agr.title || agr.id}`, agr.activityCount || 0,
                studentCount(agr.confirmedStudents), studentCount(agr.awaitingConfirmation),
                agr.commentCount || 0, `${agr.batchCount || 0} · ${agr.responseCount || 0}`], {agreementId: agr.id});
        }
        const unspecified = data.formFeedback?.unspecifiedAgreement;
        if (unspecified && (unspecified.commentCount || unspecified.batchCount)) {
            addRow([unspecified.label || 'ยังไม่ระบุข้อตกลง', '—', '—', '—', unspecified.commentCount || 0,
                `${unspecified.batchCount || 0} · ${unspecified.responseCount || 0}`], {agreementStatus: 'unspecified'});
        }
        table.appendChild(body);
        section.appendChild(table);
        section.appendChild(text('p', 'นับนักศึกษาที่ผ่านและกดยืนยันสิทธิ์แล้ว (หรือรอบที่ไม่ต้องยืนยัน) ไม่ซ้ำคน; ผู้ที่ยังไม่ยืนยันแสดงแยกและไม่นับรวม; Feedback ที่ยังไม่ระบุข้อตกลงไม่บวกเข้าฉบับใด', 'overview-muted'));
        return section;
    }
    function render(container, session) {
        container.cstuOverviewDispose?.();
        const role = window.CstuWork.roles(session).includes('executive') ? 'executive' : 'staff';
        const isExecutive = role === 'executive';
        const root = text('div', undefined, 'overview-dashboard');
        const intro = text('p', isExecutive
            ? 'ภาพรวมความร่วมมือและ Stakeholder ในขอบเขตที่คุณได้รับสิทธิ์'
            : 'สรุปข้อมูลสำหรับเจ้าหน้าที่ เฉพาะขอบเขตที่คุณได้รับสิทธิ์', 'overview-intro');
        const filters = document.createElement('form'); filters.className = 'overview-filters';
        const scopeOptions = [['', 'ทุกขอบเขตที่มีสิทธิ์'], ...[...new Set((session.grants || [])
            .filter(g => g.active !== false && ['staff', 'executive'].includes(g.role)).map(g => g.scopeId))].sort().map(scope => [scope, scope])];
        const scope = select('ขอบเขต', scopeOptions, 'scopeId');
        const stakeholderType = select('ประเภท Stakeholder', [['', 'ทั้งหมด'], ...['company','university','government','research_institute','internship'].map(value => [value, labels[value]])], 'stakeholderType');
        const activityType = select('ประเภทกิจกรรม', [['', 'ทั้งหมด'], ...['academic_activity','event','research'].map(value => [value, labels[value]])], 'activityType');
        const status = select('สถานะข้อตกลง / แลกเปลี่ยน', [['', 'ทั้งหมด'], ...['draft','active','expired','terminated','ongoing','completed','cancelled'].map(value => [value, labels[value]])], 'status');
        // #265: report one MoU/MoA at a time. Options come from the same permission-scoped agreement list.
        const agreement = select('ข้อตกลง MoU / MoA', [['', 'ทุกข้อตกลง']], 'agreementId');
        let agreementOptionsRun = 0;
        async function loadAgreementOptions() {
            const run = ++agreementOptionsRun, chosen = agreement.input.value;
            const rows = [];
            try {
                let cursor = null, pages = 0;
                do {
                    const params = new URLSearchParams({limit: '100'});
                    if (scope.input.value) params.set('scopeId', scope.input.value);
                    if (cursor) params.set('cursor', cursor);
                    const page = await window.CstuAuth.request('/agreements?' + params.toString());
                    rows.push(...(page?.data || []).filter(row => row && typeof row.id === 'string'));
                    cursor = page?.page?.nextCursor || null;
                } while (cursor && ++pages < 10);
            } catch { /* The report still works for all agreements. */ }
            if (run !== agreementOptionsRun) return;
            rows.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'th') || a.id.localeCompare(b.id));
            const options = [['', 'ทุกข้อตกลง'], ...rows.map(row => [row.id, `${row.agreementType || 'MoU'} · ${row.title || row.id}`])];
            agreement.input.replaceChildren(...options.map(([value, caption]) => {
                const option = document.createElement('option'); option.value = value; option.textContent = caption; return option;
            }));
            agreement.input.value = rows.some(row => row.id === chosen) ? chosen : '';
        }
        scope.input.addEventListener?.('change', () => { agreement.input.value = ''; loadAgreementOptions(); });
        const startLabel = text('label', 'ตั้งแต่วันที่'), start = document.createElement('input'); start.type = 'date'; start.name = 'startDate'; start.lang = 'th-TH'; startLabel.appendChild(start);
        const endLabel = text('label', 'ถึงวันที่'), end = document.createElement('input'); end.type = 'date'; end.name = 'endDate'; end.lang = 'th-TH'; endLabel.appendChild(end);
        const dateHint = text('small', 'ช่วงวันที่กรองกิจกรรม ข้อตกลง การแลกเปลี่ยน และ Feedback; ยอด Stakeholder นับตามประเภทที่เลือก', 'overview-filter-hint');
        for (const field of [scope, agreement, stakeholderType, activityType, status]) filters.appendChild(field.label);
        filters.append(startLabel, endLabel, dateHint);
        const actions = text('div', undefined, 'overview-actions');
        const apply = text('button', 'แสดงผล', 'overview-btn-primary'); apply.type = 'submit';
        const reset = text('button', 'ล้างตัวกรอง', 'overview-btn-secondary'); reset.type = 'reset';
        const download = text('button', 'ส่งออกรายงาน CSV', 'overview-btn-export'); download.type = 'button'; download.disabled = true;
        actions.append(apply, reset, download); filters.appendChild(actions);
        const statusText = text('p', 'กำลังโหลดข้อมูลสรุป', 'overview-status'); statusText.setAttribute('role', 'status');
        const tabs = text('nav', undefined, 'overview-tabs'); tabs.setAttribute('aria-label', 'ส่วนของภาพรวม'); tabs.setAttribute('role', 'tablist');
        const tabButtons = new Map();
        const tabList = [['summary', 'สรุป'], ...(isExecutive ? [['stakeholders', 'Stakeholder']] : [])];
        let activeTab = 'summary', result = null, requestNumber = 0;
        let charts = [], chartGeneration = 0, observer;
        const clearCharts = () => { chartGeneration++; charts.forEach(chart => chart.destroy()); charts = []; };
        container.cstuOverviewDispose = () => { requestNumber++; clearCharts(); observer?.disconnect(); };
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
        function drawDoughnut(canvas, rows, block, cutout = '66%') {
            const generation = chartGeneration;
            const total = rows.reduce((sum, row) => sum + row.count, 0);
            // The adjacent text/table remains available even if the chart cannot load.
            if (typeof canvas.getContext !== 'function') return;
            loadChartLibrary().then(Chart => {
                if (generation !== chartGeneration || !canvas.isConnected) return;
                const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                charts.push(new Chart(canvas, {
                    type: 'doughnut',
                    data: {labels: total ? rows.map(row => row.label) : ['ไม่มีรายการ'], datasets: [{
                        data: total ? rows.map(row => row.count) : [1],
                        backgroundColor: total ? rows.map(row => row.color) : ['#ede9e7'],
                        borderWidth: total ? 1 : 0, borderColor: '#ffffff', hoverOffset: total ? 3 : 0
                    }]},
                    options: {responsive: true, maintainAspectRatio: false, cutout,
                        animation: reduced ? false : {duration: 650},
                        plugins: {legend: {display: false}, tooltip: {enabled: total > 0}},
                        layout: {padding: 4}}
                }));
            }).catch(() => {
                if (generation === chartGeneration && canvas.isConnected) block.appendChild(text('p', 'อ่านจำนวนได้จากรายการข้างกราฟ', 'overview-chart-note'));
            });
        }
        function drawPane() {
            clearCharts();
            pane.replaceChildren(); if (!result) return;
            if (activeTab === 'summary') {
                const summary = text('section', undefined, 'overview-summary');
                summary.setAttribute('aria-label', 'สรุปจำนวนความร่วมมือ');
                const art = document.createElement('img'); art.src = 'assets/overview-orbit.webp';
                art.alt = ''; art.className = 'overview-summary-art'; art.setAttribute('aria-hidden', 'true');
                const heading = text('div', undefined, 'overview-summary-heading');
                heading.append(text('h3', 'ภาพรวมความร่วมมือ'), text('p', 'ในขอบเขตที่คุณมีสิทธิ์'));
                summary.append(art, heading);
                const groups = [
                    [['คู่ความร่วมมือ / Stakeholder', result.stakeholders?.count, 'users'], ['กิจกรรม', result.activities?.count, 'calendar-days']],
                    [['ข้อตกลง', result.agreements?.count, 'file-lines'], ['การแลกเปลี่ยน', result.exchanges?.count, 'arrow-right-arrow-left']]
                ];
                if (isExecutive) groups.push([['Feedback', result.feedback?.count, 'comment-dots']]);
                summary.dataset.groups = groups.length;
                for (const items of groups) {
                    const group = text('div', undefined, 'overview-metric-group');
                    for (const [label, value, symbol] of items) {
                        const metric = text('div', undefined, 'overview-metric');
                        const badge = text('span', undefined, 'overview-metric-icon'); badge.appendChild(icon(symbol));
                        metric.append(badge, text('span', label, 'overview-metric-label'), text('strong', value ?? 0, 'overview-metric-value'));
                        group.appendChild(metric);
                    }
                    summary.appendChild(group);
                }
                pane.appendChild(summary);
                if (Array.isArray(result.agreementSummary)) pane.appendChild(agreementReport(result));
                const grid = text('div', undefined, 'overview-breakdowns');
                for (const [key, title] of [['agreements','สถานะข้อตกลง'], ['exchanges','สถานะการแลกเปลี่ยน']]) {
                    const block = text('section', undefined, 'overview-panel overview-status-panel'); block.dataset.kind = key;
                    const values = result[key]?.statuses || {};
                    const order = [...statusOrder[key], ...Object.keys(values).filter(st => !statusOrder[key].includes(st)).sort()];
                    const rows = order.map(st => [st, Math.max(0, Number(values[st]) || 0)]);
                    const total = rows.reduce((sum, row) => sum + row[1], 0);
                    const header = text('div', undefined, 'overview-panel-heading');
                    const badge = text('span', undefined, 'overview-panel-icon'); badge.appendChild(icon(key === 'agreements' ? 'file-lines' : 'arrow-right-arrow-left'));
                    const copy = text('div', undefined, 'overview-panel-title');
                    copy.append(text('h3', title), text('p', 'จำนวนรายการตามสถานะปัจจุบัน', 'overview-muted'));
                    header.append(badge, copy, text('span', `ทั้งหมด ${total} รายการ`, 'overview-panel-total'));
                    const body = text('div', undefined, 'overview-status-body');
                    const donut = text('div', undefined, 'overview-donut');
                    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true');
                    const center = text('div', undefined, 'overview-donut-label');
                    const centerLabel = text('span', undefined);
                    centerLabel.append(text('span', key === 'agreements' ? 'ข้อตกลง' : 'การแลกเปลี่ยน'), document.createElement('br'), text('span', 'ทั้งหมด'));
                    center.append(text('strong', total), centerLabel);
                    donut.append(canvas, center);
                    const legend = text('div', undefined, 'overview-status-legend');
                    for (const [st, count] of rows) {
                        const row = text('p', undefined, 'overview-legend-row');
                        const dot = text('span', undefined, 'overview-legend-dot'); dot.style.backgroundColor = statusColors[st] || '#8990a6'; dot.setAttribute('aria-hidden', 'true');
                        row.append(dot, text('span', labels[st] || st), text('strong', count)); legend.appendChild(row);
                    }
                    body.append(donut, legend); block.append(header, body);
                    if (!total) block.appendChild(text('p', 'ไม่มีรายการตามเงื่อนไข', 'overview-chart-note'));
                    grid.appendChild(block);
                    drawDoughnut(canvas, rows.map(([st, count]) => ({label: labels[st] || st, count, color: statusColors[st] || '#8990a6'})), block);
                }
                pane.appendChild(grid);
                if (result.formFeedback && typeof result.formFeedback === 'object') {
                    const ff = result.formFeedback;
                    const kindCollection = {partner: 'partners', activity: 'activities', agreement: 'agreements', exchange: 'exchanges'};
                    const recordLink = (entityType, id, caption) => {
                        const collection = kindCollection[entityType];
                        if (!collection || !id) return text('span', caption || '');
                        const link = text('a', caption || 'เปิดรายการ', 'overview-related-link');
                        const pageName = document.body?.classList?.contains('work-home') ? 'work.html' : 'index.html';
                        link.href = `${pageName}?kind=${collection}&id=${encodeURIComponent(id)}#board-section`;
                        link.onclick = event => {
                            if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !window.CstuRecords?.openRelated) return;
                            event.preventDefault();
                            window.CstuRecords.openRelated(collection, id, link);
                        };
                        return link;
                    };
                    const section = text('section', undefined, 'overview-panel overview-form-feedback');
                    const header = text('div', undefined, 'overview-panel-heading');
                    const badge = text('span', undefined, 'overview-panel-icon'); badge.appendChild(icon('comment-dots'));
                    const copy = text('div', undefined, 'overview-panel-title');
                    copy.append(text('h3', 'ผลตอบรับจากไฟล์และความเชื่อมโยงข้อตกลง'),
                        text('p', 'ตามจากรายงานกลับไปดูแหล่งที่มาของไฟล์และงานที่เกี่ยวข้องได้ตามสิทธิ์', 'overview-muted'));
                    header.append(badge, copy, text('span', `รวม ${ff.batchCount || 0} ชุด · ${ff.responseCount || 0} คำตอบ`, 'overview-panel-total'));
                    section.appendChild(header);
                    const agrBlock = text('div', undefined, 'overview-agreement-feedback');
                    for (const agr of ff.byAgreement || []) {
                        const row = text('div', undefined, 'overview-breakdown-row');
                        row.dataset.agreementId = agr.id;
                        const labelWrap = text('span', undefined, 'overview-breakdown-label');
                        labelWrap.append(text('span', `${agr.agreementType || 'MoU'}: `), recordLink('agreement', agr.id, agr.title || agr.id));
                        row.append(labelWrap, text('span', `${agr.batchCount || 0} ชุด · ${agr.responseCount || 0} คำตอบ`, 'overview-breakdown-count'));
                        agrBlock.appendChild(row);
                    }
                    const unspec = ff.unspecifiedAgreement || {label: 'ยังไม่ระบุข้อตกลง', batchCount: 0, responseCount: 0};
                    const unspecRow = text('div', undefined, 'overview-breakdown-row overview-unspecified-row');
                    unspecRow.dataset.agreementStatus = 'unspecified';
                    unspecRow.append(text('span', unspec.label || 'ยังไม่ระบุข้อตกลง', 'overview-breakdown-label'),
                        text('span', `${unspec.batchCount || 0} ชุด · ${unspec.responseCount || 0} คำตอบ`, 'overview-breakdown-count'));
                    agrBlock.appendChild(unspecRow);
                    section.appendChild(agrBlock);
                    const batches = Array.isArray(ff.batches) ? ff.batches : [];
                    if (!batches.length) {
                        section.appendChild(text('p', 'ยังไม่มีผลตอบรับที่นำเข้าจากไฟล์ตามเงื่อนไขที่เลือก', 'overview-empty'));
                    } else {
                        const list = text('ul', undefined, 'overview-latest-list overview-form-list');
                        for (const batch of batches) {
                            const li = document.createElement('li');
                            li.dataset.batchId = batch.id || '';
                            const metaParts = [
                                labels[batch.sourceType] || batch.sourceType || 'แบบฟอร์ม',
                                `${batch.responseCount || 0} คำตอบ`,
                                batch.fileName ? `ไฟล์ ${batch.fileName}` : '',
                                batch.sheetName ? `ชีต ${batch.sheetName}` : '',
                                batch.importedByName ? `นำเข้าโดย ${batch.importedByName}` : ''
                            ].filter(Boolean);
                            li.appendChild(text('p', metaParts.join(' · '), 'overview-muted'));
                            const formTitle = text('p', undefined, 'overview-form-title');
                            formTitle.appendChild(text('strong', batch.formName || 'แบบฟอร์มนำเข้า'));
                            li.appendChild(formTitle);
                            const related = text('p', undefined, 'overview-form-related');
                            related.append(text('span', `เกี่ยวกับ${labels[batch.parentType] ? ' (' + labels[batch.parentType] + ')' : ''}: `),
                                recordLink(batch.parentType, batch.parentId, batch.parentTitle || 'เปิดงานที่เกี่ยวข้อง'));
                            const partners = Array.isArray(batch.relatedPartners) ? batch.relatedPartners.filter(p => p?.id && p?.name) : [];
                            if (partners.length) {
                                related.appendChild(text('span', ' · คู่ความร่วมมือ '));
                                partners.forEach((p, idx) => {
                                    if (idx) related.appendChild(text('span', ', '));
                                    related.appendChild(recordLink('partner', p.id, p.name));
                                });
                            }
                            const agreements = Array.isArray(batch.relatedAgreements) ? batch.relatedAgreements.filter(a => a?.id && a?.title) : [];
                            if (agreements.length) {
                                related.appendChild(text('span', ' · ข้อตกลง '));
                                agreements.forEach((a, idx) => {
                                    if (idx) related.appendChild(text('span', ', '));
                                    related.appendChild(recordLink('agreement', a.id, a.title));
                                });
                            } else if (batch.agreementStatus === 'unspecified' || batch.agreementLabel === 'ยังไม่ระบุข้อตกลง') {
                                related.appendChild(text('span', ' · ยังไม่ระบุข้อตกลง', 'overview-unspecified-tag'));
                            }
                            li.appendChild(related);
                            const sourceBtn = text('button', 'ดูแหล่งที่มาและคำตอบ', 'overview-read-source');
                            sourceBtn.type = 'button';
                            sourceBtn.setAttribute('aria-expanded', 'false');
                            const detailBox = text('div', undefined, 'overview-source-detail');
                            detailBox.hidden = true;
                            let runId = 0;
                            sourceBtn.onclick = async () => {
                                const run = ++runId;
                                const opening = detailBox.hidden;
                                detailBox.hidden = !opening;
                                sourceBtn.setAttribute('aria-expanded', String(opening));
                                sourceBtn.textContent = opening ? 'ซ่อนคำตอบ' : 'ดูแหล่งที่มาและคำตอบ';
                                detailBox.replaceChildren();
                                if (!opening) return;
                                detailBox.appendChild(text('p', 'กำลังโหลดคำตอบจากไฟล์', 'overview-muted'));
                                const collection = kindCollection[batch.parentType];
                                try {
                                    if (!collection) throw Error('INVALID_PARENT');
                                    const res = await window.CstuAuth.request(`/${collection}/${encodeURIComponent(batch.parentId)}/form-feedback/${encodeURIComponent(batch.id)}`);
                                    if (run !== runId || !root.isConnected) return;
                                    const detail = res?.data || {};
                                    detailBox.replaceChildren(text('p', `แหล่งที่มา: ไฟล์ ${detail.fileName || batch.fileName} · ชีต ${detail.sheetName || batch.sheetName} · นำเข้าโดย ${detail.importedByName || detail.createdBy || 'ไม่ระบุ'}`, 'overview-muted'));
                                    if (window.CstuFormFeedback?.responseList) {
                                        window.CstuFormFeedback.responseList(detailBox, detail);
                                    } else if (Array.isArray(detail.rows)) {
                                        for (const r of detail.rows) {
                                            detailBox.appendChild(text('p', (detail.columns || []).map((q, i) => r.answers?.[i] ? `${q}: ${r.answers[i]}` : '').filter(Boolean).join(' · ')));
                                        }
                                    }
                                } catch (err) {
                                    if (run === runId && root.isConnected) {
                                        detailBox.replaceChildren(text('p', err?.status === 403 || err?.status === 404
                                            ? 'คุณไม่มีสิทธิ์อ่านคำตอบของรายการนี้' : 'โหลดคำตอบไม่สำเร็จ กรุณาลองใหม่', 'overview-muted'));
                                    }
                                }
                            };
                            li.append(sourceBtn, detailBox);
                            list.appendChild(li);
                        }
                        section.appendChild(list);
                    }
                    pane.appendChild(section);
                }
            } else if (activeTab === 'stakeholders') {
                const block = text('section', undefined, 'overview-panel overview-stakeholders');
                const values = result.stakeholders?.byType || {};
                const order = [...Object.keys(stakeholderTypes), ...Object.keys(values).filter(type => !stakeholderTypes[type]).sort()];
                const rows = order.filter(type => Object.hasOwn(values, type)).map(type => ({
                    type, label: labels[type] || type, count: Math.max(0, Number(values[type]) || 0),
                    color: stakeholderTypes[type]?.color || '#8990a6', icon: stakeholderTypes[type]?.icon || 'building'
                }));
                const total = rows.reduce((sum, row) => sum + row.count, 0);
                const header = text('div', undefined, 'overview-stakeholder-header');
                const art = document.createElement('img'); art.src = 'assets/overview-orbit.webp';
                art.alt = ''; art.className = 'overview-summary-art'; art.setAttribute('aria-hidden', 'true');
                const badge = text('span', undefined, 'overview-stakeholder-badge'); badge.appendChild(icon('users'));
                const heading = text('div', undefined, 'overview-stakeholder-heading');
                heading.append(text('h3', 'Stakeholder ตามประเภท'), text('p', 'จำนวนคู่ความร่วมมือที่อ่านได้ตามสิทธิ์ของคุณ'));
                const headline = text('div', undefined, 'overview-stakeholder-total');
                headline.append(text('strong', total), text('span', 'คู่ความร่วมมือทั้งหมด'));
                header.append(art, badge, heading, headline);
                const body = text('div', undefined, 'overview-stakeholder-body');
                const table = text('table', undefined, 'overview-stakeholder-table');
                table.setAttribute('aria-label', 'จำนวน Stakeholder ตามประเภท');
                const thead = document.createElement('thead'), titles = document.createElement('tr');
                for (const title of ['ประเภท', 'จำนวน']) { const th = text('th', title); th.setAttribute('scope', 'col'); titles.appendChild(th); }
                thead.appendChild(titles); table.appendChild(thead);
                const tbody = document.createElement('tbody');
                for (const row of rows) {
                    const tr = document.createElement('tr'); tr.dataset.type = row.type;
                    const category = text('th', undefined); category.setAttribute('scope', 'row');
                    const categoryLabel = text('span', undefined, 'overview-stakeholder-category');
                    const symbol = text('span', undefined, 'overview-stakeholder-icon'); symbol.appendChild(icon(row.icon));
                    categoryLabel.append(symbol, text('span', row.label)); category.appendChild(categoryLabel);
                    const amount = document.createElement('td'); amount.append(text('strong', row.count), text('span', ' แห่ง'));
                    tr.append(category, amount); tbody.appendChild(tr);
                }
                table.appendChild(tbody);
                const donut = text('div', undefined, 'overview-donut overview-stakeholder-donut');
                const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true');
                const center = text('div', undefined, 'overview-donut-label'); center.append(text('strong', total), text('span', 'แห่ง'));
                donut.append(canvas, center); body.append(table, donut); block.append(header, body);
                if (!total) block.appendChild(text('p', 'ไม่พบข้อมูล Stakeholder ตามเงื่อนไข', 'overview-empty'));
                pane.appendChild(block);
                drawDoughnut(canvas, rows, block, '62%');
            }
        }
        async function load() {
            const current = ++requestNumber; statusText.dataset.state = 'loading'; statusText.textContent = 'กำลังโหลดข้อมูลสรุป'; download.disabled = true;
            const query = new URLSearchParams();
            for (const input of [scope.input, agreement.input, stakeholderType.input, activityType.input, status.input, start, end]) if (input.value) query.set(input.name, input.value);
            try {
                const response = await window.CstuAuth.request('/overview' + (query.size ? '?' + query.toString() : ''));
                if (current !== requestNumber) return;
                result = response?.data;
                if (!result || result.role !== role || !result.stakeholders || !result.activities || !result.agreements || !result.exchanges || !result.feedback) throw Error('ข้อมูลสรุปไม่ครบ');
                drawPane(); statusText.dataset.state = 'ready'; statusText.textContent = 'แสดงเฉพาะข้อมูลในขอบเขตที่คุณมีสิทธิ์'; download.disabled = false;
            } catch (error) {
                if (current !== requestNumber) return;
                if (error.status === 401) { location.replace('login.html'); return; }
                clearCharts(); result = null; pane.replaceChildren(text('p', error.status === 403 || error.status === 404
                    ? 'คุณไม่มีสิทธิ์ดูข้อมูลตามเงื่อนไขนี้' : 'โหลดข้อมูลสรุปไม่สำเร็จ กรุณาลองใหม่', 'overview-empty'));
                statusText.dataset.state = 'error'; statusText.textContent = 'ไม่สามารถโหลดภาพรวมได้';
            }
        }
        filters.addEventListener('submit', event => { event.preventDefault(); load(); });
        filters.addEventListener('reset', () => setTimeout(load, 0));
        download.onclick = () => { if (result) exportCsv(result); };
        root.append(intro, filters, statusText, tabs, pane);
        container.replaceChildren(root);
        if (typeof MutationObserver !== 'undefined') {
            observer = new MutationObserver(() => { if (!root.isConnected) container.cstuOverviewDispose?.(); });
            observer.observe(container, {childList: true});
        }
        setTab('summary'); load(); loadAgreementOptions();
    }
    window.CstuOverview = {render};
})();
