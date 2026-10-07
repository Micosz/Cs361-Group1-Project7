/* Visible filter chips mirror the existing selects. All filtering stays in script.js. */
(() => {
    'use strict';
    let dispose;

    function mount() {
        const controller = new AbortController();
        const cleanups = [];
        ['filterCollab', 'filterEvent'].forEach(id => {
            const select = document.getElementById(id);
            const wrapper = select?.closest('.filter-wrapper');
            if (!wrapper) return;

            const label = document.createElement('span');
            label.className = 'filter-caption';
            const icon = document.createElement('i');
            icon.className = 'fas fa-filter';
            icon.setAttribute('aria-hidden', 'true');
            label.append(icon, document.createTextNode('ตัวกรอง'));

            const group = document.createElement('div');
            group.className = 'filter-options';
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', select.getAttribute('aria-label') || 'ตัวกรอง');
            const buttons = Array.from(select.options, option => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'filter-chip';
                button.dataset.filterValue = option.value;
                button.textContent = option.textContent;
                button.disabled = option.disabled;
                group.append(button);
                return button;
            });
            const sync = () => buttons.forEach(button => {
                button.setAttribute('aria-pressed', String(button.dataset.filterValue === select.value));
            });
            select.addEventListener('change', sync, { signal: controller.signal });
            wrapper.addEventListener('click', event => {
                // The existing clear handler updates the select before this bubbles here.
                if (event.target.closest('.clear-filter-btn')) { sync(); return; }
                const chip = event.target.closest('.filter-chip');
                if (!chip || !group.contains(chip) || chip.disabled || chip.dataset.filterValue === select.value) return;
                select.value = chip.dataset.filterValue;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }, { signal: controller.signal });

            sync();
            select.before(label, group);
            // Progressive enhancement: the native control stays usable until chips are ready.
            wrapper.classList.add('has-filter-chips');
            cleanups.push(() => {
                wrapper.classList.remove('has-filter-chips');
                label.remove();
                group.remove();
            });
        });
        return () => { controller.abort(); cleanups.forEach(cleanup => cleanup()); };
    }

    const start = () => { dispose?.(); dispose = mount(); };
    // script.js registers its native clear controls first at DOMContentLoaded.
    if (document.readyState === 'complete') start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
    window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; });
    window.addEventListener('pageshow', event => { if (event.persisted) start(); });
})();
