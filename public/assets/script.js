const API_URL = 'https://eb49u61kph.execute-api.us-east-1.amazonaws.com/default/fetchPartnersData'; 

// Cache only a successful API snapshot for this page; reload to get fresh data.
let partnersDataCache = null;
let partnersDataRequest = null;
window.invalidatePublicData = () => { partnersDataCache = null; partnersDataRequest = null; };

function isPublicRecord(record) {
    return record.visibility === 'public' || !record.visibility;
}

function fetchPartnersData() {
    if (partnersDataCache !== null) {
        return Promise.resolve(partnersDataCache);
    }

    if (partnersDataRequest) return partnersDataRequest;

    async function loadJson(url, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                cache: 'no-store',
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (
                !Array.isArray(data) ||
                data.some(item => !item || typeof item !== 'object' ||
                    Array.isArray(item))
            ) {
                throw new Error('Invalid data: expected an array of records');
            }

            return data;
        } finally {
            clearTimeout(timer);
        }
    }

    partnersDataRequest = (async () => {
        let rawData;
        let usingBackup = false;

        try {
            rawData = await loadJson(API_URL, 8000);
        } catch (apiError) {
            console.warn('API unavailable; loading backup:', apiError);

            rawData = await loadJson(
                './data/partner-data-backup.json',
                8000
            );

            usingBackup = true;
        }

        // Merge published business records into the same browse/detail source.
        // The backend returns only its explicit public projection, without a session.
        if (window.CSTU_AUTH_CONFIG?.enabled === true) {
            try {
                const published = await loadJson('/api/public/records', 8000);
                const combined = new Map(rawData.map(row => [row.id,row]));
                for (const row of published) if (row.visibility === 'public') combined.set(row.id,{...combined.get(row.id),...row,businessRecord:row.businessRecord !== false});
                rawData = Array.from(combined.values());
            } catch (error) {
                console.warn('Published records unavailable:', error);
                usingBackup = true;
            }
        }

        // ใช้เฉพาะรายการที่ระบุว่าเผยแพร่ได้
        const publicRecords = rawData.filter(item =>
            item.access_level === 'public' ||
            item.visibility === 'public'
        );

        const partners = publicRecords
            .filter(item => item.name)
            .map(item => ({ ...item }));

        const events = publicRecords.filter(item => item.partnerId);

        // ประกอบข้อมูลแบบเดียวกันทั้ง API และไฟล์สำรอง
        partners.forEach(partner => {
            partner.collaborations = events.filter(event => {
                if (event.partnerId === partner.id) return true;
                if (Array.isArray(event.coHostPartnerIds) && event.coHostPartnerIds.includes(partner.id)) return true;

                if (Array.isArray(event.co_hosts)) {
                    return event.co_hosts.some(hostName =>
                        typeof hostName === 'string' &&
                        partner.name.includes(hostName)
                    );
                }

                return false;
            });
        });

        // แจ้งผู้ใช้เมื่อกำลังแสดงข้อมูลสำรอง
        let notice = document.getElementById('backupDataNotice');

        if (usingBackup && !notice) {
            notice = document.createElement('div');
            notice.id = 'backupDataNotice';
            notice.setAttribute('role', 'status');
            notice.style.cssText =
                'padding:12px 16px;background:#fff4d6;' +
                'color:#664d03;text-align:center;font-size:14px;';

            document.body.prepend(notice);
        }

        if (notice) {
            notice.textContent =
                'กำลังแสดงข้อมูลสำรอง ข้อมูลอาจไม่ใช่ข้อมูลล่าสุด';
            notice.hidden = !usingBackup;
        }

        partnersDataCache = partners;
        return partners;
    })().catch(error => {
        console.error('โหลดข้อมูลไม่สำเร็จ:', error);
        throw error;
    }).finally(() => {
        partnersDataRequest = null;
    });

    return partnersDataRequest;
}

// 1. ดึงข้อมูล Partner ทั้งหมดสำหรับหน้า Browse
async function getPublicPartners() {
    return await fetchPartnersData();
}

// 2. ดึงข้อมูล Partner จาก ID สำหรับหน้า Detail
async function getPublicPartnerById(id) {
    const partnersData = await fetchPartnersData();
    return partnersData.find(partner => partner.id === id) || null;
}

// 3. ดึงข้อมูลกิจกรรมทั้งหมด
async function getPublicActivities() {
    const partnersData = await fetchPartnersData();
    let allActivities = [];
    
    partnersData.forEach(partner => {
        if (partner.collaborations && partner.collaborations.length > 0) {
            // กรองเอาเฉพาะอันที่ visibility เป็น public หรือไม่มีฟิลด์นี้
            const publicCollabs = partner.collaborations.filter(isPublicRecord);
            
            const activitiesWithPartnerId = publicCollabs.map(collab => ({
                ...collab,
                // Keep the primary host when the first matching partner is a co-host.
                partnerId: collab.partnerId,
                partnerName: partnersData.find(p => p.id === collab.partnerId)?.name || partner.name
            }));
            
            allActivities = [...allActivities, ...activitiesWithPartnerId];
        }
    });

    // --- กรอง Event ที่ ID ซ้ำกันออก ---
    let uniqueActivities = [];
    let seenIds = new Set();

    allActivities.forEach(activity => {
        if (!seenIds.has(activity.id)) {
            seenIds.add(activity.id);
            uniqueActivities.push(activity);
        }
    });

    return uniqueActivities;
}

