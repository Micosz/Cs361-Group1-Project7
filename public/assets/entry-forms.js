/* Presentation only: keep the existing inputs, validation, handlers and API payloads. */
(() => {
    'use strict';
    const layouts = {
        'activity-form': {
            description: 'เริ่มจากข้อมูลกิจกรรม แล้วเลือกคู่ความร่วมมือและผู้รับผิดชอบที่เกี่ยวข้อง',
            groups: [
                ['ข้อมูลกิจกรรม', ['activity-scope', 'activity-type', 'activity-title', 'activity-summary']],
                ['กำหนดการ', ['activity-period-date', 'activity-period-text']],
                ['รายละเอียดเพิ่มเติม', ['activity-full-description', 'activity-image-path']]
            ]
        },
        'exchange-form': {
            description: 'ระบุโครงการและช่วงเวลา แล้วเลือกคู่ความร่วมมือและนักศึกษาผู้เข้าร่วม',
            groups: [
                ['ข้อมูลโครงการ', ['exchange-scope', 'exchange-title']],
                ['ช่วงเวลาโครงการ', ['exchange-start-date', 'exchange-end-date']],
                ['ข้อมูลประกอบ', ['exchange-supporting-info', 'exchange-supporting-info-participant']]
            ]
        },
        'agreement-edit-form': {
            description: 'ระบุข้อตกลง คู่ความร่วมมือ และระยะเวลาที่มีผลบังคับใช้',
            groups: [
                ['ข้อมูลข้อตกลง', ['agreement-form-scope', 'agreement-form-type', 'agreement-form-title']],
                ['ระยะเวลาและการต่ออายุ', ['agreement-form-start-date', 'agreement-form-end-date', 'agreement-form-renewal-due']],
                ['บันทึกเพิ่มเติม', ['agreement-form-renewal-note', 'agreement-form-internal-note']]
            ]
        },
        'partner-entry-form': {
            description: 'เพิ่มองค์กรหรือหน่วยงานในเครือข่ายความร่วมมือของหลักสูตร',
            groups: [
                ['ข้อมูลคู่ความร่วมมือ', ['basic-partners-scope', 'basic-partners-name', 'basic-partners-type', 'basic-partners-location', 'basic-partners-summary']],
                ['ช่องทางและรายละเอียดเพิ่มเติม', ['basic-partners-websiteUrl', 'basic-partners-logoPath', 'basic-partners-fullDescription']],
                ['การเผยแพร่', ['basic-partners-publication']]
            ]
        }
    };
    const labels = {
        'activity-scope': 'หลักสูตร / ขอบเขต', 'activity-summary': 'สรุปกิจกรรม',
        'activity-full-description': 'รายละเอียดกิจกรรม', 'activity-period-date': 'วันที่จัดกิจกรรม',
        'activity-period-text': 'ช่วงเวลาที่แสดงบนหน้าเว็บ', 'activity-image-path': 'ที่อยู่รูปภาพ',
        'activity-publication': 'การเผยแพร่', 'exchange-scope': 'หลักสูตร / ขอบเขต',
        'exchange-start-date': 'วันที่เริ่มต้น', 'exchange-end-date': 'วันที่สิ้นสุด',
        'exchange-supporting-info': 'บันทึกภายในสำหรับผู้ดูแลงาน',
        'exchange-supporting-info-participant': 'ข้อมูลสำหรับนักศึกษาผู้เข้าร่วม',
        'agreement-form-scope': 'หลักสูตร / ขอบเขต', 'basic-partners-scope': 'หลักสูตร / ขอบเขต'
    };
    const hints = {
        'activity-period-text': 'เช่น 09.00–16.00 น. หรือ ภาคเรียนที่ 1/2569',
        'activity-image-path': 'ใช้ที่อยู่รูปภาพที่มีในระบบ เช่น resources/event.jpg',
        'exchange-supporting-info': 'สำหรับทีมผู้รับผิดชอบ นักศึกษาจะไม่เห็นข้อความส่วนนี้',
        'exchange-supporting-info-participant': 'เช่น กำหนดการ สิ่งที่ต้องเตรียม และช่องทางติดต่อ',
        'basic-partners-websiteUrl': 'เช่น https://www.example.org',
        'basic-partners-logoPath': 'ที่อยู่ภาพในระบบ เช่น resources/partner-logo.png'
    };
    let choiceId = 0;

    function fieldNode(input, form) {
        let node = input.closest('p') || input.closest('label') || input.parentElement;
        // A date pair may already have a grid wrapper: move each field, not that wrapper.
        return node && form.contains(node) ? node : null;
    }

    function enhance(form, layout) {
        if (form.dataset.entryReady) return;
        form.dataset.entryReady = 'true';
        form.classList.add('entry-form');
        form.closest('dialog')?.classList.add('entry-dialog');
        const intro = document.createElement('div'); intro.className = 'entry-intro';
        const description = document.createElement('p'); description.textContent = layout.description;
        const required = document.createElement('small'); required.textContent = 'ช่องที่มี * จำเป็นต้องกรอก';
        intro.append(description, required);
        const title = form.querySelector('h2');
        if (title) { const header = document.createElement('header'); header.className = 'entry-heading'; header.append(title, intro); form.prepend(header); }
        else form.prepend(intro);
        for (const [titleText, ids] of layout.groups) {
            const section = document.createElement('fieldset'); section.className = 'entry-section';
            const legend = document.createElement('legend'); legend.textContent = titleText; section.append(legend);
            for (const id of ids) {
                const input = form.querySelector('#' + id); if (!input) continue;
                const node = fieldNode(input, form); if (!node) continue;
                node.classList.add('entry-field');
                if (input.tagName === 'TEXTAREA' || id.endsWith('-title') || id.endsWith('-name')) node.classList.add('entry-wide');
                const label = input.closest('label') || form.querySelector(`label[for="${id}"]`);
                if (label && labels[id]) {
                    const text = [...label.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
                    if (text) text.textContent = labels[id] + ' ';
                }
                if (input.required && label && !label.textContent.includes('*')) {
                    const mark = document.createElement('span'); mark.className = 'entry-required'; mark.textContent = ' *'; label.insertBefore(mark, input.parentElement === label ? input : null);
                }
                if (hints[id]) {
                    const hint = document.createElement('small'); hint.className = 'entry-hint'; hint.id = id + '-hint'; hint.textContent = hints[id];
                    input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), hint.id].filter(Boolean).join(' ')); node.append(hint);
                }
                section.append(node);
            }
            if (section.children.length > 1) form.insertBefore(section, form.querySelector('button[type="submit"]')?.closest('div')?.parentElement === form ? form.querySelector('button[type="submit"]').closest('div') : null);
        }
        for (const related of form.querySelectorAll('#activity-link-picker, #staff-activity-fields, [data-selection-fields]')) form.append(related);
        for (const input of form.querySelectorAll('input[type="date"]')) input.setAttribute('aria-label', labels[input.id] || input.labels?.[0]?.textContent.trim() || 'วันที่');
        const submit = form.querySelector('button[type="submit"]');
        if (submit) {
            let footer = submit.parentElement;
            if (footer === form) { footer = document.createElement('div'); form.append(footer); footer.append(submit); }
            footer.classList.add('entry-actions');
            const status = form.querySelector('[role="status"], .agreement-form-status');
            if (status) { status.classList.add('entry-status'); footer.prepend(status); }
            if (!footer.querySelector('button[type="button"]')) {
                const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'ยกเลิก';
                cancel.onclick = () => form.closest('dialog')?.close(); footer.append(cancel);
            }
            form.append(footer);
        }
    }

    function checkboxChoices(select) {
        if (select.dataset.entryChoices) return;
        select.dataset.entryChoices = 'true';
        select.id ||= 'entry-choice-' + (++choiceId);
        const host = document.createElement('div'); host.className = 'entry-choices';
        const search = document.createElement('input'); search.type = 'search'; search.id = select.id + '-search';
        search.placeholder = 'ค้นหารายชื่อ…'; search.setAttribute('aria-label', 'ค้นหาในรายการตัวเลือก');
        const counter = document.createElement('small'); counter.className = 'entry-choice-count'; counter.setAttribute('aria-live', 'polite');
        const list = document.createElement('div'); list.className = 'entry-choice-list';
        const error = document.createElement('p'); error.className = 'entry-choice-error'; error.setAttribute('role', 'status');
        host.append(search, counter, list, error);
        const wrappingLabel = select.closest('label');
        const title = wrappingLabel || select.form?.querySelector(`label[for="${select.id}"]`);
        if (select.required && title && !title.textContent.includes('*')) { const mark = document.createElement('span'); mark.className = 'entry-required'; mark.textContent = ' *'; title.insertBefore(mark, wrappingLabel ? select : null); }
        if (wrappingLabel) { wrappingLabel.after(select); wrappingLabel.htmlFor = search.id; }
        else { const label = select.form?.querySelector(`label[for="${select.id}"]`); if (label) label.htmlFor = search.id; }
        select.after(host); select.classList.add('entry-native-choices'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
        function render() {
            list.replaceChildren(); search.disabled = select.disabled;
            const options = [...select.options];
            counter.textContent = `เลือกแล้ว ${options.filter(o => o.selected && o.value).length} รายการ`;
            for (const option of options.filter(o => o.value)) {
                const row = document.createElement('label'), check = document.createElement('input'), text = document.createElement('span');
                row.className = 'entry-choice'; check.type = 'checkbox'; check.dataset.value = option.value; check.checked = option.selected; check.disabled = select.disabled || option.disabled;
                text.textContent = option.textContent; row.hidden = !option.textContent.toLocaleLowerCase().includes(search.value.toLocaleLowerCase());
                check.onchange = () => { option.selected = check.checked; error.textContent = ''; select.dispatchEvent(new Event('change', {bubbles:true})); };
                row.append(check, text); list.append(row);
            }
            if (options.some(o => o.value) && ![...list.children].some(row => !row.hidden)) { const empty = document.createElement('p'); empty.className = 'entry-hint'; empty.textContent = 'ไม่พบรายการที่ตรงกับคำค้นหา'; list.append(empty); }
            if (!options.some(o => o.value)) { const empty = document.createElement('p'); empty.className = 'entry-hint'; empty.textContent = select.disabled ? 'กำลังโหลดรายชื่อ…' : 'ไม่มีรายการให้เลือกในขอบเขตนี้'; list.append(empty); }
        }
        search.oninput = render;
        select.addEventListener('change', () => {
            const options = [...select.options];
            counter.textContent = `เลือกแล้ว ${options.filter(o => o.selected && o.value).length} รายการ`;
            for (const check of list.querySelectorAll('input[type=checkbox]')) check.checked = options.some(o => o.value === check.dataset.value && o.selected);
        });
        select.addEventListener('invalid', event => { event.preventDefault(); error.textContent = 'กรุณาเลือกอย่างน้อย 1 รายการ'; search.focus(); });
        new MutationObserver(render).observe(select, {childList:true, subtree:true, attributes:true, attributeFilter:['disabled','selected']});
        render();
    }

    function scan() {
        for (const [id, layout] of Object.entries(layouts)) { const form = document.getElementById(id); if (form) enhance(form, layout); }
        for (const select of document.querySelectorAll('.entry-form select[multiple]')) checkboxChoices(select);
        for (const hint of document.querySelectorAll('.entry-form [data-selection-fields] > p, .entry-form #activity-link-picker > p')) {
            if (/Ctrl\/Command/.test(hint.textContent)) hint.textContent = 'ค้นหาและติ๊กเลือกรายการได้หลายรายการ';
        }
    }
    scan();
    new MutationObserver(records => {
        if (records.some(r => [...r.addedNodes].some(n => n.nodeType === Node.ELEMENT_NODE && !n.closest?.('.entry-choices')))) scan();
    }).observe(document.body, {subtree:true, childList:true});
})();
