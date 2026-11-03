-- CI only: verified email, human review, private phone and opted-in directory.
\set ON_ERROR_STOP on
\echo 'Registration: all new Auth users become pending, including bypass attempts'
insert into auth.users(id,email,raw_user_meta_data)
values(
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 'member.email.test@example.invalid',
 '{"daapp_registration":{"flow":"email_manual_v1","username":"new_shieli","phone":"+77771234567","age":26,"residency":"resident","publish_phone":true}}'::jsonb
);
insert into auth.users(id,email) values(
 '11111111-1111-4111-8111-111111111111','no-form@example.invalid'
);
do $$
begin
 if (select count(*) from public.daapp_member_accounts
   where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' and
     username='new_shieli' and age_at_registration=26) <> 1 then
  raise exception 'Username not reserved at registration';
 end if;
 if (select count(*) from public.daapp_account_applications
   where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and status='pending' and public_phone=true
     and phone_number='+77771234567' and residency='resident') <> 1 then
  raise exception 'Full pending contact application missing';
 end if;
 if (select count(*) from public.daapp_account_applications
   where user_id='11111111-1111-4111-8111-111111111111'
     and status='pending') <> 1 then
  raise exception 'Untracked signup bypassed approval';
 end if;
end $$;

\echo 'Registration: pending users cannot read their profiles or enroll drivers'
set role authenticated;
set request.jwt.claim.sub='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
do $$
begin
 if public.daapp_account_approved() then
  raise exception 'Pending account was treated as approved';
 end if;
 if (select count(*) from public.profiles) <> 0 then
  raise exception 'Pending account saw protected profile';
 end if;
 if (select count(*) from public.daapp_account_applications) <> 1 then
  raise exception 'Applicant should see only own application';
 end if;
 begin
  insert into public.driver_registrations
     (full_name,contact_phone,vehicle_type,vehicle_model,vehicle_plate)
  values ('New Driver','+77771234567','passenger','Sedan','111ABC11');
  raise exception 'Pending account enrolled driver';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.daapp_set_avatar_path(
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp');
  raise exception 'Unverified email attached avatar';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.daapp_public_member_directory(50);
  raise exception 'Pending account read public contact list';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

-- Unconfirmed email must not upload files, even with valid user-owned path.
do $$
begin
 begin
  insert into storage.objects(bucket_id,name) values(
    'daapp-avatars',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp');
  raise exception 'Unconfirmed email bypassed upload restriction';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

\echo 'Registration: only trusted admin may review and approval needs email confirmation'
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
 if (select count(*) from public.daapp_admin_list_accounts()
   where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     and not email_verified and phone_number='+77771234567') <> 1 then
  raise exception 'Admin pending queue did not include application';
 end if;
 begin
  perform public.daapp_admin_review_account(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','approved');
  raise exception 'Unconfirmed email was approved';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
update auth.users set email_confirmed_at=now()
 where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.daapp_admin_review_account(
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','approved');
reset role;

\echo 'Registration: approved account retains resident access and controls public phone'
set role authenticated;
set request.jwt.claim.sub='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
do $$
begin
 if not public.daapp_account_approved() then
  raise exception 'Approved account remains blocked';
 end if;
 if (select count(*) from public.profiles) <> 1 then
  raise exception 'Approved user lost own profile';
 end if;
 if (select count(*) from public.daapp_public_member_directory(50)
      where username='new_shieli' and phone_number='+77771234567') <> 1 then
  raise exception 'Opted-in phone not available after approval';
 end if;
end $$;
select public.daapp_set_avatar_path(
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp');
select public.daapp_set_phone_visibility(false);
do $$
begin
 if (select count(*) from public.daapp_public_member_directory(50)
     where username='new_shieli') <> 0 then
  raise exception 'Revoked phone consent still public';
 end if;
end $$;
select public.daapp_set_phone_visibility(true);
reset role;

-- Confirmed owners can upload ONLY to own path and permitted formats.
insert into storage.objects(bucket_id,name) values(
  'daapp-avatars',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png');
do $$
begin
 begin
  insert into storage.objects(bucket_id,name) values(
    'daapp-avatars',
    'ffffffff-ffff-4fff-8fff-ffffffffffff/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp');
  raise exception 'User uploaded another account avatar';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into storage.objects(bucket_id,name) values(
    'daapp-avatars',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.svg');
  raise exception 'Unsupported avatar extension allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

\echo 'Registration: under-age accounts must never publish a contact number'
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(
 'ffffffff-ffff-4fff-8fff-ffffffffffff',
 'teen.test@example.invalid', now(),
 '{"daapp_registration":{"flow":"email_manual_v1","username":"teen_shieli","phone":"+77779998877","age":16,"residency":"guest","publish_phone":true}}'::jsonb
);
do $$
begin
 if (select public_phone from public.daapp_account_applications
     where user_id='ffffffff-ffff-4fff-8fff-ffffffffffff') is distinct from false then
  raise exception 'Minor was given public phone listing';
 end if;
end $$;
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.daapp_admin_review_account(
 'ffffffff-ffff-4fff-8fff-ffffffffffff','approved');
set request.jwt.claim.sub='ffffffff-ffff-4fff-8fff-ffffffffffff';
do $$
begin
 begin
  perform public.daapp_set_phone_visibility(true);
  raise exception 'Minor enabled public phone';
 exception when insufficient_privilege then null;
 end;
 if (select count(*) from public.daapp_public_member_directory(50)
     where username='teen_shieli') <> 0 then
  raise exception 'Minor appeared in public directory';
 end if;
end $$;
reset role;

\echo 'Registration: other approved users can see only explicitly shared numbers'
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
 if not public.daapp_account_approved() then
  raise exception 'Existing account unexpectedly blocked';
 end if;
 if (select count(*) from public.daapp_public_member_directory(50)
      where username='new_shieli')<>1 then
  raise exception 'Opted-in public phone missing to other users';
 end if;
 if (select count(*) from public.daapp_account_applications)<>0 then
  raise exception 'Another account private applications leaked';
 end if;
end $$;
reset role;
\echo 'PASS: email+password registration review and opt-in phone directory'
