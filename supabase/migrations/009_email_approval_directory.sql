-- DAapp 009: email+password registration, manual administrator approval,
-- private phone until explicit publication consent, and a verified avatar.
-- One-time migration. Requires profiles (001) and daapp_admins (006).
-- Independent of SMS provider; works with or without earlier SQL 008.
begin;

do $$
begin
  if to_regclass('public.profiles') is null or
     to_regclass('public.daapp_admins') is null then
    raise exception 'Apply 001 profiles and 006 daapp_admins first';
  end if;
  if to_regclass('public.daapp_account_applications') is not null then
    raise exception 'DAapp 009 already installed; do not execute twice';
  end if;
end $$;

-- Reuse existing 008 usernames if present, or create compatible private
-- membership records when user skipped 008 and SMS setup.
create table if not exists public.daapp_member_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (
    username = lower(username) and username ~ '^[a-z][a-z0-9_]{3,23}$'
  ),
  age_at_registration integer not null check (age_at_registration between 13 and 120),
  registered_at timestamptz not null default now()
);
create unique index if not exists daapp_member_username_unique_idx
  on public.daapp_member_accounts(username);
alter table public.daapp_member_accounts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='daapp_member_accounts'
      and policyname='daapp_member_read_self') then
    create policy daapp_member_read_self on public.daapp_member_accounts
      for select to authenticated using (user_id=(select auth.uid()));
  end if;
end $$;
revoke all on public.daapp_member_accounts from public, anon, authenticated;
grant select (user_id, username, age_at_registration, registered_at)
  on public.daapp_member_accounts to authenticated;

-- Every new auth.users record gets a pending decision, including attempts to
-- bypass our registration form. Existing email accounts are left untouched.
create table public.daapp_account_applications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_number text check (phone_number is null or
    phone_number ~ '^\\+7[0-9]{10}$'),
  residency text check (residency in ('resident','guest')),
  public_phone boolean not null default false,
  avatar_path text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
create index daapp_account_applications_pending_idx
  on public.daapp_account_applications(created_at) where status='pending';
alter table public.daapp_account_applications enable row level security;
create policy daapp_application_read_own on public.daapp_account_applications
  for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.daapp_account_applications from public, anon, authenticated;
grant select (user_id,phone_number,residency,public_phone,avatar_path,status,created_at)
  on public.daapp_account_applications to authenticated;

create function public.daapp_capture_account_application()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_meta jsonb := new.raw_user_meta_data->'daapp_registration';
  v_username text;
  v_phone text;
  v_age integer;
  v_residency text;
  v_public_phone boolean;
begin
  if coalesce(v_meta->>'flow','')='email_manual_v1' then
    v_username := lower(btrim(coalesce(v_meta->>'username','')));
    v_phone := coalesce(v_meta->>'phone','');
    v_residency := coalesce(v_meta->>'residency','');
    if v_username !~ '^[a-z][a-z0-9_]{3,23}$'
       or v_phone !~ '^\\+7[0-9]{10}$'
       or v_residency not in ('resident','guest')
       or coalesce(v_meta->>'age','') !~ '^[0-9]{1,3}$' then
      raise exception 'Invalid registration fields';
    end if;
    v_age := (v_meta->>'age')::integer;
    if v_age not between 13 and 120 then
      raise exception 'Invalid registration age';
    end if;
    v_public_phone := coalesce((v_meta->>'publish_phone')::boolean,false);
    insert into public.daapp_member_accounts(user_id,username,age_at_registration)
      values (new.id,v_username,v_age);
    insert into public.daapp_account_applications
      (user_id,phone_number,residency,public_phone,status)
      values (new.id,v_phone,v_residency,v_public_phone,'pending');
  else
    -- All other newly created Auth users require review, too. They do not
    -- automatically receive a user-selected username or publication rights.
    insert into public.daapp_account_applications(user_id,status)
      values(new.id,'pending');
  end if;
  return new;
end;
$$;
revoke all on function public.daapp_capture_account_application()
  from public,anon,authenticated;
create trigger daapp_new_user_application
after insert on auth.users
for each row execute function public.daapp_capture_account_application();

