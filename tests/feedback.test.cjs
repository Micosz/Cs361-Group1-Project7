const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(editable=true, role='staff') {
    const node=tag=>({tag,children:[],isConnected:true,value:'',append(...nodes){this.children.push(...nodes);},
        appendChild(n){this.children.push(n);},replaceChildren(...nodes){this.children=nodes;},setAttribute(){},focus(){}});
    const calls=[];
    const row={id:'f1',version:2,occurredOn:'2026-10-18',sourceType:'partner',comment:'<img onerror=bad()>',improvement:'More time'};
    let result={data:[row],page:{nextCursor:null}};
    const auth={request:async path=>{calls.push(['read',path]);return result;},
        create:async (...args)=>calls.push(['create',...args]),mutate:async (...args)=>calls.push(['update',...args])};
    const ctx={document:{createElement:node},crypto:{randomUUID:()=> 'random-submission-key'},
        window:{CstuAuth:auth,CstuWork:{roles:()=>[role],canEdit:()=>editable}}};
    vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/assets/feedback.js'),'utf8'),ctx);
    return {ctx,node,calls,auth,row,setResult:r=>result=r};
}
const walk=n=>[n,...n.children.flatMap(walk)];
test('Executive reads literal comments without editor; students mount no feedback',async()=>{
    const s=setup(false,'executive'),container=s.node('section');
    await s.ctx.window.CstuFeedback.mount(container,{id:'a1'},'activities',{user:{}});
    assert.equal(s.calls[0][1],'/activities/a1/feedback?limit=100');
    assert.ok(walk(container).some(n=>n.textContent===s.row.comment && n.innerHTML===undefined));
    assert.equal(walk(container).filter(n=>n.tag==='button').length,0);
    const student=setup(false,'student'),hidden=student.node('section');
    await student.ctx.window.CstuFeedback.mount(hidden,{id:'e1'},'exchanges',{user:{}});
    assert.equal(hidden.children.length,0);assert.equal(student.calls.length,0);
});
test('Editor submits nested feedback, keeps retry key, and handles stale edit version',async()=>{
    const s=setup(),container=s.node('section');
    await s.ctx.window.CstuFeedback.mount(container,{id:'e1'},'exchanges',{user:{}});
    walk(container).find(n=>n.textContent==='เพิ่ม Feedback').onclick();
    let form=walk(container).find(n=>n.tag==='form');
    const fields=walk(form).filter(n=>['input','select','textarea'].includes(n.tag));
    fields[0].value='2026-10-18';fields[2].value=' New comment ';fields[4].value='Private name';
    s.auth.create=async (...args)=>{s.calls.push(['create',...args]);throw Object.assign(new Error('offline'),{status:503});};
    await form.onsubmit({preventDefault(){}});await form.onsubmit({preventDefault(){}});
    const writes=s.calls.filter(c=>c[0]==='create');
    assert.equal(writes[0][1],'/exchanges/e1/feedback');assert.equal(writes[0][2].comment,'New comment');
    assert.equal(writes[0][2].respondentName,'Private name');assert.equal(writes[0][3],writes[1][3]);
    walk(container).find(n=>n.textContent==='แก้ไข Feedback').onclick();
    form=walk(container).find(n=>n.tag==='form');
    s.auth.mutate=async (...args)=>{s.calls.push(['update',...args]);throw Object.assign(new Error('stale'),{status:409});};
    await form.onsubmit({preventDefault(){}});
    const update=s.calls.find(c=>c[0]==='update');assert.equal(update[1],'/exchanges/e1/feedback/f1');assert.equal(update[3],2);
    assert.ok(walk(form).some(n=>n.textContent?.includes('ข้อมูลเปลี่ยนแล้ว')));
});
test('Feedback reads all cursor pages',async()=>{
    const s=setup(false),container=s.node('section');let page=0;
    s.auth.request=async path=>{s.calls.push(['read',path]);return {data:[{...s.row,id:String(page)}],page:{nextCursor:page++===0?'cursor/+':null}};};
    await s.ctx.window.CstuFeedback.mount(container,{id:'e1'},'exchanges',{user:{}});
    assert.match(s.calls[1][1],/cursor=cursor%2F%2B/);
    assert.equal(walk(container).filter(n=>n.tag==='li').length,2);
});
