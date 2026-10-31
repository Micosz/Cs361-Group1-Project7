/* Optional orbital scene. Vector paths keep stars round at every zoom level.
   Native motion paths animate the scene; there is no per-frame JavaScript loop. */
(() => {
    'use strict';
    let dispose;
    let pausedByUser = false;

    function createGalaxy() {
        const ns = 'http://www.w3.org/2000/svg';
        const make = (tag, attributes = {}) => {
            const element = document.createElementNS(ns, tag);
            Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
            return element;
        };
        const svg = make('svg', { viewBox: '0 0 1200 600', 'aria-hidden': 'true', focusable: 'false', class: 'galaxy-scene' });
        const dust = make('g', { class: 'galaxy-dust' });
        // Deterministic dust positions avoid visual jumps on pause or resize.
        let seed = 361;
        const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let i = 0; i < 210; i++) {
            const angle = random() * Math.PI * 2;
            const radius = .72 + random() * .37;
            const x = 600 + Math.cos(angle) * 545 * radius;
            const y = 300 + Math.sin(angle) * 264 * radius;
            if (((x - 600) / 395) ** 2 + ((y - 300) / 172) ** 2 < 1.12) continue;
            dust.append(make('circle', { cx: x, cy: y, r: .5 + random() * 1.15,
                fill: i % 3 ? '#c99951' : '#b91f48', opacity: .13 + random() * .3 }));
        }
        svg.append(dust);
        const nearStars = make('g', { class: 'galaxy-near-stars' });
        for (let i = 0; i < 52; i++) {
            nearStars.append(make('circle', { cx: 240 + random() * 720, cy: 100 + random() * 400,
                r: .65 + random() * 1.2, fill: i % 2 ? '#c99951' : '#b91f48', opacity: .25 + random() * .3 }));
        }
        svg.append(nearStars);
        const routes = [
            { rx: 530, ry: 245, angle: -8, color: '#cb9b51', period: 132, phases: [.04, .39, .72] },
            { rx: 478, ry: 213, angle: -8, color: '#bd3658', period: 108, phases: [.19, .57, .86] },
            { rx: 422, ry: 178, angle: -8, color: '#cb9b51', period: 88, phases: [.08, .47, .81] }
        ];
        routes.forEach((route, index) => {
            const a = route.angle * Math.PI / 180;
            const x = route.rx * Math.cos(a), y = route.rx * Math.sin(a);
            const path = `M ${600 + x} ${300 + y} A ${route.rx} ${route.ry} ${route.angle} 1 1 ${600 - x} ${300 - y} A ${route.rx} ${route.ry} ${route.angle} 1 1 ${600 + x} ${300 + y}`;
            svg.append(make('path', { d: path, fill: 'none', stroke: route.color,
                'stroke-width': index === 1 ? 1 : .8, opacity: .4, 'vector-effect': 'non-scaling-stroke' }));
            route.phases.forEach((phase, starIndex) => {
                const star = make('g', { class: 'galaxy-star' });
                const radius = starIndex === 0 ? 4.2 : 2.7;
                star.append(make('circle', { r: radius + 5, fill: route.color, opacity: .07 }));
                star.append(make('circle', { r: radius + 2.2, fill: route.color, opacity: .12 }));
                star.append(make('circle', { r: radius, fill: route.color }));
                star.append(make('circle', { r: radius * .32, fill: '#fff8dd', opacity: .85 }));
                star.append(make('animateMotion', { path, dur: `${route.period}s`,
                    begin: `-${route.period * phase}s`, repeatCount: 'indefinite', calcMode: 'linear', rotate: '0' }));
                svg.append(star);
            });
        });
        return svg;
    }

    function mount() {
        const hero = document.querySelector('.hero-section');
        if (!hero) return () => {};
        const controller = new AbortController();
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        const heading = hero.querySelector('.hero-content');
        const observers = [];
        let inViewport = true;
        let frame = 0;
        let cameraAnimation;
        let introStarted = false;
        const on = (target, name, fn, options = {}) => target?.addEventListener(name, fn, { ...options, signal: controller.signal });

        const backdrop = document.createElement('div');
        backdrop.className = 'constellation-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        const camera = document.createElement('div');
        camera.className = 'galaxy-camera';
        const galaxy = createGalaxy();
        const canopy = document.createElement('div');
        canopy.className = 'constellation-canopy';
        canopy.setAttribute('aria-hidden', 'true');
        const canopyGalaxy = createGalaxy();
        canopy.append(canopyGalaxy);
        document.body.prepend(canopy);
        camera.append(galaxy);
        backdrop.append(camera);
        hero.prepend(backdrop);
        hero.classList.add('constellation-ready');

        const toggle = document.createElement('button');
        toggle.className = 'constellation-toggle';
        toggle.type = 'button';
        toggle.setAttribute('aria-label', 'พักการเคลื่อนไหวพื้นหลัง');
        toggle.setAttribute('aria-pressed', String(pausedByUser));
        toggle.textContent = pausedByUser ? 'เล่นพื้นหลังต่อ' : 'พักพื้นหลัง';
        hero.append(toggle);

        function update() {
            frame = 0;
            const intro = hero.classList.contains('intro-pending') || hero.classList.contains('intro-playing');
            const dialog = document.querySelector('dialog[open]');
            const detail = document.querySelector('#detailModal');
            const detailOpen = detail?.style.display === 'flex';
            const readable = !heading || getComputedStyle(heading).visibility !== 'hidden';
            const visible = inViewport && (intro || readable) && !document.body.classList.contains('feedback-inbox-view');
            const running = visible && !dialog && !detailOpen && !document.hidden && !reduced.matches && !pausedByUser;
            if (!introStarted && hero.classList.contains('intro-playing')) {
                introStarted = true;
                if (!reduced.matches && camera.animate) {
                    const duration = parseFloat(getComputedStyle(hero).getPropertyValue('--opening-duration')) || 3800;
                    cameraAnimation = camera.animate([
                        { offset: 0, transform: 'scale(2.2) rotate(-7deg)', opacity: .45 },
                        { offset: .42, transform: 'scale(2.05) rotate(-4deg)', opacity: .65 },
                        { offset: .72, transform: 'scale(1.35) rotate(-1deg)', opacity: .9 },
                        { offset: 1, transform: 'scale(1) rotate(0deg)', opacity: 1 }
                    ], { duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
                }
            }
            if (reduced.matches || scrollY > 16 || dialog || detailOpen) {
                cameraAnimation?.cancel();
                cameraAnimation = undefined;
            } else if (cameraAnimation && cameraAnimation.playState !== 'finished') {
                if (running) cameraAnimation.play(); else cameraAnimation.pause();
            }
            if (running) galaxy.unpauseAnimations(); else galaxy.pauseAnimations();
            const canopyVisible = visible && !dialog && !detailOpen && scrollY < 280;
            canopy.dataset.visible = String(canopyVisible);
            if (running && canopyVisible) canopyGalaxy.unpauseAnimations(); else canopyGalaxy.pauseAnimations();
            hero.dataset.constellationVisible = String(visible && !dialog && !detailOpen);
            hero.dataset.constellationMotion = running ? 'running' : 'paused';
            // The opening controller owns inline translate once scrolling starts.
            hero.dataset.constellationFloat = String(running && !intro && scrollY < 16);
            toggle.hidden = reduced.matches || !visible || intro;
        }
        function schedule() { if (!frame) frame = requestAnimationFrame(update); }
        on(toggle, 'click', () => {
            pausedByUser = !pausedByUser;
            toggle.setAttribute('aria-pressed', String(pausedByUser));
            toggle.textContent = pausedByUser ? 'เล่นพื้นหลังต่อ' : 'พักพื้นหลัง';
            update();
        });
        on(document, 'visibilitychange', schedule);
        on(window, 'scroll', schedule, { passive: true });
        on(reduced, 'change', schedule);
        on(window, 'resize', schedule);
        const changes = new MutationObserver(schedule);
        changes.observe(hero, { attributes: true, attributeFilter: ['class'] });
        if (heading) changes.observe(heading, { attributes: true, attributeFilter: ['style'] });
        changes.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        document.querySelectorAll('dialog, #detailModal').forEach(element => changes.observe(element, {
            attributes: true, attributeFilter: ['open', 'style']
        }));
        observers.push(changes);
        if ('IntersectionObserver' in window) {
            const viewport = new IntersectionObserver(entries => {
                inViewport = entries[0].isIntersecting;
                schedule();
            });
            viewport.observe(hero);
            observers.push(viewport);
        }
        update();
        return () => {
            controller.abort();
            cameraAnimation?.cancel();
            galaxy.pauseAnimations();
            canopyGalaxy.pauseAnimations();
            observers.forEach(observer => observer.disconnect());
            cancelAnimationFrame(frame);
            backdrop.remove();
            canopy.remove();
            toggle.remove();
            hero.classList.remove('constellation-ready');
            delete hero.dataset.constellationVisible;
            delete hero.dataset.constellationMotion;
            delete hero.dataset.constellationFloat;
        };
    }
    const start = () => { dispose?.(); dispose = mount(); };
    window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; });
    window.addEventListener('pageshow', event => { if (event.persisted) start(); });
    start();
})();