-- Legacy users predate this migration and remain allowed without a new
-- application row. Any newly created Auth user has a pending row via trigger.
create function public.daapp_account_approved()
returns boolean language sql stable security definer set search_path=''
as $$
 select (select auth.uid()) is not null and (
   exists(select 1 from public.daapp_admins a
          where a.user_id=(select auth.uid()))
   or not exists(select 1 from public.daapp_account_applications a
          where a.user_id=(select auth.uid()))
   or exists(select 1 from public.daapp_account_applications a
          where a.user_id=(select auth.uid()) and a.status='approved')
 );
$$;
revoke all on function public.daapp_account_approved() from public,anon,authenticated;
grant execute on function public.daapp_account_approved() to authenticated;

-- Restrictive RLS is additive to existing own-row policies: pending users
-- cannot read/write private profiles, submit organisations or enroll drivers.
create policy daapp_only_approved_profile on public.profiles
  as restrictive for all to authenticated
  using (public.daapp_account_approved())
  with check (public.daapp_account_approved());

do $$
begin
  if to_regclass('public.place_submissions') is not null then
    execute 'create policy daapp_only_approved_place_submission on public.place_submissions
      as restrictive for all to authenticated
      using (public.daapp_account_approved())
      with check (public.daapp_account_approved())';
  end if;
  if to_regclass('public.driver_registrations') is not null then
    execute 'create policy daapp_only_approved_driver_submission on public.driver_registrations
      as restrictive for all to authenticated
      using (public.daapp_account_approved())
      with check (public.daapp_account_approved())';
  end if;
end $$;

-- Self-only private profile update; no phone verification is implied.
create function public.daapp_set_phone_visibility(p_public boolean)
returns boolean language plpgsql security definer set search_path=''
as $$
begin
  if (select auth.uid()) is null or not public.daapp_account_approved() then
    raise exception 'Approved account required' using errcode='42501';
  end if;
  if p_public is null then
    raise exception 'Invalid visibility' using errcode='22023';
  end if;
  update public.daapp_account_applications
     set public_phone=p_public where user_id=(select auth.uid())
       and status='approved';
  if not found then raise exception 'No reviewed account record' using errcode='P0002'; end if;
  return p_public;
end;
$$;
revoke all on function public.daapp_set_phone_visibility(boolean)
  from public,anon,authenticated;
grant execute on function public.daapp_set_phone_visibility(boolean)
  to authenticated;

-- Photos are uploaded only after email confirmation, to a per-user path.
-- This metadata RPC cannot approve an account or expose the phone.
create function public.daapp_set_avatar_path(p_path text)
returns text language plpgsql security definer set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists
      (select 1 from auth.users u where u.id=v_uid
        and u.email_confirmed_at is not null) then
    raise exception 'Confirmed email required' using errcode='42501';
  end if;
  if p_path is null or p_path !~
     ('^'||v_uid::text||'/[0-9a-fA-F-]{36}\\.(jpg|jpeg|png|webp)$') then
    raise exception 'Invalid avatar path' using errcode='22023';
  end if;
  update public.daapp_account_applications
     set avatar_path=p_path where user_id=v_uid;
  if not found then raise exception 'Account record missing' using errcode='P0002'; end if;
  return p_path;
end;
$$;
revoke all on function public.daapp_set_avatar_path(text)
  from public,anon,authenticated;
grant execute on function public.daapp_set_avatar_path(text) to authenticated;

-- Admin review and limited, server-side queue (no password or auth secrets).
create function public.daapp_admin_list_accounts()
returns table(
 user_id uuid, username text, email text, phone_number text,
 residency text, public_phone boolean, avatar_path text,
 created_at timestamptz, email_verified boolean
)
language plpgsql security definer set search_path=''
as $$
begin
  if not exists(select 1 from public.daapp_admins a
    where a.user_id=(select auth.uid())) then
    raise exception 'Administrator required' using errcode='42501';
  end if;
  return query
    select r.user_id, m.username, u.email::text, r.phone_number,
           r.residency, r.public_phone, r.avatar_path, r.created_at,
           (u.email_confirmed_at is not null)
    from public.daapp_account_applications r
    join auth.users u on u.id=r.user_id
    left join public.daapp_member_accounts m on m.user_id=r.user_id
    where r.status='pending'
    order by r.created_at asc limit 100;