// 4. ดึงข้อมูลกิจกรรมจาก ID
async function getPublicActivityById(id) {
    const allActivities = await getPublicActivities();
    return allActivities.find(activity => activity.id === id) || null;
}

// ==========================================
// ส่วนของการ Render UI 
// ==========================================

let searchDebounceTimer = null;
let suggestionsVersion = 0;

function getSearchKeyword() {
    return document.getElementById('searchInput').value.toLowerCase().trim();
}

function hideSuggestions() {
    ++suggestionsVersion;
    const dropdown = document.getElementById('searchSuggestions');
    if (dropdown) dropdown.style.display = 'none';
}

function cancelPendingSearch() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
}

function handleSearch() {
    cancelPendingSearch();
    hideSuggestions();
    return setBrowseKeyword(getSearchKeyword());
}

function scheduleSearch() {
    cancelPendingSearch();
    hideSuggestions();
    // Invalidate pending card renders as soon as input changes, before debounce.
    ++collaboratorRenderVersion;
    ++eventRenderVersion;
    if (!getSearchKeyword()) return setBrowseKeyword('');

    const version = suggestionsVersion;
    searchDebounceTimer = setTimeout(() => {
        searchDebounceTimer = null;
        setBrowseKeyword(getSearchKeyword());
        // Dismissal cancels suggestions, while the pending search still updates cards.
        if (version === suggestionsVersion) showSuggestions();
    }, 250);
}

async function showSuggestions() {
    const keyword = getSearchKeyword();
    const dropdown = document.getElementById('searchSuggestions');
    const version = ++suggestionsVersion;

    if (keyword.length === 0) {
        dropdown.style.display = 'none';
        return;
    }

    let partners, activities;
    try {
        [partners, activities] = await Promise.all([getPublicPartners(), getPublicActivities()]);
    } catch (error) {
        if (version === suggestionsVersion) hideSuggestions();
        return; // Card renderers show the API error and allow Search/filter to retry.
    }
    if (version !== suggestionsVersion || keyword !== getSearchKeyword()) return;

    const matchedPartners = filterBrowseRecords(partners, 'name', 'filterCollab', keyword)
        .map(p => ({ ...p, resultType: 'partner', topicLabel: 'องค์กร / ผู้มีส่วนได้ส่วนเสีย' }));

    const matchedActivities = filterBrowseRecords(activities, 'title', 'filterEvent', keyword)
        .map(a => ({ ...a, resultType: 'activity', topicLabel: 'กิจกรรม / โครงการ' }));

    const results = [...matchedPartners, ...matchedActivities];

    if (results.length === 0) {
        const message = document.createElement('div');
        message.style.cssText = 'padding: 15px 20px; color: var(--text-light); text-align: center;';
        message.textContent = `ไม่พบข้อมูลที่ตรงกับ "${keyword}"`;
        dropdown.replaceChildren(message);
    } else {
        dropdown.innerHTML = results.slice(0, 6).map(item => `
            <div class="suggestion-item" onclick="selectSuggestion('${item.id}', '${item.resultType}')">
                <span class="suggestion-category">${item.topicLabel} • ${item.type.toUpperCase()}</span>
                <span class="suggestion-title">${item.name || item.title}</span>
                <span class="suggestion-desc">${item.summary || ''}</span>
            </div>
        `).join('');
    }
    
    dropdown.style.display = 'block';
}

function selectSuggestion(id, type) {
    cancelPendingSearch();
    hideSuggestions();
    return openModal(id, type);
}

document.addEventListener('click', function(event) {
    const wrapper = document.querySelector('.search-wrapper');
    if (wrapper && !wrapper.contains(event.target)) {
        hideSuggestions();
    }
});

function getColorClass(type) {
    switch(type) {
        case 'university': 
        case 'academic_activity': return 'card-bg-red';
        case 'company': 
        case 'internship': return 'card-bg-yellow';
        case 'government': 
        case 'research': return 'card-bg-orange';
        default: return 'card-bg-red';
    }
}

function formatActivityDate(activity) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(activity.period_date || '');
    if (match) {
        const [, year, month, day] = match;
        const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
        if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === match[0]) {
            const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
            return `${Number(day)} ${months[Number(month) - 1]} ${String(Number(year) + 543).slice(-2)}`;
        }
    }
    // Preserve a source's month precision; never invent a calendar day.
    if (activity.date_precision === 'month') {
        return activity.period?.replace(/\b(\d{2})(\d{2})\b$/, '$2') || 'ไม่ระบุวันที่';
    }
    return 'ไม่ระบุวันที่';
}

// Public activity history only. Internal agreements need an authorized read API first.
function buildPartnerActivityHistory(partnerId, activities) {
    const seen = new Set();
    return activities.filter(activity => {
        if (!activity || typeof activity.id !== 'string' || !activity.id || seen.has(activity.id)) return false;
        const flags = [activity.visibility, activity.access_level, activity.publication].filter(value => value !== undefined);
        if (!flags.includes('public') || flags.some(value => value !== 'public')) return false;
        if (activity.entityType && activity.entityType !== 'activity') return false;
        if (activity.partnerId !== partnerId && !(Array.isArray(activity.coHostPartnerIds) && activity.coHostPartnerIds.includes(partnerId))) return false;
        seen.add(activity.id);
        return true;
    }).map(activity => {
        const raw = activity.periodDate ?? activity.period_date;
        const parsed = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)
            ? new Date(`${raw}T00:00:00Z`) : null;
        const date = parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : null;
        return { sourceId: activity.id, kind: 'activity', label: activity.title || 'กิจกรรม', date,
            dateLabel: date ? formatActivityDate({period_date: date}) : formatActivityDate(activity) };
    }).sort((a, b) => {
        if (a.date !== b.date) return a.date === null ? 1 : b.date === null ? -1 : b.date.localeCompare(a.date);
        return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
    });
}

