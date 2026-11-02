-- DAapp / Step 9: trusted moderation queue for Shieli.
-- Run manually in Supabase SQL Editor after migrations 004 and 005.
-- No user is automatically made admin; bootstrap separately in SQL Editor.
begin;

do $$
begin
  if to_regclass('public.map_places') is null
     or to_regclass('public.place_submissions') is null then
    raise exception 'Migrations 004 and 005 are required before migration 006.';
  end if;
  if to_regclass('public.daapp_admins') is not null
     or to_regclass('public.daapp_moderation_log') is not null
     or to_regprocedure('public.daapp_admin_list_submissions()') is not null
     or to_regprocedure('public.daapp_admin_review_submission(uuid,text,double precision,double precision,text)') is not null then
    raise exception 'DAapp moderation objects already exist. Inspect before applying migration 006.';
  end if;
  if not (select c.relrowsecurity from pg_class c
          where c.oid='public.place_submissions'::regclass)
     or not (select c.relrowsecurity from pg_class c
          where c.oid='public.map_places'::regclass) then
    raise exception 'Required RLS is not enabled on place_submissions and map_places.';
  end if;
end $$;

-- Separate allowlist. Browser users cannot nominate themselves.
create table public.daapp_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  assigned_at timestamptz not null default now()
);
alter table public.daapp_admins enable row level security;
create policy "daapp_admins_read_self"
  on public.daapp_admins for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.daapp_admins from public, anon, authenticated;
grant select (user_id) on public.daapp_admins to authenticated;

-- Audit available only to trusted SQL Editor administrators.
create table public.daapp_moderation_log (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.place_submissions(id),
  actor_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approved','rejected')),
  published_place_id uuid references public.map_places(id) on delete set null,
  decided_at timestamptz not null default now()
);
alter table public.daapp_moderation_log enable row level security;
revoke all on public.daapp_moderation_log from public, anon, authenticated;

create or replace function public.daapp_admin_list_submissions()
returns table(
  id uuid,
  name text,
  category text,
  address text,
  contact_phone text,
  latitude double precision,
  longitude double precision,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.daapp_admins a where a.user_id = v_actor
  ) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  return query
    select s.id, s.name, s.category, s.address,
           s.contact_phone, s.latitude, s.longitude, s.created_at
    from public.place_submissions s
    where s.status = 'pending'
    order by s.created_at asc
    limit 100;
end;
$$;

-- Approval requires VERIFIED coordinates supplied explicitly by an administrator.
-- The applicant's unverified coordinates are NEVER published automatically.
-- The applicant's private contact phone is NEVER copied automatically.
create or replace function public.daapp_admin_review_submission(
  p_submission_id uuid,
  p_decision text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_public_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_submission public.place_submissions%rowtype;
  v_place_id uuid := null;
  v_phone text := nullif(btrim(p_public_phone), '');
begin
  if v_actor is null or not exists (
    select 1 from public.daapp_admins a where a.user_id = v_actor
  ) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_decision not in ('approved','rejected') or p_decision is null then
    raise exception 'Invalid moderation decision' using errcode = '22023';
  end if;
  if v_phone is not null and char_length(v_phone) > 40 then
    raise exception 'Public phone must be <= 40 characters' using errcode = '22023';
  end if;

  -- Lock the pending row: two moderators cannot publish the same submission twice.
  select * into v_submission
  from public.place_submissions s
  where s.id = p_submission_id and s.status = 'pending'
  for update;
  if not found then
    raise exception 'Pending submission not found' using errcode = 'P0002';
  end if;

  if p_decision = 'approved' then
    if p_latitude is null or p_longitude is null
      or not (p_latitude between 44.05 and 44.31)
      or not (p_longitude between 66.55 and 66.94) then
      raise exception 'Verified coordinates inside Shieli are required'
        using errcode = '22023';
    end if;

    insert into public.map_places
      (name, category, address, phone, latitude, longitude, is_published)
    values
      (v_submission.name, v_submission.category, v_submission.address,
       v_phone, p_latitude, p_longitude, true)
    returning id into v_place_id;
  end if;

  update public.place_submissions
  set status = p_decision
  where id = p_submission_id;

  insert into public.daapp_moderation_log
    (submission_id, actor_id, decision, published_place_id)
  values
    (p_submission_id, v_actor, p_decision, v_place_id);

  return v_place_id;
end;
$$;

revoke all on function public.daapp_admin_list_submissions()
  from public, anon, authenticated;
grant execute on function public.daapp_admin_list_submissions()
  to authenticated;

revoke all on function public.daapp_admin_review_submission(
  uuid, text, double precision, double precision, text
) from public, anon, authenticated;
grant execute on function public.daapp_admin_review_submission(
  uuid, text, double precision, double precision, text
) to authenticated;

commit;

-- IMPORTANT: NO ADMINS ARE CREATED BY THIS SCRIPT.
-- Bootstrap exactly one trusted administrator in Supabase SQL Editor:
-- insert into public.daapp_admins(user_id)
-- select id from auth.users where email = 'YOUR_OWN_SIGN_IN_EMAIL'
-- on conflict (user_id) do nothing;
-- Check exactly which user was inserted before opening admin-app.
-- Never add an admin through browser JavaScript or grant admin to all profiles.
