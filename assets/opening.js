/* Presentation only. Reuses rendered collaborator logos without data requests,
   app state changes, scroll handlers, click interception or scroll locking. */
(() => {
    'use strict';
    let dispose;
    let presented = false;
    function mount() {
        const hero = document.querySelector('.hero-section');
        const grid = document.querySelector('#collaboratorGrid');
        if (!hero || !grid) return () => {};
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        const compact = matchMedia('(max-width: 1023px)');
        const controller = new AbortController();
        const animations = new Set();
        const timers = new Set();
        const tiles = [];
        const liveCards = [...hero.querySelectorAll('.float-card')];
        let disposed = false;
        let preparing = false;
        let settled = presented || reduced.matches || window.scrollY > 16;
        let resizeFrame = 0;
        let layer;
        let releaseDecode;
        const on = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: controller.signal });
        const after = (fn, ms) => {
            const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
            timers.add(id);
            return id;
        };
        const play = (element, frames, options) => {
            const animation = element.animate(frames, options);
            animations.add(animation);
            return animation;
        };
        const pose = (x, y, angle, scale) => `translate(-50%,-50%) translate3d(${x}px,${y}px,0) rotate(${angle}deg) scale(${scale})`;
        function measure() {
            if (!tiles.length) return;
            // Read all geometry together; never measure continuously while scrolling.
            const box = hero.getBoundingClientRect();
            const cards = liveCards.map(card => card.getBoundingClientRect());
            const width = box.width;
            const height = box.height;
            const destinations = cards.map((card, index) => ({
                x: card.left + card.width / 2 - box.left - width / 2,
                y: card.top + card.height / 2 - box.top - height / 2,
                angle: [-7, 7, -5][index], scale: card.width / 140, opacity: 0
            }));
            // Five decorative companions frame the message without covering its text.
            const companions = [[.43, .08, -9], [.7, .08, 7], [.87, .79, 8], [.57, .91, -5], [.1, .48, 6]];
            companions.forEach(([x, y, angle]) => destinations.push({
                x: width * x - width / 2,
                y: Math.max(62, Math.min(height - 76, height * y)) - height / 2,
                angle, scale: width < 1100 ? .84 : 1, opacity: compact.matches ? 0 : 1
            }));
            tiles.forEach(item => {
                item.destination = destinations[item.slot];
                item.tile.style.transform = pose(item.destination.x, item.destination.y, item.destination.angle, item.destination.scale);
                item.tile.style.opacity = item.destination.opacity;
                item.drift.style.setProperty('--scatter-x', `${item.destination.x * .25}px`);
                item.drift.style.setProperty('--scatter-y', `${item.destination.y * .2}px`);
            });
        }
        function finish() {
            settled = true;
            presented = true;
            hero.classList.remove('intro-pending', 'intro-playing', 'intro-orbit-visible', 'intro-unfolding');
            animations.forEach(animation => animation.cancel());
            animations.clear();
            timers.forEach(id => clearTimeout(id));
            timers.clear();
            releaseDecode?.();
            releaseDecode = undefined;
            // Inline endpoints are already present beneath the temporary animations.
        }
        function run() {
            if (settled || reduced.matches || disposed || window.scrollY > 16 || !hero.animate) { finish(); return; }
            hero.classList.remove('intro-pending');
            hero.classList.add('intro-playing');
            measure();
            const box = hero.getBoundingClientRect();
            const radiusX = compact.matches ? Math.min(box.width * .31, 150) : Math.min(box.width * .23, 245);
            const radiusY = compact.matches ? Math.min(box.width * .31, 150) : Math.min(box.height * .32, 225);
            const duration = compact.matches ? 1500 : 2300;
            // Expose presentation phases for visual checks without touching app state.
            after(() => hero.classList.add('intro-orbit-visible'), duration * .22);
            after(() => hero.classList.add('intro-unfolding'), duration * .68);
            const ring = (angle, scale, radius = 1) => {
                const radians = angle * Math.PI / 180;
                return pose(Math.cos(radians) * radiusX * radius, Math.sin(radians) * radiusY * radius, angle + 90, scale);
            };
            const completed = tiles.map((item, index) => {
                const angle = -90 + index * 360 / tiles.length;
                const end = item.destination;
                return play(item.tile, [
                    { offset: 0, opacity: 0, transform: ring(angle + 100, .5, .72) },
                    { offset: .12, opacity: 1, transform: ring(angle + 80, .65) },
                    { offset: .42, opacity: 1, transform: ring(angle + 5, .72) },
                    { offset: .58, opacity: 1, transform: ring(angle - 20, .8, 1.06) },
                    { offset: .9, opacity: 1, transform: pose(end.x, end.y, end.angle, end.scale) },
                    { offset: 1, opacity: end.opacity, transform: pose(end.x, end.y, end.angle, end.scale) }
                ], { duration, delay: index * 25, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'both' }).finished.catch(() => {});
            });
            const content = hero.querySelector('.hero-content');
            const cards = hero.querySelector('.hero-animation');
            play(content, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], {
                duration: compact.matches ? 400 : 620, delay: duration * .5, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both'
            });
            play(cards, [{ opacity: 0 }, { opacity: 1 }], {
                duration: 380, delay: duration * .85, easing: 'ease-out', fill: 'both'
            });
            Promise.all(completed).then(() => { if (!disposed) finish(); });
            after(finish, duration + 450); // Fail open even if animation completion is interrupted.
        }
        async function prepare() {
            if (preparing || disposed || reduced.matches) return;
            const partners = [...grid.querySelectorAll(':scope > .card')].map(card => ({
                title: card.querySelector('.card-title')?.textContent.trim(),
                background: card.querySelector('.card-thumbnail')?.style.backgroundImage
            })).filter(item => item.title && item.background);
            if (partners.length < 5) return;
            preparing = true;
            observer.disconnect(); // Filtering never replays the opening or replaces its artwork.
            const selected = liveCards.map(card => partners.find(item => item.title === card.querySelector('h4')?.textContent.trim()));
            partners.forEach(partner => { if (!selected.includes(partner) && selected.length < 8) selected.push(partner); });
            const candidates = selected.map((partner, slot) => {
                if (!partner) return null;
                const match = partner.background.match(/^url\((['"]?)(.*?)\1\)$/);
                if (!match) return null;
                const image = document.createElement('img');
                image.alt = '';
                image.width = 104;
                image.height = 80;
                image.decoding = 'async';
                image.src = match[2];
                return { image, slot };
            }).filter(Boolean);
            await Promise.race([
                Promise.all(candidates.map(item => item.image.decode().catch(() => {}))),
                new Promise(resolve => { releaseDecode = resolve; after(resolve, 500); })
            ]);
            releaseDecode = undefined;
            if (disposed) return;
            const available = candidates.filter(item => item.image.complete && item.image.naturalWidth);
            if (available.length < 5) { finish(); return; }
            layer = document.createElement('div');
            layer.className = 'orbit-layer';
            layer.setAttribute('aria-hidden', 'true');
            available.forEach(({ image, slot }) => {
                const drift = document.createElement('div');
                drift.className = 'orbit-drift';
                const tile = document.createElement('div');
                tile.className = 'orbit-tile';
                tile.append(image);
                drift.append(tile);
                layer.append(drift);
                tiles.push({ tile, drift, slot });
            });
            hero.prepend(layer);
            measure();
            // Clear only the pending-data timeout; the decorative sequence has its own bound.
            clearTimeout(pendingTimer);
            timers.delete(pendingTimer);
            try { run(); } catch { finish(); } // Optional motion must always fail open.
        }
        const observer = new MutationObserver(prepare);
        observer.observe(grid, { childList: true });
        const pendingTimer = settled ? 0 : after(() => finish(), 3500);
        if (!settled) hero.classList.add('intro-pending');
        prepare();
        // All original actions run normally. These listeners only settle decoration.
        on(window, 'wheel', finish, { passive: true });
        on(window, 'touchmove', finish, { passive: true });
        on(document, 'keydown', finish, { capture: true });
        on(document, 'pointerdown', event => {
            if (event.target.closest('a, button, input, select, [role="button"]')) finish();
        }, { capture: true });
        on(reduced, 'change', () => { finish(); measure(); });
        on(window, 'resize', () => {
            // Browsers may resize during initial navigation, before logos arrive.
            if (hero.classList.contains('intro-playing')) finish();
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(measure);
        });
        return () => {
            disposed = true;
            controller.abort();
            observer.disconnect();
            cancelAnimationFrame(resizeFrame);
            finish();
            layer?.remove();
        };
    }
    const start = () => { dispose?.(); dispose = mount(); };
    window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; });
    window.addEventListener('pageshow', event => { if (event.persisted) start(); });
    start();
})();
