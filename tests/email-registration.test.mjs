import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=join(dirname(fileURLToPath(import.meta.url)),'..');
const raw=readFileSync(join(base,'account-app/email-registration.js'),'utf8').replace(/^export /gm,'');
const auth=new Function(raw+'\nreturn {formatKzPhone,validateEmailRegistration,submitEmailRegistration,accountDecision,uploadAvatar,avatarPublicUrl,updatePublicPhoneConsent};')();
const values={
 username:'  Test_User ',email:'new@example.invalid',phone:'8 (777) 123-45-67',
 age:29,residency:'resident',password:'Password-123456',
 confirmPassword:'Password-123456',publishPhone:true
};
test('Phone contact and email registration validation (without SMS)',()=>{
 const x=auth.validateEmailRegistration(values);
 assert.equal(x.username,'test_user');
 assert.equal(x.email,'new@example.invalid');
 assert.equal(x.phone,'+77771234567');
 assert.equal(x.age,29);
 assert.equal(x.residency,'resident');
 assert.equal(x.publishPhone,true);
 assert.ok(auth.validateEmailRegistration({...values,phone:'555'}).error);
 assert.ok(auth.validateEmailRegistration({...values,username:'a'}).error);
 assert.ok(auth.validateEmailRegistration({...values,email:'invalid'}).error);
 assert.ok(auth.validateEmailRegistration({...values,residency:'driver'}).error);
 assert.ok(auth.validateEmailRegistration({...values,confirmPassword:'Wrong123'}).error);
 assert.equal(auth.validateEmailRegistration({...values,age:16}).publishPhone,false);
});

test('Email password signup sends metadata, not SMS, and requires correct redirect',async()=>{
 let payload;
 const client={auth:{async signUp(x){payload=x;return {data:{user:{id:'mock'},session:null},error:null};}}};
 const url='https://antondatsagolov.github.io/DAapp/account-app/';
 const result=await auth.submitEmailRegistration(client,values,url);
 assert.deepEqual(result,{registered:true,hasSession:false});
 assert.equal(payload.email,'new@example.invalid');
 assert.equal(payload.password,values.password);
 assert.equal(payload.options.emailRedirectTo,url);
 assert.deepEqual(payload.options.data.daapp_registration,{
   flow:'email_manual_v1',username:'test_user',phone:'+77771234567',
   age:29,residency:'resident',publish_phone:true
 });
 assert.ok(!payload.phone);
 assert.ok(!payload.options.channel);
});

test('Pending decision is read from own RLS-protected application',async()=>{
 let called;
 const c={from(name){called=name;return {select(fields){return {async maybeSingle(){
   return {data:{status:'pending',phone_number:'+77771234567',public_phone:false},error:null};
 }};}};}};
 const d=await auth.accountDecision(c);
 assert.equal(called,'daapp_account_applications');
 assert.equal(d.status,'pending');
 assert.equal(d.public_phone,false);
});

test('Avatar must be image smaller than 1.5 MB and stored within owner folder',async()=>{
 const uid='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 let objectPath, claim;
 const c={storage:{from(bucket){
   assert.equal(bucket,'daapp-avatars');
   return {async upload(path,file,opts){
     objectPath=path;
     assert.equal(file.type,'image/png');
     assert.equal(opts.upsert,false);
     return {error:null};
   },getPublicUrl(path){return {data:{publicUrl:'https://example.invalid/'+path}};}};
 }},async rpc(name,args){
   claim={name,args};return {error:null};
 }};
 const file={type:'image/png',size:34567};
 assert.ok((await auth.uploadAvatar(c,uid,{type:'image/svg+xml',size:100})).error);
 assert.ok((await auth.uploadAvatar(c,uid,{type:'image/png',size:2000000})).error);
 const result=await auth.uploadAvatar(c,uid,file);
 assert.ok(result.path.startsWith(uid+'/'));
 assert.ok(result.path.endsWith('.png'));
 assert.equal(claim.name,'daapp_set_avatar_path');
 assert.equal(claim.args.p_path,objectPath);
 assert.ok(auth.avatarPublicUrl(c,result.path));
 assert.equal(auth.avatarPublicUrl(c,'../other/avatar.png'),null);
});

test('Public phone visibility is server-side RPC with explicit boolean',async()=>{
 let called;
 const c={async rpc(name,args){called={name,args};return {error:null};}};
 assert.deepEqual(await auth.updatePublicPhoneConsent(c,true),{success:true});
 assert.deepEqual(called,{name:'daapp_set_phone_visibility',args:{p_public:true}});
});

test('Signup UI and directory expose only approved opt-in phone sharing',()=>{
 const registration=readFileSync(join(base,'account-app/index.html'),'utf8');
 const directory=readFileSync(join(base,'directory-app/index.html'),'utf8');
 const admin=readFileSync(join(base,'admin-app/index.html'),'utf8');
 for(const id of ['signupEmail','signupUsername','signupPassword','signupPhone',
     'signupAge','signupResidency','signupAvatar','signupPublishPhone',
     'decisionStatus','phoneOptions','avatarForm']){
   assert.ok(registration.includes('id="'+id+'"'),id);
 }
 assert.ok(registration.includes("import('./email-registration.js')"));
 assert.ok(directory.includes('daapp_public_member_directory'));
 assert.ok(directory.includes('tel:'));
 assert.ok(admin.includes('accountQueue'));
 assert.ok(admin.includes("import('./accounts.js')"));
 const edge=readFileSync(join(base,'supabase/functions/daapp-username-login/index.ts'),'utf8');
 assert.match(edge,/email:target\.user\.email, password/);
 assert.match(edge,/approval\.status!==['"]approved['"]/);
});
