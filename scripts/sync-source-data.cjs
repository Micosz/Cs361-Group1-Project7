const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { loadRecords } = require('./build-source-backup.cjs');

const CONTROL_KEY = { id: 'github-source-sync#control', type: 'github_source_control' };
const FIELDS = new Set([
    'id', 'type', 'name', 'title', 'summary', 'location', 'website_url', 'logo_path',
    'coordinators', 'access_level', 'visibility', 'relationship_basis', 'full_description',
    'source_urls', 'source_checked_on', 'evidence_note', 'period', 'period_date',
    'period_end_date', 'date_precision', 'image_path', 'co_hosts', 'organization_roles',
    'partnerId', 'partnerName', 'activity_tags'
]);
const META = new Set(['data_source', 'source_commit', 'source_revision', 'source_state']);
const PROTECTED = ['publication', 'scopeId', 'createdBy', 'responsibleUserIds',
    'responsible_user_ids', 'ownerId', 'agreementIds', 'participants', 'objectKey', 'documents'];
const keyOf = row => ({ id: row.id, type: row.type });
const keyString = row => JSON.stringify([row.id, row.type]);
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

function checkPublic(row) {
    assert.ok(row.access_level === 'public' || row.visibility === 'public', `Record is not public: ${row.id}`);
    for (const field of ['access_level', 'visibility']) {
        assert.ok(row[field] === undefined || row[field] === 'public', `Conflicting visibility: ${row.id}`);
    }
}

function validateDesired(records) {
    assert.ok(Array.isArray(records) && records.length, 'Refusing an empty catalog');
    const ids = new Set();
    const partners = new Map(records.filter(row => row.name).map(row => [row.id, row]));
    for (const row of records) {
        assert.match(row.id, /^(partner-|event-|collab-)[a-z0-9-]+$/);
        assert.ok(!ids.has(row.id), `Duplicate ID: ${row.id}`); ids.add(row.id);
        assert.ok(row.name ? ['company', 'university', 'government', 'internship', 'research_institute'].includes(row.type)
            : ['academic_activity', 'event', 'research', 'internship'].includes(row.type), `Invalid type: ${row.id}`);
        assert.ok(row.name ? typeof row.name === 'string' && !row.title : typeof row.title === 'string' && row.title.length, `Invalid record: ${row.id}`);
        for (const field of Object.keys(row)) assert.ok(FIELDS.has(field), `Unapproved field: ${field}`);
        if (row.activity_tags !== undefined) {
            assert.ok(row.title && Array.isArray(row.activity_tags)
                && row.activity_tags.length > 0
                && row.activity_tags.every(tag => tag === 'mou')
                && new Set(row.activity_tags).size === row.activity_tags.length,
            `Invalid activity tags: ${row.id}`);
        }
        checkPublic(row);
        assert.ok(typeof row.summary === 'string' && row.summary.length, `Missing summary: ${row.id}`);
        assert.ok(Array.isArray(row.source_urls) && row.source_urls.length, `Missing evidence: ${row.id}`);
        assert.ok(!row.coordinators || row.coordinators.length === 0, 'Contacts require separate review before public sync');
        if (row.title) {
            assert.ok(partners.has(row.partnerId), `Unknown activity partner: ${row.id}`);
            assert.equal(row.partnerName, partners.get(row.partnerId).name, `Wrong activity partner name: ${row.id}`);
        }
    }
}

// Compare all approved attributes to the snapshot and require protected attributes
// to remain absent. A concurrent editor causes the entire transaction to fail.
function snapshotCondition(previous) {
    if (!previous) return { ConditionExpression: 'attribute_not_exists(#id)', ExpressionAttributeNames: { '#id': 'id' } };
    const names = {}, values = {}, expressions = [];
    for (const [index, field] of [...FIELDS, ...META, ...PROTECTED].entries()) {
        const name = `#f${index}`; names[name] = field;
        if (Object.hasOwn(previous, field)) {
            const value = `:v${index}`; values[value] = previous[field]; expressions.push(`${name} = ${value}`);
        } else expressions.push(`attribute_not_exists(${name})`);
    }
    return { ConditionExpression: expressions.join(' AND '), ExpressionAttributeNames: names,
        ExpressionAttributeValues: values };
}

