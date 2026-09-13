/*
 * Source-independent filtering for the public records supplied by #46.
 * Load before browse-filter-controls.js. This module does not fetch data,
 * change records, or take ownership of the search UI in #48.
 */
(function (root) {
    'use strict';

    const normalizeKeyword = value => String(value ?? '').trim().toLowerCase();

    function filterRecords(records, field, type, keyword) {
        const query = normalizeKeyword(keyword);
        return records.filter(record =>
            (!type || type === 'all' || record.type === type) &&
            normalizeKeyword(record[field]).includes(query)
        );
    }

    // Inputs are the public, reconstructed lists, not raw DynamoDB records.
    // Keep dates, co_hosts, identifiers and relationships exactly as supplied.
    function createController({ partners = [], activities = [] } = {}) {
        let data = { partners, activities };
        const state = { partnerType: 'all', activityType: 'all', keyword: '' };
        const listeners = new Set();

        function getResults() {
            return {
                partners: filterRecords(data.partners, 'name', state.partnerType, state.keyword),
                activities: filterRecords(data.activities, 'title', state.activityType, state.keyword)
            };
        }

        function notify() {
            const results = getResults();
            listeners.forEach(listener => listener(results, { ...state }));
            return results;
        }

        return {
            getState: () => ({ ...state }),
            getResults,
            // Call again when #46 refreshes data; selected conditions survive.
            setData({ partners, activities }) {
                data = { partners, activities };
                return notify();
            },
            setPartnerType(type) {
                state.partnerType = type || 'all';
                return notify();
            },
            setActivityType(type) {
                state.activityType = type || 'all';
                return notify();
            },
            // #48 passes the keyword here, including '' when search is cleared.
            setKeyword(keyword) {
                state.keyword = String(keyword ?? '');
                return notify();
            },
            clearTypes() {
                state.partnerType = 'all';
                state.activityType = 'all';
                return notify();
            },
            subscribe(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            }
        };
    }

    root.BrowseFilters = Object.freeze({ createController });
})(globalThis);
