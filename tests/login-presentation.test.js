const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const base = join(__dirname, '..');
const source = readFileSync(`${base}/assets/login.js`, 'utf8');
function setup(reduce = false, mobile = false) {
    class Target extends EventTarget { constructor() { super(); this.disabled = true; this.hidden = true; this.valid = true; } reportValidity() { return this.valid; } }
    const form = new Target(), status = new Target(), submit = new Target(), window = new Target();
    window.innerHeight = 800; window.scrollY = 0;
    const media = [new Target(), new Target()]; media[0].matches = reduce; media[1].matches = mobile;
    window.matchMedia = query => query.includes('reduced') ? media[0] : media[1];
    const styles = new Map(), classes = new Set(), frames = new Map(); let frameId = 0;
    vm.runInNewContext(source, { window, document: {
        getElementById: id => ({'login-form':form,'login-status':status,'login-submit':submit})[id],
        documentElement: {style: {setProperty: (key,value) => styles.set(key,value)}},
        body: {classList:{ add: value => classes.add(value), remove: value => classes.delete(value)}}
    }, AbortController, requestAnimationFrame: callback => {frames.set(++frameId, callback);return frameId;}, cancelAnimationFrame: id => frames.delete(id),
    fetch: () => {throw Error('Unexpected authentication request');}, localStorage: {setItem() {throw Error('Unexpected credential storage');}} });
    return {form,status,submit,window,media,styles,classes,frames, flush() {const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());}};
}
test('valid submit stays local, explicitly reports unavailable auth and never claims success', () => {
    const p = setup(); assert.equal(p.submit.disabled, false);
    const event = new Event('submit',{cancelable:true});p.form.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true); assert.equal(p.status.hidden, false);
    assert.match(p.status.textContent,/ยังไม่ได้เชื่อมต่อระบบยืนยันตัวตน/);
});
test('invalid submit is prevented without a simulated success or status', () => {
    const p=setup();p.form.valid=false;const event=new Event('submit',{cancelable:true});p.form.dispatchEvent(event);
    assert.equal(event.defaultPrevented,true);assert.equal(p.status.hidden,true);
});
test('scroll work coalesces into one frame, with distinct heading and light motion', () => {
    const p=setup();p.window.scrollY=300;
    p.window.dispatchEvent(new Event('scroll'));p.window.dispatchEvent(new Event('scroll'));
    assert.equal(p.frames.size,1);p.flush();
    assert.equal(p.styles.get('--light-y'),'54px');assert.equal(p.styles.get('--heading-y'),'30px');assert.equal(p.styles.get('--panel-y'),'-10.500000000000002px');
});
test('reduced motion is static and mobile uses reduced travel', () => {
    const p=setup(true);p.window.scrollY=300;p.window.dispatchEvent(new Event('scroll'));p.flush();assert.equal(p.styles.get('--light-y'),'0px');
    const phone=setup(false,true);phone.window.scrollY=300;phone.window.dispatchEvent(new Event('scroll'));phone.flush();assert.equal(phone.styles.get('--light-y'),'18.9px');
});
test('pagehide cleans listeners and pending frames; restored page enables one form handler', () => {
    const p=setup();p.window.dispatchEvent(new Event('scroll'));p.window.dispatchEvent(new Event('pagehide'));
    assert.equal(p.frames.size,0);assert.equal(p.submit.disabled,true);assert.equal(p.classes.has('login-enter'),false);
    p.window.dispatchEvent(new Event('scroll'));assert.equal(p.frames.size,0);
    const restored=new Event('pageshow');restored.persisted=true;p.window.dispatchEvent(restored);
    assert.equal(p.submit.disabled,false);p.window.dispatchEvent(new Event('scroll'));assert.equal(p.frames.size,1);
});
test('login markup has only the requested credentials, starts submission disabled and homepage has no signup', () => {
    const html=readFileSync(`${base}/login.html`,'utf8'),home=readFileSync(`${base}/index.html`,'utf8');
    assert.equal((html.match(/<input /g)||[]).length,2);
    assert.match(html,/id="login-submit"[^>]+disabled/);assert.match(html,/autocomplete="username"/);assert.match(html,/autocomplete="current-password"/);
    assert.doesNotMatch(home,/class="signup-link"/);assert.match(home,/href="login.html" class="login-btn"/);
});
