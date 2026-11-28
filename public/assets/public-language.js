/* Localize interface copy only. Record content and form values belong to their authors. */
(() => {
    'use strict';
    if (document.body.classList.contains('work-home') || window.parent !== window) return;
    const messages = window.CstuPublicEnglish;
    if (!messages) return;
    const homeTemplate = document.getElementById('home-language-template');
    const homeSwitch = homeTemplate?.content.firstElementChild;
    const storageKey = 'cstuhub.public-language';
    const originalText = new WeakMap();
    const attributes = new WeakMap();
    const controls = ['aria-label', 'title', 'placeholder'];
    let preferred = 'th';
    function readPreference() {
        try { preferred = localStorage.getItem(storageKey) === 'en' ? 'en' : 'th'; }
        catch { /* Use the in-memory choice when storage is unavailable. */ }
    }
    readPreference();
    const params = new URLSearchParams(location.search);
    const publicKinds = ['partners', 'activities', 'agreements'];
    let publicView = !params.has('view') && !params.has('action')
        && (!params.has('kind') || publicKinds.includes(params.get('kind')));
    const language = () => publicView ? preferred : 'th';
    const equivalent = th => Object.hasOwn(messages, th) ? messages[th] : undefined;
    const translate = (th, en = equivalent(th)) => language() === 'en' ? (en ?? th) : th;

    function paintText(node, pair) {
        const value = translate(pair.th, pair.en);
        if (node.data !== value) node.data = value;
    }
    function captureText(node, english) {
        if (!node || node.nodeType !== Node.TEXT_NODE || originalText.has(node)) return;
        const th = node.data;
        const en = english ?? (Object.hasOwn(messages, th.trim())
            ? th.replace(th.trim(), () => messages[th.trim()]) : undefined);
        if (en === undefined || th === en) return;
        const pair = { th, en };
        originalText.set(node, pair);
        node.parentElement.dataset.uiBound = '';
        paintText(node, pair);
    }
    function attr(el, name, th, en = equivalent(th)) {
        if (!el || en === undefined) return;
        if (!attributes.has(el)) attributes.set(el, new Map());
        attributes.get(el).set(name, { th, en });
        el.dataset.uiBound = '';
        const value = translate(th, en);
        if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }
    function capture(el) {
        if (!el) return;
        for (const child of el.childNodes) captureText(child);
        for (const name of controls) {
            const value = el.getAttribute(name);
            if (value && Object.hasOwn(messages, value) && !attributes.get(el)?.has(name)) attr(el, name, value);
        }
    }
    // Only call on controls/statuses whose direct text is written by the UI.
    // Replacing a translated Text node naturally drops its old binding.
    const observer = new MutationObserver(records => {
        for (const target of new Set(records.map(record => record.target))) capture(target);
    });
    function live(...elements) {
        for (const el of elements) if (el) {
            capture(el);
            observer.observe(el, { childList: true });
        }
    }
    function pair(el, english) {
        if (el?.firstChild) captureText(el.firstChild, english);
    }
    function updateHomeSwitch() {
        if (!homeSwitch) return;
        homeSwitch.hidden = !publicView;
        for (const button of homeSwitch.querySelectorAll('button')) {
            button.setAttribute('aria-pressed', String(button.dataset.language === language()));
        }
    }
    function refresh() {
        document.documentElement.lang = language();
        for (const el of document.querySelectorAll('[data-ui-bound]')) {
            for (const child of el.childNodes) {
                const copy = originalText.get(child);
                if (copy) paintText(child, copy);
            }
            for (const [name, copy] of attributes.get(el) || []) attr(el, name, copy.th, copy.en);
        }
        updateHomeSwitch();
        window.dispatchEvent(new Event('cstu:language'));
    }
    function setPublic(value) {
        if (publicView === value) return;
        publicView = value;
        refresh();
    }
    window.CstuLanguage = { language, translate, capture, pair, attr, live, setPublic };
    // Deferred before app renderers. Bind only the server-supplied UI nodes,
    // never traverse a rendered catalogue, a document or submitted comments.
    for (const el of document.querySelectorAll('[data-ui]')) capture(el);
    if (homeSwitch) {
        attr(homeSwitch, 'aria-label', 'ภาษาเว็บไซต์', 'Website language');
        for (const button of homeSwitch.querySelectorAll('button')) {
            button.addEventListener('click', () => {
                if (!publicView) return;
                preferred = button.dataset.language;
                try { localStorage.setItem(storageKey, preferred); } catch { /* Keep this page usable. */ }
                refresh();
            });
        }
        updateHomeSwitch();
        homeTemplate.replaceWith(homeSwitch);
    }
    document.documentElement.lang = language();
    window.addEventListener('pageshow', event => {
        if (event.persisted) { readPreference(); refresh(); }
    });
})();