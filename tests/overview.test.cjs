const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

class Element {
    constructor(tag) {
        this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {};
        this.value = ''; this.hidden = false; this.disabled = false; this.className = '';
        this.classList = {toggle: (name, active) => { this.classes ||= new Set(); active ? this.classes.add(name) : this.classes.delete(name); }};
    }
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.children.push(item); return item; }
    replaceChildren(...items) { this.children = items; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    remove() { this.removed = true; }
    click() { this.onclick?.({target:this}); }
    set textContent(value) { this._text = String(value ?? ''); }
    get textContent() { return this._text || ''; }
}
const all = root => [root, ...root.children.flatMap(all)];
const fullText = root => all(root).map(node => node.textContent).join(' ');
const pause = () => new Promise(resolve => setImmediate(resolve));
const response = {data:{role:'executive',filters:{},availableScopes:['cs-demo'],
    stakeholders:{count:2,byType:{university:1,company:1}},
    partners:{count:2,byType:{university:1,company:1}}, activities:{count:1,byType:{event:1},outcomesRecorded:1},
    agreements:{count:1,statuses:{draft:1}},exchanges:{count:0,statuses:{}},
    outcomes:{count:1,records:[{recordType:'activity',title:'Workshop',date:'2026-10-18',summary:'Joint project completed'}]},
    feedback:{count:1,bySource:{partner:1},withImprovement:1,latest:[{date:'2026-10-18',sourceType:'partner',parentType:'activity',parentTitle:'Workshop',comment:'Useful collaboration',improvement:'Schedule earlier',respondentName:'Private respondent'}]}}};
function load(role='executive') {
    const requests = [];
    const document = {body:new Element('body'),createElement:tag=>new Element(tag)};
    const ctx = {document,URLSearchParams,URL,Blob,Set,Map,console,
        window:{CstuWork:{roles:()=>[role]},CstuAuth:{request:async path=>{requests.push(path);const copy=JSON.parse(JSON.stringify(response));copy.data.role=role;return copy;}}}};
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(require.resolve('../public/assets/overview.js'),'utf8'),ctx);
    const container = new Element('main');
    ctx.window.CstuOverview.render(container,{grants:[{role,scopeId:'cs-demo',active:true}],user:{}});
    return {container,requests};
}

test('Executive overview uses a dedicated tabbed view and never renders respondent identity', async () => {
    const state = load(); await pause();
    const nodes = all(state.container);
    assert.ok(nodes.some(node=>node.textContent==='Stakeholder'));
    assert.ok(nodes.some(node=>node.textContent==='Feedback'));
    const feedbackTab = nodes.find(node=>node.textContent==='Feedback' && node.tagName==='button');
    feedbackTab.click();
    assert.match(fullText(state.container),/Useful collaboration/);
    assert.doesNotMatch(fullText(state.container),/Private respondent|respondentName/);
    assert.equal(state.requests[0],'/overview');
});

test('Staff overview provides scope-based filters and omits the Executive Stakeholder drill-down tab', async () => {
    const state = load('staff'); await pause();
    let nodes = all(state.container);
    assert.ok(!nodes.some(node=>node.textContent==='Stakeholder' && node.tagName==='button'));
    const form = nodes.find(node=>node.tagName==='form');
    const selects = nodes.filter(node=>node.tagName==='select');
    selects[0].value='cs-demo'; selects[3].value='draft';
    form.listeners.submit({preventDefault(){}}); await pause();
    assert.match(state.requests.at(-1),/scopeId=cs-demo/);
    assert.match(state.requests.at(-1),/status=draft/);
    assert.doesNotMatch(fullText(state.container),/Private respondent|respondentName/);
});
