import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const base=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(base,path),'utf8');
const modeSource=read('shared/modes.js').replace(/^export /gm,'');
const helpers=new Function(modeSource+
  '\nreturn {MODE_PATHS,MODE_LABELS,normalizeModeState,getModeState,saveLastMode,modeUrl};')();

test('Mode state contains only server-approved member roles',()=>{
  const state=helpers.normalizeModeState({
    approved:true,
    available_modes:['resident','driver','an_unknown_role'],
    last_mode:'business',driver_application:'approved'
  });
  assert.deepEqual(state.availableModes,['resident','driver']);
  assert.equal(state.lastMode,'resident','Unavailable last mode must fall back to resident');
  const pending=helpers.normalizeModeState({
    approved:false,available_modes:['resident','driver','business'],last_mode:'business'
  });
  assert.deepEqual(pending.availableModes,[],'Blocked member must get no modes');
  assert.equal(pending.approved,false);
});

test('Mode selection is verified by SQL RPC before any navigation',async()=>{
  let params;
  const client={async rpc(name,args){
    params={name,args};return {data:'business',error:null};
  }};
  const success=await helpers.saveLastMode(client,'business');
  assert.deepEqual(success,{saved:'business'});
  assert.deepEqual(params,{name:'daapp_set_last_mode',args:{p_mode:'business'}});
  assert.deepEqual(await helpers.saveLastMode(client,'admin'),{error:'Неизвестный режим DAapp.'});
  assert.ok(helpers.modeUrl('business','https://example.invalid/DAapp/account-app/')
    .endsWith('/DAapp/business-app/'));
  const denied={async rpc(){return {error:{code:'42501'}};}};
  assert.match((await helpers.saveLastMode(denied,'driver')).error,/не подтверждён/);
});

test('Mode fetch does not promote browser metadata or localStorage',async()=>{
  const client={async rpc(name){
    assert.equal(name,'daapp_mode_status');
    return {data:{approved:true,available_modes:['resident'],last_mode:'resident'},error:null};
  }};
  const result=await helpers.getModeState(client);
  assert.deepEqual(result.state.availableModes,['resident']);
  const source=read('shared/mode-switcher.js');
  assert.match(source,/await getModeState\(supabase\)/);
  assert.match(source,/await saveLastMode\(supabase,moduleMode\)/);
  assert.match(source,/await saveLastMode\(supabase,mode\)/);
  assert.match(source,/mode===moduleMode/);
  assert.doesNotMatch(source,/localStorage\\.setItem|localStorage\\.getItem|sessionStorage\\.setItem|service_role/i);
});

test('Shared settings switcher appears in all three user modules',()=>{
  for(const dir of ['client-app','business-app','driver-app']){
    const html=read(dir+'/index.html');
    assert.match(html,/<script type="module" src="\.\.\/shared\/mode-switcher\.js"><\/script>/,
      'Missing common mode settings in '+dir);
  }
  const code=read('shared/mode-switcher.js');
  assert.match(code,/Настройки · Режим DAapp/);
  assert.match(code,/Сменить режим/);
  assert.match(code,/Подключить режим/);
  assert.match(code,/на проверке/);
});

test('Single homepage routes to the account and restores remembered allowed mode',()=>{
  const yml=read('.github/workflows/pages.yml');
  assert.match(yml,/content="0;url=\.\/account-app\/"/);
  assert.match(yml,/_site\/shared\/mode-switcher.js/);
  assert.match(yml,/_site\/shared\/modes.js/);
  const entry=read('account-app/index.html');
  assert.match(entry,/modeHelpers\.getModeState\(supabase\)/);
  assert.match(entry,/modeHelpers\.modeUrl\(chosen,location\.href\)/);
  assert.match(entry,/window\.location\.replace/);
  assert.match(entry,/has\('manage'\)/);
  assert.match(entry,/state\.availableModes\.includes\(next\)/);
});

test('Database checks all modes and enforces approved driver and business',()=>{
  const sql=read('supabase/migrations/011_unified_mode_navigation.sql');
  assert.match(sql,/create function public\.daapp_mode_status\(\)/);
  assert.match(sql,/create function public\.daapp_set_last_mode\(p_mode text\)/);
  assert.match(sql,/d\.review_status='approved'/);
  assert.match(sql,/b\.status='approved'/);
  assert.match(sql,/public\.daapp_account_approved\(\)/);
  assert.match(sql,/security definer set search_path=''/);
  assert.match(sql,/revoke all on public\.daapp_member_navigation from public, anon, authenticated/);
  assert.match(sql,/daapp_stop_driver_on_suspension/);
});
