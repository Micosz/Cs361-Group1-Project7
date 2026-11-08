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
test('executive grant confers scoped role management in auth-client and role-menu without duplicate badges',async()=>{
 const authSource=fs.readFileSync('public/assets/auth-client.js','utf8');
 const menuSource=fs.readFileSync('public/assets/role-menu.js','utf8');
 const mkNode=tag=>({tag,children:[],textContent:'',className:'',href:'',hidden:false,style:{},attributes:{},
  append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);},
  replaceChildren(...items){this.children=items;},prepend(item){this.children.unshift(item);},
  querySelector(){return null;},contains(){return true;},setAttribute(k,v){this.attributes[k]=v;},
  classList:{remove(){},add(){},toggle(){}},addEventListener(){},close(){},showModal(){},getBoundingClientRect(){}});
 const nodes={authNavButtons:mkNode('div'),'role-menu':mkNode('dialog'),'role-menu-links':mkNode('div'),
  'role-menu-status':mkNode('p'),'role-menu-logout':mkNode('button'),'role-menu-account':mkNode('div'),'close-role-menu':mkNode('button')};
 const session={user:{id:'u-exec',displayName:'สุทธิพจน์ ทดสอบ',accountType:'tu'},
  grants:[{role:'executive',scopeId:'cs-demo'}],capabilities:[],csrfToken:'a'.repeat(64)};
 const ctx={window:null,document:{getElementById:id=>nodes[id]||mkNode('div'),createElement:mkNode,body:{style:{}}},
  CSTU_AUTH_CONFIG:{enabled:true},fetch:async()=>({ok:true,status:200,text:async()=>JSON.stringify(session),headers:{get:()=>'application/json'}}),
  AbortController,setTimeout,clearTimeout,Event,matchMedia:()=>({matches:true}),addEventListener(){}};
 ctx.window=ctx;
 ctx.CstuWork={menu:()=>[{label:'รวม Feedback',href:'index.html?view=feedback#board-section',description:'Feedback'}]};
 vm.createContext(ctx);
 vm.runInContext(authSource,ctx);
 assert.deepEqual([...ctx.CstuAuth.managedScopes(session)],['cs-demo']);
 assert.deepEqual([...ctx.CstuAuth.managedScopes({...session,capabilities:[{name:'manageRoles',scopeId:'cs-demo'}]})],['cs-demo']);
 vm.runInContext(menuSource,ctx);
 await new Promise(r=>setTimeout(r,20));
 const labels=nodes['role-menu-links'].children.map(link=>link.children[0].textContent);
 assert.deepEqual(labels,['รวม Feedback','จัดการสิทธิ์ผู้ใช้']);
 const badges=nodes['role-menu-account'].children[1].children.map(span=>span.textContent);
 assert.deepEqual(badges,['Executive · cs-demo','จัดการสิทธิ์ · cs-demo']);
});
test('executive has all scoped staff navigation, create/edit permissions, and role-menu entries',async()=>{
 const authSource=fs.readFileSync('public/assets/auth-client.js','utf8');
 const workNavSource=fs.readFileSync('public/assets/work-navigation.js','utf8');
 const menuSource=fs.readFileSync('public/assets/role-menu.js','utf8');
 const mkNode=tag=>({tag,children:[],textContent:'',className:'',href:'',hidden:false,style:{},attributes:{},
  append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);},
  replaceChildren(...items){this.children=items;},prepend(item){this.children.unshift(item);},
  querySelector(){return null;},contains(){return true;},setAttribute(k,v){this.attributes[k]=v;},
  classList:{remove(){},add(){},toggle(){}},addEventListener(){},close(){},showModal(){},getBoundingClientRect(){}});
 const nodes={authNavButtons:mkNode('div'),'role-menu':mkNode('dialog'),'role-menu-links':mkNode('div'),
  'role-menu-status':mkNode('p'),'role-menu-logout':mkNode('button'),'role-menu-account':mkNode('div'),'close-role-menu':mkNode('button')};
 const execSession={user:{id:'u-exec',displayName:'ผู้บริหาร ทดสอบ',accountType:'tu'},
  grants:[{role:'executive',scopeId:'cs-demo',active:true}],capabilities:[],csrfToken:'a'.repeat(64)};
 const staffSession={user:{id:'u-staff',displayName:'เจ้าหน้าที่ ทดสอบ',accountType:'tu'},
  grants:[{role:'staff',scopeId:'cs-demo',active:true}],capabilities:[],csrfToken:'a'.repeat(64)};
 const ctx={window:null,document:{getElementById:id=>nodes[id]||mkNode('div'),createElement:mkNode,body:{style:{}}},
  CSTU_AUTH_CONFIG:{enabled:true},fetch:async()=>({ok:true,status:200,text:async()=>JSON.stringify(execSession),headers:{get:()=>'application/json'}}),
  AbortController,setTimeout,clearTimeout,Event,matchMedia:()=>({matches:true}),addEventListener(){}};
 ctx.window=ctx;
 vm.createContext(ctx);
 vm.runInContext(authSource,ctx);
 vm.runInContext(workNavSource,ctx);
 for(const kind of ['partners','activities','agreements','exchanges']){
  assert.equal(ctx.CstuWork.canCreate(execSession,kind),true,`executive should canCreate ${kind}`);
  assert.equal(ctx.CstuWork.canCreate(execSession,kind),ctx.CstuWork.canCreate(staffSession,kind));
 }
 assert.equal(ctx.CstuWork.canEdit(execSession,{scopeId:'cs-demo',responsibleUserIds:[]}),true);
 assert.equal(ctx.CstuWork.canEdit(execSession,{scopeId:'other-scope',responsibleUserIds:[]}),false);
 vm.runInContext(menuSource,ctx);
 await new Promise(r=>setTimeout(r,20));
 const labels=nodes['role-menu-links'].children.map(link=>link.children[0].textContent);
 assert.deepEqual(labels,['รวม Feedback','เพิ่มคู่ความร่วมมือ','เพิ่มกิจกรรม','เพิ่มข้อตกลง','เพิ่มการแลกเปลี่ยน','จัดการสิทธิ์ผู้ใช้']);
});
