/* Style the existing native category menus; filtering remains in script.js. */
(() => {
    'use strict';
    let dispose;
    function mount() {
        const cleanups = [];
        ['filterCollab', 'filterEvent'].forEach(id => {
            const select = document.getElementById(id);
            const wrapper = select?.closest('.filter-wrapper');
            if (!wrapper) return;
            const caption = document.createElement('span');
            caption.className = 'filter-caption';
            const icon = document.createElement('i');
            icon.className = 'fas fa-filter';
            icon.setAttribute('aria-hidden', 'true');
            caption.append(icon, document.createTextNode('ตัวกรอง'));
            select.before(caption);
            wrapper.classList.add('has-filter-controls');
            cleanups.push(() => { caption.remove(); wrapper.classList.remove('has-filter-controls'); });
        });
        return () => cleanups.forEach(cleanup => cleanup());
    }
    const start = () => { dispose?.(); dispose = mount(); };
    if (document.readyState === 'complete') start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
    window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; });
    window.addEventListener('pageshow', event => { if (event.persisted) start(); });
})();
