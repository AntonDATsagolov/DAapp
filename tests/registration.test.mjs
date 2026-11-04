// DAapp: browser-like OTP registration/login flow without real emails,
// users, API keys, external requests or modifications to production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const base = join(dirname(fileURLToPath(import.meta.url)), '..');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const appNames = ['client-app','business-app','driver-app','admin-app'];

function element() {
  const listeners = new Map();
  return {
    hidden: false, disabled: false, value: '', textContent: '',
    dataset: {}, style: {},
    addEventListener(type, handler) { listeners.set(type, handler); },
    trigger(type) { return listeners.get(type); },
    replaceChildren() {},
    append() {},
    reset() {},
    setAttribute() {},
    checkValidity() { return true; },
    querySelectorAll() { return []; }
  };
}

async function startApp(app) {
  const html = readFileSync(join(base, app, 'index.html'), 'utf8');
  const code = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(code, app + ' missing inline module');
  const controls = new Map();
  const get = id => {
    const key = id.replace(/^#/, '');
    if (!controls.has(key)) controls.set(key, element());
    return controls.get(key);
  };
  const emailInput = get('email');
  emailInput.value = 'test-registration@example.invalid';
  get('adminPassword').value = 'strong-test-password';
  const document = {querySelector:get, getElementById:get};
  const calls = [];
  const auth = {
    async getSession() { return {data:{session:null},error:null}; },
    onAuthStateChange() {},
    async signInWithOtp(payload) { calls.push({kind:'otp',payload}); return {data:{},error:null}; },
    async signInWithPassword(payload) { calls.push({kind:'password',payload}); return {data:{},error:null}; }
  };
  const supabase = {auth};
  const moduleMap = {
    '../shared/supabase.js': {supabase},
    './map.js': {initVillageMap: async () => ({invalidateSize(){}})},
    './profile.js': {createProfileController: () => ({show(){},clear(){}})},
    './submissions.js': {},
    './driver.js': {},
    './checks.js': {},
    './accounts.js': {createAccountModerator:()=>({reset(){},refresh(){}})},
    './control-center.js': {createControlCenter:()=>({reset(){},load(){}})}
  };
  function load(path) {
    assert.ok(Object.hasOwn(moduleMap,path), 'Unexpected module: ' + path);
    return Promise.resolve(moduleMap[path]);
  }
  const location = {href:'https://antondatsagolov.github.io/DAapp/' + app + '/'};
  const fakeWindow = {confirm:()=>false};
  // Replace dynamic imports ONLY for this fake browser. The actual deployed
  // app still imports original Supabase SDK; no account is created here.
  const script = code.replace(/\bimport\s*\(/g, '__load(');
  const run = new AsyncFunction(
    'document','location','setTimeout','window','FormData','__load',script);
  await run(document,location,() => 0,fakeWindow,class {},load);
  const login = get('loginForm');
  const onSubmit = login.trigger('submit');
  assert.equal(typeof onSubmit, 'function', app + ' registration handler missing');
  await onSubmit({preventDefault(){}});
  assert.equal(calls.length,1,app + ' should issue one login request');
  return {html,calls,controls,location};
}

for(const app of appNames) {
  test('Login and authorized redirects in '+app, async ()=>{
    const result = await startApp(app);
    const call = result.calls[0];
    if(app==='admin-app'){
      assert.equal(call.kind,'password');
      assert.equal(call.payload.email,'test-registration@example.invalid');
      assert.equal(call.payload.password,'strong-test-password');
      assert.match(result.html,/саморегистрация здесь отключена/);
      const magic=result.controls.get('magicLinkButton').trigger('click');
      assert.equal(typeof magic,'function');
      await magic();
      const otp=result.calls[1];
      assert.equal(otp.kind,'otp');
      assert.equal(otp.payload.options.emailRedirectTo,result.location.href);
      assert.equal(otp.payload.options.shouldCreateUser,false);
    }else{
      assert.equal(call.kind,'otp');
      assert.equal(call.payload.email,'test-registration@example.invalid');
      assert.equal(call.payload.options.emailRedirectTo,result.location.href);
      assert.equal(call.payload.options.shouldCreateUser,false);
      assert.match(result.html,/account-app\/\?next=/i);
    }
    assert.doesNotMatch(result.html,/emailRedirectTo:\s*['"]http:\/\/localhost/i);
  });
}

test('Links exist between residents, businesses and drivers',()=>{
  const appFiles=Object.fromEntries(appNames.map(app=>[
    app,readFileSync(join(base,app,'index.html'),'utf8')
  ]));
  assert.match(appFiles['client-app'],/href="\.\.\/business-app\/"/);
  assert.match(appFiles['client-app'],/href="\.\.\/driver-app\/"/);
  assert.match(appFiles['driver-app'],/href="\.\.\/client-app\/"/);
  assert.match(appFiles['driver-app'],/href="\.\.\/business-app\/"/);
  assert.match(appFiles['business-app'],/href="\.\.\/client-app\/"/);
});
