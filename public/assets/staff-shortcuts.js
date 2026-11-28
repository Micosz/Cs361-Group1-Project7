/* Links navigate normally. Only a forward shortcut activation supplies outgoing snapshots. */
(() => {
    let shortcut;
    const nav = document.getElementById('work-nav');

    nav.addEventListener('focusin', event => {
        const link = event.target.closest('a:focus-visible');
        if (link && document.body.matches('.staff-landing') && nav.scrollWidth > nav.clientWidth) {
            link.scrollIntoView({block:'nearest', inline:'center', behavior:'instant'});
        }
    });

    document.addEventListener('click', event => {
        shortcut = !event.defaultPrevented && event.button === 0 &&
            !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
            ? event.target.closest('.staff-landing #work-actions a') : null;
    });

    window.addEventListener('pageswap', event => {
        const transition = event.viewTransition;
        const link = shortcut;
        shortcut = null;
        if (!transition) return;
        if (!document.body.matches('.staff-landing:not(.work-checking)') || !link?.isConnected ||
            event.activation?.navigationType !== 'push' || event.activation.entry.url !== link.href ||
            matchMedia('(prefers-reduced-motion: reduce)').matches) {
            transition.skipTransition();
            return;
        }
        link.classList.add('shortcut-opening');
        transition.finished.finally(() => link.classList.remove('shortcut-opening'));
    });
})();
