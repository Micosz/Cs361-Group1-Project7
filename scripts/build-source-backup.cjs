const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');

// Prepare the V2 fallback only; this never connects to AWS.
const root = join(__dirname, '..');
const partners = JSON.parse(readFileSync(join(root, 'data/partners.json'), 'utf8'));
const records = partners.flatMap(({ collaborations, ...partner }) => [
    partner,
    ...collaborations.map(event => ({ ...event, partnerId: partner.id, partnerName: partner.name }))
]);
assert.equal(new Set(records.map(record => record.id)).size, records.length, 'Duplicate record ID');
for (const record of records) {
    assert.ok(record.source_urls?.length, `Missing evidence: ${record.id}`);
    for (const url of record.source_urls) {
        assert.ok(['cs.sci.tu.ac.th', 'sci.tu.ac.th', 'lnkd.in'].includes(new URL(url).hostname), `Unexpected evidence source: ${url}`);
    }
    for (const field of ['logo_path', 'image_path']) {
        if (record[field]) assert.ok(existsSync(join(root, 'public', record[field])), `Missing asset: ${record[field]}`);
    }
    if (record.title) {
        assert.equal(Boolean(record.period_date), ['day', 'range'].includes(record.date_precision), `Date precision mismatch: ${record.id}`);
        if (record.period_end_date) assert.ok(record.period_end_date >= record.period_date, `Reversed date range: ${record.id}`);
    }
}
const output = JSON.stringify(records, null, 2) + '\n';
const destination = join(root, 'public/data/partner-data-backup.json');
if (process.argv.includes('--check')) {
    assert.equal(readFileSync(destination, 'utf8'), output, 'Fallback differs from data/partners.json; regenerate it');
} else {
    writeFileSync(destination, output);
}
console.log(`Verified ${partners.length} organizations and ${records.length - partners.length} activities`);
