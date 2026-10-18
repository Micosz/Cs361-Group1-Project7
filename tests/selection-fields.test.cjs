const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
class Element extends EventTarget {
 constructor(){super();this.children=[];this.style={};this.dataset={};this.value='';this.isConnected=true;this.id='input';}
 append(...items){for(const item of items)this.appendChild(item);}
 appendChild(item){item.parentElement=this;this.children.push(item);return item;}
 insertBefore(item,before){item.parentElement=this;this.children.splice(this.children.indexOf(before),0,item);}
 closest(){return this.parentElement;}
 replaceChildren(){this.children=[];}
 querySelector(){return null;}
 get selectedOptions(){return this.children.filter(c=>c.selected);}
}
const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function setup(request,value='one'){
 const form=new Element(),submit=new Element(),scope=new Element(),status=new Element(),input=new Element(),wrapper=new Element();
 scope.value='cs';input.value=value;wrapper.appendChild(input);form.append(wrapper,submit);
 const window={CstuAuth:{request}},document={createElement:()=>new Element()};
 vm.runInNewContext(fs.readFileSync('public/assets/selection-fields.js','utf8'),{window,document});
 const mount=()=>window.SelectionFields.mount({form,scope,fields:[{input,kind:'partners',label:'Partners'}],submit,status});
 mount();return {form,submit,scope,status,input,wrapper,mount};
}
test('named choices preserve selected IDs and submit the newly selected ID',async()=>{
 const p=setup(async()=>({data:[{id:'one',name:'First'},{id:'two',name:'Second'}],page:{nextCursor:null}}));
 await settle();assert.equal(p.submit.disabled,false);assert.equal(p.wrapper.hidden,true);
 const box=p.form.children.find(c=>'selectionFields' in c.dataset);
 const select=box.children[1].children[1];
 assert.equal(select.children[0].textContent,'First');assert.equal(select.children[0].selected,true);
 select.children[0].selected=false;select.children[1].selected=true;select.onchange();
 assert.equal(p.input.value,'two');
});
test('missing or failed choices block writes and never silently clear saved relationships',async()=>{
 for(const request of [async()=>{throw Error('offline');},async()=>({data:[],page:{nextCursor:null}})]){
  const p=setup(request);await settle();assert.equal(p.input.value,'one');assert.equal(p.submit.disabled,true);
  const event=new Event('submit',{cancelable:true});p.form.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
 }
});
