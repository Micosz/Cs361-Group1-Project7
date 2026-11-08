const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('../support/load-data-lambda.cjs');
const partner = (id, extra={}) => ({ id,name:id,entityType:'partner',scopeId:'demo',publication:'public',...extra });
test('scan reads every page, filters private/retired/conflicting flags and strips secrets', async () => {
    const h = await load('fetchPartnersData',[
        {Items:[partner('p',{secret:'hidden'}),partner('private',{visibility:'internal'})],LastEvaluatedKey:{id:'cursor'}},
        {Items:[partner('q'),partner('retired',{source_state:'retired'}),{id:'unpublished',name:'hidden'}]}
    ]);
    const result = await h.handler({});
    assert.equal(result.statusCode,200);
    const rows = JSON.parse(result.body);
    assert.deepEqual(rows.map(r=>r.id),['p','q']); assert.equal(rows[0].secret,undefined);
    assert.equal(h.calls[1].ExclusiveStartKey.id,'cursor'); assert.equal(h.calls[0].TableName,'test-partners');
});
test('relationships use current public labels and reject ambiguous or cross-scope parents', async () => {
    const activity = (id,partnerId,extra={})=>({id,title:id,entityType:'activity',visibility:'public',scopeId:'demo',partnerId,...extra});
    const h = await load('fetchPartnersData',[{Items:[partner('p'),partner('q'),partner('other',{scopeId:'other'}),partner('dup'),partner('dup',{publication:'internal'}),
        activity('valid','p',{coHostPartnerIds:['q','other'],co_hosts:['stale'],partnerName:'stale'}),activity('cross','other'),activity('ambiguous','dup'),activity('bad','p',{coHostPartnerIds:['q','q']})]}]);
    const rows=JSON.parse((await h.handler({})).body).filter(r=>r.title);
    assert.deepEqual(rows.map(r=>r.id),['valid']); assert.equal(rows[0].partnerName,'p'); assert.deepEqual(rows[0].co_hosts,['q']);
});
test('empty scan succeeds and database failures return no records or internal error details', async () => {
    assert.deepEqual(JSON.parse((await (await load('fetchPartnersData',[{}])).handler({})).body),[]);
    const result=await (await load('fetchPartnersData',[Error('secret-table-details')])).handler({});
    assert.equal(result.statusCode,500); assert.equal(result.body.includes('secret-table'),false);
});