function renderPartnerActivityHistory(container, partnerId, activities) {
    const heading = document.createElement('h3');
    heading.textContent = 'ประวัติความร่วมมือ';
    container.appendChild(heading);
    const entries = buildPartnerActivityHistory(partnerId, activities);
    if (!entries.length) {
        const empty = document.createElement('p');
        empty.textContent = 'ยังไม่มีกิจกรรมสาธารณะที่เชื่อมกับคู่ความร่วมมือนี้';
        container.appendChild(empty);
        return;
    }
    const list = document.createElement('ol');
    list.className = 'partner-history';
    for (const entry of entries) {
        const row = document.createElement('li');
        const date = document.createElement(entry.date ? 'time' : 'span');
        date.textContent = entry.dateLabel;
        if (entry.date) date.dateTime = entry.date;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = entry.label;
        button.addEventListener('click', () => openModal(entry.sourceId, 'activity'));
        row.appendChild(date);
        row.appendChild(button);
        list.appendChild(row);
    }
    container.appendChild(list);
}

// Shared implementation of the original card layout for both data sources.
function createBrowseCard(record, type = 'partner', onOpen = null) {
    const partner = type === 'partner', agreement = type === 'agreement';
    const stateLabel = {draft:'ฉบับร่าง',active:'มีผลใช้งาน',expired:'หมดอายุ',terminated:'ยุติแล้ว'}[record.status] || record.status || '';
    const name = (partner ? record.name : record.title) || 'รายละเอียด';
    const card = document.createElement('div'); card.className = 'card'; card.id = record.id;
    const thumbnail = document.createElement('div'); thumbnail.className = 'card-thumbnail '+getColorClass(record.type);
    const fallback = document.createElement('span'); fallback.className = 'card-image-placeholder';
    fallback.textContent = agreement ? record.agreementType || 'MoU / MoA' : name; thumbnail.appendChild(fallback);
    const imagePath = partner ? record.logoPath || record.logo_path : record.imagePath || record.image_path;
    if (imagePath) {
        try {
            const url = new URL(imagePath, location.href);
            if (['http:','https:'].includes(url.protocol)) {
                // Keep the original thumbnail contract used by the opening and hero animations.
                thumbnail.style.backgroundImage = `url(${JSON.stringify(url.href)})`;
                thumbnail.style.backgroundColor = 'white';
                thumbnail.style.backgroundSize = 'contain';
                thumbnail.style.backgroundRepeat = 'no-repeat';
                thumbnail.style.backgroundPosition = 'center';
                const image = document.createElement('img');
                image.onload = () => { fallback.hidden = true; };
                image.onerror = () => { thumbnail.style.backgroundImage = ''; fallback.hidden = false; };
                image.src = url.href;
            }
        } catch (_) { /* Keep the text placeholder for unavailable images. */ }
    }
    const content = document.createElement('div'); content.className = 'card-content';
    const title = document.createElement('h3'); title.className = 'card-title';
    title.style.cssText = 'margin-bottom:.5rem;font-size:1.1rem;color:var(--text-dark)';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'browse-card-open';
    const activate = () => onOpen ? onOpen(record,button) : openModal(record.id,type);
    button.textContent = name; button.onclick = activate;
    title.appendChild(button);
    const summary = document.createElement('p'); summary.className = 'card-desc'; summary.textContent = record.summary || (agreement ? 'ข้อตกลงความร่วมมือ '+(record.agreementType || 'MoU / MoA') : '');
    const footer = document.createElement('div'); footer.className = 'card-footer';
    const author = document.createElement('div'); author.className = 'author';
    const authorName = document.createElement('span'); authorName.className = 'author-name';
    if (partner) authorName.textContent = record.location || '';
    else if (agreement) authorName.textContent = stateLabel;
    else if (record.publication === 'internal') authorName.textContent = 'กิจกรรมภายใน';
    else authorName.innerHTML = generatePartnerLinks(record.co_hosts, record.partnerName, record.partnerId);
    author.appendChild(authorName); footer.appendChild(author);
    if (!partner) {
        const date = document.createElement('span'); date.className = 'stats event-date'; date.textContent = agreement
            ? [record.startDate,record.endDate].filter(Boolean).map(day => formatActivityDate({period_date:day})).join(' – ') || 'ไม่ระบุช่วงวันที่'
            : formatActivityDate({...record,period_date:record.periodDate || record.period_date});
        footer.appendChild(date);
    }
    content.appendChild(title); content.appendChild(summary); content.appendChild(footer);
    card.appendChild(thumbnail); card.appendChild(content);
    card.addEventListener('click', event => { if (!event.target.closest('button,a')) activate(); });
    return card;
}

