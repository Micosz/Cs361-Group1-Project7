/* Presentation only: reuse existing record nodes, forms and server permissions. */
(() => {
    'use strict';
    const states = new Map();
    const node = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text) element.textContent = text;
        return element;
    };
    function create(root, prefix, title, close, content, identity = []) {
        const sidebar = node('aside', 'detail-identity');
        sidebar.append(...identity, title);
        const main = node('div', 'detail-main');
        const bar = node('div', 'detail-toolbar');
        const tabs = node('div', 'detail-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'ส่วนของรายละเอียด');
        const details = node('section', 'detail-panel detail-reading');
        const comments = node('section', 'detail-panel detail-comments');
        const forms = node('section', 'detail-panel detail-forms');
        const panels = [details, comments, forms];
        const buttons = ['รายละเอียด', 'ความคิดเห็น', 'ผลตอบรับจากแบบฟอร์ม'].map((label, index) => {
            const button = node('button', 'detail-tab', label); button.type = 'button';
            button.id = prefix + '-tab-' + index;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-controls', prefix + '-panel-' + index);
            panels[index].id = prefix + '-panel-' + index;
            panels[index].setAttribute('role', 'tabpanel');
            panels[index].setAttribute('aria-labelledby', button.id);
            panels[index].tabIndex = 0;
            tabs.append(button); return button;
        });
        function select(index, focus = false) {
            if (buttons[index].hidden) return;
            buttons.forEach((button, i) => {
                button.setAttribute('aria-selected', String(i === index)); button.tabIndex = i === index ? 0 : -1;
                panels[i].hidden = i !== index;
            });
            if (focus) buttons[index].focus();
        }
        buttons.forEach((button, index) => {
            button.onclick = () => select(index);
            button.onkeydown = event => {
                if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
                event.preventDefault();
                const available = buttons.map((button, i) => button.hidden ? -1 : i).filter(i => i >= 0);
                const position = available.indexOf(index), length = available.length;
                const next = event.key === 'Home' ? available[0] : event.key === 'End' ? available[length - 1]
                    : available[(position + (event.key === 'ArrowRight' ? 1 : -1) + length) % length];
                select(next, true);
            };
        });
        buttons[1].hidden = buttons[2].hidden = true;
        details.append(...content); bar.append(tabs, close); main.append(bar, ...panels);
        root.append(sidebar, main); root.classList.add('detail-sheet');
        select(0);
        const state = {root, sidebar, details, comments, forms, buttons, select, title, close};
        states.set(root, state); return state;
    }
    const legacy = document.querySelector('#detailModal .modal-content');
    let legacyState, returnFocus;
    if (legacy) {
        const image = document.getElementById('modalImage');
        const title = document.getElementById('modalTitle');
        const meta = legacy.querySelector('.user-info');
        const heading = node('h2', 'detail-section-title', 'เกี่ยวกับองค์กร');
        legacyState = create(legacy, 'partner-detail', title, legacy.querySelector('.close-btn'), [heading, document.getElementById('modalDetails')], [image]);
        legacyState.sidebar.append(meta);
        legacy.setAttribute('role', 'dialog'); legacy.setAttribute('aria-modal', 'true'); legacy.setAttribute('aria-labelledby', 'modalTitle');
        legacy.tabIndex = -1;
        legacy.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); window.closeModal(); }
            if (event.key !== 'Tab') return;
            const focusable = [...legacy.querySelectorAll('a[href],button,input,textarea,select,[tabindex]')]
                .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
            const first = focusable[0], last = focusable.at(-1);
            if (event.shiftKey && (document.activeElement === first || document.activeElement === legacy)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        });
    }
    const dialog = document.getElementById('record-detail');
    let recordState;
    function resetRecord() {
        if (!recordState) return;
        recordState.observer?.disconnect();
        const preserved = ['detail-close','detail-title','detail-status','detail-fields','detail-actions'].map(id => document.getElementById(id));
        dialog.append(...preserved);
        recordState.sidebar.remove(); dialog.querySelector('.detail-main')?.remove();
        dialog.classList.remove('detail-sheet');
        dialog.querySelectorAll('.detail-image-in-sidebar').forEach(el => el.classList.remove('detail-image-in-sidebar'));
        states.delete(dialog); recordState = null;
    }
    function record(data, kind) {
        resetRecord();
        const title = document.getElementById('detail-title');
        const source = dialog.querySelector('.record-detail-image');
        const identity = [];
        if (source) {
            const well = node('div', 'detail-record-logo');
            const img = source.cloneNode(true); img.className = ''; well.append(img); identity.push(well);
            source.classList.add('detail-image-in-sidebar');
        }
        recordState = create(dialog, 'record-detail-view', title, document.getElementById('detail-close'),
            ['detail-status','detail-fields','detail-actions'].map(id => document.getElementById(id)), identity);
        const meta = node('p', 'detail-record-meta', [data.location, window.CstuWork?.kinds[kind]?.label].filter(Boolean).join(' · '));
        recordState.sidebar.append(meta);
    }
    function feedback(container) {
        if (!recordState || !container.classList.contains('feedback-section')) return;
        recordState.comments.append(container); recordState.buttons[1].hidden = false;
        const state = recordState;
        const update = () => {
            const count = container.querySelector('ol')?.children.length || 0;
            state.buttons[1].textContent = 'ความคิดเห็น' + (count ? ' (' + count + ')' : '');
        };
        state.observer?.disconnect(); state.observer = new MutationObserver(update);
        state.observer.observe(container, {childList:true, subtree:true}); update();
    }
    dialog?.addEventListener('close', resetRecord);
    window.CstuDetailSheet = {
        record, resetRecord, feedback,
        forms(container, isPartner = false) {
            const state = isPartner ? legacyState : recordState;
            if (!state || !container.classList.contains('form-feedback')) return;
            state.forms.replaceChildren(container); state.buttons[2].hidden = false;
        },
        open() {
            if (!legacyState) return;
            returnFocus = document.activeElement;
            legacyState.forms.replaceChildren(); legacyState.buttons[2].hidden = true;
            legacyState.sidebar.querySelector('.detail-short-name')?.remove();
            const name = legacyState.title.textContent;
            const acronym = name.match(/\(([A-Z][A-Z0-9&.-]{1,14})\)\s*$/)?.[1];
            legacyState.title.classList.toggle('detail-full-name', Boolean(acronym));
            if (acronym) legacyState.title.before(node('p', 'detail-short-name', acronym));
            const image = document.getElementById('modalImage');
            image.setAttribute('role', 'img'); image.setAttribute('aria-label', 'โลโก้ ' + name);
            legacyState.select(0); legacyState.details.scrollTop = 0;
            legacyState.sidebar.scrollTop = 0;
            legacy.focus({preventScroll:true});
        },
        close() {
            if (returnFocus?.isConnected && legacy.contains(document.activeElement)) returnFocus.focus({preventScroll:true});
            returnFocus = null;
        }
    };
})();
