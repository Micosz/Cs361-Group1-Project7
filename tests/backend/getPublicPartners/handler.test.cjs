const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('../support/load-data-lambda.cjs');
test('public partner list reads pagination and hides retired/private/conflicting records', async () => {
    const h=await load('getPublicPartners',[{Items:[{id:'p',name:'Public',visibility:'public',secret:'hidden'}],LastEvaluatedKey:{id:'cursor'}},{Items:[{id:'q',visibility:'public'},{id:'old',visibility:'public',source_state:'retired'},{id:'private',visibility:'public',publication:'internal'},{id:'unmarked'}]}]);
    const result=await h.handler({}); const rows=JSON.parse(result.body);
    assert.equal(result.statusCode,200); assert.deepEqual(rows.map(r=>r.id),['p','q']);
    assert.equal(rows[0].secret,undefined); assert.equal(h.calls[1].ExclusiveStartKey.id,'cursor');
});
test('empty scan and errors have stable bodies and CORS', async () => {
    const empty=await (await load('getPublicPartners',[{}])).handler({});
    assert.equal(empty.statusCode,200); assert.deepEqual(JSON.parse(empty.body),[]);
    const error=await (await load('getPublicPartners',[Error('secret')])).handler({});
    assert.equal(error.statusCode,500); assert.equal(error.headers['Access-Control-Allow-Origin'],'*');
    assert.deepEqual(JSON.parse(error.body),{message:'Internal Server Error'});
});
