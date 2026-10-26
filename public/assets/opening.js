/* Presentation only. Reuses rendered collaborator logos without data requests,
   app state changes or scroll locking. A single RAF-batched scroll controller
   paints scene opacity and transforms directly across browsers.
   Extra previews delegate to the existing detail function and hero ticker. */
(() => {
    'use strict';
    let dispose;
    let presented = false;
    const reloadIntro = window.__CSTUHubReloadIntro;
    const catalog = new Map(); // Retain preview artwork when returning from the browser cache.
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
        let navigationFrame = 0;
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
        const boardScene = document.querySelector('.board-scene');
        const heading = hero.querySelector('.hero-content');
        const subject = hero.querySelector('.heading-subject');
        const boardTitle = boardScene?.querySelector('.page-title h1');
        const boardSubtitle = boardScene?.querySelector('.page-title h2');
        const boardTabs = boardScene?.querySelector('.tabs');
        const boardContent = boardScene?.querySelector('main');
        const welcomeParts = [...hero.querySelectorAll('.heading-intro, .heading-end, .hero-features, .hero-btn')];
        const bridge = document.createElement('span');
        bridge.className = 'scene-title-bridge';
        bridge.setAttribute('aria-hidden', 'true');
        bridge.textContent = subject?.textContent || '';
        bridge.hidden = true;
        document.body.append(bridge);
        let titleGeometry;
        const originalInert = { hero: hero.inert, board: boardScene?.inert };
        const sceneStyles = new Map();
        let sceneEnabled = false;
        let sceneFrame = 0;
        let sceneDirty = true;
        let sceneHeight = 1;
        let sceneTravel = 1;
        let sceneProgress = -1;
        const sceneMode = () => Boolean(boardScene) && !document.body.classList.contains('feedback-inbox-view') && !reduced.matches && !compact.matches && innerHeight > 650;
        const clamp = value => Math.max(0, Math.min(1, value));
        const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
        const mix = (from, to, t) => from + (to - from) * t;
        function paintScene(element, styles) {
            if (!element) return;
            let original = sceneStyles.get(element);
            if (!original) { original = {}; sceneStyles.set(element, original); }
            Object.entries(styles).forEach(([property, value]) => {
                if (!(property in original)) original[property] = element.style[property];
                element.style[property] = value;
            });
        }
        function clearSceneStyles() {
            sceneStyles.forEach((styles, element) => Object.assign(element.style, styles));
            sceneStyles.clear();
            bridge.hidden = true;
            hero.inert = originalInert.hero;
            if (boardScene) boardScene.inert = originalInert.board;
        }
        function measureTitle() {
            if (!sceneEnabled || !subject || !boardTitle) return;
            // Only startup/font/resize/intro completion reads layout. Scrolling
            // interpolates these endpoints, including when moving backwards.
            const from = subject.getBoundingClientRect();
            const to = boardTitle.getBoundingClientRect();
            const heroBox = hero.getBoundingClientRect();
            const sourceStyle = getComputedStyle(subject);
            const targetStyle = getComputedStyle(boardTitle);
            const scale = parseFloat(targetStyle.fontSize) / parseFloat(sourceStyle.fontSize);
            Object.assign(bridge.style, {
                width: `${from.width}px`, height: `${from.height}px`,
                fontFamily: sourceStyle.fontFamily, fontSize: sourceStyle.fontSize,
                fontWeight: sourceStyle.fontWeight, lineHeight: sourceStyle.lineHeight,
                letterSpacing: sourceStyle.letterSpacing
            });
            titleGeometry = {
                x: from.left, y: from.top + 92 - heroBox.top,
                endX: to.left + (to.width - from.width * scale) / 2,
                endY: to.top + scrollY - sceneTravel + (to.height - from.height * scale) / 2,
                tracking: parseFloat(sourceStyle.letterSpacing) || 0,
                endTracking: (parseFloat(targetStyle.letterSpacing) || 0) / scale,
                scale
            };
        }
        function renderScene() {
            sceneFrame = 0;
            if (!sceneEnabled || disposed) return;
            // Only scroll position is read here. Geometry is cached at startup/resize.
            const progress = clamp(window.scrollY / sceneTravel);
            if (!sceneDirty && progress === sceneProgress) return;
            sceneProgress = progress;
            sceneDirty = false;
            const exit = ease((progress - .03) / .55);
            const copyExit = ease(progress / .38);
            const arrival = ease((progress - .08) / .74);
            const titleTravel = ease(progress / .82);
            const movingTitle = settled && titleGeometry && progress > 0 && progress < .82;
            bridge.hidden = !movingTitle;
            if (movingTitle) {
                const geometry = titleGeometry;
                Object.assign(bridge.style, {
                    transform: `translate3d(${mix(geometry.x, geometry.endX, titleTravel)}px,${mix(geometry.y, geometry.endY, titleTravel)}px,0) scale(${mix(1, geometry.scale, titleTravel)})`,
                    letterSpacing: `${mix(geometry.tracking, geometry.endTracking, titleTravel)}px`,
                    color: `rgb(${Math.round(mix(195, 32, titleTravel))} ${Math.round(mix(0, 32, titleTravel))} ${Math.round(mix(47, 32, titleTravel))})`
                });
            }
            // Keep the original semantic headings. Only the aria-hidden copy
            // travels between them; opacity hands off without duplicate text.
            if (settled) {
                paintScene(heading, { visibility: progress < .86 ? 'visible' : 'hidden' });
                paintScene(subject, { opacity: progress === 0 || !titleGeometry ? '1' : '0' });
                welcomeParts.forEach(element => paintScene(element, {
                    opacity: String(1 - copyExit), transform: `translateY(${-24 * copyExit}px)`
                }));
            }
            const opacity = String(1 - exit);
            const visibility = exit < 1 ? 'visible' : 'hidden';
            liveCards.forEach((card, index) => paintScene(card, {
                opacity, visibility,
                translate: `${(index === 1 ? 72 : -72) * exit}px ${-28 * exit}px`
            }));
            tiles.forEach(item => {
                if (!item.destination) return;
                paintScene(item.drift, {
                    opacity, visibility,
                    transform: `translate(${item.destination.x * .18 * exit}px,${item.destination.y * .14 * exit}px) scale(${1 - .08 * exit})`
                });
            });
            // The rounded board rises beneath the shared heading, overlapping
            // the departing orbit instead of leaving an empty interval.
            const boardOffset = (sceneHeight + 40) * (1 - arrival);
            paintScene(boardScene, {
                opacity: '1', visibility: progress > 0 ? 'visible' : 'hidden',
                pointerEvents: progress >= .72 ? 'auto' : 'none',
                transform: `translateY(${(progress - 1) * sceneTravel + boardOffset}px)`
            });
            paintScene(boardTitle, { opacity: progress >= .82 || !titleGeometry ? '1' : '0' });
            [[boardSubtitle, .36], [boardTabs, .46], [boardContent, .56]].forEach(([element, start]) => {
                const reveal = ease((progress - start) / .26);
                paintScene(element, { opacity: String(reveal), transform: `translateY(${18 * (1 - reveal)}px)` });
            });
            // This layer is created by constellation.js after the opening mounts.
            paintScene(hero.querySelector('.constellation-backdrop'), {
                opacity: String(1 - ease((progress - .12) / .74)),
                transform: `scale(${1 - .16 * titleTravel}) translateY(${-24 * titleTravel}px)`
            });
            hero.inert = progress >= .58 || originalInert.hero;
            boardScene.inert = progress < .72 || originalInert.board;
        }
        function scheduleScene(refresh = false) {
            if (!sceneEnabled || disposed) return;
            sceneDirty ||= refresh;
            if (!sceneFrame) sceneFrame = requestAnimationFrame(renderScene);
        }
        const updateSceneMode = () => {
            clearSceneStyles();
            sceneEnabled = sceneMode();
            cancelAnimationFrame(sceneFrame);
            sceneFrame = 0;
            sceneDirty = true;
            sceneHeight = Math.max(1, innerHeight - 92);
            // Keep this travel in sync with the 2.5-view hero track in opening.css.
            sceneTravel = sceneHeight * 1.5;
            document.body.classList.toggle('scene-ready', sceneEnabled);
            measureTitle();
            renderScene();
        };
        updateSceneMode();
        document.fonts?.ready.then(() => { if (!disposed) updateSceneMode(); });
        const bodyObserver = typeof MutationObserver === 'function'
            ? new MutationObserver(() => {
                if (sceneMode() !== sceneEnabled) updateSceneMode();
            })
            : null;
        bodyObserver?.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        on(reduced, 'change', updateSceneMode);
        on(window, 'resize', updateSceneMode);
        on(window, 'scroll', () => {
            if (!settled) finish();
            scheduleScene();
        }, { passive: true });
        function advanceScene() {
            if (!boardScene) return;
            cancelAnimationFrame(navigationFrame);
            navigationFrame = requestAnimationFrame(() => {
                navigationFrame = 0;
                updateSceneMode();
                if (document.body.classList.contains('feedback-inbox-view')) {
                    window.scrollTo({ top: 0, behavior: 'auto' });
                    return;
                }
                // Measure after layout settles. Never target the moving, transformed
                // board on desktop, and finish the full scene travel even at half pixels.
                const navbar = document.querySelector('.navbar');
                const headerInset = navbar
                    ? navbar.offsetHeight + (parseFloat(getComputedStyle(navbar).top) || 0) + 10
                    : 92;
                const top = sceneEnabled
                    ? Math.ceil(Math.max(sceneTravel, boardScene.offsetTop - 92))
                    : Math.max(0, boardScene.getBoundingClientRect().top + window.scrollY - headerInset);
                window.scrollTo({ top, behavior: reduced.matches ? 'auto' : 'smooth' });
            });
        }
        // Own the ordinary anchor scroll so the browser cannot start a competing
        // scroll toward the board while it is still transformed. Keep the same URL.
        on(window, 'cstu:board', () => { finish(); advanceScene(); });
        on(hero.querySelector('.hero-btn'), 'click', event => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            finish();
            if (window.location.hash !== '#board-section') {
                try { window.history.pushState(null, '', '#board-section'); }
                catch { /* Some local file previews disallow History API updates. */ }
            }
            advanceScene();
        });
        on(document.querySelector('.search-btn'), 'click', () => {
            if (boardScene && scrollY < boardScene.offsetTop - 92) advanceScene();
        });
        on(document.querySelector('#searchInput'), 'keydown', event => {
            if (event.key === 'Enter' && boardScene && scrollY < boardScene.offsetTop - 92) advanceScene();
        });
        const pose = (x, y, angle, scale) => `translate(-50%,-50%) translate3d(${x}px,${y}px,0) rotate(${angle}deg) scale(${scale})`;
        const shuffle = items => {
            const copy = [...items];
            for (let i = copy.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [copy[i], copy[j]] = [copy[j], copy[i]];
            }
            return copy;
        };
        function readPartners() {
            grid.querySelectorAll(':scope > .card').forEach(card => {
                const title = card.querySelector('.card-title')?.textContent.trim();
                const background = card.querySelector('.card-thumbnail')?.style.backgroundImage;
                const match = background?.match(/^url\((['"]?)(.*?)\1\)$/);
                if (card.id && title && match) catalog.set(card.id, { id: card.id, title, src: match[2] });
            });
        }
        function assign(item, partner) {
            item.partner = partner;
            item.tile.setAttribute('aria-label', `ดูรายละเอียด ${partner.title}`);
            item.tile.title = partner.title;
            if (item.image.getAttribute('src') !== partner.src) item.image.src = partner.src;
        }
        function refreshCompanions() {
            if (!settled || disposed || !tiles.length) return;
            const current = new Set(liveCards.map(card => card.querySelector('h4')?.textContent.trim()));
            // Keep the preview under the pointer/focus stable until the next ticker cycle.
            const held = tiles.filter(item => item.slot >= 3 &&
                (item.tile.matches(':hover') || item.tile.contains(document.activeElement)));
            held.forEach(item => current.add(item.partner.title));
            const pool = shuffle([...catalog.values()].filter(partner => !current.has(partner.title)));
            tiles.filter(item => item.slot >= 3 && !held.includes(item)).forEach(item => {
                const partner = pool.pop();
                if (partner) assign(item, partner);
            });
        }
        function measure() {
            if (!tiles.length) return;
            // Read all geometry together; never measure continuously while scrolling.
            const box = hero.getBoundingClientRect();
            const cards = liveCards.map(card => card.getBoundingClientRect());
            const tileWidth = tiles[0].tile.offsetWidth || 126;
            const width = box.width;
            const height = box.height;
            // Optional decorative themes can inset companions without changing the scene layout.
            const orbitInset = Math.max(.8, Math.min(1, parseFloat(getComputedStyle(hero).getPropertyValue('--orbit-inset')) || 1));
            const destinations = cards.map((card, index) => ({
                x: card.left + card.width / 2 - box.left - width / 2,
                y: card.top + card.height / 2 - box.top - height / 2,
                angle: [-7, 7, -5][index], scale: compact.matches ? 1 : liveCards[index].offsetWidth / tileWidth, opacity: 0
            }));
            // Five decorative companions frame the message without covering its text.
            const roomy = matchMedia('(min-width: 1440px) and (min-height: 800px)').matches;
            const companions = [[roomy ? .38 : .43, .08, -9], [.7, .08, 7],
                [.87, roomy ? .72 : .79, 8], [roomy && height < 800 ? .68 : .57, roomy && height >= 800 ? .86 : .91, -5],
                // Larger previews need more space for Thai titles on shorter desktops.
                height < (roomy ? 900 : 720) ? [.32, .9, 6] : [.1, .48, 6]];
            const phone = matchMedia('(max-width: 767px)').matches;
            const gutter = phone ? 16 : 28;
            const gap = phone ? 8 : 10;
            const companionWidth = (width - gutter * 2 - gap * 4) / 5;
            companions.forEach(([x, y, angle], index) => destinations.push(compact.matches ? {
                x: gutter + companionWidth / 2 + index * (companionWidth + gap) - width / 2,
                y: height - (phone ? 24 + 29 : 26 + 34) - height / 2,
                angle: 0, scale: Math.min(1, companionWidth / tileWidth), opacity: 1
            } : {
                x: (width * x - width / 2) * orbitInset,
                // Keep the upper logos clear of the welcome text while insetting the bottom row.
                y: (Math.max(roomy ? 88 : 62, Math.min(height - (roomy ? 88 : 76), height * y)) - height / 2) * (y < .5 ? 1 : orbitInset),
                angle, scale: (width < 1100 ? .84 : 1) * orbitInset, opacity: 1
            }));
            tiles.forEach(item => {
                item.destination = destinations[item.slot];
                item.tile.style.transform = pose(item.destination.x, item.destination.y, item.destination.angle, item.destination.scale);
                item.tile.style.opacity = item.destination.opacity;
            });
            scheduleScene(true);
        }
        function finish() {
            const wasSettled = settled;
            settled = true;
            presented = true;
            hero.classList.remove('intro-pending', 'intro-playing', 'intro-orbit-visible', 'intro-unfolding');
            animations.forEach(animation => animation.cancel());
            animations.clear();
            timers.forEach(id => clearTimeout(id));
            timers.clear();
            releaseDecode?.();
            releaseDecode = undefined;
            tiles.forEach(item => { if (item.slot >= 3 && item.tile.disabled) item.tile.disabled = false; });
            if (!wasSettled) updateSceneMode();
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
            const duration = parseFloat(getComputedStyle(hero).getPropertyValue('--opening-duration')) || (compact.matches ? 1100 : 2300);
            // Keep the compact orbit near the message rather than halfway down
            // the tall mobile card list. Touch/scroll can still settle it immediately.
            const centerY = compact.matches ? Math.min(190, box.height / 2) - box.height / 2 : 0;
            // Expose presentation phases for visual checks without touching app state.
            after(() => hero.classList.add('intro-orbit-visible'), duration * .22);
            after(() => hero.classList.add('intro-unfolding'), duration * .68);
            const ring = (angle, scale, radius = 1) => {
                const radians = angle * Math.PI / 180;
                return pose(Math.cos(radians) * radiusX * radius, centerY + Math.sin(radians) * radiusY * radius, angle + 90, scale);
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
            if (preparing || disposed) return;
            readPartners();
            const partners = [...catalog.values()];
            if (partners.length < 5) return;
            preparing = true;
            const selected = liveCards.map(card => partners.find(item => item.title === card.querySelector('h4')?.textContent.trim()));
            shuffle(partners).forEach(partner => { if (!selected.includes(partner) && selected.length < 8) selected.push(partner); });
            const candidates = selected.map((partner, slot) => {
                if (!partner) return null;
                const image = document.createElement('img');
                image.alt = '';
                image.width = 104;
                image.height = 80;
                image.decoding = 'async';
                image.src = partner.src;
                return { image, slot, partner };
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
            available.forEach(({ image, slot, partner }) => {
                const drift = document.createElement('div');
                drift.className = 'orbit-drift';
                drift.dataset.slot = slot;
                const tile = document.createElement('button');
                tile.type = 'button';
                tile.className = 'orbit-tile';
                tile.disabled = true;
                if (slot < 3) tile.setAttribute('aria-hidden', 'true');
                tile.append(image);
                drift.append(tile);
                layer.append(drift);
                const item = { tile, drift, slot, image, partner };
                tiles.push(item);
                assign(item, partner);
                if (slot >= 3) on(tile, 'click', () => {
                    if (typeof window.openModal === 'function') window.openModal(item.partner.id, 'partner');
                });
            });
            hero.append(layer);
            measure();
            // Clear only the pending-data timeout; the decorative sequence has its own bound.
            clearTimeout(pendingTimer);
            timers.delete(pendingTimer);
            try { run(); } catch { finish(); } // Optional motion must always fail open.
        }
        const observer = new MutationObserver(() => { readPartners(); prepare(); });
        // Follow the existing ten-second ticker; no extra timer or data request.
        const tickerObserver = new MutationObserver(refreshCompanions);
        liveCards.forEach(card => {
            const title = card.querySelector('h4');
            if (title) tickerObserver.observe(title, { childList: true, subtree: true, characterData: true });
        });
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
            bodyObserver?.disconnect();
            tickerObserver.disconnect();
            cancelAnimationFrame(resizeFrame);
            cancelAnimationFrame(navigationFrame);
            cancelAnimationFrame(sceneFrame);
            clearSceneStyles();
            finish();
            layer?.remove();
            bridge.remove();
            document.body.classList.remove('scene-ready');
        };
    }
    const start = () => { dispose?.(); dispose = mount(); };
    window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; });
    window.addEventListener('pageshow', event => {
        if (event.persisted) { start(); return; }
        if (!reloadIntro) return;
        const root = document.documentElement;
        const scrollBehavior = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        window.scrollTo(0, 0);
        root.style.scrollBehavior = scrollBehavior;
        if (reloadIntro.previousMode !== null) history.scrollRestoration = reloadIntro.previousMode;
        delete window.__CSTUHubReloadIntro;
        start();
    });
    if (!reloadIntro) start();
})();
