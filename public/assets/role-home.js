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
                if (session?.user && window.CstuWork.roles(session).includes('student') && !internal && !document.getElementById('student-home-link')) {
                    const shortcut = link('โครงการแลกเปลี่ยนของฉัน','index.html?kind=exchanges#board-section');
                    shortcut.id = 'student-home-link'; shortcut.className = 'hero-btn';
                    document.querySelector('.hero-content')?.append(shortcut);
                }
                return;
            }
            if (!internal) { location.replace(session?.user || document.body.dataset.signingOut === 'true' ? 'index.html' : 'login.html'); return; }
            const roles = window.CstuWork.roles(session);
            const nav = document.getElementById('work-nav');
            const selected = new URLSearchParams(location.search);
            const active = selected.get('view') || selected.get('kind') || 'home';
            const entries = [...destinations];
            if (roles.some(r => ['staff','executive'].includes(r))) entries.push(['ภาพรวมความร่วมมือ','work.html?view=overview#board-section','overview']);
            if (auth.managedScopes(session).length) entries.push(['จัดการสิทธิ์ผู้ใช้','work.html?view=roles#board-section','roles']);
            for (const [title,href,key] of entries) {
                const a = link(title,href); if (active === key) a.setAttribute('aria-current','page'); nav.append(a);
            }
            const name = session.user.accountType === 'demo' ? '' : (session.user.displayName || '').trim().split(/\s+/u)[0];
            document.getElementById('work-title').textContent = name ? `สวัสดี ${name} วันนี้เริ่มงานอะไรดี?` : 'วันนี้เริ่มจากงานไหนดี?';
            document.getElementById('work-role').textContent = [...new Set(roles.map(r => titles[r]).filter(Boolean))].join(' · ');
            const actions = document.getElementById('work-actions');
            if (active === 'home') {
                const board = link('กระดานข้อเสนอความร่วมมือ','work.html?view=proposals','ดูข้อเสนอและผู้สนใจ');
                board.id = 'proposal-shortcut';
                const icon = document.createElement('i'); icon.className = 'fas fa-thumbtack'; icon.setAttribute('aria-hidden','true'); board.prepend(icon);
                actions.append(board);
            }
            const icons = {partners:'building',activities:'calendar-plus',agreements:'file-signature',exchanges:'globe'};
            for (const [kind,config] of Object.entries(window.CstuWork.kinds)) {
                if (!window.CstuWork.canCreate(session,kind)) continue;
                const a = link(config.create,`work.html?kind=${kind}&action=create#board-section`,{partners:'บันทึกองค์กรและผู้ติดต่อ',activities:'เชื่อมกิจกรรมกับคู่ความร่วมมือ',agreements:'บันทึกข้อตกลงและระยะเวลา',exchanges:'จัดการโครงการและผู้เข้าร่วม'}[kind]);
                const icon = document.createElement('i'); icon.className = `fas fa-${icons[kind]}`; icon.setAttribute('aria-hidden','true'); a.prepend(icon); actions.append(a);
            }
            actions.append(link('อ่านผลตอบรับ','work.html?view=feedback#board-section','รวบรวม Comment และ Form Feedback'));
            document.body.classList.toggle('work-dashboard', !selected.has('kind') && !selected.has('view'));
            document.body.classList.toggle('work-proposals', active === 'proposals');
            document.body.classList.remove('work-checking');
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
