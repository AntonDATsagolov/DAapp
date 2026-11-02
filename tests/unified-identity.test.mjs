import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const content=readFileSync(join(root,'account-app/auth.js'),'utf8').replace(/^export /gm,'');
const api=new Function(content+'\nreturn {normalizePhone,validateSignup,registerWithPhone,verifyPhoneAndClaim,claimUsername,signInAccount,safeDestination};')();

test('Username/password/age/phone signup payload is private and validated',async()=>{
  assert.equal(api.normalizePhone('+7 (777) 123-45-67'),'+77771234567');
  assert.equal(api.normalizePhone('87771234567'),'+77771234567');
  assert.equal(api.normalizePhone('+1 555 123 4567'),null);
  const details={username:'  My_Daapp ',phone:'87771234567',age:'27',password:'long-strong-pass'};
  const x=api.validateSignup(details);
  assert.equal(x.username,'my_daapp');
  assert.equal(x.phone,'+77771234567');
  assert.equal(x.age,27);
  assert.equal(x.password,'long-strong-pass');
  assert.ok(api.validateSignup({...details,username:'a'}).error);
  assert.ok(api.validateSignup({...details,age:10}).error);
  assert.ok(api.validateSignup({...details,password:'short'}).error);
  let captured=null;
  const client={auth:{async signUp(arg){captured=arg;return {data:{user:{id:'mock'}},error:null};}}};
  const result=await api.registerWithPhone(client,details);
  assert.deepEqual(result,{phone:'+77771234567',username:'my_daapp',age:27});
  assert.deepEqual(Object.keys(captured).sort(),['options','password','phone']);
  assert.deepEqual(captured.options,{channel:'sms'});
  assert.equal(captured.password,'long-strong-pass');
  assert.ok(!JSON.stringify(captured).includes('age_at_registration'));
});

test('SMS OTP confirmation must precede username binding',async()=>{
  const calls=[];
  const client={
    auth:{async verifyOtp(args){calls.push(['verify',args]);return {data:{},error:null};}},
    async rpc(name,args){calls.push(['rpc',name,args]);return {data:'my_daapp',error:null};}
  };
  const result=await api.verifyPhoneAndClaim(client,{phone:'+77771234567',username:'my_daapp',age:27},'123456');
  assert.deepEqual(result,{username:'my_daapp'});
  assert.equal(calls[0][1].type,'sms');
  assert.equal(calls[1][1],'daapp_claim_username');
  assert.equal(calls[1][2].p_username,'my_daapp');
  assert.equal(calls[1][2].p_age,27);
  assert.equal((await api.verifyPhoneAndClaim(client,{phone:'+77771234567'},'invalid')).error,'Укажите код из SMS.');
});

test('Phone password signs in through Supabase Auth, not a public lookup',async()=>{
  let called=null;
  const client={auth:{async signInWithPassword(args){called=args;return {error:null};}}};
  const result=await api.signInAccount(client,'87771234567','secure-pass',{});
  assert.deepEqual(result,{success:true});
  assert.deepEqual(called,{phone:'+77771234567',password:'secure-pass'});
});

test('Username password session comes ONLY from protected server function',async()=>{
  const client={auth:{async setSession(session){
    assert.deepEqual(session,{access_token:'mock-access',refresh_token:'mock-refresh'});
    return {error:null};
  }}};
  const prior=globalThis.fetch;
  let captured=null;
  try{
    globalThis.fetch=async(url,init)=>{
      captured={url,init};
      return {ok:true,async json(){return {access_token:'mock-access',refresh_token:'mock-refresh'};}};
    };
    const out=await api.signInAccount(client,'my_daapp','topsecret',{
      usernameEndpoint:'https://example.invalid/functions/v1/daapp-username-login'
    });
    assert.equal(out.success,true);
    assert.equal(captured.init.credentials,'omit');
    assert.equal(captured.init.cache,'no-store');
    assert.equal(JSON.parse(captured.init.body).username,'my_daapp');
    assert.equal(JSON.parse(captured.init.body).password,'topsecret');
  }finally {globalThis.fetch=prior;}
});

test('Unknown destinations cannot redirect to external websites',()=>{
  assert.equal(api.safeDestination('driver'),'driver');
  assert.equal(api.safeDestination('business'),'business');
  assert.equal(api.safeDestination('https://evil.example'),'resident');
  assert.equal(api.safeDestination('../admin-app/'),'resident');
});

test('Existing auth users retain base resident profile; no exclusive driver/business roles',()=>{
  const sql=readFileSync(join(root,'supabase/migrations/008_unified_member_accounts.sql'),'utf8');
  assert.match(sql,/references auth\.users\(id\)/);
  assert.match(sql,/phone_confirmed_at is not null/);
  assert.match(sql,/unique index daapp_member_username_unique_idx/);
  assert.doesNotMatch(sql,/grant update.*to authenticated/i);
  assert.doesNotMatch(sql,/alter table public\.profiles/i);
  const edge=readFileSync(join(root,'supabase/functions/daapp-username-login/index.ts'),'utf8');
  assert.match(edge,/Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/);
  assert.match(edge,/allowedOrigins/);
  assert.match(edge,/Invalid credentials/);
  assert.doesNotMatch(edge,/console\.log\(.*password/);
});
