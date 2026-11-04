import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>readFileSync(join(root,f),'utf8');

test('Passenger taxi API validates addresses and routes all work through RPC',async()=>{
  const source=read('client-app/taxi-orders.js').replace(/^export /gm,'');
  const {validateTaxiOrder,createTaxiOrder,fetchMyTaxiOrders,cancelTaxiOrder}=
    new Function(source+'\nreturn {validateTaxiOrder,createTaxiOrder,fetchMyTaxiOrders,cancelTaxiOrder};')();
  assert.ok(validateTaxiOrder({pickup:'a',destination:'b'}).error);
  assert.ok(validateTaxiOrder({pickup:'Shieli, Abay 15',destination:'Shieli bus terminal',note:'x'.repeat(241)}).error);
  const good={pickup:' Shieli Abay 15 ',destination:' Shieli station ',note:' At the gate '};
  assert.deepEqual(validateTaxiOrder(good).payload,{
    p_pickup:'Shieli Abay 15',p_destination:'Shieli station',p_note:'At the gate'
  });
  const calls=[];
  const mock={async rpc(name,args){calls.push([name,args]);return {
    data:name==='daapp_taxi_create_order'?'order-id':name==='daapp_taxi_my_orders'?[]:true,error:null
  };}};
  assert.equal((await createTaxiOrder(mock,good)).id,'order-id');
  assert.deepEqual(await fetchMyTaxiOrders(mock),[]);
  assert.equal((await cancelTaxiOrder(mock,'order-id')).success,true);
  assert.deepEqual(calls.map(x=>x[0]),[
    'daapp_taxi_create_order','daapp_taxi_my_orders','daapp_taxi_cancel_order'
  ]);
  assert.doesNotMatch(source,/\.from\(|\.insert\(|\.update\(/);
});

test('Driver taxi API never reads private tables or bypasses assignment RPC',async()=>{
  const source=read('driver-app/orders.js').replace(/^export /gm,'');
  const {fetchDriverTaxiOrders,acceptDriverTaxiOrder,completeDriverTaxiOrder,driverTaxiError}=
    new Function(source+'\nreturn {fetchDriverTaxiOrders,acceptDriverTaxiOrder,completeDriverTaxiOrder,driverTaxiError};')();
  const calls=[];
  const mock={async rpc(name,args){calls.push([name,args]);return {
    data:name==='daapp_taxi_driver_orders'?[]:true,error:null
  };}};
  assert.deepEqual(await fetchDriverTaxiOrders(mock),[]);
  assert.equal((await acceptDriverTaxiOrder(mock,'order-1')).success,true);
  assert.equal((await completeDriverTaxiOrder(mock,'order-1')).success,true);
  assert.deepEqual(calls.map(x=>x[0]),[
    'daapp_taxi_driver_orders','daapp_taxi_accept_order','daapp_taxi_complete_order'
  ]);
  assert.match(driverTaxiError({code:'P0002'}),/уже принят/);
  assert.doesNotMatch(source,/\.from\(|\.insert\(|\.update\(/);
});

test('Resident and driver dashboards expose complete real-order UX',()=>{
  const resident=read('client-app/index.html');
  const driver=read('driver-app/index.html');
  for(const id of ['taxiOrderOpen','taxiDialog','taxiForm','taxiPickup',
    'taxiDestination','taxiNote','taxiOrderList','taxiSubmit','taxiOrderRefresh'])
    assert.ok(resident.includes('id="'+id+'"'),'Missing resident '+id);
  for(const id of ['driverOrdersPanel','driverOrderList','ordersNotice',
    'enableOrdersNotification','refreshDriverOrders','lineSwitch'])
    assert.ok(driver.includes('id="'+id+'"'),'Missing driver '+id);
  assert.match(resident,/import\('\.\/taxi-orders\.js'\)/);
  assert.match(driver,/import\('\.\/orders\.js'\)/);
  assert.match(driver,/setInterval\(\(\)=>\{void refreshDriverOrders\(\)\},12000\)/);
  assert.match(driver,/window\.Notification\.requestPermission\(\)/);
  assert.match(driver,/notifyNewTaxiOrder/);
  assert.match(driver,/currentDriver\?\.is_online/);
  assert.match(driver,/acceptDriverTaxiOrder\(client,item\.id\)/);
  assert.match(driver,/completeDriverTaxiOrder\(client,item\.id\)/);
  assert.match(resident,/cancelTaxiOrder\(taxiClient,item\.id\)/);
  assert.doesNotMatch(driver,/id="goOnline"|id="goOffline"/);
  assert.doesNotMatch(driver,/Фальшивые поездки/);
});

test('SQL 013 protects taxi orders with private table and server authorization',()=>{
  const sql=read('supabase/migrations/013_taxi_orders.sql');
  assert.match(sql,/alter table public\.daapp_taxi_orders enable row level security/);
  assert.match(sql,/revoke all on public\.daapp_taxi_orders from public,anon,authenticated/);
  assert.match(sql,/create unique index daapp_one_active_taxi_per_passenger/);
  assert.match(sql,/create unique index daapp_one_accepted_taxi_per_driver/);
  assert.match(sql,/where o\.id=p_order_id and o\.status='requested'/);
  assert.match(sql,/d\.review_status='approved' and d\.is_online/);
  assert.match(sql,/o\.driver_id=v_uid/);
  assert.match(sql,/o\.passenger_id=v_uid/);
  assert.match(sql,/grant execute on function public\.daapp_taxi_driver_orders\(\)/);
  assert.doesNotMatch(sql,/grant select on public\.daapp_taxi_orders/);
});
