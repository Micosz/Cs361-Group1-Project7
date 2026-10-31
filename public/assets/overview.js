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
    const icon = name => {
        const item = text('i', undefined, `fa-${name}`);
        item.classList.add(['file-lines', 'calendar-days', 'comment-dots'].includes(name) ? 'fa-regular' : 'fa-solid');
        item.setAttribute('aria-hidden', 'true');
        return item;
    };
    const statusColors = {active:'#2eb48e', draft:'#ffc43b', expired:'#fa6488', terminated:'#af8d98',
        ongoing:'#416bff', completed:'#12aa83', cancelled:'#8990a6'};
    const statusOrder = {agreements:['active','draft','expired','terminated'], exchanges:['ongoing','completed','draft','cancelled']};
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
    const counter = (container, value) => {
        const row = text('p', undefined, 'overview-breakdown-row');
        row.dataset.status = value[0];
        const sep = text('span', ' · ', 'overview-breakdown-sep'); sep.setAttribute('aria-hidden', 'true');
        row.append(text('span', labels[value[0]] || value[0], 'overview-breakdown-label'), sep, text('strong', `${value[1]} รายการ`, 'overview-breakdown-count'));
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
        const startLabel = text('label', 'ตั้งแต่วันที่'), start = document.createElement('input'); start.type = 'date'; start.name = 'startDate'; start.lang = 'th-TH'; startLabel.appendChild(start);
        const endLabel = text('label', 'ถึงวันที่'), end = document.createElement('input'); end.type = 'date'; end.name = 'endDate'; end.lang = 'th-TH'; endLabel.appendChild(end);
        const dateHint = text('small', 'ช่วงวันที่กรองกิจกรรม ข้อตกลง การแลกเปลี่ยน และ Feedback; ยอด Stakeholder นับตามประเภทที่เลือก', 'overview-filter-hint');
        for (const field of [scope, stakeholderType, activityType, status]) filters.appendChild(field.label);
        filters.append(startLabel, endLabel, dateHint);
        const actions = text('div', undefined, 'overview-actions');
        const apply = text('button', 'แสดงผล', 'overview-btn-primary'); apply.type = 'submit';
        const reset = text('button', 'ล้างตัวกรอง', 'overview-btn-secondary'); reset.type = 'reset';
        const download = text('button', 'ส่งออกรายงาน CSV', 'overview-btn-export'); download.type = 'button'; download.disabled = true;
        actions.append(apply, reset, download); filters.appendChild(actions);
        const statusText = text('p', 'กำลังโหลดข้อมูลสรุป', 'overview-status'); statusText.setAttribute('role', 'status');
        const tabs = text('nav', undefined, 'overview-tabs'); tabs.setAttribute('aria-label', 'ส่วนของภาพรวม'); tabs.setAttribute('role', 'tablist');
        const tabButtons = new Map();
        const tabList = [['summary', 'สรุป'], ...(isExecutive ? [['stakeholders', 'Stakeholder']] : []), ['feedback', 'Feedback']];
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
                    const generation = chartGeneration;
                    // Loading the chart must never prevent access to the text summary.
                    if (typeof canvas.getContext === 'function') loadChartLibrary().then(Chart => {
                        if (generation !== chartGeneration || !canvas.isConnected) return;
                        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                        charts.push(new Chart(canvas, {
                            type: 'doughnut',
                            data: {labels: total ? rows.map(([st]) => labels[st] || st) : ['ไม่มีรายการ'], datasets: [{
                                data: total ? rows.map(([,count]) => count) : [1],
                                backgroundColor: total ? rows.map(([st]) => statusColors[st] || '#8990a6') : ['#ede9e7'],
                                borderWidth: total ? 1 : 0, borderColor: '#ffffff', hoverOffset: total ? 3 : 0
                            }]},
                            options: {responsive: true, maintainAspectRatio: false, cutout: '66%',
                                animation: reduced ? false : {duration: 650},
                                plugins: {legend: {display: false}, tooltip: {enabled: total > 0}},
                                layout: {padding: 4}}
                        }));
                    }).catch(() => {
                        if (generation === chartGeneration && canvas.isConnected) block.appendChild(text('p', 'แสดงจำนวนแต่ละสถานะด้านข้างแทนกราฟ', 'overview-chart-note'));
                    });
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
                    if (item.improvement) li.append(text('p', `ข้อเสนอแนะ: ${item.improvement}`, 'overview-improvement'));
                    list.appendChild(li);
                }
                if (!list.children.length) block.appendChild(text('p', 'ยังไม่มี Feedback ในข้อมูลที่ตรงกับเงื่อนไข', 'overview-empty'));
                else block.appendChild(list);
                pane.appendChild(block);
            }
        }
        async function load() {
            const current = ++requestNumber; statusText.dataset.state = 'loading'; statusText.textContent = 'กำลังโหลดข้อมูลสรุป'; download.disabled = true;
            const query = new URLSearchParams();
            for (const input of [scope.input, stakeholderType.input, activityType.input, status.input, start, end]) if (input.value) query.set(input.name, input.value);
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
        setTab('summary'); load();
    }
    window.CstuOverview = {render};
})();
