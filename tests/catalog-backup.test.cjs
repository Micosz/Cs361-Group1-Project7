const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadRecords } = require('../scripts/build-source-backup.cjs');

test('public catalog fallback matches the validated source data', () => {
    const { partners, records } = loadRecords();
    const backup = JSON.parse(readFileSync(join(__dirname, '../public/data/partner-data-backup.json'), 'utf8'));

    assert.ok(partners.length > 0);
    assert.deepEqual(backup, records);
    assert.equal(new Set(records.map(record => record.id)).size, records.length);
    assert.ok(records.every(record => record.access_level === 'public' || record.visibility === 'public'));
});
