/* Style the existing native category menus; filtering remains in script.js. */
(() => {
    'use strict';
    let dispose;
    function mount() {
        const cleanups = [];
        const controller = new AbortController();
        const listen = (el, event, fn) => el.addEventListener(event, fn, { signal: controller.signal });
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

            // A Buddhist-year display adapter; the existing ISO date remains the filter value.
            const clear = document.getElementById(`${id}DateClear`);
            ['Date', 'DateEnd'].forEach(suffix => {
                const date = document.getElementById(`${id}${suffix}`);
                if (!date) return;
                const label = document.getElementById(`${id}${suffix}Label`);
                const shell = document.createElement('div');
                shell.className = 'buddhist-date-control';
                const text = document.createElement('input');
                text.type = 'text';
                text.id = `${id}${suffix}Display`;
                if (label) label.setAttribute('for', text.id);
                text.inputMode = 'numeric';
                text.placeholder = 'วัน/เดือน/พ.ศ.';
                text.autocomplete = 'off';
                text.name = `${id}${suffix}Buddhist`;
                text.spellcheck = false;
                text.setAttribute('aria-label', `${date.getAttribute('aria-label')} วัน/เดือน/ปี พ.ศ.`);
                const picker = document.createElement('button');
                picker.type = 'button';
                picker.className = 'date-picker-btn';
                picker.setAttribute('aria-label', 'เลือกวันที่จากปฏิทิน');
                picker.title = 'เลือกวันที่จากปฏิทิน';
                picker.innerHTML = '<i class="far fa-calendar-alt" aria-hidden="true"></i>';
                date.before(shell);
                shell.append(text, picker, date);
                date.classList.add('native-date-source');
                date.tabIndex = -1;
                date.setAttribute('aria-hidden', 'true');
                const sync = () => {
                    const parts = date.value.split('-');
                    text.value = date.value ? `${parts[2]}/${parts[1]}/${Number(parts[0]) + 543}` : '';
                    text.setCustomValidity('');
                    if (clear) {
                        const active = ['Date', 'DateEnd'].some(key => document.getElementById(`${id}${key}`)?.value);
                        clear.hidden = !active; clear.disabled = !active;
                    }
                };
                listen(date, 'change', sync);
                if (clear) listen(clear, 'click', sync);
                const normalizeDateText = value => {
                    const normalized = value.trim().replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 3664));
                    return /^\d{8}$/.test(normalized)
                        ? `${normalized.slice(0, 2)}/${normalized.slice(2, 4)}/${normalized.slice(4)}`
                        : normalized;
                };
                listen(text, 'input', () => {
                    text.setCustomValidity('');
                    // Format a complete compact date without disturbing partial edits or the caret.
                    if (/^[0-9๐-๙]{8}$/.test(text.value)) text.value = normalizeDateText(text.value);
                });
                listen(text, 'change', () => {
                    const value = normalizeDateText(text.value);
                    const match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(value);
                    let iso = '';
                    if (value && match) {
                        const year = Number(match[3]) - 543;
                        const month = Number(match[2]);
                        const day = Number(match[1]);
                        const check = new Date(Date.UTC(year, month - 1, day));
                        if (year >= 100 && year <= 9999 && check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day)
                            iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    }
                    if (value && !iso) {
                        text.setCustomValidity('กรอกวันที่จริงในรูปแบบ วัน/เดือน/ปี พ.ศ. เช่น 17/08/2563');
                        text.reportValidity();
                        return;
                    }
                    date.value = iso;
                    date.dispatchEvent(new Event('change', { bubbles: true }));
                    sync();
                });
                listen(picker, 'click', () => {
                    if (typeof date.showPicker === 'function') {
                        try { date.showPicker(); } catch { text.focus(); }
                    } else { text.focus(); }
                });
                sync();
                cleanups.push(() => {
                    shell.before(date);
                    shell.remove();
                    date.classList.remove('native-date-source');
                    date.removeAttribute('tabindex');
                    date.removeAttribute('aria-hidden');
                    if (label) label.setAttribute('for', date.id);
                });
            });
        });
        return () => { controller.abort(); cleanups.forEach(cleanup => cleanup()); };
    }
    const start = () => { dispose?.(); dispose = mount(); };
    if (document.readyState === 'complete') start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
    window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; });
    window.addEventListener('pageshow', event => { if (event.persisted) start(); });
})();