// สร้างการ์ดหน้า Collaborator
async function renderCollaboratorCards() {
    const container = document.getElementById('collaboratorGrid');
    if (!container) return;
    
    // ดึงข้อมูล
    const version = ++collaboratorRenderVersion;
    let records;
    try {
        records = await getPublicPartners();
    } catch (error) {
        if (version === collaboratorRenderVersion) { showDataLoadError(container); window.CstuRecords?.renderPartnerCards(container); }
        return;
    }
    if (version !== collaboratorRenderVersion) return;
    initHeroTicker(records); // Also recover the ticker after a failed initial load.
    const partners = filterBrowseRecords(records, 'name', 'filterCollab');

    if (partners.length === 0) {
        container.innerHTML = `
            <div data-public-empty style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: var(--text-gray);">
                <i class="fas fa-search" style="font-size: 3rem; color: #d1d5db; margin-bottom: 1rem;"></i>
                <h3 style="color: var(--text-dark); margin-bottom: 0.5rem;">ไม่พบผู้มีส่วนได้ส่วนเสีย</h3>
                <p>ลองเปลี่ยนคำค้นหา หรือล้างตัวกรองเพื่อดูข้อมูลทั้งหมด</p>
            </div>
        `;
        window.CstuRecords?.renderPartnerCards(container);
        return;
    }

    container.replaceChildren(...partners.map(partner => createBrowseCard(partner,'partner')));
    window.CstuRecords?.renderPartnerCards(container);
}

//สร้างการ์ดหน้า Event & Activities
async function renderEventCards() {
    const container = document.getElementById('eventGrid');
    if (!container) return;
    
    const version = ++eventRenderVersion;
    let records;
    try {
        records = await getPublicActivities();
    } catch (error) {
        if (version === eventRenderVersion) { showDataLoadError(container); window.CstuRecords?.renderEventCards(container); }
        return;
    }
    if (version !== eventRenderVersion) return;
    const activities = filterBrowseRecords(records, 'title', 'filterEvent');

    if (activities.length === 0) {
        container.innerHTML = `
            <div data-public-event-empty style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: var(--text-gray);">
                <i class="fas fa-search" style="font-size: 3rem; color: #d1d5db; margin-bottom: 1rem;"></i>
                <h3 style="color: var(--text-dark); margin-bottom: 0.5rem;">ไม่พบกิจกรรม</h3>
                <p>ลองเปลี่ยนคำค้นหา หรือล้างตัวกรองเพื่อดูข้อมูลทั้งหมด</p>
            </div>
        `;
        window.CstuRecords?.renderEventCards(container);
        return;
    }

    container.replaceChildren(...activities.map(activity => createBrowseCard(activity,'activity')));
    window.CstuRecords?.renderEventCards(container);
}

//ฟังก์ชันสลับ Tab
function switchTab(tabName) {
    const tabCollab = document.getElementById('tabCollab');
    const tabEvent = document.getElementById('tabEvent');
    const secCollab = document.getElementById('sectionCollaborator');
    const secEvent = document.getElementById('sectionEvent');

    if (!tabCollab || !tabEvent || !secCollab || !secEvent) return;

    if (tabName === 'collaborator') {
        tabCollab.classList.add('active');
        tabEvent.classList.remove('active');
        secCollab.style.display = 'block';
        secEvent.style.display = 'none';
    } else {
        tabEvent.classList.add('active');
        tabCollab.classList.remove('active');
        secEvent.style.display = 'block';
        secCollab.style.display = 'none';
    }
}

//ฟังก์ชันสุ่มข้อความใส่การ์ดทุกๆ 10 วินาที
let heroTickerStarted = false;

async function initHeroTicker(records) {
    if (heroTickerStarted) return;
    let partners;
    try {
        partners = records || await getPublicPartners();
    } catch (error) {
        for (let i = 1; i <= 3; i++) {
            const title = document.getElementById(`heroTitle${i}`);
            const description = document.getElementById(`heroDesc${i}`);
            if (title) title.textContent = 'โหลดข้อมูลไม่สำเร็จ';
            if (description) description.textContent = 'กรุณากด Search เพื่อลองใหม่';
        }
        return;
    }
    if (heroTickerStarted) return;
    if (!partners || partners.length === 0) return;
    heroTickerStarted = true;

    function updateCards() {
        // สลับลำดับข้อมูลแบบสุ่ม (Shuffle)
        let shuffled = [...partners].sort(() => 0.5 - Math.random());
        
        // ดึง3บริษัทแรกหลังจากการสุ่ม
        const p1 = shuffled[0] || partners[0];
        const p2 = shuffled[1] || partners[0];
        const p3 = shuffled[2] || partners[0];

        //การ์ดใบที่ 1
        const t1 = document.getElementById('heroTitle1');
        const d1 = document.getElementById('heroDesc1');
        const c1 = document.getElementById('heroCard1');
        if (t1) { t1.textContent = p1.name; d1.textContent = `${p1.type.toUpperCase()}`; }
        if (c1) { c1.onclick = () => openModal(p1.id, 'partner'); }

        //การ์ดใบที่ 2
        const t2 = document.getElementById('heroTitle2');
        const d2 = document.getElementById('heroDesc2');
        const c2 = document.getElementById('heroCard2');
        if (t2) { t2.textContent = p2.name; d2.textContent = `${p2.type.toUpperCase()}`; }
        if (c2) { c2.onclick = () => openModal(p2.id, 'partner'); }

        //การ์ดใบที่ 3
        const t3 = document.getElementById('heroTitle3');
        const d3 = document.getElementById('heroDesc3');
        const c3 = document.getElementById('heroCard3');
        if (t3) { t3.textContent = p3.name; d3.textContent = `${p3.type.toUpperCase()}`; }
        if (c3) { c3.onclick = () => openModal(p3.id, 'partner'); }
    }

    updateCards();

    setInterval(updateCards, 10000);
}

//สั่งให้ Render การ์ดทันทีเมื่อโหลดโครงสร้าง HTML เสร็จ
document.addEventListener('DOMContentLoaded', () => {
    renderCollaboratorCards();
    renderEventCards();
    initHeroTicker(); // เติมบรรทัดนี้เพื่อให้ระบบสุ่มเริ่มทำงาน
});

