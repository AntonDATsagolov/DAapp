-- Disposable CI only: test SQL 013 dispatch with synthetic users, no production writes.
\set ON_ERROR_STOP on
\echo 'Taxi: anonymous visitors cannot see private orders or submit a booking'
set role anon;
set request.jwt.claim.sub='';
do $$
begin
  begin
    perform count(*) from public.daapp_taxi_orders;
    raise exception 'Anonymous user browsed taxi rows';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.daapp_taxi_create_order('Shieli street one 1','Railway station');
    raise exception 'Anonymous user created a taxi order';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'Taxi: verified resident creates first real request'
set role authenticated;
set request.jwt.claim.sub='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
do $$
begin
  begin
    perform public.daapp_taxi_create_order('x','x');
    raise exception 'Invalid addresses allowed';
  exception when invalid_parameter_value then null;
  end;
end $$;
select public.daapp_taxi_create_order(
  'Shieli Abay 15','Shieli railway station','Near the gate'
) as first_order_id \gset

do $$
begin
  if (select count(*) from public.daapp_taxi_my_orders()
      where status='requested' and driver_phone is null)<>1 then
    raise exception 'Passenger does not see just their pending request';
  end if;
  begin
    perform public.daapp_taxi_create_order('Shieli Abay 16','Shieli station');
    raise exception 'Passenger created duplicate active trip' using errcode='XX000';
  exception when raise_exception or unique_violation then null;
  end;
  begin
    perform public.daapp_taxi_accept_order(
      '00000000-0000-4000-8000-000000000099'::uuid);
    raise exception 'Passenger assigned their own driver';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.daapp_taxi_orders;
    raise exception 'Passenger directly browsed private taxi order table';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'Taxi: rejected driver can never list or take any orders'
set role authenticated;
set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
begin
  begin
    perform * from public.daapp_taxi_driver_orders();
    raise exception 'Rejected driver saw orders';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'Taxi: approved but OFFLINE driver sees no pending requests'
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  if (select count(*) from public.daapp_taxi_driver_orders())<>0 then
    raise exception 'Offline driver saw an open request';
  end if;
  begin
    perform public.daapp_taxi_accept_order(
      (select id from public.daapp_taxi_orders where pickup='Shieli Abay 15'));
    raise exception 'Offline driver accepted a request';
  exception when insufficient_privilege then null;
  end;
end $$;
select public.daapp_driver_set_online(true);
do $$
begin
  if (select count(*) from public.daapp_taxi_driver_orders()
      where status='requested' and passenger_phone is null)<>1 then
    raise exception 'Online driver did not receive request or saw private phone';
  end if;
end $$;
select public.daapp_taxi_accept_order(:'first_order_id'::uuid);
do $$
begin
  if (select count(*) from public.daapp_taxi_driver_orders()
      where status='accepted' and passenger_phone='+77771234567')<>1 then
    raise exception 'Assigned driver did not receive passenger contact';
  end if;
end $$;
reset role;

\echo 'Taxi: passenger sees only assigned driver after atomic acceptance'
set role authenticated;
set request.jwt.claim.sub='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
do $$
begin
  if (select count(*) from public.daapp_taxi_my_orders()
      where status='accepted' and driver_name='Driver Example'
      and driver_phone='+77001112233')<>1 then
    raise exception 'Passenger has no driver contact after acceptance';
  end if;
end $$;
reset role;

\echo 'Taxi: another verified passenger opens a distinct request'
set role authenticated;
set request.jwt.claim.sub='ffffffff-ffff-4fff-8fff-ffffffffffff';
select public.daapp_taxi_create_order(
  'Shieli market main gate','Shieli bus stop',null
) as second_order_id \gset
reset role;
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  begin
    perform public.daapp_taxi_accept_order(
      '00000000-0000-4000-8000-000000000098'::uuid);
    raise exception 'Busy driver accepted multiple simultaneous rides' using errcode='XX000';
  exception when raise_exception or unique_violation then null;
  end;
end $$;
select public.daapp_driver_set_online(false);
do $$
begin
  if (select count(*) from public.daapp_taxi_driver_orders()
       where status='accepted')<>1 then
    raise exception 'Offline driver lost their accepted trip';
  end if;
  if (select count(*) from public.daapp_taxi_driver_orders()
       where status='requested')<>0 then
    raise exception 'Offline driver still sees open queue';
  end if;
  begin
    perform public.daapp_taxi_cancel_order(
      (select id from public.daapp_taxi_orders where pickup='Shieli Abay 15'));
    raise exception 'Driver cancelled a passenger booking';
  exception when insufficient_privilege then null;
  end;
end $$;
select public.daapp_taxi_complete_order(:'first_order_id'::uuid);
do $$
begin
  begin
    perform public.daapp_taxi_complete_order(
      (select id from public.daapp_taxi_orders where pickup='Shieli market main gate'));
    raise exception 'Driver completed a non-assigned booking';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'Taxi: passenger cancels own pending request, no driver may accept it'
set role authenticated;
set request.jwt.claim.sub='ffffffff-ffff-4fff-8fff-ffffffffffff';
select public.daapp_taxi_cancel_order(:'second_order_id'::uuid);
do $$
begin
  if (select count(*) from public.daapp_taxi_my_orders()
      where status='cancelled')<>1 then
    raise exception 'Passenger did not see cancellation';
  end if;
end $$;
reset role;
-- Temporary test-only helper accepts psql variable from SQL outside DO blocks
-- while executing the RPC under the calling authenticated driver's identity.
create function pg_temp.expect_cancelled_unavailable(p_id uuid)
returns void language plpgsql as $
begin
  begin
    perform public.daapp_taxi_accept_order(p_id);
    raise exception 'Driver accepted cancelled order' using errcode='XX000';
  exception when no_data_found then null;
  end;
end $;
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.daapp_driver_set_online(true);
select pg_temp.expect_cancelled_unavailable(:'second_order_id'::uuid);
reset role;

\echo 'Taxi: completed order recorded and direct writes stay denied'
set role authenticated;
set request.jwt.claim.sub='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
do $$
begin
  if (select count(*) from public.daapp_taxi_my_orders()
      where status='completed')<>1 then
    raise exception 'Passenger did not see completed trip';
  end if;
  begin
    update public.daapp_taxi_orders set status='accepted';
    raise exception 'Browser directly changed order state';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo 'PASS: online-only dispatch, assigned phones, unique acceptance, privacy and cancellation'
