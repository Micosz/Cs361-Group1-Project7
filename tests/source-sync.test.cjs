const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, keyString, CONTROL_KEY } = require('../scripts/sync-source-data.cjs');
const { loadRecords } = require('../scripts/build-source-backup.cjs');
const config = require('../data/source-sync-config.json');
const commit = 'a'.repeat(40);
const record = { id: 'partner-example-001', type: 'company', name: 'Example', summary: 'Public source',
    access_level: 'public', source_urls: ['https://cs.sci.tu.ac.th/partnership-th/'], coordinators: [] };
const legacyKey = { id: 'partner-ascend-001', type: 'company' };
const plan = (extra = {}) => buildPlan({ records: [record], config, current: new Map(), commit, ...extra });

test('new records and control are prepared in one conditional transaction', () => {
    const result = plan();
    assert.equal(result.summary.written, 1);
    assert.equal(result.transaction.length, 2);
    assert.deepEqual(result.transaction.at(-1).Put.Item.managed_keys.find(key => key.id === record.id), { id: record.id, type: record.type });
    assert.equal(result.transaction[0].Put.ConditionExpression, 'attribute_not_exists(#id)');
});
test('legacy removals preserve their content and create private backups without deleting records', () => {
    const previous = { ...legacyKey, name: 'Legacy', summary: 'Old', access_level: 'public' };
    const result = plan({ current: new Map([[keyString(previous), previous]]) });
    const backup = result.transaction.find(x => x.Put.Item.snapshot)?.Put.Item;
    const retired = result.transaction.find(x => x.Put.Item.id === previous.id)?.Put.Item;
    assert.deepEqual(backup.snapshot, previous);
    assert.equal(backup.access_level, 'private'); assert.equal(backup.visibility, 'private');
    assert.equal(retired.source_state, 'retired'); assert.equal(retired.name, previous.name);
    assert.equal(retired.access_level, 'private'); assert.equal(retired.visibility, 'private');
    assert.ok(result.transaction.every(x => !x.Delete));
});
test('type changes retire the old composite key while creating the new key', () => {
    const { records } = loadRecords();
    const old = { id: 'event-cp-001', type: 'academic_activity', title: 'Old seminar', visibility: 'public' };
    const result = plan({ records, current: new Map([[keyString(old), old]]) });
    assert.ok(result.transaction.some(x => x.Put.Item.id === old.id && x.Put.Item.type === 'academic_activity' && x.Put.Item.source_state === 'retired'));
    assert.ok(result.transaction.some(x => x.Put.Item.id === old.id && x.Put.Item.type === 'event' && x.Put.Item.source_state === 'active'));
});
test('private, conflicting, unowned and protected records stop the complete plan', () => {
    for (const existing of [
        { ...record, access_level: 'private' },
        { ...record, visibility: 'private' },
        { ...record, data_source: 'another-system' },
        { ...record, scopeId: 'internal' },
        { ...record, private_notes: 'must not be overwritten' }
    ]) assert.throws(() => plan({ current: new Map([[keyString(existing), existing]]) }));
    assert.throws(() => plan({ records: [{ ...record, scopeId: 'injected' }] }));
});
test('owned active records with identical public data do not rewrite or create more backups', () => {
    const owned = { ...record, data_source: config.owner, source_state: 'active', source_commit: commit, source_revision: 'first' };
    assert.equal(plan({ current: new Map([[keyString(owned), owned]]) }).transaction.length, 0);
});
test('retired collaborators can return without inventing an agreement or activity', () => {
    const restored = { ...record, id: 'partner-kingpower-001', name: 'King Power Click', relationship_basis: 'listed_collaborator' };
    const retired = { ...restored, access_level: 'private', visibility: 'private', data_source: config.owner,
        source_state: 'retired', source_revision: 'before' };
    const result = plan({ records: [restored], current: new Map([[keyString(retired), retired]]) });
    const active = result.transaction.find(x => x.Put.Item.id === restored.id).Put.Item;
    assert.equal(active.source_state, 'active'); assert.equal(active.access_level, 'public');
    assert.equal(active.visibility, undefined); assert.equal(result.summary.retired, 0);
    assert.equal(active.relationship_basis, 'listed_collaborator');
    assert.equal(plan({ records: [{ ...record, type: 'research_institute' }] }).summary.written, 1);
});
test('updates and the control record carry snapshot conditions to reject concurrent edits', () => {
    const old = { ...record, summary: 'Before', data_source: config.owner, source_state: 'active', source_revision: 'first' };
    const control = { ...CONTROL_KEY, data_source: config.owner, source_revision: 'first', managed_keys: [] };
    const result = plan({ current: new Map([[keyString(old), old]]), control });
    const update = result.transaction.find(x => x.Put.Item.id === record.id).Put;
    assert.ok(Object.values(update.ExpressionAttributeNames).includes('publication'));
    assert.ok(Object.values(update.ExpressionAttributeValues).includes('Before'));
    assert.deepEqual(result.transaction.at(-1).Put.ExpressionAttributeValues, { ':revision': 'first' });
});
test('empty catalogs, duplicate IDs, missing relationships and oversized transactions fail before writes', () => {
    assert.throws(() => plan({ records: [] }));
    assert.throws(() => plan({ records: [record, record] }));
    assert.throws(() => plan({ records: [{ id: 'event-orphan-001', type: 'event', title: 'Orphan', summary: 'x', visibility: 'public', source_urls: record.source_urls }] }));
    assert.throws(() => plan({ records: Array.from({ length: 100 }, (_, i) => ({ ...record, id: `partner-example-${i}` })) }));
});
