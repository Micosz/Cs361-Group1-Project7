const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(rows) {
    const store=new Map(),calls=[];
    const make=tag=>({tag,children:[],listeners:{},attributes:{},value:'',checked:false,textContent:'',
        append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);},
        replaceChildren(...items){this.children=items;},setAttribute(k,v){this.attributes[k]=v;},
        addEventListener(k,fn){this.listeners[k]=fn;}});
    const document={createElement:make};
    const ctx={document,URLSearchParams,localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)},
        window:{CstuAuth:{request:async path=>{calls.push(path);return {data:rows,page:{nextCursor:null}};}}}};
    vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/assets/feedback-inbox.js'),'utf8'),ctx);
    return {ctx,make,store,calls};
}
const walk=node=>[node,...node.children.flatMap(walk)];

test('inbox searches, filters favorites, persists favorites per account and renders literal text safely',async()=>{
    const s=setup([{id:'f1',parentId:'e1',parentType:'exchange',parentTitle:'งานแลกเปลี่ยน',occurredOn:'2026-10-20',sourceType:'partner',comment:'<img onerror=bad()>',improvement:'เพิ่มเวลา'}]);
    const host=s.make('main'); await s.ctx.window.CstuFeedbackInbox.render(host,{user:{id:'staff/1'}});
    assert.deepEqual(s.calls,['/feedback?limit=100']);
    const nodes=walk(host);
    assert.ok(nodes.some(node=>node.textContent==='งานแลกเปลี่ยน'));
    assert.ok(nodes.some(node=>node.textContent==='<img onerror=bad()>'));
    const favorite=nodes.find(node=>node.tag==='button'); favorite.onclick();
    assert.match(s.store.get('cstuhub:feedback-favorites:staff%2F1'),/f1/);
    const refreshed=s.make('main'); await s.ctx.window.CstuFeedbackInbox.render(refreshed,{user:{id:'staff/1'}});
    const refreshedNodes=walk(refreshed);
    const toggle=refreshedNodes.find(node=>node.tag==='input'&&node.attributes['aria-label']==='แสดงเฉพาะรายการที่กดหัวใจ');
    toggle.checked=true;toggle.listeners.change();
    assert.ok(walk(refreshed).some(node=>node.tag==='article'));
    const other=s.make('main'); await s.ctx.window.CstuFeedbackInbox.render(other,{user:{id:'another'}});
    const otherToggle=walk(other).find(node=>node.tag==='input'&&node.attributes['aria-label']==='แสดงเฉพาะรายการที่กดหัวใจ');
    otherToggle.checked=true;otherToggle.listeners.change();
    assert.ok(walk(other).some(node=>node.textContent==='ยังไม่มี Feedback ที่กดหัวใจไว้'));
});
