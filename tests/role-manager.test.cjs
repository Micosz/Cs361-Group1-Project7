const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('public/assets/workspace.js','utf8');
function harness(){
 const elements={};
 const roles=['','student','coordinator','staff','executive'].map(value=>({value,checked:false}));
 function element(id){return elements[id]??=( {value:'',disabled:false,checked:false,textContent:'',listeners:{},
  addEventListener(type,fn){this.listeners[type]=fn},replaceChildren(){},appendChild(){},close(){this.closed=true},showModal(){},
  querySelectorAll(query){return query==='input:checked'?roles.filter(r=>r.checked):roles}});}
 const messages=[], writes=[], reads=[];
 const scope=element('role-scope'); scope.value='cs-demo';
 const target=element('role-target'); target.value='target';
 const context={document:{getElementById:element},window:{parent:{postMessage:x=>messages.push(x)},CstuAuth:{
  request:async()=>{const r=reads.shift(); return r?await r:{data:{displayName:'Target',identityVerified:true,authzVersion:2,grants:[{role:'staff',scopeId:'cs-demo',active:true}]}}},
  mutate:async(...args)=>{writes.push(args);return {data:{authzVersion:3}}}}},location:{search:'?embed=roles',origin:'https://example.com'},URLSearchParams,Option:function(){},
  openRoles:element('open-roles'),scope,target,roleSearch:element('role-search'),roleTargetStatus:element('role-target-status'),choices:element('role-choices'),saveRoles:element('save-roles'),roleStatus:element('role-status'),
  version:null,selectedTarget:null,selectedScope:null,roleLoadRevision:0};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function invalidateSelection()'),source.indexOf('async function allWorkspaceRows')),context);
 vm.runInContext(source.slice(source.indexOf('openRoles.onclick'),source.indexOf('if (exchangeCloseBtn && exchangeDialog)')),context);
 return {context,element,roles,messages,writes,reads};
}
test('selecting account loads its current role automatically; review is reset',async()=>{
 const h=harness(); await h.element('role-target').listeners.change();
 assert.equal(h.roles.find(r=>r.checked).value,'staff'); assert.equal(h.element('save-roles').disabled,false);
 assert.equal(h.element('confirm-identity').checked,false);
});
test('unchecked confirmation and multiple choices never reach the API',async()=>{
 const h=harness();await h.context.loadSelectedRoleUser();const submit=h.element('role-form').onsubmit;
 await submit({preventDefault(){}});assert.equal(h.writes.length,0);
 h.element('confirm-identity').checked=true;h.roles[1].checked=true;
 await submit({preventDefault(){}});assert.equal(h.writes.length,0);
});
test('successful save closes embedded parent; revoke sends an empty roles list',async()=>{
 const h=harness();await h.context.loadSelectedRoleUser(); h.roles.forEach(r=>r.checked=!r.value);
 h.element('confirm-identity').checked=true;await h.element('role-form').onsubmit({preventDefault(){}});
 assert.equal(h.writes.length,1);assert.equal(h.writes[0][1].roles.length,0);
 assert.equal(h.messages[0].type,'roles-saved');assert.equal(h.element('role-dialog').closed,true);
});
test('close cancels an outstanding account load and tells the parent to close',async()=>{
 const h=harness();let resolve;h.reads.push(new Promise(r=>resolve=r));const loading=h.context.loadSelectedRoleUser();
 h.element('close-roles').onclick(); resolve({data:{displayName:'Late',authzVersion:2,grants:[]}}); await loading;
 assert.equal(h.messages[0].type,'roles-closed');assert.equal(h.element('save-roles').disabled,true);
 assert.equal(h.element('role-user').textContent,'');
});
