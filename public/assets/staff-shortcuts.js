/* Links navigate normally. Only a forward shortcut activation supplies outgoing snapshots. */
(() => {
    let shortcut;
    document.addEventListener('focusin', event => {
        const nav = event.target.closest('#work-nav');
        const link = event.target.closest('a:focus-visible');
        if (nav && link && document.body.matches('.staff-landing') && nav.scrollWidth > nav.clientWidth) {
            link.scrollIntoView({block:'nearest', inline:'center', behavior:'instant'});
        }
    });

    document.addEventListener('click', event => {
        shortcut = !event.defaultPrevented && event.button === 0 &&
            !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
            ? event.target.closest('.staff-landing #work-actions a') : null;
    });

    function destinationSelector(url) {
        const params = new URL(url).searchParams;
        if (params.get('view') === 'proposals') return '#proposal-board:has(#proposal-cards > *)';
        if (params.get('view') === 'feedback') return '#home-records:has(.feedback-inbox-tabs)';
        if (params.get('action') === 'create') return 'dialog[open]:is(.entry-dialog, .entry-frame-dialog)';
    }

    function readySurface(selector) {
        return new Promise(resolve => {
            // The native outgoing image fades independently. Watch briefly for the
            // real panel to mount and measure it before the browser paints it.
            const observer = new MutationObserver(find);
            const cancel = () => finish(null);
            const timeout = setTimeout(cancel,900);
            window.addEventListener('pagehide',cancel);
            function finish(surface) {
                clearTimeout(timeout);
                observer.disconnect();
                window.removeEventListener('pagehide',cancel);
                resolve(surface);
            }
            function find() {
                if (document.getElementById('work-gate-retry')?.hidden === false) { cancel(); return; }
                if (!document.body?.matches('.work-home:not(.work-checking)')) return;
                const element = document.querySelector(selector);
                const box = element?.getBoundingClientRect();
                if (box?.width && box.height) finish({element,box});
            }
            observer.observe(document.documentElement,{
                subtree:true, childList:true, attributes:true, attributeFilter:['open','hidden','class']
            });
            find();
        });
    }

    window.addEventListener('pagereveal', async event => {
        const transition = event.viewTransition;
        if (!transition) return;
        const selector = destinationSelector(window.navigation?.activation?.entry?.url || location.href);
        try { await transition.ready; } catch { return; }
        if (!selector) { transition.skipTransition(); return; }

        const root = document.documentElement;
        const capture = getComputedStyle(root,'::view-transition-group(desk-card)');
        const width = parseFloat(capture.width), height = parseFloat(capture.height);
        if (!width || !height || capture.transform === 'none') { transition.skipTransition(); return; }
        const origin = new DOMMatrixReadOnly(capture.transform);
        const surface = await readySurface(selector);
        if (!surface || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
            transition.skipTransition();
            return;
        }
        const {element,box} = surface;
        // Move the real dialog or section. Its border, tint, and contents now have
        // one outline even when the source and destination aspect ratios differ.
        const transform = `translate(${origin.e - box.x}px, ${origin.f - box.y}px) scale(${width / box.width}, ${height / box.height})`;
        element.style.setProperty('--desk-start',transform);
        element.classList.add('desk-receiving');
        root.classList.add('desk-arriving');
        const motion = element.getAnimations().find(animation => animation.animationName === 'desk-receive');
        const finish = () => {
            transition.skipTransition();
            motion?.cancel();
        };
        window.addEventListener('resize',finish);
        window.addEventListener('pagehide',finish);
        try { await motion?.finished; } catch { /* The viewport changed or navigation continued. */ }
        window.removeEventListener('resize',finish);
        window.removeEventListener('pagehide',finish);
        root.classList.remove('desk-arriving');
        element.classList.remove('desk-receiving');
        element.style.removeProperty('--desk-start');
    });

    window.addEventListener('pageswap', event => {
        const transition = event.viewTransition;
        const link = shortcut;
        shortcut = null;
        if (!transition) return;
        if (!document.body?.matches('.staff-landing:not(.work-checking)') || !link?.isConnected ||
            event.activation?.navigationType !== 'push' || event.activation.entry.url !== link.href ||
            matchMedia('(prefers-reduced-motion: reduce)').matches) {
            transition.skipTransition();
            return;
        }
        link.classList.add('shortcut-opening');
        transition.finished.finally(() => link.classList.remove('shortcut-opening'));
    });
})();
