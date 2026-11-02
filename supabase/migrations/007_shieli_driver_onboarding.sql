-- DAapp / Step 11. Driver registration and reviewed availability in Shieli.
-- Run ONCE in Supabase SQL Editor as a trusted administrator.
-- Does not modify existing profiles, organisations, business applications or roles.
begin;

do $$
begin
  if to_regclass('public.daapp_admins') is null then
    raise exception 'Migration 006 (daapp_admins) is required before driver registration.';
  end if;
  if to_regclass('public.driver_registrations') is not null
     or to_regprocedure('public.daapp_driver_set_online(boolean)') is not null
     or to_regprocedure('public.daapp_admin_list_drivers()') is not null
     or to_regprocedure('public.daapp_admin_review_driver(uuid,text)') is not null then
    raise exception 'Driver registration already exists. Inspect current schema before applying 007.';
  end if;
end $$;

create table public.driver_registrations (
  user_id uuid primary key default auth.uid()
    references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  contact_phone text not null check (char_length(btrim(contact_phone)) between 6 and 40),
  vehicle_type text not null check (vehicle_type in ('passenger', 'minivan', 'cargo')),
  vehicle_model text not null check (char_length(btrim(vehicle_model)) between 2 and 80),
  vehicle_plate text not null check (char_length(btrim(vehicle_plate)) between 3 and 24),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  is_online boolean not null default false,
  created_at timestamptz not null default now(),
  constraint online_only_if_approved check (not is_online or review_status = 'approved')
);

create index driver_registrations_pending_idx
  on public.driver_registrations(created_at) where review_status = 'pending';
alter table public.driver_registrations enable row level security;

-- Drivers see ONLY their own application and availability. The public cannot
-- list driver names, phone numbers or vehicle plates.
create policy "drivers_read_self"
on public.driver_registrations for select to authenticated
using (user_id = (select auth.uid()));

create policy "drivers_submit_self_pending"
on public.driver_registrations for insert to authenticated
with check (user_id = (select auth.uid()) and review_status = 'pending'
            and is_online = false);

-- Until a separate controlled edit/review flow exists, an application is
-- submitted once. No direct UPDATE/DELETE permissions for browsers.
revoke all on public.driver_registrations from public, anon, authenticated;
grant select (user_id, full_name, contact_phone, vehicle_type,
              vehicle_model, vehicle_plate, review_status, is_online, created_at)
  on public.driver_registrations to authenticated;
grant insert (full_name, contact_phone, vehicle_type, vehicle_model, vehicle_plate)
  on public.driver_registrations to authenticated;

-- An APPROVED driver can change ONLY their own online/offline flag.
-- No role changes, no passenger access, no tracking/geolocation writes.
create function public.daapp_driver_set_online(p_online boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign-in required' using errcode = '28000';
  end if;
  if p_online is null then
    raise exception 'Invalid availability value' using errcode = '22023';
  end if;

  update public.driver_registrations
  set is_online = p_online
  where user_id = v_user and review_status = 'approved';
  if not found then
    raise exception 'Approved driver registration required' using errcode = '42501';
  end if;
  return p_online;
end;
$$;

create function public.daapp_admin_list_drivers()
returns table (
  user_id uuid,
  full_name text,
  contact_phone text,
  vehicle_type text,
  vehicle_model text,
  vehicle_plate text,
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
    select d.user_id, d.full_name, d.contact_phone, d.vehicle_type,
           d.vehicle_model, d.vehicle_plate, d.created_at
    from public.driver_registrations d
    where d.review_status = 'pending'
    order by d.created_at asc
    limit 100;
end;
$$;

create function public.daapp_admin_review_driver(p_driver_id uuid, p_decision text)
returns boolean
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
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Invalid driver review decision' using errcode = '22023';
  end if;

  -- Atomic approval/rejection of one pending driver. Never change their
  -- auth role, and always reset line availability to offline.
  update public.driver_registrations
  set review_status = p_decision, is_online = false
  where user_id = p_driver_id and review_status = 'pending';

  if not found then
    raise exception 'Pending driver registration not found' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

revoke all on function public.daapp_driver_set_online(boolean)
  from public, anon, authenticated;
grant execute on function public.daapp_driver_set_online(boolean)
  to authenticated;

revoke all on function public.daapp_admin_list_drivers()
  from public, anon, authenticated;
grant execute on function public.daapp_admin_list_drivers()
  to authenticated;

revoke all on function public.daapp_admin_review_driver(uuid,text)
  from public, anon, authenticated;
grant execute on function public.daapp_admin_review_driver(uuid,text)
  to authenticated;

commit;

-- Driver approval must be performed by the existing trusted DAapp admin.
-- No admin is created, no dummy orders are inserted, and no data is public.
