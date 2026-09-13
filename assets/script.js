let currentSearchKeyword = "";
let currentCollabFilter = "all";
let currentEventFilter = "all";

async function fetchPartnersData() {
    try {
        const response = await fetch('data/partners.json');
        if (!response.ok) throw new Error("ไม่สามารถดึงข้อมูลได้");
        return await response.json();
    } catch (error) {
        console.error("Error loading JSON:", error);
        return [];
    }
}

async function getPublicPartners() {
    return await fetchPartnersData();
}

async function getPublicPartnerById(id) {
    const partnersData = await fetchPartnersData();
    return partnersData.find(partner => partner.id === id) || null;
}

async function getPublicActivities() {
    const partnersData = await fetchPartnersData();
    let allActivities = [];
    
    partnersData.forEach(partner => {
        if (partner.collaborations && partner.collaborations.length > 0) {
            const publicCollabs = partner.collaborations.filter(collab => collab.visibility === 'public' || !collab.visibility);
            const activitiesWithPartnerId = publicCollabs.map(collab => ({
                ...collab,
                partnerId: partner.id,
                partnerName: partner.name
            }));
            allActivities = [...allActivities, ...activitiesWithPartnerId];
        }
    });

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

async function getPublicActivityById(id) {
    const allActivities = await getPublicActivities();
    return allActivities.find(activity => activity.id === id) || null;
}

function handleSearch() {
    currentSearchKeyword = document.getElementById('searchInput').value.toLowerCase().trim();
    renderCollaboratorCards();
    renderEventCards();
}

async function showSuggestions() {
    const keyword = document.getElementById('searchInput').value.toLowerCase().trim();
    const dropdown = document.getElementById('searchSuggestions');
    
    handleSearch(); 

    if (keyword.length === 0) {
        dropdown.style.display = 'none';
        return;
    }

    const partners = await getPublicPartners();
    const activities = await getPublicActivities();

    const matchedPartners = partners.filter(p => 
        (p.name && p.name.toLowerCase().includes(keyword)) ||
        (p.summary && p.summary.toLowerCase().includes(keyword)) ||
        (p.location && p.location.toLowerCase().includes(keyword))
    ).map(p => ({ ...p, resultType: 'partner', topicLabel: 'องค์กร / ผู้มีส่วนได้ส่วนเสีย' }));

    const matchedActivities = activities.filter(a => 
        (a.title && a.title.toLowerCase().includes(keyword)) ||
        (a.summary && a.summary.toLowerCase().includes(keyword)) ||
        (a.partnerName && a.partnerName.toLowerCase().includes(keyword)) ||
        (a.co_hosts && a.co_hosts.join(' ').toLowerCase().includes(keyword))
    ).map(a => ({ ...a, resultType: 'activity', topicLabel: 'กิจกรรม / โครงการ' }));

    const results = [...matchedPartners, ...matchedActivities];

    if (results.length === 0) {
        dropdown.innerHTML = `<div style="padding: 15px 20px; color: var(--text-light); text-align: center;">ไม่พบข้อมูลที่ตรงกับ "${keyword}"</div>`;
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
    document.getElementById('searchSuggestions').style.display = 'none';
    openModal(id, type);
}

document.addEventListener('click', function(event) {
    const wrapper = document.querySelector('.search-wrapper');
    const dropdown = document.getElementById('searchSuggestions');
    if (wrapper && !wrapper.contains(event.target)) {
        if (dropdown) dropdown.style.display = 'none';
    }
});

function applyCollabFilters() {
    currentCollabFilter = document.getElementById('filterCollab').value;
    renderCollaboratorCards();
}

function applyEventFilters() {
    currentEventFilter = document.getElementById('filterEvent').value;
    renderEventCards();
}

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

async function renderCollaboratorCards() {
    const container = document.getElementById('collaboratorGrid');
    if (!container) return;
    
    let partners = await getPublicPartners();
    if (currentCollabFilter !== 'all') {
        partners = partners.filter(p => p.type === currentCollabFilter);
    }
    if (currentSearchKeyword !== "") {
        partners = partners.filter(p => 
            (p.name && p.name.toLowerCase().includes(currentSearchKeyword)) ||
            (p.summary && p.summary.toLowerCase().includes(currentSearchKeyword)) ||
            (p.location && p.location.toLowerCase().includes(currentSearchKeyword))
        );
    }

    container.innerHTML = ''; 
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

    partners.forEach(partner => {
        const bgStyle = partner.logo_path 
            ? `background-image: url('${partner.logo_path}'); background-color: white; background-size: contain; background-repeat: no-repeat; background-position: center;` 
            : '';
        const colorClass = getColorClass(partner.type);

        const cardHTML = `
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
        container.innerHTML += cardHTML;
    });
}

async function renderEventCards() {
    const container = document.getElementById('eventGrid');
    if (!container) return;
    
    let activities = await getPublicActivities();
    if (currentEventFilter !== 'all') {
        activities = activities.filter(a => a.type === currentEventFilter);
    }
    if (currentSearchKeyword !== "") {
        activities = activities.filter(a => 
            (a.title && a.title.toLowerCase().includes(currentSearchKeyword)) ||
            (a.summary && a.summary.toLowerCase().includes(currentSearchKeyword)) ||
            (a.partnerName && a.partnerName.toLowerCase().includes(currentSearchKeyword)) ||
            (a.co_hosts && a.co_hosts.join(' ').toLowerCase().includes(currentSearchKeyword))
        );
    }

    container.innerHTML = ''; 
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

    activities.forEach(activity => {
        const colorClass = getColorClass(activity.type);
        const bgStyle = activity.image_path 
            ? `background-image: url('${activity.image_path}'); background-color: white; background-size: contain; background-repeat: no-repeat; background-position: center;` 
            : '';
        const thumbnailContent = activity.image_path 
            ? '' 
            : `<h2 style="color:white; font-size:1.5rem; text-align:center; padding:0 1.5rem; margin: auto;">${activity.title}</h2>`;

        const hostNames = (activity.co_hosts && activity.co_hosts.length > 0)
            ? activity.co_hosts.join(' และ ') 
            : activity.partnerName;

        const cardHTML = `
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
        container.innerHTML += cardHTML;
    });
}

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

async function initHeroTicker() {
    const partners = await getPublicPartners();
    if (!partners || partners.length === 0) return;

    function updateCards() {
        let shuffled = [...partners].sort(() => 0.5 - Math.random());
        const p1 = shuffled[0] || partners[0];
        const p2 = shuffled[1] || partners[0];
        const p3 = shuffled[2] || partners[0];

        const t1 = document.getElementById('heroTitle1');
        const d1 = document.getElementById('heroDesc1');
        if (t1) { t1.textContent = p1.name; d1.textContent = `${p1.type.toUpperCase()}`; }

        const t2 = document.getElementById('heroTitle2');
        const d2 = document.getElementById('heroDesc2');
        if (t2) { t2.textContent = p2.name; d2.textContent = `${p2.type.toUpperCase()}`; }

        const t3 = document.getElementById('heroTitle3');
        const d3 = document.getElementById('heroDesc3');
        if (t3) { t3.textContent = p3.name; d3.textContent = `${p3.type.toUpperCase()}`; }
    }

    updateCards();
    setInterval(updateCards, 10000);
}

document.addEventListener('DOMContentLoaded', () => {
    renderCollaboratorCards();
    renderEventCards();
    initHeroTicker(); 
});

async function openModal(id, type) {
    let data = null;
    const allActivities = await getPublicActivities();

    if (type === 'partner') {
        data = await getPublicPartnerById(id);
    } else if (type === 'activity') {
        data = await getPublicActivityById(id);
    }

    if (!data) return;

    const modalImage = document.getElementById('modalImage');
    const modalDetails = document.getElementById('modalDetails');

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
        
        if (data.collaborations && data.collaborations.length > 0) {
            const publicCollabs = data.collaborations.filter(c => c.visibility === 'public');
            if(publicCollabs.length > 0) {
                detailsHTML += `<h3 style="margin-top: 1.5rem; margin-bottom: 1rem; border-bottom: 2px solid #eee; padding-bottom: 0.5rem;">ความร่วมมือและกิจกรรม</h3>`;
                detailsHTML += `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem;">`;
                publicCollabs.forEach(collab => {
                    detailsHTML += createMiniCardHTML(collab, data.name);
                });
                detailsHTML += `</div>`;
            }
        }
        modalDetails.innerHTML = detailsHTML;

    } else {
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