const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ctx = {window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/work-navigation.js'),'utf8'),ctx);
const nav = ctx.window.CstuWork;
const session = (...grants) => ({user:{id:'u1'},grants:grants.map(([role,scopeId])=>({role,scopeId}))});
test('shared menu routes use data kinds, deduplicate multi roles and keep executive read-only', () => {
    const executive = nav.menu(session(['executive','c1']));
    assert.equal(executive.filter(item=>item.href.includes('action=create')).length,0);
    assert.equal(executive.length,0);
    const multi = nav.menu(session(['staff','c1'],['coordinator','c1']));
    assert.equal(multi.filter(item=>item.href.includes('kind=activities&action=create')).length,1);
    assert.ok(nav.canCreate(session(['staff','c1']),'partners'));
    assert.equal(nav.canCreate(session(['coordinator','c1']),'partners'),false);
    assert.equal(nav.menu(session()).length,0);
});
test('edit affordances bind role and assignment to the same record scope', () => {
    const row = {scopeId:'c1',responsibleUserIds:['u1']};
    assert.ok(nav.canEdit(session(['coordinator','c1']),row));
    assert.equal(nav.canEdit(session(['coordinator','c2']),row),false);
    assert.equal(nav.canEdit(session(['executive','c1'],['staff','c2']),row),false);
    assert.equal(nav.canEdit(session(['coordinator','c1']),{...row,responsibleUserIds:['u2']}),false);
    assert.equal(nav.canEdit(session(['coordinator','c1']),{...row,responsibleUserIds:'u1'}),false);
    assert.equal(nav.canEdit(session(['executive','c1']),row),false);
});
test('shared form seam stays unavailable until a feature registers its handler', () => {
    assert.equal(nav.handler('activities','edit'),undefined);
    const edit = () => {};
    nav.register('activities',{edit});
    assert.equal(nav.handler('activities','edit'),edit);
    assert.throws(()=>nav.register('unknown',{edit}));
    assert.throws(()=>nav.register('activities',{delete:edit}));
});
test('public detail action requires a fresh authorized protected record and ignores detached UI or API failure', async () => {
    const local = {window:{}, document:{createElement:()=>({})}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/work-navigation.js'),'utf8'),local);
    const row = {scopeId:'c1', responsibleUserIds:['u1']};
    const holder = {isConnected:true, children:[], appendChild(node){this.children.push(node);}};
    local.window.CstuAuth = {enabled:()=>true, refresh:async()=>session(['coordinator','c1']),request:async()=>({data:row})};
    await local.window.CstuWork.attachDetailAction(holder,'activities','a1');
    assert.equal(holder.children[0].href,'index.html?kind=activities&id=a1#board-section');
    holder.children=[]; holder.isConnected=false;
    await local.window.CstuWork.attachDetailAction(holder,'activities','a1');
    assert.equal(holder.children.length,0);
    holder.isConnected=true; local.window.CstuAuth.request=async()=>{throw Object.assign(Error(),{status:503});};
    await local.window.CstuWork.attachDetailAction(holder,'activities','a1');
    assert.equal(holder.children.length,0);
});
test('staff gets create entries, students get only their exchange shortcut, and expired grants get nothing', () => {
    const staff=nav.menu(session(['staff','c1']));
    assert.equal(staff.length,4);
    assert.ok(staff.every(item=>item.href.startsWith('index.html?kind=') && item.href.endsWith('&action=create#board-section')));
    const student=nav.menu(session(['student','c1']));
    assert.equal(student.length,1);
    assert.equal(student[0].label,'โครงการแลกเปลี่ยนของฉัน');
    assert.equal(student[0].href,'index.html?kind=exchanges#board-section');
    const revoked=session(['staff','c1']); revoked.grants[0].active=false;
    assert.equal(nav.menu(revoked).length,0);
    assert.equal(nav.menu(session(['coordinator','c1'])).length,3);
});


test('Partner actions stay in the shared detail modal instead of linking to a second detail screen', async () => {
    let mounted;
    const local={window:{CstuAuth:{enabled:()=>true},CstuRecords:{attachPartnerManagement:async (...args)=>{mounted=args;}}}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/work-navigation.js'),'utf8'),local);
    const host={};
    await local.window.CstuWork.attachDetailAction(host,'partners','partner-1');
    assert.equal(mounted[0],host);
    assert.equal(mounted[1],'partner-1');
});

test('embedded adapters close only for their own frame and reload only after saves', () => {
    for (const [kind, event] of [['activities','activity'],['exchanges','exchange']]) {
        const handlers = {}, messages = {}, nodes = [];
        let reloaded = 0, focused = 0;
        const document = {
            activeElement:{focus(){focused++;}},
            body:{appendChild(){}},
            createElement(tag) {
                const node = {tag, style:{}, contentWindow:{}, open:false,
                    setAttribute(){}, appendChild(){}, addEventListener(){}, remove(){},
                    showModal(){this.open=true;}, close(){this.open=false;}};
                nodes.push(node); return node;
            }
        };
        const local = {document, window:{location:{origin:'http://localhost'},
            CstuWork:{register(key,value){handlers[key]=value;}},
            addEventListener(name,callback){messages[name]=callback;}}};
        vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/'+event+'-adapter.js'),'utf8'),local);
        handlers[kind].create({reload(){reloaded++;}});
        const dialog = nodes.find(node=>node.tag==='dialog'), frame=nodes.find(node=>node.tag==='iframe');
        messages.message({origin:'http://elsewhere',source:frame.contentWindow,data:{type:event+'-closed'}});
        assert.equal(dialog.open,true);
        messages.message({origin:'http://localhost',source:{},data:{type:event+'-closed'}});
        assert.equal(dialog.open,true);
        messages.message({origin:'http://localhost',source:frame.contentWindow,data:{type:event+'-closed'}});
        assert.equal(dialog.open,false); assert.equal(reloaded,0); assert.equal(focused,1);
        handlers[kind].edit({record:{id:'record-1'},reload(){reloaded++;}});
        const editFrame=nodes.filter(node=>node.tag==='iframe').at(-1);
        assert.ok(editFrame.src.endsWith('&id=record-1'));
        messages.message({origin:'http://localhost',source:editFrame.contentWindow,data:{type:event+'-saved'}});
        assert.equal(dialog.open,false); assert.equal(reloaded,1);
    }
});
