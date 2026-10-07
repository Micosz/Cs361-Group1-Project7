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
            const date = document.getElementById(`${id}Date`);
            const clear = document.getElementById(`${id}DateClear`);
            if (!date) return;
            const shell = document.createElement('div');
            shell.className = 'buddhist-date-control';
            const text = document.createElement('input');
            text.type = 'text';
            text.id = `${id}DateDisplay`;
            text.inputMode = 'numeric';
            text.placeholder = 'วัน/เดือน/พ.ศ.';
            text.autocomplete = 'off';
            text.name = `${id}BuddhistDate`;
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
                if (clear) { clear.hidden = !date.value; clear.disabled = !date.value; }
            };
            listen(date, 'change', sync);
            if (clear) listen(clear, 'click', sync);
            listen(text, 'input', () => text.setCustomValidity(''));
            listen(text, 'change', () => {
                const value = text.value.trim().replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 3664));
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
