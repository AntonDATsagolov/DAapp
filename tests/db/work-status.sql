-- DAapp SQL 012: disposable PostgreSQL CI only. Requires migrations 001-012.
\set ON_ERROR_STOP on
\echo 'DAapp work status: public records start closed until owner changes them'
select id as owner_place_id from public.map_places
 where name='CI Approval Candidate' and is_published=true \gset
select id as other_place_id from public.map_places
 where name='Mode Test Shop' and is_published=true \gset

do $$
begin
 if (select count(*) from public.map_places where is_working)<>0 then
  raise exception 'Previously published businesses should start as not working';
 end if;
end $$;

\echo 'DAapp work status: approved owner controls only their reviewed published place'
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
declare v record;
begin
 if (select count(*) from public.daapp_business_my_workplaces()) <> 1 then
   raise exception 'Owner should have exactly one published workplace';
 end if;
 select * into v from public.daapp_business_my_workplaces();
 if v.name <> 'CI Approval Candidate' or v.is_working then
   raise exception 'Unexpected owned place: %',row_to_json(v);
 end if;
 begin
   update public.map_places set is_working=true where name='CI Approval Candidate';
   raise exception 'Browser bypassed the owner-only work-status RPC';
 exception when insufficient_privilege then null;
 end;
end $$;
select public.daapp_business_set_working(:'owner_place_id'::uuid,true);
do $$
begin
 if not (select is_working from public.daapp_business_my_workplaces() limit 1) then
   raise exception 'Owner could not turn workplace on';
 end if;
 begin
   perform public.daapp_business_set_working(:'other_place_id'::uuid,true);
   raise exception 'Owner controlled another member workplace';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.daapp_business_set_working(null,true);
   raise exception 'Null place was accepted';
 exception when invalid_parameter_value then null;
 end;
end $$;
reset role;

\echo 'DAapp work status: anonymous residents see only published status'
set role anon;
set request.jwt.claim.sub='';
do $$
begin
 if (select count(*) from public.map_places
     where name='CI Approval Candidate' and is_working=true)<>1 then
   raise exception 'Published working status not visible to residents';
 end if;
 if (select count(*) from public.map_places where name='CI Hidden Draft')<>0 then
   raise exception 'Unpublished places became public';
 end if;
 if public.daapp_public_available_drivers()<>0 then
   raise exception 'Unexpected drivers are on line before test';
 end if;
 begin
   perform public.daapp_business_my_workplaces();
   raise exception 'Anonymous caller viewed private business ownership';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.daapp_business_set_working(:'owner_place_id'::uuid,false);
   raise exception 'Anonymous caller changed working status';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

\echo 'DAapp work status: unrelated authenticated account cannot change business'
set role authenticated;
set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
begin
 if (select count(*) from public.daapp_business_my_workplaces())<>0 then
   raise exception 'Non-owner read private workplace controls';
 end if;
 begin
   perform public.daapp_business_set_working(:'owner_place_id'::uuid,false);
   raise exception 'Non-owner changed workplace status';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

\echo 'DAapp work status: driver on/off changes public COUNT only, no PII'
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.daapp_driver_set_online(true);
reset role;
set role anon;
set request.jwt.claim.sub='';
do $$
begin
 if public.daapp_public_available_drivers()<>1 then
   raise exception 'Public online driver count should be 1';
 end if;
 begin
   perform count(*) from public.driver_registrations;
   raise exception 'Anonymous user can read private driver information';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.daapp_driver_set_online(false);
select public.daapp_business_set_working(:'owner_place_id'::uuid,false);
reset role;
do $$
begin
 if public.daapp_public_available_drivers()<>0 then
   raise exception 'Driver remained online after end of shift';
 end if;
 if (select is_working from public.map_places where name='CI Approval Candidate') then
   raise exception 'Business remained working after end of shift';
 end if;
end $$;
\echo 'PASS: business and taxi status changes, public display and ownership access'