function buildPlan({ records, config, current, control, commit, revision = randomUUID() }) {
    validateDesired(records);
    assert.match(commit, /^[a-f0-9]{40}$/);
    const desired = new Map(records.map(row => [keyString(row), row]));
    const legacy = new Set(config.legacy_keys.map(keyString));
    const oldManaged = control?.managed_keys || [];
    const managed = new Map([...config.legacy_keys, ...oldManaged, ...records.map(keyOf)].map(key => [keyString(key), key]));
    const transaction = [], backups = [], changedKeys = [];
    let written = 0, retired = 0;
    for (const [encoded, key] of managed) {
        const previous = current.get(encoded), incoming = desired.get(encoded);
        if (!previous && !incoming) continue;
        if (previous) {
            assert.ok(Object.keys(previous).every(field => FIELDS.has(field) || META.has(field)), `Protected/unknown fields on ${key.id}; refusing overwrite`);
            assert.ok(previous.data_source === config.owner || (!previous.data_source && legacy.has(encoded)), `Record is not owned by GitHub: ${key.id}`);
            if (previous.source_state !== 'retired') checkPublic(previous);
            else {
                assert.equal(previous.data_source, config.owner, 'Only owned retired records can be restored');
                assert.ok(previous.access_level === 'private' && previous.visibility === 'private', 'Retired record unexpectedly public');
            }
        }
        let next;
        if (incoming) {
            const publicPrevious = previous && Object.fromEntries(Object.entries(previous).filter(([field]) => FIELDS.has(field)));
            if (previous?.data_source === config.owner && previous.source_state === 'active' && canonical(publicPrevious) === canonical(incoming)) continue;
            next = { ...incoming, data_source: config.owner, source_commit: commit, source_revision: revision, source_state: 'active' };
            written++;
        } else {
            if (previous.source_state === 'retired') continue;
            // Preserve the old content; retiring removes it from the existing public API.
            next = { ...previous, access_level: 'private', visibility: 'private', data_source: config.owner,
                source_commit: commit, source_revision: revision, source_state: 'retired' };
            retired++;
        }
        if (previous) {
            const backupKey = { id: `github-source-backup#${revision}#${key.id}#${key.type}`, type: 'github_source_backup' };
            backups.push(backupKey);
            transaction.push({ Put: { TableName: config.backup_table,
                Item: { ...backupKey, access_level: 'private', visibility: 'private', data_source: config.owner,
                    source_commit: commit, snapshot: previous, original_key: key }, ...snapshotCondition(null) } });
        }
        changedKeys.push(key);
        transaction.push({ Put: { TableName: config.table, Item: next, ...snapshotCondition(previous) } });
    }
    if (transaction.length) {
        const condition = control ? {
            ConditionExpression: '#revision = :revision', ExpressionAttributeNames: { '#revision': 'source_revision' },
            ExpressionAttributeValues: { ':revision': control.source_revision }
        } : snapshotCondition(null);
        transaction.push({ Put: { TableName: config.backup_table, Item: { ...CONTROL_KEY,
            access_level: 'private', visibility: 'private', data_source: config.owner, source_commit: commit,
            source_revision: revision, managed_keys: [...managed.values()], backup_keys: backups, changed_keys: changedKeys,
            previous_revision: control?.source_revision || null }, ...condition } });
    }
    assert.ok(transaction.length <= 100, 'More than 100 atomic operations; stop and review sync scope before splitting');
    for (const operation of transaction) assert.ok(Buffer.byteLength(JSON.stringify(operation.Put.Item)) < 390 * 1024, 'Item too large; refusing sync');
    assert.ok(Buffer.byteLength(JSON.stringify(transaction)) < 4 * 1024 * 1024, 'Transaction exceeds 4 MB');
    return { transaction, summary: { source_commit: commit, public_records: records.length, written, retired,
        backups: backups.length, operations: transaction.length, revision } };
}

async function readRows(client, table, keys) {
    const { BatchGetCommand } = require('@aws-sdk/lib-dynamodb');
    const result = new Map();
    const unique = [...new Map(keys.map(key => [keyString(key), key])).values()];
    for (let offset = 0; offset < unique.length; offset += 100) {
        let request = { [table]: { Keys: unique.slice(offset, offset + 100), ConsistentRead: true } };
        for (let attempt = 0; Object.keys(request).length; attempt++) {
            assert.ok(attempt < 6, 'Unprocessed read keys remain; refusing a partial snapshot');
            const response = await client.send(new BatchGetCommand({ RequestItems: request }));
            for (const row of response.Responses?.[table] || []) result.set(keyString(row), row);
            request = response.UnprocessedKeys || {};
            if (Object.keys(request).length) await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
        }
    }
    return result;
}

