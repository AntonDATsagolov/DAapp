-- Disposable CI only. Requires migrations 001-011 and previous tests/db steps.
\set ON_ERROR_STOP on
\echo 'DAapp modes: a resident has only the resident mode after signup'
set role authenticated;
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$
declare v jsonb;
begin
 v:=public.daapp_mode_status();
 if v->>'approved'<>'true'
    or v->>'last_mode'<>'resident'
    or v->'available_modes'<>'["resident"]'::jsonb then
   raise exception 'Resident mode set is incorrect: %',v;
 end if;
 begin
   perform public.daapp_set_last_mode('driver');
   raise exception 'Resident entered unapproved driver mode';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.daapp_set_last_mode('business');
   raise exception 'Resident entered unapproved business mode';
 exception when insufficient_privilege then null;
 end;
 begin
   insert into public.daapp_member_navigation(user_id,last_mode)
   values('22222222-2222-4222-8222-222222222222','driver');
   raise exception 'User wrote unauthorized mode directly';
 exception when insufficient_privilege then null;
 end;
end $$;
select public.daapp_set_last_mode('resident');
reset role;

\echo 'DAapp modes: applications do not activate driver/business mode'
set role authenticated;
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
insert into public.driver_registrations
(full_name,contact_phone,vehicle_type,vehicle_model,vehicle_plate)
values('Mode Test Driver','+77770000001','passenger','Toyota Camry','011DA11');
insert into public.place_submissions
(name,category,address,contact_phone)
values('Mode Test Shop','shop','Shieli test street 11','+77770000001');
do $$
declare v jsonb;
begin
 v:=public.daapp_mode_status();
 if v->'available_modes'<>'["resident"]'::jsonb or
    v->>'driver_application'<>'pending' or
    v->>'business_application'<>'pending' then
  raise exception 'Pending applications incorrectly unlock working mode: %',v;
 end if;
end $$;
reset role;

\echo 'DAapp modes: trusted administrator approves driver and business separately'
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.daapp_admin_review_driver(
 '22222222-2222-4222-8222-222222222222','approved');
select id as mode_shop_id from public.daapp_admin_list_submissions()
 where name='Mode Test Shop' \gset
select public.daapp_admin_review_submission(
 :'mode_shop_id', 'approved', 44.176,66.740,null);
reset role;

\echo 'DAapp modes: all confirmed roles can switch and last one survives re-login'
set role authenticated;
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$
declare v jsonb;
begin
 v:=public.daapp_mode_status();
 if not (v->'available_modes' @> '["resident","driver","business"]'::jsonb) then
   raise exception 'Reviewed roles not offered: %',v;
 end if;
end $$;
select public.daapp_set_last_mode('driver');
select public.daapp_set_last_mode('business');
reset role;
-- Simulates new browser session: preference is stored in Postgres, not local.
set role authenticated;
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$
declare v jsonb;
begin
 v:=public.daapp_mode_status();
 if v->>'last_mode'<>'business' then
   raise exception 'Last mode did not persist across sessions';
 end if;
end $$;
select public.daapp_driver_set_online(true);
reset role;

\echo 'DAapp modes: suspending an account removes all modes and stops the line'
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.daapp_architect_set_member_state(
 '22222222-2222-4222-8222-222222222222','rejected',
 'Test mode access suspension');
reset role;
do $$
begin
 if exists(select 1 from public.driver_registrations
  where user_id='22222222-2222-4222-8222-222222222222' and is_online=true) then
   raise exception 'Suspended driver remained online';
 end if;
end $$;
set role authenticated;
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$
declare v jsonb;
begin
 v:=public.daapp_mode_status();
 if v->>'approved'<>'false' or v->'available_modes'<>'[]'::jsonb then
   raise exception 'Suspended user still has modes: %',v;
 end if;
 begin
   perform public.daapp_set_last_mode('business');
   raise exception 'Blocked user changed mode';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.daapp_driver_set_online(true);
   raise exception 'Blocked user returned to driver line';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

\echo 'DAapp modes: revoked driver approval cannot be bypassed via remembered mode'
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.daapp_architect_set_member_state(
 '22222222-2222-4222-8222-222222222222','approved',
 'Test restored mode access');
reset role;
-- Administrative revocation simulation in isolated database.
update public.driver_registrations set review_status='rejected',is_online=false
 where user_id='22222222-2222-4222-8222-222222222222';
set role authenticated;
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$
declare v jsonb;
begin
 v:=public.daapp_mode_status();
 if v->'available_modes' @> '["driver"]'::jsonb then
   raise exception 'Revoked driver still available';
 end if;
 begin
   perform public.daapp_set_last_mode('driver');
   raise exception 'Revoked driver mode was restored';
 exception when insufficient_privilege then null;
 end;
end $$;
select public.daapp_set_last_mode('resident');
reset role;
\echo 'PASS: cross-device mode recovery, reviewed access and safe fallback'
