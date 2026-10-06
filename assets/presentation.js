/* Optional presentation layer: no application state, requests, or event cancellation. */
(() => {
    'use strict';
    let dispose;
    function mount() {
        const controller = new AbortController();
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        const pointer = matchMedia('(hover: hover) and (pointer: fine) and (min-width: 768px)');
        const animations = new Map();
        const observers = [];
        const highlights = new Set();
        // Reuse images already rendered by the application; never fetch another dataset.
        const heroMedia = [];
        const partnerImages = new Map();
        const heroCards = Array.from(document.querySelectorAll('.hero-animation .float-card'));
        heroCards.forEach(card => {
            const media = document.createElement('span');
            media.className = 'hero-card-media';
            media.setAttribute('aria-hidden', 'true');
            card.prepend(media);
            heroMedia.push(media);
        });
        const syncHeroImages = () => {
            document.querySelectorAll('#collaboratorGrid > .card').forEach(card => {
                const title = card.querySelector('.card-title')?.textContent.trim();
                const image = card.querySelector('.card-thumbnail')?.style.backgroundImage;
                if (title && image) partnerImages.set(title, image);
            });
            heroCards.forEach((card, index) => {
                const title = card.querySelector('h4')?.textContent.trim();
                const image = partnerImages.get(title) || '';
                if (heroMedia[index].style.backgroundImage !== image) heroMedia[index].style.backgroundImage = image;
            });
        };
        const mediaObserver = new MutationObserver(syncHeroImages);
        const partnerGrid = document.querySelector('#collaboratorGrid');
        if (partnerGrid) mediaObserver.observe(partnerGrid, { childList: true });
        heroCards.forEach(card => {
            const title = card.querySelector('h4');
            if (title) mediaObserver.observe(title, { childList: true, subtree: true, characterData: true });
        });
        observers.push(mediaObserver);
        syncHeroImages();
        let interacted = false;
        let active = null;
        let rect;
        let frame = 0;
        let indicatorFrame = 0;
        let position;
        const on = (target, type, handler, options = {}) => target?.addEventListener(type, handler, { ...options, signal: controller.signal });
        function cancel(element) {
            animations.get(element)?.forEach(animation => animation.cancel());
            animations.delete(element);
        }
        function animate(element, frames, options) {
            if (reduced.matches || !element.animate) return;
            const animation = element.animate(frames, options);
            const list = animations.get(element) || [];
            list.push(animation);
            animations.set(element, list);
            animation.onfinish = () => {
                const remaining = (animations.get(element) || []).filter(item => item !== animation);
                if (remaining.length) animations.set(element, remaining);
                else animations.delete(element);
            };
        }
        const compact = matchMedia('(max-width: 767px)');
        const timing = { duration: compact.matches ? 360 : 680, easing: 'cubic-bezier(.22,1,.36,1)' };
        document.querySelectorAll('.hero-heading span').forEach((line, index) => {
            animate(line, [
                { opacity: .2, clipPath: 'inset(0 0 100% 0)', transform: 'translateY(30px)' },
                { opacity: 1, clipPath: 'inset(0)', transform: 'none' }
            ], { ...timing, delay: index * 65 });
        });
        const scene = document.querySelector('.hero-animation');
        if (scene) animate(scene, [
            { opacity: .3, clipPath: 'inset(14% 8% 14% 8% round 32px)' },
            { opacity: 1, clipPath: 'inset(0 round 32px)' }
        ], { duration: compact.matches ? 350 : 900, easing: 'cubic-bezier(.16,1,.3,1)' });
        // Forward keyboard activation to existing click handlers without changing them.
        on(document, 'keydown', event => {
            const card = event.target.closest('.float-card[role="button"]');
            if (!card || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            card.click();
        });
        let reveal;
        if ('IntersectionObserver' in window) {
            reveal = new IntersectionObserver(entries => {
                entries.forEach(({ target, isIntersecting }) => {
                    if (!isIntersecting) return;
                    reveal.unobserve(target);
                    if (target.matches('.card') && interacted) return;
                    const index = Array.from(target.parentElement.children).indexOf(target);
                    const angle = compact.matches ? 0 : (index % 2 ? -5 : 5);
                    animate(target, [
                        { opacity: .35, transform: compact.matches ? 'translateY(12px)' : `perspective(1100px) translate3d(0,38px,-45px) rotateX(9deg) rotateY(${angle}deg)` },
                        { opacity: 1, transform: 'none' }
                    ], { ...timing, delay: target.matches('.card') ? (index % 3) * 55 : 0 });
                    const image = target.querySelector('.card-thumbnail');
                    if (image) animate(image, [
                        { clipPath: 'inset(0 0 12% 0)', transform: 'translateY(8px)' },
                        { clipPath: 'inset(0)', transform: 'none' }
                    ], { ...timing, duration: 760 });
                });
            }, { threshold: .08 });
            observers.push(reveal);
            document.querySelectorAll('.page-title, .site-footer').forEach(element => {
                if (element.matches('.page-title') && CSS.supports('animation-timeline: view()') &&
                    matchMedia('(min-width: 1024px)').matches) return;
                reveal.observe(element);
            });
            document.querySelectorAll('main .grid').forEach(grid => {
                let initialized = false;
                const initialBatch = () => {
                    if (initialized || interacted) return;
                    const cards = grid.querySelectorAll(':scope > .card');
                    if (!cards.length) return;
                    initialized = true;
                    cards.forEach(card => reveal.observe(card));
                };
                initialBatch();
                const observer = new MutationObserver(initialBatch);
                observer.observe(grid, { childList: true });
                observers.push(observer);
            });
        }
        function browse(event) {
            if (!event.target.closest('#searchInput, .search-container, .filter-wrapper, .tabs')) return;
            interacted = true;
            for (const element of animations.keys()) {
                if (element.closest('main .grid')) cancel(element);
            }
        }
        ['input', 'change', 'click'].forEach(type => on(document, type, browse));
        // FLIP the existing detail panel from the clicked preview's screen rectangle.
        // Observe the application's completed render instead of changing openModal().
        const modal = document.querySelector('#detailModal');
        const panel = modal?.querySelector('.modal-content');
        let previewOrigin = null;
        let modalFrame = 0;
        const stopModalMotion = () => {
            cancelAnimationFrame(modalFrame);
            modalFrame = 0;
            if (panel) cancel(panel);
            if (modal) cancel(modal);
        };
        if (modal && panel) {
            on(document, 'click', event => {
                if (event.target === modal || event.target.closest('.close-btn')) {
                    previewOrigin = null;
                    stopModalMotion();
                    return;
                }
                const preview = event.target.closest('.card, .float-card, .orbit-tile, .suggestion-item');
                if (!preview) return;
                const box = preview.getBoundingClientRect();
                previewOrigin = {
                    left: box.left, top: box.top, width: box.width, height: box.height,
                    time: performance.now(), keyboard: event.detail === 0
                };
            }, { capture: true });
            const modalChanged = () => {
                if (modal.style.display === 'none') {
                    previewOrigin = null;
                    stopModalMotion();
                    return;
                }
                if (!previewOrigin) return;
                cancelAnimationFrame(modalFrame);
                modalFrame = requestAnimationFrame(() => {
                    modalFrame = 0;
                    const source = previewOrigin;
                    previewOrigin = null;
                    if (!source || reduced.matches || source.keyboard ||
                        performance.now() - source.time > 3000 || !panel.getClientRects().length) return;
                    cancel(panel);
                    cancel(modal);
                    reset();
                    const destination = panel.getBoundingClientRect();
                    if (!destination.width || !destination.height) return;
                    const x = source.left + source.width / 2 - destination.left - destination.width / 2;
                    const y = source.top + source.height / 2 - destination.top - destination.height / 2;
                    const scaleX = Math.max(.12, Math.min(1, source.width / destination.width));
                    const scaleY = Math.max(.12, Math.min(1, source.height / destination.height));
                    animate(panel, [
                        { transform: `translate3d(${x}px,${y}px,0) scale(${scaleX},${scaleY})` },
                        { transform: 'translate3d(0,0,0) scale(1,1)' }
                    ], { duration: 1000, easing: 'cubic-bezier(.16,1,.3,1)' });
                });
            };
            const modalObserver = new MutationObserver(modalChanged);
            modalObserver.observe(modal, { attributes: true, attributeFilter: ['style'] });
            const title = document.querySelector('#modalTitle');
            if (title) modalObserver.observe(title, { childList: true, subtree: true, characterData: true });
            observers.push(modalObserver);
            // Reading and pressing controls can interrupt the entrance immediately.
            on(panel, 'wheel', stopModalMotion, { passive: true });
            on(panel, 'touchmove', stopModalMotion, { passive: true });
            on(window, 'resize', stopModalMotion);
        }
        function reset() {
            cancelAnimationFrame(frame);
            frame = 0;
            if (active) {
                active.classList.remove('is-tilting');
                active.style.removeProperty('transform');
                active.querySelector('.card-thumbnail')?.style.removeProperty('transform');
            }
            active = null;
        }
        on(document.querySelector('main'), 'pointermove', event => {
            if (reduced.matches || !pointer.matches || event.pointerType === 'touch') return;
            const card = event.target.closest('.grid > .card');
            if (!card) { reset(); return; }
            if (active !== card) {
                reset();
                active = card;
                cancel(card);
                const thumbnail = card.querySelector('.card-thumbnail');
                if (thumbnail) cancel(thumbnail);
                rect = card.getBoundingClientRect();
                let light = card.querySelector('.card-highlight');
                if (!light) {
                    light = document.createElement('span');
                    light.className = 'card-highlight';
                    light.setAttribute('aria-hidden', 'true');
                    card.append(light);
                    highlights.add(light);
                }
                card.classList.add('is-tilting');
            }
            position = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                if (!active?.isConnected) { reset(); return; }
                const x = Math.max(-.5, Math.min(.5, position.x / rect.width - .5));
                const y = Math.max(-.5, Math.min(.5, position.y / rect.height - .5));
                active.style.transform = `perspective(1100px) translateY(-3px) rotateX(${-y * 6}deg) rotateY(${x * 8}deg)`;
                const light = active.querySelector('.card-highlight');
                light.style.setProperty('--light-x', `${position.x}px`);
                light.style.setProperty('--light-y', `${position.y}px`);
                const image = active.querySelector('.card-thumbnail');
                if (image) image.style.transform = `translate3d(${x * 4}px,${y * 4}px,8px)`;
            });
        });
        on(document.querySelector('main'), 'pointerout', event => {
            if (active && !active.contains(event.relatedTarget)) reset();
        });
        ['pointercancel', 'focusin', 'keydown'].forEach(type => on(document, type, reset));
        on(window, 'wheel', reset, { passive: true });
        on(window, 'resize', reset);
        on(document, 'visibilitychange', () => { if (document.hidden) reset(); });
        on(pointer, 'change', reset);
        on(reduced, 'change', () => {
            reset();
            if (reduced.matches) for (const element of animations.keys()) cancel(element);
        });
        const tabs = document.querySelector('.tabs');
        let indicator;
        if (tabs) {
            indicator = document.createElement('span');
            indicator.className = 'tab-indicator';
            indicator.setAttribute('aria-hidden', 'true');
            tabs.append(indicator);
            const sync = () => {
                cancelAnimationFrame(indicatorFrame);
                indicatorFrame = requestAnimationFrame(() => {
                    const selected = tabs.querySelector('.tab.active');
                    if (selected) {
                        indicator.style.transform = `translateX(${selected.offsetLeft}px) scaleX(${selected.offsetWidth / 100})`;
                        tabs.classList.add('has-indicator');
                    }
                });
            };
            const observer = new MutationObserver(sync);
            tabs.querySelectorAll('.tab').forEach(tab => observer.observe(tab, { attributes: true, attributeFilter: ['class'] }));
            observers.push(observer);
            if ('ResizeObserver' in window) {
                const resize = new ResizeObserver(sync);
                resize.observe(tabs);
                observers.push(resize);
            }
            on(window, 'resize', sync);
            sync();
        }
        return () => {
            controller.abort();
            stopModalMotion();
            reset();
            cancelAnimationFrame(indicatorFrame);
            observers.forEach(observer => observer.disconnect());
            for (const element of animations.keys()) cancel(element);
            highlights.forEach(light => light.remove());
            heroMedia.forEach(media => media.remove());
            indicator?.remove();
            tabs?.classList.remove('has-indicator');
        };
    }
    const start = () => { dispose?.(); dispose = mount(); };
    window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; });
    window.addEventListener('pageshow', event => { if (event.persisted) start(); });
    start();
})();
