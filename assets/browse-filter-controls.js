/*
 * Opt-in integration for the existing Browse page (no automatic mounting).
 *
 * After #46 has loaded public records and the renderer accepts filtered lists:
 *   const filters = BrowseFilters.createController({ partners, activities });
 *   const unbind = BrowseFilterControls.bind({
 *       controller: filters,
 *       partnerSelect: document.getElementById('filterCollab'),
 *       activitySelect: document.getElementById('filterEvent')
 *   });
 *   const unsubscribe = filters.subscribe(({ partners, activities }) => {
 *       // Render these lists using the existing card renderer, then call
 *       // updateEmptyState(grid, list.length) for each completed grid render.
 *   });
 *   // #48 calls filters.setKeyword(input.value) when its keyword changes.
 *   // Initial render uses filters.getResults(); refresh uses filters.setData().
 *   // Call unbind() and unsubscribe() when removing the page.
 */
(function (root) {
    'use strict';

    function bind({ controller, partnerSelect, activitySelect }) {
        if (!partnerSelect || !activitySelect) {
            throw new Error('Both Browse Type selects are required.');
        }

        const bindings = [
            { select: partnerSelect, stateKey: 'partnerType', setType: controller.setPartnerType },
            { select: activitySelect, stateKey: 'activityType', setType: controller.setActivityType }
        ];

        const cleanups = bindings.map(({ select, stateKey, setType }) => {
            // Replace the legacy inline handler only while this binding is active.
            const previousHandler = select.getAttribute('onchange');
            const previousLabel = select.getAttribute('aria-label');
            select.removeAttribute('onchange');
            if (!previousLabel) {
                select.setAttribute('aria-label', stateKey === 'partnerType'
                    ? 'ประเภทคู่ความร่วมมือ' : 'ประเภทกิจกรรม');
            }

            const clearButton = select.ownerDocument.createElement('button');
            clearButton.type = 'button';
            clearButton.className = 'modern-select';
            clearButton.textContent = 'ล้างประเภท';
            clearButton.setAttribute('aria-label', stateKey === 'partnerType'
                ? 'ล้างประเภทคู่ความร่วมมือ' : 'ล้างประเภทกิจกรรม');
            select.insertAdjacentElement('afterend', clearButton);

            const onChange = () => setType(select.value);
            const onClear = () => setType('all');
            const sync = () => {
                const type = controller.getState()[stateKey];
                select.value = type;
                clearButton.disabled = type === 'all';
            };
            select.addEventListener('change', onChange);
            clearButton.addEventListener('click', onClear);
            const unsubscribe = controller.subscribe(sync);
            sync();

            return () => {
                unsubscribe();
                select.removeEventListener('change', onChange);
                clearButton.removeEventListener('click', onClear);
                clearButton.remove();
                if (previousHandler !== null) select.setAttribute('onchange', previousHandler);
                if (previousLabel === null) select.removeAttribute('aria-label');
            };
        });

        return () => cleanups.forEach(cleanup => cleanup());
    }

    // Call after a successful render, never for loading or data-source errors.
    function updateEmptyState(grid, resultCount) {
        let message = grid.querySelector('[data-browse-filter-empty]');
        if (resultCount > 0) {
            if (message) message.remove();
            return;
        }
        if (!message) {
            message = grid.ownerDocument.createElement('p');
            message.setAttribute('data-browse-filter-empty', '');
            message.setAttribute('role', 'status');
            message.style.gridColumn = '1 / -1';
            grid.appendChild(message);
        }
        message.textContent = 'ไม่พบอีเวนต์หรือคู่ความร่วมมือที่ตรงกับเงื่อนไข กรุณาเปลี่ยนหรือล้างประเภทหรือคำค้น';
    }

    root.BrowseFilterControls = Object.freeze({ bind, updateEmptyState });
})(globalThis);
