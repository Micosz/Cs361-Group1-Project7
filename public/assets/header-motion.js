/* Header decoration only: no navigation, session, or search behavior changes. */
(() => {
    'use strict';
    const header = document.querySelector('.navbar');
    if (!header) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const settle = () => header.classList.add('header-settled');
    const update = () => {
        frame = 0;
        // Hysteresis avoids flickering near the threshold with trackpads.
        if (scrollY > 48) header.classList.add('header-scrolled');
        else if (scrollY < 16) header.classList.remove('header-scrolled');
        if (scrollY > 16) settle();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    // CSS completes by itself even if JavaScript fails. Early interaction always
    // reveals controls immediately, including dropdowns outside the glass edge.
    header.addEventListener('animationend', event => {
        if (event.animationName === 'header-capsule-open') settle();
    });
    header.addEventListener('pointerdown', settle, { capture: true });
    header.addEventListener('focusin', settle);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('pagehide', () => { cancelAnimationFrame(frame); frame = 0; settle(); });
    window.addEventListener('pageshow', event => { if (event.persisted) settle(); update(); });
    reduced.addEventListener('change', () => { if (reduced.matches) settle(); });
    if (reduced.matches || location.hash || new URLSearchParams(location.search).has('view')) settle();
    update();
})();