// One article layout for source-backed and newly created activities.
function createActivityDetailContent(record) {
    const content = document.createElement('section'); content.className = 'public-activity-detail';
    const hosts = document.createElement('p'); hosts.className = 'activity-detail-hosts';
    const relationships = record.relationships;
    if (relationships) {
        const seen = new Set();
        for (const row of [relationships.partner,...(relationships.coHosts || [])].filter(Boolean)) {
            if (seen.has(row.id)) continue; seen.add(row.id);
            if (hosts.children.length) { const separator=document.createElement('span');separator.textContent=' และ ';hosts.appendChild(separator); }
            const link=document.createElement('a');link.textContent=row.name || row.title;
            link.href='index.html?kind=partners&id='+encodeURIComponent(row.id);hosts.appendChild(link);
        }
    } else if (record.partnerName || record.co_hosts?.length) {
        hosts.innerHTML = generatePartnerLinks(record.co_hosts,record.partnerName,record.partnerId);
    }
    if (hosts.children.length || hosts.innerHTML) content.appendChild(hosts);
    const date=document.createElement('p');date.className='activity-detail-date';
    date.textContent=formatActivityDate({...record,period_date:record.period_date || record.periodDate}) ;
    if (date.textContent === 'ไม่ระบุวันที่' && record.periodText) date.textContent=record.periodText;
    content.appendChild(date);
    const imagePath=record.imagePath || record.image_path;
    if (imagePath) {
        const image=document.createElement('img');image.src=imagePath;image.alt=record.title;
        image.className='record-detail-image';content.appendChild(image);
    }
    // User-authored fields remain plain text. Only the existing catalog article
    // renderer may supply source-backed HTML below this shared header.
    if (record.businessRecord !== false) {
        for (const text of [record.summary,record.fullDescription || record.full_description].filter((text,index,all)=>typeof text==='string' && text.trim() && all.indexOf(text)===index)) {
            if (hasLegacySourceLinks(text)) {
                for (const node of createLegacyDescriptionNodes(text)) {
                    node.classList.add('activity-detail-description');
                    content.appendChild(node);
                }
            } else {
                const paragraph=document.createElement('p');paragraph.className='activity-detail-description';
                paragraph.textContent=text;content.appendChild(paragraph);
            }
        }
    }
    if (relationships?.agreements?.length) {
        const heading=document.createElement('h3');heading.textContent='ข้อตกลงที่เกี่ยวข้อง';content.appendChild(heading);
        for (const row of relationships.agreements) {
            const link=document.createElement('a');link.textContent=row.title;link.href='index.html?kind=agreements&id='+encodeURIComponent(row.id);
            const line=document.createElement('p');line.appendChild(link);content.appendChild(line);
        }
    }
    return content;
}

// Older public records may store source links as HTML inside full_description.
// Parse that markup inertly, then rebuild only plain text and safe HTTP(S) links.
function createLegacyDescriptionNodes(value, { partner = false } = {}) {
    const parsed = new DOMParser().parseFromString(String(value || ''), 'text/html');
    parsed.querySelectorAll('br').forEach(node => node.replaceWith(parsed.createTextNode('\n')));
    const rawText = parsed.body.textContent || '';
    const sourceMarker = /(?:หลักฐาน|Sources)\s*:/i.exec(rawText);
    const descriptionText = (sourceMarker ? rawText.slice(0, sourceMarker.index) : rawText).trim();
    const paragraph = document.createElement('p');
    paragraph.textContent = descriptionText;
    paragraph.style.lineHeight = '1.6';
    paragraph.style.color = 'var(--text-dark)';
    paragraph.style.marginBottom = '1.5rem';
    if (partner) {
        paragraph.style.fontWeight = 'bold';
        paragraph.style.fontSize = '1.1em';
    } else {
        paragraph.style.textAlign = 'justify';
    }

    if (!sourceMarker) return [paragraph];

    const sources = document.createElement('div');
    sources.className = 'legacy-description-sources';
    const label = document.createElement('strong');
    label.textContent = 'Sources: ';
    sources.appendChild(label);
    const anchors = [...parsed.querySelectorAll('a')];
    const validAnchors = anchors.map(node => {
        const href = node.getAttribute('href') || '';
        try {
            const url = new URL(href);
            return ['http:', 'https:'].includes(url.protocol) ? { href: url.href, text: node.textContent.trim() || url.hostname } : null;
        } catch { return null; }
    }).filter(Boolean);
    if (validAnchors.length) {
        validAnchors.forEach((source, index) => {
            if (index) sources.appendChild(document.createTextNode(' · '));
            const link = document.createElement('a');
            link.textContent = source.text;
            link.href = source.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            sources.appendChild(link);
        });
    } else {
        sources.appendChild(document.createTextNode(rawText.slice(sourceMarker.index + sourceMarker[0].length).trim()));
    }
    return [paragraph, sources];
}

function hasLegacySourceLinks(value) {
    return typeof value === 'string' && /(?:หลักฐาน|Sources)\s*:/i.test(value) && /<a\b/i.test(value);
}

