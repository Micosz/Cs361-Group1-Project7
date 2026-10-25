/* Role navigation consumes server Session; visibility never grants API access. */
(() => {
    'use strict';
    const host = document.getElementById('authNavButtons');
    const dialog = document.getElementById('role-menu');
    if (!host || !dialog) return;
    const links = document.getElementById('role-menu-links');
    const status = document.getElementById('role-menu-status');
    const logout = document.getElementById('role-menu-logout');
    const accountDetails = document.getElementById('role-menu-account');
    const roleNames = {student:'Student', coordinator:'Coordinator', staff:'Staff', executive:'Executive'};
    const managedScopes = session => window.CstuAuth?.managedScopes
        ? window.CstuAuth.managedScopes(session)
        : [...new Set([
            ...(session?.capabilities || []).filter(c => c.active !== false && c.name === 'manageRoles').map(c => c.scopeId),
            ...(session?.grants || []).filter(g => g.active !== false && g.role === 'executive').map(g => g.scopeId)
        ].filter(Boolean))];
    const firstName = value => typeof value === 'string' ? value.trim().split(/\s+/u)[0] || '' : '';
    function showAccount(session) {
        if (!accountDetails) return;
        accountDetails.replaceChildren(); accountDetails.hidden = !session?.user;
        if (!session?.user) { host.querySelector('.account-summary')?.remove(); return; }
        const grants = (session.grants || []).filter(g => g.active !== false);
        const roles = [...new Set(grants.map(g => roleNames[g.role] || g.role))];
        const isDemo = session.user.accountType === 'demo';
        const name = isDemo ? (roles.join(' · ') || 'บัญชีทดสอบ')
            : session.user.accountType === 'tu' ? (firstName(session.user.displayName) || 'บัญชีที่เข้าสู่ระบบ')
                : 'บัญชีที่เข้าสู่ระบบ';
        let summary = host.querySelector('.account-summary');
        if (!summary) { summary = document.createElement('div'); summary.className = 'account-summary'; host.prepend(summary); }
        summary.replaceChildren();
        const shortName = document.createElement('span'); shortName.className = 'account-summary-name'; shortName.textContent = name; shortName.title = name;
        const shortRoles = document.createElement('span'); shortRoles.className = 'account-summary-roles';
        shortRoles.textContent = isDemo ? 'บัญชีทดลอง' : roles.join(' · ') || 'ยังไม่มีบทบาท';
        summary.append(shortName, shortRoles);
        const fullName = document.createElement('strong'); fullName.className = 'account-details-name'; fullName.textContent = name;
        const permissions = document.createElement('div'); permissions.className = 'account-details-grants';
        const entries = grants.map(g => (roleNames[g.role] || g.role) + ' · ' + g.scopeId);
        for (const scopeId of managedScopes(session)) entries.push('จัดการสิทธิ์ · ' + scopeId);
        for (const text of [...new Set(entries.length ? entries : ['ยังไม่ได้รับบทบาทงาน'])]) { const badge = document.createElement('span'); badge.textContent = text; permissions.append(badge); }
        accountDetails.append(fullName, permissions);
    }
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
        if (!window.CstuAuth?.enabled()) { showAccount(null); finishClose(); return; }
        try {
            const session = await window.CstuAuth.refresh();
            if (current !== revision) return;
            if (!session?.user) {
                showAccount(null); finishClose();
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
            showAccount(session);
            links.replaceChildren(); status.textContent = '';
            const append = (label, href, description) => {
                const link = document.createElement('a'); link.href = href;
                const title = document.createElement('span'); title.textContent = label;
                const small = document.createElement('small'); small.textContent = description;
                link.append(title, small); links.append(link);
            };
            const roles = window.CstuAuth.roles(session);
            for (const item of window.CstuWork.menu(session)) append(item.label, item.href, item.description);
            if (managedScopes(session).length) append('จัดการสิทธิ์ผู้ใช้', 'index.html?view=roles#board-section', 'มอบหมายและถอนบทบาทในขอบเขตที่ดูแล');
            if (!roles.length) append('รอมอบหมายสิทธิ์', 'index.html#board-section', 'บัญชีของคุณยังไม่ได้รับบทบาทงานภายใน');
        } catch {
            if (current !== revision) return;
            showAccount(null); finishClose();
            const retry = document.createElement('button'); retry.type = 'button';
            retry.className = 'login-btn'; retry.textContent = 'ลองใหม่';
            retry.setAttribute('aria-label', 'ตรวจสถานะเข้าสู่ระบบอีกครั้ง'); retry.onclick = refresh;
            host.replaceChildren(retry);
        }
    }
    closeButton.onclick = close;
    dialog.addEventListener('click', event => {
        if (!event.target.closest('a, button, .account-details')) close(event);
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close({detail: 0}); });
    dialog.addEventListener('close', () => { restoreScroll(); dialog.classList.remove('is-open'); host.querySelector('button')?.setAttribute('aria-expanded','false'); });
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
