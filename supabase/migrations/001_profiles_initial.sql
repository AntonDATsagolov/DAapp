-- DAapp / Step 3: NEW Supabase projects only.
-- Safety: abort if public.profiles already exists; do not modify existing data or policies.
begin;

do $$
begin
  if to_regclass('public.profiles') is not null then
    raise exception 'DAapp migration stopped: public.profiles already exists. Review existing schema/RLS before applying.';
  end if;
end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone_number text,
  role text not null default 'client'
    check (role in ('client', 'driver', 'business_owner')),
  driver_vehicle_type text
    check (driver_vehicle_type in ('passenger','minivan','cargo')),
  constraint driver_vehicle_only
    check (driver_vehicle_type is null or role = 'driver')
);

alter table public.profiles enable row level security;

-- Only the account owner can read their profile.
create policy "profile_read_self" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

-- Authenticated users may edit their own display name and number, not roles.
create policy "profile_update_self" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Limit browser privileges to non-sensitive columns; role and vehicle type
-- must only be changed by trusted administrative tooling.
revoke all on public.profiles from anon, authenticated;
grant select (id, full_name, phone_number, role, driver_vehicle_type)
  on public.profiles to authenticated;
grant update (full_name, phone_number)
  on public.profiles to authenticated;

-- Profiles are created when a user signs up, not by browser INSERT.
create function public.daapp_create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'client');
  return new;
end;
$$;

revoke all on function public.daapp_create_profile() from public, anon, authenticated;

create trigger daapp_auth_user_created
after insert on auth.users
for each row execute function public.daapp_create_profile();

commit;

-- IMPORTANT:
-- 1. Run only after inspecting the project schema.
-- 2. Existing auth.users records are NOT backfilled by this migration.
-- 3. Audit other tables and existing RLS policies separately.
-- 4. Change roles ONLY via trusted admin/service operations, never PWA.