async function openModal(id, type, protectedPartner = null) {
    let data = null;
    let allActivities;
    try {
        allActivities = await getPublicActivities(); // ใช้ snapshot เดียวกับการ์ดและ suggestions

        if (type === 'partner') {
            data = await getPublicPartnerById(id);
            if (!data && protectedPartner) data = {...protectedPartner, businessRecord:true,
                full_description:protectedPartner.fullDescription, logo_path:protectedPartner.logoPath,
                website_url:protectedPartner.websiteUrl};
        } else if (type === 'activity') {
            data = await getPublicActivityById(id);
        }
    } catch (error) {
        document.getElementById('modalTitle').textContent = 'โหลดข้อมูลไม่สำเร็จ';
        document.getElementById('modalName').textContent = '';
        document.getElementById('modalInfo').textContent = '';
        document.getElementById('modalImage').style.display = 'none';
        showDataLoadError(document.getElementById('modalDetails'));
        document.getElementById('detailModal').style.display = 'flex';
        return;
    }

    if (!data) return;

    const modalImage = document.getElementById('modalImage');
    const modalDetails = document.getElementById('modalDetails');
    modalImage.textContent = '';
    modalImage.classList.remove('partner-image-placeholder');

    // ฟังก์ชันช่วยสร้าง HTML การ์ดขนาดเล็กสำหรับใส่ใน Modal
    const createMiniCardHTML = (collab, partnerName) => {
        const bgStyle = collab.image_path ? `background-image: url('${collab.image_path}'); background-size: cover; background-position: center;` : '';
        const colorClass = getColorClass(collab.type || 'academic_activity');
        const thumbnailContent = collab.image_path ? '' : `<h2 style="color:white; font-size:1.2rem; text-align:center; padding:0 1rem; margin: auto;">${collab.title}</h2>`;
        
        return `
            <div class="card" onclick="openModal('${collab.id}', 'activity')" style="cursor: pointer; margin-bottom: 1rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div class="card-thumbnail ${colorClass}" style="${bgStyle}; display: flex; height: 120px;">
                    ${thumbnailContent}
                </div>
                <div class="card-content" style="padding: 1rem;">
                    <h3 class="card-title" style="margin-bottom: 0.5rem; font-size: 1rem; color: var(--text-dark);">${collab.title}</h3>
                    <p class="card-desc" style="font-size: 0.85rem; margin-bottom: 0.5rem;">${collab.summary}</p>
                    <div class="card-footer" style="font-size: 0.8rem; border-top: 1px solid #eee; padding-top: 0.5rem; display: flex; justify-content: space-between;">
                        <span class="author-name" style="color: #666;">${partnerName}</span>
                        <span class="stats event-date" style="color: #999;">${formatActivityDate(collab)}</span>
                    </div>
                </div>
            </div>
        `;
    };

    if (type === 'partner') {
        // --- 1. ส่วนของ Partner (แสดงการ์ดกิจกรรมที่เกี่ยวข้อง) ---
        document.getElementById('modalTitle').textContent = data.name;
        document.getElementById('modalName').textContent = data.location || 'ไม่ระบุสถานที่';
        document.getElementById('modalInfo').textContent = (data.type || '').toUpperCase();
        
        if (data.logo_path) {
            modalImage.style.backgroundImage = `url('${data.logo_path}')`;
            modalImage.style.display = 'block';
        } else {
            modalImage.style.backgroundImage = 'none';
            modalImage.style.display = 'flex';
            modalImage.classList.add('partner-image-placeholder');
            modalImage.textContent = data.name;
        }

        const partnerDetailText = data.full_description || data.summary || '';
        if (data.businessRecord && !hasLegacySourceLinks(partnerDetailText)) {
            modalDetails.replaceChildren();
            const description = document.createElement('p'); description.textContent = partnerDetailText;
            modalDetails.appendChild(description);
        } else {
            modalDetails.replaceChildren(...createLegacyDescriptionNodes(partnerDetailText, { partner: true }));
        }
        renderPartnerActivityHistory(modalDetails, data.id, allActivities);

    } else {
        // --- 2. ส่วนของ Activity (แสดง Event อื่นๆ ของบริษัทเดียวกัน) ---
        let hostNames = generatePartnerLinks(data.co_hosts, data.partnerName, data.partnerId);

        document.getElementById('modalTitle').textContent = data.title;
        document.getElementById('modalName').innerHTML = hostNames;
        document.getElementById('modalInfo').textContent = formatActivityDate(data);
        
        if (data.image_path) {
            modalImage.style.backgroundImage = `url('${data.image_path}')`;
            modalImage.style.display = 'block';
        } else {
            modalImage.style.display = 'none';
        }

        const detailText = data.full_description ? data.full_description : data.summary;
        const descriptionNodes = data.businessRecord && !hasLegacySourceLinks(detailText)
            ? [Object.assign(document.createElement('p'), { textContent: detailText || '' })]
            : createLegacyDescriptionNodes(detailText);
        let detailsHTML = '';

        // หา Event อื่นๆ ที่มาจากบริษัทเดียวกัน (และไม่ใช่ตัวมันเอง)
        const relatedActivities = allActivities.filter(a => a.partnerId === data.partnerId && a.id !== data.id);
        
        if (relatedActivities.length > 0) {
            detailsHTML += `<h3 style="margin-top: 2rem; margin-bottom: 1rem; border-bottom: 2px solid #eee; padding-bottom: 0.5rem;">กิจกรรมอื่นๆ จาก ${data.partnerName}</h3>`;
            detailsHTML += `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem;">`;
            relatedActivities.forEach(collab => {
                detailsHTML += createMiniCardHTML(collab, collab.partnerName);
            });
            detailsHTML += `</div>`;
        }

        modalDetails.innerHTML = detailsHTML;
        if (descriptionNodes.length) modalDetails.prepend(...descriptionNodes);
    }

    if (type === 'activity' && window.CstuRecords?.openPublicActivity) {
        const content = createActivityDetailContent({...data,businessRecord:data.businessRecord === true});
        if (!data.businessRecord) {
            while (modalDetails.firstChild) content.appendChild(modalDetails.firstChild);
        }
        closeModal();
        return window.CstuRecords.openPublicActivity(data,content,document.activeElement);
    }

    if (window.CstuWork) {
        const actions = document.createElement('div');
        if (type === 'partner') actions.className = 'partner-management';
        modalDetails.appendChild(actions);
        window.CstuWork.attachDetailAction(actions, type === 'partner' ? 'partners' : 'activities', data.id);
    }
    document.getElementById('detailModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('detailModal').style.display = 'none';
    document.getElementById('modalDetails').querySelectorAll?.('.partner-management').forEach(node => node.remove());
}

window.onclick = function(event) {
    const modal = document.getElementById('detailModal');
    if (event.target === modal) {
        closeModal();
    }
}

// ==========================================
// Browse filters (data access and search UI remain separate)
// ==========================================
let browseKeyword = '';
let collaboratorRenderVersion = 0;
let eventRenderVersion = 0;

function filterBrowseRecords(records, field, selectId, searchKeyword = browseKeyword) {
    const type = document.getElementById(selectId)?.value || 'all';
    const keyword = searchKeyword.trim().toLowerCase();
    const start = document.getElementById(`${selectId}Date`)?.value || '';
    const end = document.getElementById(`${selectId}DateEnd`)?.value || '';
    const withinRange = day => (!start && !end) || (
        typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
        (!start || day >= start) && (!end || day <= end)
    );
    const matchesType = record => {
        const hasMoU = Array.isArray(record.activity_tags) && record.activity_tags.includes('mou');
        if (selectId === 'filterEvent' && type === 'mou') return hasMoU;
        if (selectId === 'filterEvent' && type === 'academic_activity') {
            return record.type === type && !hasMoU;
        }
        return type === 'all' || record.type === type;
    };
    // V2 specifies name/title search; suggestions and cards share these rules.
    // Preserve dates, co_hosts and relationships from the data source.
    return records.filter(record =>
        matchesType(record) &&
        String(record[field] ?? '').toLowerCase().includes(keyword) &&
        // Compare the stored calendar day directly, without timezone conversion.
        ((!start && !end) || (selectId === 'filterCollab'
            ? record.collaborations?.some(activity => withinRange(activity.period_date))
            : withinRange(record.period_date)))
    );
}

// Integration point for #48: pass the keyword, or '' to clear only search.
function setBrowseKeyword(keyword) {
    browseKeyword = String(keyword ?? '');
    window.CstuRecords?.filter({keyword:browseKeyword});
    return Promise.all([renderCollaboratorCards(), renderEventCards()]);
}

function applyCollabFilters() {
    hideSuggestions();
    window.CstuRecords?.filter({selectId:'filterCollab'});
    return renderCollaboratorCards();
}

function applyEventFilters() {
    hideSuggestions();
    window.CstuRecords?.filter({selectId:'filterEvent'});
    return renderEventCards();
}

function applyBrowseDateFilter(selectId) {
    const input = document.getElementById(`${selectId}Date`);
    const end = document.getElementById(`${selectId}DateEnd`);
    const clear = document.getElementById(`${selectId}DateClear`);
    const active = Boolean(input?.value || end?.value);
    if (clear) { clear.disabled = !active; clear.hidden = !active; }
    const error = document.getElementById(`${selectId}DateError`);
    if (error) {
        const reversed = Boolean(input?.value && end?.value && input.value > end.value);
        error.hidden = !reversed;
        error.textContent = reversed ? 'วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น' : '';
    }
    return selectId === 'filterCollab' ? applyCollabFilters() : applyEventFilters();
}

function clearBrowseDateFilter(selectId) {
    const input = document.getElementById(`${selectId}Date`);
    if (input) input.value = '';
    const end = document.getElementById(`${selectId}DateEnd`);
    if (end) end.value = '';
    return applyBrowseDateFilter(selectId);
}

function initBrowseFilters() {
    [
        ['filterCollab', 'ประเภทคู่ความร่วมมือ', applyCollabFilters],
        ['filterEvent', 'ประเภทกิจกรรม', applyEventFilters]
    ].forEach(([id, label, apply]) => {
        const select = document.getElementById(id);
        if (!select || document.getElementById(`${id}Clear`)) return;
        
        select.setAttribute('aria-label', label);
        
        // สร้างปุ่มล้าง Filter (ถังขยะ)
        const clearButton = document.createElement('button');
        clearButton.id = `${id}Clear`;
        clearButton.type = 'button';
        clearButton.className = 'clear-filter-btn'; // เปลี่ยน Class เพื่อไปเขียน CSS ใหม่
        clearButton.innerHTML = '<i class="fas fa-trash-alt"></i>'; // ใช้ Icon ถังขยะ
        clearButton.setAttribute('aria-label', `ล้าง${label}`);
        clearButton.title = `ล้าง${label}`; // เพิ่ม Tooltip ให้รู้ว่าปุ่มนี้ทำอะไร
        
        const sync = () => { 
            // ซ่อนปุ่มถังขยะถ้าเลือก 'all' (ไม่มีอะไรให้ล้าง)
            clearButton.style.display = select.value === 'all' ? 'none' : 'flex';

            adjustSelectWidth(select);
        };
        
        select.addEventListener('change', sync);
        clearButton.addEventListener('click', () => {
            select.value = 'all';
            sync();
            apply();
        });
        
        // แทรกลงไปต่อท้ายกล่อง Select
        select.insertAdjacentElement('afterend', clearButton);
        sync();
    });
}

function showDataLoadError(container) {
    const message = document.createElement('p');
    message.setAttribute('role', 'status');
    message.style.gridColumn = '1 / -1';
    message.textContent = 'โหลดข้อมูลไม่สำเร็จ กรุณากด Search หรือเปลี่ยนตัวกรองเพื่อลองใหม่';
    container.replaceChildren(message);
}

// ฟังก์ชันช่วยคำนวณความกว้างของข้อความใน Select ให้พอดีเป๊ะ (เวอร์ชันคำนวณจาก CSS จริง)
function adjustSelectWidth(selectElement) {
    const tempSpan = document.createElement('span');
    tempSpan.textContent = selectElement.options[selectElement.selectedIndex].text;
    
    // ดึงสไตล์ของฟอนต์มาให้เหมือนกล่อง Select เป๊ะๆ
    const style = window.getComputedStyle(selectElement);
    tempSpan.style.fontFamily = style.fontFamily;
    tempSpan.style.fontSize = style.fontSize;
    tempSpan.style.fontWeight = style.fontWeight;
    
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'nowrap';
    document.body.appendChild(tempSpan);
    
    // หาความกว้างเฉพาะตัวอักษร
    const textWidth = tempSpan.getBoundingClientRect().width;
    document.body.removeChild(tempSpan);
    
    // ดึงค่า Padding ซ้าย/ขวา และ Border จาก CSS มาบวกเพิ่ม (แทนการกะเลขเอง)
    const paddingLeft = parseFloat(style.paddingLeft) || 16;
    const paddingRight = parseFloat(style.paddingRight) || 40;
    const border = 2; // ขอบซ้ายขวา
    
    // รวมความกว้างทั้งหมด (บวกเผื่อบัฟเฟอร์ไว้อีก 5px กันตัวอักษรเบียดขอบ)
    const newWidth = textWidth + paddingLeft + paddingRight + border + 5;
    
    selectElement.style.width = `${newWidth}px`;
}

document.addEventListener('DOMContentLoaded', initBrowseFilters);

/**
 * ฟังก์ชันสำหรับเปิด Popup คู่ความร่วมมือเมื่อคลิกลิงก์บนการ์ดกิจกรรม
 * @param {Event} event - Event object จากการคลิก
 * @param {string} partnerId - ID ของคู่ความร่วมมือที่จะเปิด
 */
function handlePartnerClick(event, partnerId) {
    // ป้องกันการ Reload หรือ Redirect หน้าเว็บ
    event.preventDefault();
    
    // ป้องกันไม่ให้ Event ทะลุไปทริกเกอร์ OnClick ของหน้าการ์ดหลัก
    event.stopPropagation();
    
    // เรียกฟังก์ชันเปิด Popup ที่มีอยู่แล้วใน V1 (detailModal)
    if (partnerId) {
        openModal(partnerId, 'partner');
    } else {
        console.warn("ไม่พบ partnerId สำหรับเปิด Popup");
    }
}


/**
 * ฟังก์ชันสำหรับสร้างลิงก์ชื่อบริษัท โดยแยกกดทีละบริษัทได้ถ้ามีหลายอัน
 */
function escapePartnerLinkText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

function generatePartnerLinks(coHosts, partnerName, partnerId) {
    const link = (name, id) => {
        const label = escapePartnerLinkText(name);
        if (!id) return label;
        const encodedId = escapePartnerLinkText(encodeURIComponent(id));
        return `<a class="partner-link" href="#partner-${encodedId}" data-partner-id="${encodedId}" onclick="handlePartnerClick(event, decodeURIComponent(this.dataset.partnerId))">${label}&nbsp;<span class="icon" aria-hidden="true">&#x2197;</span></a>`;
    };
    const hosts = Array.isArray(coHosts)
        ? coHosts.filter(name => typeof name === 'string' && name.trim()) : [];
    if (hosts.length) {
        return hosts.map(name => {
            const matches = (partnersDataCache || []).filter(partner =>
                (typeof partner.name === 'string' && partner.name.includes(name)) ||
                (typeof partner.short_name === 'string' && partner.short_name.includes(name))
            );
            // Ambiguous legacy names remain text rather than opening the wrong partner.
            return link(name, matches.length === 1 ? matches[0].id : null);
        }).join(' และ ');
    }
    const primaryName = partnerName || (partnersDataCache || []).find(partner => partner.id === partnerId)?.name;
    return link(primaryName || (partnerId ? 'ดูคู่ความร่วมมือ' : 'ไม่ระบุคู่ความร่วมมือ'), partnerId);
}

async function checkAgreementEntryVisibility() {
    const btn = document.getElementById('btnOpenAgreements');
    if (!btn) return;
    if (!window.CstuAuth?.enabled()) {
        btn.style.display = 'none';
        return;
    }
    try {
        const session = await window.CstuAuth.refresh();
        const roles = window.CstuAuth.roles(session);
        const canManage = roles.some(r => ['coordinator', 'staff'].includes(r));
        btn.style.display = canManage ? 'inline-block' : 'none';
    } catch {
        btn.style.display = 'none';
    }
}
window.addEventListener('authchange', checkAgreementEntryVisibility);
window.addEventListener('pageshow', checkAgreementEntryVisibility);
document.addEventListener('DOMContentLoaded', checkAgreementEntryVisibility);