end;
$$;
revoke all on function public.daapp_admin_list_accounts()
  from public,anon,authenticated;
grant execute on function public.daapp_admin_list_accounts()
  to authenticated;

create function public.daapp_admin_review_account(p_user_id uuid,p_decision text)
returns boolean language plpgsql security definer set search_path=''
as $$
declare
  v_email_ok boolean;
  v_has_username boolean;
  v_has_fields boolean;
begin
  if not exists(select 1 from public.daapp_admins a
    where a.user_id=(select auth.uid())) then
    raise exception 'Administrator required' using errcode='42501';
  end if;
  if p_decision not in ('approved','rejected') or p_decision is null then
    raise exception 'Invalid decision' using errcode='22023';
  end if;
  perform 1 from public.daapp_account_applications r
    where r.user_id=p_user_id and r.status='pending' for update;
  if not found then
    raise exception 'Pending account not found' using errcode='P0002';
  end if;
  if p_decision='approved' then
    select (u.email_confirmed_at is not null) into v_email_ok
      from auth.users u where u.id=p_user_id;
    select exists(select 1 from public.daapp_member_accounts m
      where m.user_id=p_user_id) into v_has_username;
    select (r.phone_number is not null and r.residency is not null)
      into v_has_fields
      from public.daapp_account_applications r where r.user_id=p_user_id;
    if not coalesce(v_email_ok,false)
       or not coalesce(v_has_username,false)
       or not coalesce(v_has_fields,false) then
      raise exception 'Email confirmation and complete registration required'
        using errcode='42501';
    end if;
  end if;
  update public.daapp_account_applications
    set status=p_decision, reviewed_at=now(), reviewed_by=(select auth.uid())
    where user_id=p_user_id and status='pending';
  return true;
end;
$$;
revoke all on function public.daapp_admin_review_account(uuid,text)
  from public,anon,authenticated;
grant execute on function public.daapp_admin_review_account(uuid,text)
  to authenticated;

-- Approved users only can browse people who opted into sharing their number.
create function public.daapp_public_member_directory(p_limit integer default 50)
returns table (user_id uuid, username text, phone_number text, avatar_path text)
language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.daapp_account_approved() then
    raise exception 'Approved account required' using errcode='42501';
  end if;
  return query
    select r.user_id,m.username,r.phone_number,r.avatar_path
    from public.daapp_account_applications r
    join public.daapp_member_accounts m on m.user_id=r.user_id
    where r.status='approved' and r.public_phone=true and r.phone_number is not null
    order by m.username asc limit least(greatest(coalesce(p_limit,50),1),100);
end;
$$;
revoke all on function public.daapp_public_member_directory(integer)
  from public,anon,authenticated;
grant execute on function public.daapp_public_member_directory(integer)
  to authenticated;

-- Public bucket: images are public if URL is known, so keep paths
-- unguessable; no phone numbers are present in Storage.
-- Supabase Storage is absent in the isolated Postgres test database.
do $$
begin
 if to_regclass('storage.buckets') is not null
    and to_regclass('storage.objects') is not null then
   insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('daapp-avatars','daapp-avatars',true,1572864,
     array['image/jpeg','image/png','image/webp'])
   on conflict(id) do nothing;
   execute $policy$
      create policy daapp_avatar_upload_self
      on storage.objects for insert to authenticated
      with check (
        bucket_id='daapp-avatars'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and name ~ ('^'||(select auth.uid())::text||
          '/[0-9a-fA-F-]{36}\\.(jpg|jpeg|png|webp)$')
        and exists(select 1 from auth.users u
          where u.id=(select auth.uid()) and u.email_confirmed_at is not null)
      )
   $policy$;
 end if;
end $$;
commit;

-- Admin and member changes are enforced in DB, not only client UI.
-- All existing users are grandfathered; new users start pending.
-- Directory phone display requires an explicit opt-in from the user.
