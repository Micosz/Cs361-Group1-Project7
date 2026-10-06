const API_URL = 'https://eb49u61kph.execute-api.us-east-1.amazonaws.com/default/fetchPartnersData'; 

// Cache only a successful API snapshot for this page; reload to get fresh data.
let partnersDataCache = null;
let partnersDataRequest = null;

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
        if (version === collaboratorRenderVersion) showDataLoadError(container);
        return;
    }
    if (version !== collaboratorRenderVersion) return;
    initHeroTicker(records); // Also recover the ticker after a failed initial load.
    const partners = filterBrowseRecords(records, 'name', 'filterCollab');

    if (partners.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: var(--text-gray);">
                <i class="fas fa-search" style="font-size: 3rem; color: #d1d5db; margin-bottom: 1rem;"></i>
                <h3 style="color: var(--text-dark); margin-bottom: 0.5rem;">ไม่พบผู้มีส่วนได้ส่วนเสีย</h3>
                <p>ลองเปลี่ยนคำค้นหา หรือล้างตัวกรองเพื่อดูข้อมูลทั้งหมด</p>
            </div>
        `;
        return;
    }

    container.innerHTML = partners.map(partner => {
        const bgStyle = partner.logo_path 
    ? `background-image: url('${partner.logo_path}'); background-color: white; background-size: contain; background-repeat: no-repeat; background-position: center;` 
    : '';
        const colorClass = getColorClass(partner.type);

        return `
            <div class="card" id="${partner.id}" onclick="openModal('${partner.id}', 'partner')">
                <div class="card-thumbnail ${colorClass}" style="${bgStyle}"></div>
                <div class="card-content">
                    <h3 class="card-title" style="margin-bottom: 0.5rem; font-size: 1.1rem; color: var(--text-dark);">${partner.name}</h3>
                    <p class="card-desc">${partner.summary}</p>
                    <div class="card-footer">
                        <div class="author"><span class="author-name">${partner.location}</span></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
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
        if (version === eventRenderVersion) showDataLoadError(container);
        return;
    }
    if (version !== eventRenderVersion) return;
    const activities = filterBrowseRecords(records, 'title', 'filterEvent');

    if (activities.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: var(--text-gray);">
                <i class="fas fa-search" style="font-size: 3rem; color: #d1d5db; margin-bottom: 1rem;"></i>
                <h3 style="color: var(--text-dark); margin-bottom: 0.5rem;">ไม่พบกิจกรรม</h3>
                <p>ลองเปลี่ยนคำค้นหา หรือล้างตัวกรองเพื่อดูข้อมูลทั้งหมด</p>
            </div>
        `;
        return;
    }

    container.innerHTML = activities.map(activity => {
        const colorClass = getColorClass(activity.type);
        
        const bgStyle = activity.image_path 
    ? `background-image: url('${activity.image_path}'); background-color: white; background-size: contain; background-repeat: no-repeat; background-position: center;` 
    : '';
        const thumbnailContent = activity.image_path 
            ? '' 
            : `<h2 style="color:white; font-size:1.5rem; text-align:center; padding:0 1.5rem; margin: auto;">${activity.title}</h2>`;

        // --- เช็คผู้จัดร่วม (co_hosts) ---
        const hostNames = (activity.co_hosts && activity.co_hosts.length > 0)
            ? activity.co_hosts.join(' และ ') 
            : activity.partnerName;

        return `
            <div class="card" id="${activity.id}" onclick="openModal('${activity.id}', 'activity')">
                <div class="card-thumbnail ${colorClass}" style="${bgStyle}; display: flex;">
                    ${thumbnailContent}
                </div>
                <div class="card-content">
                    <h3 class="card-title" style="margin-bottom: 0.5rem; font-size: 1.1rem; color: var(--text-dark);">${activity.title}</h3>
                    <p class="card-desc">${activity.summary}</p>
                    <div class="card-footer">
                        <div class="author"><span class="author-name">${hostNames}</span></div>
                        <div class="stats">${activity.period}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
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

async function openModal(id, type) {
    let data = null;
    let allActivities;
    try {
        allActivities = await getPublicActivities(); // ใช้ snapshot เดียวกับการ์ดและ suggestions

        if (type === 'partner') {
            data = await getPublicPartnerById(id);
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
                        <span class="stats" style="color: #999;">${collab.period}</span>
                    </div>
                </div>
            </div>
        `;
    };

    if (type === 'partner') {
        // --- 1. ส่วนของ Partner (แสดงการ์ดกิจกรรมที่เกี่ยวข้อง) ---
        document.getElementById('modalTitle').textContent = data.name;
        document.getElementById('modalName').textContent = data.location || 'ไม่ระบุสถานที่';
        document.getElementById('modalInfo').textContent = data.type.toUpperCase();
        
        if (data.logo_path) {
            modalImage.style.backgroundImage = `url('${data.logo_path}')`;
            modalImage.style.display = 'block';
        } else {
            modalImage.style.display = 'none';
        }

        const partnerDetailText = data.full_description ? data.full_description : data.summary;
        let detailsHTML = `<p style="font-weight: bold; font-size: 1.1em; margin-bottom: 1.5rem; color: var(--text-dark); line-height: 1.6;">${partnerDetailText}</p>`;
        
        // แปลง List เป็น Grid Cards
        if (data.collaborations && data.collaborations.length > 0) {
            const publicCollabs = data.collaborations.filter(isPublicRecord);
            if(publicCollabs.length > 0) {
                detailsHTML += `<h3 style="margin-top: 1.5rem; margin-bottom: 1rem; border-bottom: 2px solid #eee; padding-bottom: 0.5rem;">ความร่วมมือและกิจกรรม</h3>`;
                // สร้าง Grid ขนาดย่อมใน Modal
                detailsHTML += `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem;">`;
                publicCollabs.forEach(collab => {
                    detailsHTML += createMiniCardHTML(collab, data.name);
                });
                detailsHTML += `</div>`;
            }
        }
        modalDetails.innerHTML = detailsHTML;

    } else {
        // --- 2. ส่วนของ Activity (แสดง Event อื่นๆ ของบริษัทเดียวกัน) ---
        const hostNames = (data.co_hosts && data.co_hosts.length > 0) ? data.co_hosts.join(' และ ') : data.partnerName;

        document.getElementById('modalTitle').textContent = data.title;
        document.getElementById('modalName').textContent = hostNames;
        document.getElementById('modalInfo').textContent = data.period || data.type.toUpperCase();
        
        if (data.image_path) {
            modalImage.style.backgroundImage = `url('${data.image_path}')`;
            modalImage.style.display = 'block';
        } else {
            modalImage.style.display = 'none';
        }

        const detailText = data.full_description ? data.full_description : data.summary;
        let detailsHTML = `<p style="line-height: 1.6; color: var(--text-dark); text-align: justify; margin-bottom: 1.5rem;">${detailText}</p>`;

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
    }

    document.getElementById('detailModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('detailModal').style.display = 'none';
}

window.onclick = function(event) {
    const modal = document.getElementById('detailModal');
    if (event.target === modal) {
        modal.style.display = "none";
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
    // V2 specifies name/title search; suggestions and cards share these rules.
    // Preserve dates, co_hosts and relationships from the data source.
    return records.filter(record =>
        (type === 'all' || record.type === type) &&
        String(record[field] ?? '').toLowerCase().includes(keyword)
    );
}

// Integration point for #48: pass the keyword, or '' to clear only search.
function setBrowseKeyword(keyword) {
    browseKeyword = String(keyword ?? '');
    return Promise.all([renderCollaboratorCards(), renderEventCards()]);
}

function applyCollabFilters() {
    hideSuggestions();
    return renderCollaboratorCards();
}

function applyEventFilters() {
    hideSuggestions();
    return renderEventCards();
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
