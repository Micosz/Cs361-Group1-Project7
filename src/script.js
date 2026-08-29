// ดึงข้อมูลจากไฟล์ JSON
async function fetchPartnersData() {
    try {
        const response = await fetch('../src/partners.json'); // อย่าลืมเช็ค Path ตรงนี้ให้ตรงกับโฟลเดอร์งานอ้นนะ
        if (!response.ok) throw new Error("ไม่สามารถดึงข้อมูลได้");
        return await response.json();
    } catch (error) {
        console.error("Error loading JSON:", error);
        return [];
    }
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
            const publicCollabs = partner.collaborations.filter(collab => collab.visibility === 'public' || !collab.visibility);
            
            const activitiesWithPartnerId = publicCollabs.map(collab => ({
                ...collab,
                partnerId: partner.id,
                partnerName: partner.name
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
    const partners = await getPublicPartners();
    container.innerHTML = ''; 

    partners.forEach(partner => {
        const bgStyle = partner.logo_path ? `background-image: url('${partner.logo_path}'); background-size: cover; background-position: center;` : '';
        const colorClass = getColorClass(partner.type);

        const cardHTML = `
            <div class="card" id="${partner.id}">
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

//สร้างการ์ดหน้า Event & Activities
async function renderEventCards() {
    const container = document.getElementById('eventGrid');
    if (!container) return;
    
    const activities = await getPublicActivities();
    container.innerHTML = ''; 

    activities.forEach(activity => {
        const colorClass = getColorClass(activity.type);
        
        // เช็คว่ามีรูปไหม
        const bgStyle = activity.image_path 
            ? `background-image: url('${activity.image_path}'); background-size: cover; background-position: center;` 
            : '';
        const thumbnailContent = activity.image_path 
            ? '' 
            : `<h2 style="color:white; font-size:1.5rem; text-align:center; padding:0 1.5rem; margin: auto;">${activity.title}</h2>`;

        // --- เช็คผู้จัดร่วม (co_hosts) ---
        const hostNames = (activity.co_hosts && activity.co_hosts.length > 0)
            ? activity.co_hosts.join(' และ ') 
            : activity.partnerName;

        const cardHTML = `
            <div class="card" id="${activity.id}">
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
async function initHeroTicker() {
    const partners = await getPublicPartners();
    if (!partners || partners.length === 0) return;

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
        if (t1) { t1.textContent = p1.name; d1.textContent = `${p1.type.toUpperCase()}`; }

        //การ์ดใบที่ 2
        const t2 = document.getElementById('heroTitle2');
        const d2 = document.getElementById('heroDesc2');
        if (t2) { t2.textContent = p2.name; d2.textContent = `${p2.type.toUpperCase()}`; }

        //การ์ดใบที่ 3
        const t3 = document.getElementById('heroTitle3');
        const d3 = document.getElementById('heroDesc3');
        if (t3) { t3.textContent = p3.name; d3.textContent = `${p3.type.toUpperCase()}`; }
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