async function main() {
    const { DynamoDBClient, DescribeTableCommand, CreateTableCommand, waitUntilTableExists } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
    const config = JSON.parse(readFileSync(join(__dirname, '../data/source-sync-config.json'), 'utf8'));
    const { records } = loadRecords(); validateDesired(records);
    assert.deepEqual(JSON.parse(readFileSync(join(__dirname, '../public/data/partner-data-backup.json'), 'utf8')), records, 'Fallback is stale');
    const commit = process.env.SOURCE_COMMIT;
    assert.match(commit || '', /^[a-f0-9]{40}$/, 'SOURCE_COMMIT must identify the checked-out commit');
    const raw = new DynamoDBClient({ region: config.region });
    const table = (await raw.send(new DescribeTableCommand({ TableName: config.table }))).Table;
    assert.equal(table.TableArn.split(':')[4], config.account_id, 'Wrong AWS account');
    assert.deepEqual(table.KeySchema, [{ AttributeName: 'id', KeyType: 'HASH' }, { AttributeName: 'type', KeyType: 'RANGE' }], 'Unexpected table key schema');
    const client = DynamoDBDocumentClient.from(raw);
    assert.notEqual(config.backup_table, config.table, 'Backups must be separate from the public table');
    let backupExists = true;
    try {
        const backup = (await raw.send(new DescribeTableCommand({ TableName: config.backup_table }))).Table;
        assert.equal(backup.TableArn.split(':')[4], config.account_id, 'Wrong backup account');
        assert.deepEqual(backup.KeySchema, table.KeySchema, 'Unexpected backup key schema');
    } catch (error) {
        if (error.name !== 'ResourceNotFoundException') throw error;
        backupExists = false;
    }
    const control = backupExists ? (await client.send(new GetCommand({ TableName: config.backup_table, Key: CONTROL_KEY, ConsistentRead: true }))).Item : undefined;
    if (control) assert.equal(control.data_source, config.owner, 'Unexpected sync control owner');
    const keys = [...config.legacy_keys, ...(control?.managed_keys || []), ...records.map(keyOf)];
    const current = await readRows(client, config.table, keys);
    const plan = buildPlan({ records, config, current, control, commit });
    console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', ...plan.summary }));
    if (!process.argv.includes('--apply') || !plan.transaction.length) return;
    if (!backupExists) {
        await raw.send(new CreateTableCommand({ TableName: config.backup_table,
            KeySchema: table.KeySchema, AttributeDefinitions: table.AttributeDefinitions, BillingMode: 'PAY_PER_REQUEST' }));
        await waitUntilTableExists({ client: raw, maxWaitTime: 120 }, { TableName: config.backup_table });
    }
    await client.send(new TransactWriteCommand({ TransactItems: plan.transaction, ClientRequestToken: plan.summary.revision }));
    const verified = await readRows(client, config.table, keys);
    for (const operation of plan.transaction) {
        if (operation.Put.Item.type === 'github_source_backup' || operation.Put.Item.type === 'github_source_control') continue;
        assert.equal(canonical(verified.get(keyString(operation.Put.Item))), canonical(operation.Put.Item), 'Read-back mismatch');
    }
    const resultControl = (await client.send(new GetCommand({ TableName: config.backup_table, Key: CONTROL_KEY, ConsistentRead: true }))).Item;
    assert.equal(resultControl?.source_revision, plan.summary.revision, 'Sync control read-back mismatch');
    console.log('Atomic sync and consistent read-back verified');
    if (process.env.GITHUB_STEP_SUMMARY) require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `Source commit: ${commit}\n\nPublic records: ${records.length}; written: ${plan.summary.written}; retired: ${plan.summary.retired}; backups: ${plan.summary.backups}\n\nAtomic sync and database read-back verified.\n`);
}

module.exports = { buildPlan, validateDesired, keyString, CONTROL_KEY };
if (require.main === module) main().catch(error => {
    // Do not dump SDK request/response objects or record snapshots to public logs.
    console.error(`Source sync failed: ${error.name}: ${error.message}`); process.exitCode = 1;
});
