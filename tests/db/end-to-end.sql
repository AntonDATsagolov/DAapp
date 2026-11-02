-- DAapp real PostgreSQL integration test, but ONLY in a disposable CI database.
-- Assumes migrations 004, 005, 006 were applied in sequence in CI.
\set ON_ERROR_STOP on
\echo 'DAapp DB integration: bootstrap synthetic administrator'
insert into public.daapp_admins(user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

\echo 'DAapp DB integration: business applicant creates two pending submissions'
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

insert into public.place_submissions (name,category,address,contact_phone)
values
 ('CI Approval Candidate','shop','Shieli, test street 1','+77000000000'),
 ('CI Rejection Candidate','cafe','Shieli, test street 2','+77000000001');

select id as approve_id from public.place_submissions
where name = 'CI Approval Candidate' \gset
select id as reject_id from public.place_submissions
where name = 'CI Rejection Candidate' \gset

do $$
begin
 if (select count(*) from public.place_submissions) <> 2 then
   raise exception 'Business applicant cannot read own submissions';
 end if;
 if (select count(*) from public.place_submissions where status = 'pending') <> 2 then
   raise exception 'Default submission status must be pending';
 end if;

 -- The client has no right to pick a moderation status.
 begin
   insert into public.place_submissions(name,category,address,contact_phone,status)
   values ('Malicious candidate','shop','Shieli bad address','+77000000000','approved');
   raise exception 'Client unexpectedly set status=approved';
 exception when insufficient_privilege then null;
 end;

 -- The client must not be able to create public places.
 begin
   insert into public.map_places(name,category,address,latitude,longitude,is_published)
   values ('Malicious public pin','shop','Shieli bad address',44.176,66.741,true);
   raise exception 'Client unexpectedly published directly';
 exception when insufficient_privilege then null;
 end;

 -- The client must not be able to become an administrator.
 begin
   insert into public.daapp_admins(user_id)
   values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
   raise exception 'Client unexpectedly self-appointed as administrator';
 exception when insufficient_privilege then null;
 end;

 -- Even the owner of a pending submission cannot moderate it via UPDATE.
 begin
   update public.place_submissions set status = 'approved' where name = 'CI Approval Candidate';
   raise exception 'Client unexpectedly updated own moderation status';
 exception when insufficient_privilege then null;
 end;
end;
$$;

\echo 'DAapp DB integration: unauthorised user is isolated'
set request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
begin
 if (select count(*) from public.place_submissions) <> 0 then
   raise exception 'RLS leaked a different applicant submission';
 end if;
 if (select count(*) from public.daapp_admins) <> 0 then
   raise exception 'RLS leaked admin allowlist to non-admin';
 end if;
 begin
   perform public.daapp_admin_list_submissions();
   raise exception 'Non-admin accessed moderation queue';
 exception when insufficient_privilege then null;
 end;
end;
$$;

\echo 'DAapp DB integration: administrator can read private moderation queue only via RPC'
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
 if (select count(*) from public.place_submissions) <> 0 then
   raise exception 'Admin should not bypass ordinary applicant SELECT RLS';
 end if;
 if (select count(*) from public.daapp_admin_list_submissions()) <> 2 then
   raise exception 'Authorised RPC did not return both pending submissions';
 end if;
end;
$$;

-- Invalid coordinates must be rejected without changing the request.
create function pg_temp.expect_invalid_coordinates(p_id uuid)
returns void language plpgsql as $$
begin
 begin
   perform public.daapp_admin_review_submission(p_id, 'approved', null, null, null);
   raise exception 'Admin published without verified coordinates';
 exception when invalid_parameter_value then null;
 end;
end;
$$;
select pg_temp.expect_invalid_coordinates(:'approve_id'::uuid);

\echo 'DAapp DB integration: publish verified place atomically'
select public.daapp_admin_review_submission(
 :'approve_id'::uuid, 'approved',44.17603,66.74096,null
) as published_place_id \gset

do $$
begin
 if (select count(*) from public.daapp_admin_list_submissions()) <> 1 then
   raise exception 'Approved request remains in pending queue';
 end if;
end;
$$;

\echo 'DAapp DB integration: double approval is refused'
create function pg_temp.expect_duplicate_denied(p_id uuid)
returns void language plpgsql as $$
begin
 begin
   perform public.daapp_admin_review_submission(p_id, 'approved',44.17603,66.74096,null);
   raise exception 'Duplicate approval succeeded';
 exception when no_data_found then null;
 end;
end;
$$;
select pg_temp.expect_duplicate_denied(:'approve_id'::uuid);

\echo 'DAapp DB integration: rejection leaves no public pin'
select public.daapp_admin_review_submission(
 :'reject_id'::uuid, 'rejected',null,null,null
);

do $$
begin
 if (select count(*) from public.daapp_admin_list_submissions()) <> 0 then
   raise exception 'Rejected request remains pending';
 end if;
end;
$$;

\echo 'DAapp DB integration: public anonymous user sees approved pin only'
reset role;
set role anon;
set request.jwt.claim.sub = '';
do $$
begin
 if (select count(*) from public.map_places) <> 1 then
   raise exception 'Published map count is not exactly one';
 end if;
 if (select count(*) from public.map_places
     where name = 'CI Approval Candidate' and phone is null) <> 1 then
   raise exception 'Incorrect public place or private phone was published';
 end if;
 -- Reading private applications must be forbidden to anonymous callers.
 begin
   perform count(*) from public.place_submissions;
   raise exception 'Anonymous user read private submissions';
 exception when insufficient_privilege then null;
 end;
end;
$$;

\echo 'DAapp DB integration: privileged audit of synthetic test transaction'
reset role;
do $$
begin
 if (select count(*) from public.place_submissions where status = 'approved') <> 1
 or (select count(*) from public.place_submissions where status = 'rejected') <> 1 then
   raise exception 'Incorrect final application statuses';
 end if;
 if (select count(*) from public.daapp_moderation_log) <> 2 then
   raise exception 'Moderation audit must contain exactly two decisions';
 end if;
 if (select count(*) from public.daapp_moderation_log
     where decision = 'approved' and published_place_id is not null) <> 1 then
   raise exception 'Approved place is not tracked in audit';
 end if;
 if (select count(*) from public.daapp_moderation_log
     where decision = 'rejected' and published_place_id is null) <> 1 then
   raise exception 'Rejected action unexpectedly published a place';
 end if;
 if (select count(*) from public.map_places) <> 1 then
   raise exception 'Exactly one approved map point expected';
 end if;
end;
$$;

\echo 'PASS: real PostgreSQL application / RLS / moderation integration test completed in isolated CI'
