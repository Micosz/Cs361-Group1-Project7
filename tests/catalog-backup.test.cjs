const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');

test('public catalog fallback matches the validated source data', () => {
    const partners = JSON.parse(readFileSync(join(root, 'data/partners.json'), 'utf8'));
    const records = partners.flatMap(({ collaborations = [], ...partner }) => [
        partner,
        ...collaborations.map(event => ({ ...event, partnerId: partner.id, partnerName: partner.name }))
    ]);
    const backup = JSON.parse(readFileSync(join(root, 'public/data/partner-data-backup.json'), 'utf8'));

    assert.ok(partners.length > 0);
    assert.ok(Array.isArray(partners));
    assert.deepEqual(backup, records);
    assert.equal(new Set(records.map(record => record.id)).size, records.length);
    for (const record of records) {
        assert.ok(record.source_urls?.length, `Missing evidence: ${record.id}`);
        for (const url of record.source_urls) {
            assert.ok(['cs.sci.tu.ac.th', 'sci.tu.ac.th', 'lnkd.in'].includes(new URL(url).hostname), `Unexpected evidence source: ${record.id}`);
        }
        for (const field of ['logo_path', 'image_path']) {
            if (record[field]) assert.ok(existsSync(join(root, 'public', record[field])), `Missing asset: ${record[field]}`);
        }
        if (record.title) {
            assert.equal(Boolean(record.period_date), ['day', 'range'].includes(record.date_precision), `Date precision mismatch: ${record.id}`);
            if (record.period_end_date) assert.ok(record.period_end_date >= record.period_date, `Reversed date range: ${record.id}`);
        }
    }
    assert.ok(records.every(record => record.access_level === 'public' || record.visibility === 'public'));
});
