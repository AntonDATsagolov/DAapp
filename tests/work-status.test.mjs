import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFileSync(join(root,file),'utf8');

test('Business work-status API uses server ownership checks, never direct map writes',async()=>{
 const source=read('business-app/work-status.js').replace(/^export /gm,'');
 const api=new Function(source+'\nreturn {fetchMyWorkplaces,setBusinessWorking};')();
 const calls=[];
 const client={async rpc(name,payload){calls.push([name,payload]);return name==='daapp_business_my_workplaces'
   ?{data:[{place_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Shop',is_working:false}],error:null}
   :{data:payload.p_working,error:null};}};
 const rows=await api.fetchMyWorkplaces(client);
 assert.equal(rows.length,1);
 const toggled=await api.setBusinessWorking(client,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
 assert.deepEqual(toggled,{success:true,is_working:true});
 assert.deepEqual(calls.map(x=>x[0]),['daapp_business_my_workplaces','daapp_business_set_working']);
 assert.deepEqual(calls[1][1],{p_place_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_working:true});
 assert.ok((await api.setBusinessWorking(client,'not-a-uuid',true)).error);
 assert.ok((await api.setBusinessWorking(client,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','yes')).error);
 assert.doesNotMatch(source,/from\('map_places'\)|\.update\(|service_role/);
});

test('Business UI shows per-place accessible work switches',()=>{
 const html=read('business-app/index.html');
 for(const id of ['workPanel','workplacesList','workStatusMessage','refreshWorkplaces']){
   assert.ok(html.includes('id="'+id+'"'),'Missing business control '+id);
 }
 assert.match(html,/toggle\.setAttribute\('role','switch'\)/);
 assert.match(html,/await workApi\.setBusinessWorking\(client,item\.place_id,desired\)/);
 assert.match(html,/void refreshWorkplaces\(\)/);
 assert.match(html,/toggle\.checked = previous/);
 assert.match(html,/Статус виден всем жителям на карте/);
});

test('Driver on-line state uses a switch and reverts on a failed RPC',()=>{
 const html=read('driver-app/index.html');
 assert.match(html,/id="lineSwitch" type="checkbox" role="switch"/);
 assert.match(html,/id="lineSwitchLabel"/);
 assert.match(html,/\$\('lineSwitch'\)\.addEventListener\('change'/);
 assert.match(html,/\$\('lineSwitch'\)\.checked = Boolean\(currentDriver\?\.is_online\)/);
 assert.match(html,/setDriverAvailability\(client, online\)/);
 assert.doesNotMatch(html,/id="goOnline"|id="goOffline"/);
});

test('Resident published map indicates business status, driver count has no private records',()=>{
 const html=read('client-app/index.html');
 const js=read('client-app/map.js');
 const places=read('client-app/places.js');
 const sql=read('supabase/migrations/012_business_driver_work_status.sql');
 assert.match(html,/id="taxiAvailable"/);
 assert.match(js,/daapp_public_available_drivers/);
 assert.match(js,/workLabel\(place\)/);
 assert.match(js,/place\.is_working===true/);
 assert.match(places,/is_working: typeof raw\.is_working === 'boolean'/);
 assert.match(places,/select\(fields\)/);
 assert.match(sql,/create function public\.daapp_public_available_drivers\(\)/);
 assert.match(sql,/not exists\(select 1 from public\.daapp_account_applications/);
 assert.match(sql,/grant execute on function public\.daapp_public_available_drivers\(\)/);
 assert.doesNotMatch(sql,/grant select.*driver_registrations.*anon/);
});

test('SQL 012 links only an approved publication to its own applicant',()=>{
 const sql=read('supabase/migrations/012_business_driver_work_status.sql');
 assert.match(sql,/ml\.published_place_id=p\.id and ml\.decision='approved'/);
 assert.match(sql,/ps\.applicant_id=v_uid and ps\.status='approved'/);
 assert.match(sql,/p\.is_published/);
 assert.match(sql,/public\.daapp_account_approved\(\)/);
 assert.match(sql,/revoke all on function public\.daapp_business_set_working\(uuid,boolean\)/);
 assert.match(sql,/grant execute on function public\.daapp_business_set_working\(uuid,boolean\)/);
 assert.match(sql,/is_working boolean not null default false/);
});
