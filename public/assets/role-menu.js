/* Role navigation consumes server Session; visibility never grants API access. */
(() => {
    'use strict';
    const host = document.getElementById('authNavButtons');
    const dialog = document.getElementById('role-menu');
    if (!host || !dialog) return;
    const links = document.getElementById('role-menu-links');
    const status = document.getElementById('role-menu-status');
    const logout = document.getElementById('role-menu-logout');
    const closeButton = document.getElementById('close-role-menu');
    let revision = 0, closing = null, locked = false, previousOverflow = '';
    const lockScroll = () => {
        if (locked) return;
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden'; locked = true;
    };
    const restoreScroll = () => {
        if (!locked) return;
        document.body.style.overflow = previousOverflow; locked = false;
    };
    function finishClose() {
        clearTimeout(closing); closing = null;
        dialog.classList.remove('is-open');
        if (dialog.open) dialog.close();
        restoreScroll();
        host.querySelector('button')?.setAttribute('aria-expanded', 'false');
    }
    function close(event) {
        if (!dialog.open) return;
        dialog.classList.toggle('instant', event?.detail === 0);
        dialog.classList.remove('is-open');
        clearTimeout(closing);
        closing = setTimeout(finishClose, event?.detail === 0 || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500);
    }
    async function refresh() {
        const current = ++revision;
        if (!window.CstuAuth?.enabled()) { finishClose(); return; }
        try {
            const session = await window.CstuAuth.refresh();
            if (current !== revision) return;
            if (!session?.user) {
                finishClose();
                const login = document.createElement('a');
                login.href = 'login.html'; login.className = 'login-btn'; login.textContent = 'Log in';
                host.replaceChildren(login); return;
            }
            let trigger = host.querySelector('button');
            if (!trigger) {
                trigger = document.createElement('button');
                trigger.type = 'button'; trigger.className = 'login-btn role-menu-trigger';
                trigger.textContent = 'Menu'; trigger.setAttribute('aria-haspopup', 'dialog');
                trigger.setAttribute('aria-controls', 'role-menu'); trigger.setAttribute('aria-expanded', 'false');
                trigger.onclick = async event => {
                    // Re-check role/session whenever opening; do not trust a stale menu.
                    await refresh();
                    if (!host.contains(trigger) || status.textContent) return;
                    clearTimeout(closing); closing = null;
                    dialog.classList.toggle('instant', event.detail === 0);
                    dialog.showModal(); lockScroll();
                    dialog.getBoundingClientRect();
                    dialog.classList.add('is-open'); trigger.setAttribute('aria-expanded', 'true');
                };
                host.replaceChildren(trigger);
            }
            links.replaceChildren(); status.textContent = '';
            const append = (label, href, description) => {
                const link = document.createElement('a'); link.href = href;
                const title = document.createElement('span'); title.textContent = label;
                const small = document.createElement('small'); small.textContent = description;
                link.append(title, small); links.append(link);
            };
            const roles = window.CstuAuth.roles(session);
            const labels = {
                student: ['นักศึกษา / ผู้เข้าร่วมโครงการ', 'การสมัครและข้อมูลการแลกเปลี่ยนของตนเอง'],
                coordinator: ['อาจารย์ / ผู้ประสานงาน', 'ข้อมูลความร่วมมือและงานในความรับผิดชอบ'],
                staff: ['เจ้าหน้าที่หลักสูตร', 'ข้อมูล เอกสาร และสถานะกระบวนการ'],
                executive: ['ผู้บริหาร / ผู้ดูแลระบบ', 'ภาพรวมความร่วมมือและ Stakeholder']
            };
            for (const role of roles) if (labels[role]) append(labels[role][0], 'workspace.html?view=' + role, labels[role][1]);
            if (session.capabilities.some(c => c.name === 'manageRoles')) append('จัดการสิทธิ์ผู้ใช้', 'workspace.html?view=roles', 'มอบหมายและถอนบทบาทในขอบเขตที่ดูแล');
            if (!roles.length) append('รอมอบหมายสิทธิ์', 'workspace.html', 'บัญชีของคุณยังไม่ได้รับบทบาทงานภายใน');
        } catch {
            if (current !== revision) return;
            finishClose();
            const retry = document.createElement('button'); retry.type = 'button';
            retry.className = 'login-btn'; retry.textContent = 'ลองใหม่';
            retry.setAttribute('aria-label', 'ตรวจสถานะเข้าสู่ระบบอีกครั้ง'); retry.onclick = refresh;
            host.replaceChildren(retry);
        }
    }
    closeButton.onclick = close;
    dialog.addEventListener('click', event => {
        if (!event.target.closest('a, button')) close(event);
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close({detail: 0}); });
    dialog.addEventListener('close', restoreScroll);
    logout.onclick = async () => {
        logout.disabled = true; status.textContent = '';
        try { await window.CstuAuth.logout(); finishClose(); await refresh(); }
        catch { status.textContent = 'ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง'; }
        finally { logout.disabled = false; }
    };
    window.addEventListener('authchange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('pagehide', finishClose);
    refresh();
})();
