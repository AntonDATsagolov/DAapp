-- CI ONLY, disposable daapp_ci. SQL 010 after migration 009.
\set ON_ERROR_STOP on
\echo 'DAapp: newly verified residents activate automatically without administrator'
insert into auth.users(id,email,raw_user_meta_data) values(
 '22222222-2222-4222-8222-222222222222',
 'normal.new@example.invalid',
 '{"daapp_registration":{"flow":"email_manual_v1","username":"new_resident","phone":"+77770000001","age":25,"residency":"guest","goal":"resident","publish_phone":false}}'::jsonb
);
do $$
begin
 if (select status from public.daapp_account_applications
     where user_id='22222222-2222-4222-8222-222222222222')<>'pending' then
  raise exception 'Unconfirmed email was activated';
 end if;
end $$;
update auth.users set email_confirmed_at=now()
 where id='22222222-2222-4222-8222-222222222222';
do $$
begin
 if (select status from public.daapp_account_applications
     where user_id='22222222-2222-4222-8222-222222222222')<>'approved' then
  raise exception 'Verified resident not activated automatically';
 end if;
end $$;
set role authenticated;
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$
begin
 if not public.daapp_account_approved() then
  raise exception 'Resident cannot access own account';
 end if;
 if (select count(*) from public.profiles)<>1 then
  raise exception 'Resident profile not accessible';
 end if;
 begin
  perform public.daapp_admin_dashboard();
  raise exception 'Regular member read admin overview';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.daapp_admin_member_register('', 'all', 10, 0);
  raise exception 'Regular member read admin member registry';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.daapp_architect_update_settings(false,false);
  raise exception 'Regular user changed architect settings';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into public.daapp_architects(user_id)
     values('22222222-2222-4222-8222-222222222222');
  raise exception 'Member self-declared architect';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

\echo 'DAapp: choosing driver is only an onboarding intent'
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(
 '33333333-3333-4333-8333-333333333333',
 'new.driver@example.invalid',now(),
 '{"daapp_registration":{"flow":"email_manual_v1","username":"new_driver","phone":"+77770000002","age":31,"residency":"resident","goal":"driver","publish_phone":false}}'::jsonb
);
do $$
begin
 if (select status from public.daapp_account_applications
     where user_id='33333333-3333-4333-8333-333333333333')<>'approved' then
  raise exception 'Instantly confirmed user not activated';
 end if;
 if (select onboarding_goal from public.daapp_account_applications
     where user_id='33333333-3333-4333-8333-333333333333')<>'driver' then
  raise exception 'Initial driver goal missing';
 end if;
 if exists(select 1 from public.driver_registrations
     where user_id='33333333-3333-4333-8333-333333333333') then
  raise exception 'Driver status assigned without review';
 end if;
end $$;
-- An account created outside the DAapp signup form never self-activates.
insert into auth.users(id,email,email_confirmed_at) values(
 '44444444-4444-4444-8444-444444444444',
 'untracked@example.invalid',now()
);
do $$
begin
 if (select status from public.daapp_account_applications
     where user_id='44444444-4444-4444-8444-444444444444')<>'pending' then
  raise exception 'Incomplete signup bypassed account approval';
 end if;
end $$;

\echo 'DAapp: moderator dashboard is server restricted'
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare v jsonb;
begin
 v:=public.daapp_admin_dashboard();
 if v->>'is_architect'<>'false' then
  raise exception 'Normal admin has architect powers';
 end if;
 if (v->>'all_auth_users')::integer<7 then
  raise exception 'Overview missed accounts';
 end if;
 if (select count(*) from public.daapp_admin_member_register(
     'new_resident','approved',40,0))<>1 then
  raise exception 'Searchable approved user missing';
 end if;
 begin
  perform public.daapp_architect_set_member_state(
   '22222222-2222-4222-8222-222222222222','rejected','fraud check');
  raise exception 'Moderator could block accounts';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

\echo 'DAapp: a trusted architect can adjust settings with audit'
insert into public.daapp_architects(user_id)
 values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.daapp_architect_update_settings(false,false);
set request.jwt.claim.sub='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
do $
begin
 if (select count(*) from public.daapp_public_member_directory(20))<>0 then
  raise exception 'Architect-disabled contacts directory still reveals phones';
 end if;
end $;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $
declare v jsonb;
begin
 v:=public.daapp_admin_dashboard();
 if v->>'is_architect'<>'true' then
  raise exception 'Architect not recognized';
 end if;
 if (v->'settings'->>'auto_activate_after_email')<>'false' then
  raise exception 'Auto approval setting did not persist';
 end if;
 if not exists(select 1 from public.daapp_architect_recent_audit(10)
    where operation='settings_update') then
  raise exception 'Settings audit missing';
 end if;
 begin
  perform public.daapp_architect_set_member_state(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','rejected','self test');
  raise exception 'Architect could suspend self';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

\echo 'DAapp: disabled auto activate requires manual review'
insert into auth.users(id,email,raw_user_meta_data) values(
 '55555555-5555-4555-8555-555555555555',
 'new.requires.review@example.invalid',
 '{"daapp_registration":{"flow":"email_manual_v1","username":"review_needed","phone":"+77770000005","age":24,"residency":"resident","goal":"business","publish_phone":false}}'::jsonb
);
update auth.users set email_confirmed_at=now()
 where id='55555555-5555-4555-8555-555555555555';
do $$
begin
 if (select status from public.daapp_account_applications
     where user_id='55555555-5555-4555-8555-555555555555')<>'pending' then
  raise exception 'Manual approval setting ignored';
 end if;
end $$;
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.daapp_admin_review_account(
 '55555555-5555-4555-8555-555555555555','approved');
select public.daapp_architect_update_settings(true,true);
-- account block and restore are audited and effective through existing RLS
select public.daapp_architect_set_member_state(
 '22222222-2222-4222-8222-222222222222','rejected','Test suspension');
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$
begin
 if public.daapp_account_approved() or
    (select count(*) from public.profiles)<>0 then
  raise exception 'Blocked user retained protected access';
 end if;
end $$;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.daapp_architect_set_member_state(
 '22222222-2222-4222-8222-222222222222','approved','Test restoration');
do $$
begin
 if (select count(*) from public.daapp_architect_recent_audit(30))<4 then
   raise exception 'Audit did not track settings, blocks, restores';
 end if;
end $$;
reset role;
\echo 'PASS: self-service registration, optional manual moderation, architect controls & audit'
