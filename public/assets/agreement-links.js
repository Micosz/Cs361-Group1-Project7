/**
 * Partner <-> Agreement <-> Activity/Exchange navigation (#263).
 *
 * Reads only through the authorized list filters (?partnerId= / ?agreementId=),
 * so each list shows exactly the links the server already lets this user see.
 * All record text goes through textContent.
 */
(() => {
    'use strict';

    const STATUS = {
        draft: 'ฉบับร่าง', active: 'มีผลบังคับใช้', expired: 'สิ้นสุดระยะเวลา', terminated: 'ยุติก่อนกำหนด',
        planned: 'วางแผน', ongoing: 'กำลังดำเนินการ', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิก'
    };
    const ACTIVITY_TYPE = {academic_activity: 'กิจกรรมวิชาการ', event: 'กิจกรรม', research: 'งานวิจัย'};
    const MAX_PAGES = 10;

    function el(tag, text, className) {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    }

    async function listAll(path) {
        const rows = [];
        let cursor = null, pages = 0;
        do {
            const separator = path.includes('?') ? '&' : '?';
            const result = await window.CstuAuth.request(path + separator + 'limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
            if (!Array.isArray(result?.data)) throw Error('INVALID_LIST');
            rows.push(...result.data.filter(row => row && typeof row.id === 'string'));
            cursor = result.page?.nextCursor || null;
        } while (cursor && ++pages < MAX_PAGES);
        return rows;
    }

    function opener(options) {
        return options?.open || ((collection, id, trigger) => window.CstuRecords?.openRelated?.(collection, id, trigger));
    }

    function linkButton(label, collection, id, open) {
        const button = el('button', label, 'agreement-link-button');
        button.type = 'button';
        button.dataset.collection = collection;
        button.dataset.recordId = id;
        button.onclick = () => open(collection, id, button);
        return button;
    }

    function period(row) {
        if (row.periodDate) return row.periodDate;
        if (row.startDate || row.endDate) return `${row.startDate || '?'} – ${row.endDate || '?'}`;
        return '';
    }

    function errorText(error) {
        if (error?.status === 401) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
        if (error?.status === 403 || error?.status === 404) return 'คุณไม่มีสิทธิ์ดูรายการที่เชื่อมโยง';
        return 'โหลดรายการที่เชื่อมโยงไม่สำเร็จ';
    }

    function section(container, heading, className) {
        container.className = ['agreement-links', className].filter(Boolean).join(' ');
        const title = el('h3', heading);
        const status = el('p', 'กำลังโหลด…', 'agreement-links-status');
        status.setAttribute('role', 'status');
        container.replaceChildren(title, status);
        return status;
    }

    function rowList(rows, render) {
        const list = el('ul', undefined, 'agreement-links-list');
        for (const row of rows) {
            const item = el('li');
            item.dataset.recordId = row.id;
            render(item, row);
            list.appendChild(item);
        }
        return list;
    }

    async function responsibleNames(agreement, identity) {
        const ids = Array.isArray(agreement.responsibleUserIds) ? agreement.responsibleUserIds : [];
        if (!ids.length) return [];
        const canLookup = (identity?.grants || []).some(g => g.active !== false && g.scopeId === agreement.scopeId
            && ['staff', 'executive'].includes(g.role));
        if (!canLookup) return ids;
        try {
            const result = await window.CstuAuth.request('/selection-users?scopeId=' + encodeURIComponent(agreement.scopeId) + '&kind=responsible');
            const names = new Map((result?.data || []).map(user => [user.id, user.displayName]));
            return ids.map(id => names.get(id) || id);
        } catch {
            return ids;
        }
    }

    /** Partner detail: every agreement this user may read that names the partner. */
    async function partnerAgreements(container, partner, options = {}) {
        const status = section(container, 'ข้อตกลง MoU/MoA ของคู่ความร่วมมือนี้', 'partner-agreements');
        const open = opener(options);
        try {
            const rows = await listAll('/agreements?partnerId=' + encodeURIComponent(partner.id));
            if (!container.isConnected) return;
            rows.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || (a.title || '').localeCompare(b.title || ''));
            if (!rows.length) { status.textContent = 'ยังไม่มีข้อตกลงที่คุณมีสิทธิ์ดู'; return; }
            status.textContent = `${rows.length} ฉบับ`;
            container.appendChild(rowList(rows, (item, row) => {
                item.append(
                    el('span', row.agreementType || 'MoU', 'agreement-links-type'),
                    linkButton(row.title || row.id, 'agreements', row.id, open),
                    el('span', [STATUS[row.status] || row.status, period(row)].filter(Boolean).join(' · '), 'agreement-links-meta')
                );
            }));
        } catch (error) {
            if (container.isConnected) status.textContent = errorText(error);
        }
    }

    /** Agreement detail: partners (back links), responsible people, activities and Exchanges of this agreement only. */
    async function agreementWork(container, agreement, options = {}) {
        const status = section(container, 'งานภายใต้ข้อตกลงนี้', 'agreement-work');
        const open = opener(options);
        const partnersBox = el('div', undefined, 'agreement-links-partners');
        const responsibleBox = el('p', undefined, 'agreement-links-responsible');
        const activityBox = el('div', undefined, 'agreement-links-activities');
        const exchangeBox = el('div', undefined, 'agreement-links-exchanges');
        container.append(partnersBox, responsibleBox, activityBox, exchangeBox);

        const partnerIds = Array.isArray(agreement.partnerIds) ? agreement.partnerIds.filter(id => typeof id === 'string' && id) : [];
        const partnerTask = Promise.all(partnerIds.map(async id => {
            try { return (await window.CstuAuth.request('/partners/' + encodeURIComponent(id))).data; }
            catch { return null; } // Unreadable partners are omitted, never shown by ID.
        }));
        const peopleTask = responsibleNames(agreement, options.identity);
        try {
            const [activities, exchanges, partners, people] = await Promise.all([
                listAll('/activities?agreementId=' + encodeURIComponent(agreement.id)),
                listAll('/exchanges?agreementId=' + encodeURIComponent(agreement.id)),
                partnerTask, peopleTask
            ]);
            if (!container.isConnected) return;
            status.textContent = `กิจกรรม ${activities.length} งาน · Exchange ${exchanges.length} โครงการ`;

            const readable = partners.filter(p => p?.id && p.name);
            if (readable.length) {
                partnersBox.appendChild(el('strong', 'คู่ความร่วมมือ: '));
                readable.forEach((partner, index) => {
                    if (index) partnersBox.appendChild(el('span', ', '));
                    partnersBox.appendChild(linkButton(partner.name, 'partners', partner.id, open));
                });
            }
            if (people.length) {
                responsibleBox.append(el('strong', 'ผู้รับผิดชอบ: '), el('span', people.join(', ')));
            }

            activityBox.appendChild(el('h4', 'กิจกรรม'));
            activities.sort((a, b) => (a.periodDate || '').localeCompare(b.periodDate || ''));
            activityBox.appendChild(activities.length ? rowList(activities, (item, row) => {
                item.append(linkButton(row.title || row.id, 'activities', row.id, open),
                    el('span', [ACTIVITY_TYPE[row.type] || row.type, period(row)].filter(Boolean).join(' · '), 'agreement-links-meta'));
            }) : el('p', 'ยังไม่มีกิจกรรมภายใต้ข้อตกลงนี้', 'agreement-links-empty'));

            exchangeBox.appendChild(el('h4', 'โครงการแลกเปลี่ยน (Exchange)'));
            exchanges.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
            exchangeBox.appendChild(exchanges.length ? rowList(exchanges, (item, row) => {
                item.append(linkButton(row.title || row.id, 'exchanges', row.id, open),
                    el('span', [STATUS[row.status] || row.status, period(row)].filter(Boolean).join(' · '), 'agreement-links-meta'));
            }) : el('p', 'ยังไม่มี Exchange ภายใต้ข้อตกลงนี้', 'agreement-links-empty'));
        } catch (error) {
            if (container.isConnected) status.textContent = errorText(error);
        }
    }

    window.CstuAgreementLinks = {partnerAgreements, agreementWork};
})();
