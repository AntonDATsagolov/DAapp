import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(join(root,'admin-app/control-center.js'),'utf8');
const createControlCenter=new Function(source.replace(/^export /gm,'')+'\nreturn createControlCenter;')();
function element(){
 const children=[],listeners={};
 return {children,hidden:false,disabled:false,checked:false,value:'',textContent:'',dataset:{},style:{},
   replaceChildren(...parts){children.splice(0,children.length,...parts);},
   append(...parts){children.push(...parts);},
   addEventListener(event,fn){listeners[event]=fn;},
   trigger(event){return listeners[event]?.({key:event==='keydown'?'Enter':null,preventDefault(){}});}
 };
}
const required=[
 'controlMetrics','refreshDashboard','controlDashboardStatus','memberSearch',
 'memberFilter','memberSearchButton','memberRegisterStatus','memberRegistry',
 'membersPrev','membersNext','architectControls','controlAutoApprove',
 'controlDirectoryEnabled','controlSaveSettings','controlSettingsStatus',
 'controlAudit','controlAuditStatus','refreshAudit','adminRights'
];

test('Admin control center loads real server totals and authorized member register',async()=>{
 const priorDocument=globalThis.document,priorWindow=globalThis.window;
 globalThis.document={createElement(){return element();}};
 globalThis.window={confirm:()=>true,prompt:()=> 'Test policy'};
 try{
  const ui=Object.fromEntries(required.map(k=>[k,element()]));
  ui.memberFilter.value='all';
  const calls=[];
  const client={async rpc(name,args){
    calls.push({name,args});
    if(name==='daapp_admin_dashboard')
      return {data:{all_auth_users:10,member_approved:5,driver_pending:2,
        is_architect:true,settings:{auto_activate_after_email:true,public_directory_enabled:true}},error:null};
    if(name==='daapp_admin_member_register')
      return {data:[{user_id:'test',username:'shieli_test',email:'resident@example.invalid',
        phone_number:'+77770000000',residency:'resident',onboarding_goal:'driver',
        account_status:'approved',email_verified:true,public_phone:false,business_count:1,driver_status:null}],error:null};
    if(name==='daapp_architect_recent_audit')return {data:[],error:null};
    if(name==='daapp_architect_update_settings')return {data:{},error:null};
    return {error:{code:'unexpected'}};
  }};
  const ctrl=createControlCenter(client,ui);
  ctrl.reset('admin-test-id');
  ctrl.load();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.controlMetrics.children.length,12);
  assert.equal(ui.memberRegistry.children.length,1);
  assert.equal(ui.architectControls.hidden,false);
  assert.equal(ui.controlAutoApprove.checked,true);
  assert.ok(ui.adminRights.textContent.includes('архитектор'));
  assert.ok(calls.some(x=>x.name==='daapp_admin_dashboard'));
  assert.ok(calls.some(x=>x.name==='daapp_admin_member_register'));
  ui.controlAutoApprove.checked=false;
  ui.controlSaveSettings.trigger('click');
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(calls.some(x=>x.name==='daapp_architect_update_settings'&&
    x.args.p_auto_activate===false));
 }finally{globalThis.document=priorDocument;globalThis.window=priorWindow;}
});

test('New admin interface offers password, recovery link, separate architect audit',()=>{
 const html=readFileSync(join(root,'admin-app/index.html'),'utf8');
 for(const id of ['adminPassword','passwordSetupForm','newAdminPassword','magicLinkButton',
   'controlMetrics','memberRegistry','architectControls','controlAudit','memberFilter']){
   assert.ok(html.includes('id="'+id+'"'),'Missing admin control: '+id);
 }
 assert.match(html,/auth\.signInWithPassword/);
 assert.match(html,/auth\.updateUser\(\{password:value\}\)/);
 assert.match(html,/shouldCreateUser:\s*false/);
 assert.ok(!html.includes('SUPABASE_SERVICE_ROLE_KEY'));
 const sql=readFileSync(join(root,'supabase/migrations/010_member_self_service_admin_control.sql'),'utf8');
 for(const fn of ['daapp_admin_dashboard','daapp_admin_member_register',
    'daapp_architect_update_settings','daapp_architect_set_member_state',
    'daapp_architect_recent_audit','daapp_activate_verified_member']){
   assert.ok(sql.includes('public.'+fn));
 }
 assert.match(sql,/daapp_control_audit/);
 assert.match(sql,/p_user_id=\(select auth.uid\(\)\)/);
 assert.match(sql,/email_confirmed_at is not null/);
});
