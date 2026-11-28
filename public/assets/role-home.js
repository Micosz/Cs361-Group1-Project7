/* Page routing is presentation only. APIs continue to enforce roles and scopes. */
(() => {
    'use strict';
    const auth = window.CstuAuth;
    const workPage = document.body.classList.contains('work-home');
    let revision = 0;
    const titles = {coordinator:'อาจารย์ / ผู้ประสานงาน',staff:'เจ้าหน้าที่',executive:'ผู้ดูแลความร่วมมือ'};
    const destinations = [
        ['หน้าทำงาน','work.html','home'],
        ['คู่ความร่วมมือ','work.html?kind=partners#board-section','partners'],
        ['กิจกรรม','work.html?kind=activities#board-section','activities'],
        ['ข้อเสนอความร่วมมือ','work.html?view=proposals','proposals'],
        ['ข้อตกลง MoU / MoA','work.html?kind=agreements#board-section','agreements'],
        ['โครงการแลกเปลี่ยน','work.html?kind=exchanges#board-section','exchanges'],
        ['รวม Feedback','work.html?view=feedback#board-section','feedback']
    ];
    const link = (title, href, description) => {
        const a = document.createElement('a'); a.href = href;
        const strong = document.createElement('strong'); strong.textContent = title; a.append(strong);
        if (description) { const small = document.createElement('small'); small.textContent = description; a.append(small); }
        return a;
    };
    function createShortcutGroup(items) {
        const section = document.createElement('section');
        section.className = 'desk-create';
        section.setAttribute('aria-labelledby','desk-create-heading');
        const title = document.createElement('h2');
        title.id = 'desk-create-heading';
        title.textContent = 'เพิ่มข้อมูล';
        const links = document.createElement('div');
        links.className = 'desk-create-links';
        links.append(items);
        section.append(title,links);
        return section;
    }
    function clearWork() {
        document.body.classList.add('work-checking');
        window.CstuProposals?.clear();
        document.getElementById('work-nav')?.replaceChildren();
        document.getElementById('work-actions')?.replaceChildren();
    }
    async function refresh() {
        const current = ++revision;
        if (workPage) clearWork();
        try {
            if (!auth?.enabled()) throw Error('AUTH_DISABLED');
            const session = await auth.refresh();
            if (current !== revision) return;
            const internal = auth.isInternal(session);
            if (!workPage) {
                const params = new URLSearchParams(location.search);
                if (internal && params.get('public') !== '1') {
                    location.replace('work.html' + location.search + location.hash); return;
                }
                return;
            }
            if (!internal) { location.replace(session?.user || document.body.dataset.signingOut === 'true' ? 'index.html' : 'login.html'); return; }
            const roles = window.CstuWork.roles(session);
            const nav = document.getElementById('work-nav');
            const selected = new URLSearchParams(location.search);
            const active = selected.get('view') || selected.get('kind') || 'home';
            const entries = [...destinations];
            const staffOrExecutive = roles.some(r => ['staff','executive'].includes(r));
            const landing = !selected.has('kind') && !selected.has('view');
            const staffLanding = landing && staffOrExecutive;
            if (staffOrExecutive) entries.push(['ภาพรวมความร่วมมือ','work.html?view=overview#board-section','overview']);
            if (auth.managedScopes(session).length) entries.push(['จัดการสิทธิ์ผู้ใช้','work.html?view=roles#board-section','roles']);
            for (const [title,href,key] of entries) {
                const a = link(title,href);
                if (active === key) a.setAttribute('aria-current','page');
                nav.append(a);
            }
            const name = session.user.accountType === 'demo' ? '' : (session.user.displayName || '').trim().split(/\s+/u)[0];
            document.querySelector('.work-sidebar h2').textContent = staffLanding ? 'เมนูงาน' : 'พื้นที่ทำงาน';
            const heading = document.getElementById('work-title');
            if (staffLanding) heading.textContent = name ? `พื้นที่ทำงานของ${name}` : 'พื้นที่ทำงาน';
            else heading.textContent = name ? `สวัสดี ${name} วันนี้เริ่มงานอะไรดี?` : 'วันนี้เริ่มจากงานไหนดี?';
            document.getElementById('work-role').textContent = [...new Set(roles.map(r => titles[r]).filter(Boolean))].join(' · ');
            const actions = document.getElementById('work-actions');
            if (active === 'home') {
                const board = link('กระดานข้อเสนอความร่วมมือ','work.html?view=proposals','ดูข้อเสนอและผู้สนใจ');
                board.id = 'proposal-shortcut';
                const icon = document.createElement('i'); icon.className = 'fas fa-thumbtack'; icon.setAttribute('aria-hidden','true'); board.prepend(icon);
                actions.append(board);
            }
            const icons = {partners:'building',activities:'calendar-plus',agreements:'file-signature',exchanges:'globe'};
            const createLinks = document.createDocumentFragment();
            for (const [kind,config] of Object.entries(window.CstuWork.kinds)) {
                if (!window.CstuWork.canCreate(session,kind)) continue;
                const a = link(config.create,`work.html?kind=${kind}&action=create#board-section`,{partners:'บันทึกองค์กรและผู้ติดต่อ',activities:'เชื่อมกิจกรรมกับคู่ความร่วมมือ',agreements:'บันทึกข้อตกลงและระยะเวลา',exchanges:'จัดการโครงการและผู้เข้าร่วม'}[kind]);
                const icon = document.createElement('i'); icon.className = `fas fa-${icons[kind]}`; icon.setAttribute('aria-hidden','true'); a.prepend(icon); createLinks.append(a);
            }
            if (staffLanding && createLinks.childElementCount) actions.append(createShortcutGroup(createLinks));
            else actions.append(createLinks);
            const feedback = link('อ่านผลตอบรับ','work.html?view=feedback#board-section','รวบรวม Comment และ Form Feedback');
            if (staffLanding) {
                const icon = document.createElement('i');
                icon.className = 'fas fa-comment-dots'; icon.setAttribute('aria-hidden','true');
                feedback.prepend(icon);
            }
            actions.append(feedback);
            document.body.classList.toggle('work-dashboard', landing);
            document.body.classList.toggle('staff-landing', staffLanding);
            document.body.classList.toggle('work-proposals', active === 'proposals');
            document.body.classList.remove('work-checking');
            // Native autofocus can miss a form that opened behind the permission gate.
            if (staffOrExecutive && document.activeElement === document.body) {
                const dialog = document.getElementById('record-detail');
                if (dialog?.open) dialog.focus({preventScroll:true});
            }
            if (active === 'proposals' || active === 'home') window.CstuProposals?.mount(session, active);
            document.querySelector('.navbar')?.classList.add('header-settled');
            document.querySelector('.page-title h1').textContent = 'ข้อมูลความร่วมมือ';
            document.querySelector('.page-title h2').textContent = 'ค้นหาและเปิดรายการเพื่อจัดการ';
        } catch {
            if (current !== revision || !workPage) return;
            document.getElementById('work-gate-message').textContent = 'ตรวจสิทธิ์ไม่สำเร็จ กรุณาลองอีกครั้ง';
            document.getElementById('work-gate-retry').hidden = false;
        }
    }
    document.getElementById('work-gate-retry')?.addEventListener('click',refresh);
    // Keep shared record links on the working page, including links created later.
    document.addEventListener('click',event => {
        const a = event.target.closest('a[href]');
        if (!a || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const url = new URL(a.href,location.href);
        if (url.origin !== location.origin || !/\/index\.html$/.test(url.pathname) || url.searchParams.get('public') === '1') return;
        if (auth.isInternal(auth.state()) && (url.searchParams.has('kind') || url.searchParams.has('view'))) {
            event.preventDefault(); location.assign('work.html'+url.search+url.hash);
        }
    },true);
    window.addEventListener('authchange',refresh);
    window.addEventListener('pageshow',event => { if (event.persisted) refresh(); });
    refresh();
})();
