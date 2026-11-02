-- DAapp / Migration 003 — safe recovery for signed-in users without a profile.
-- Run ONCE in Supabase Dashboard → SQL Editor as a trusted administrator.
-- Never execute as browser-side SQL, and never expose a secret key.
--
-- This migration only creates a narrowly scoped RPC function.
-- It does NOT delete users, change existing roles, or disable RLS.
begin;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles is missing. Review migration 001 first.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'
  ) then
    raise exception 'public.profiles must contain id and role columns.';
  end if;
end $$;

create or replace function public.daapp_ensure_own_profile()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
begin
  -- Derive identity only from the validated Supabase session JWT.
  -- Never accept a user ID or a requested role from the client.
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Authentication is required' using errcode = '28000';
  end if;

  -- A missing row gets the lowest privilege. Never overwrite an existing row.
  insert into public.profiles (id, role)
  values (caller_id, 'client')
  on conflict (id) do nothing;

  return true;
end;
$$;

-- SECURITY DEFINER functions need explicit EXECUTE restrictions.
revoke all on function public.daapp_ensure_own_profile()
  from public, anon, authenticated;
grant execute on function public.daapp_ensure_own_profile()
  to authenticated;

commit;

-- Test from the signed-in client (not SQL Editor):
-- supabase.rpc('daapp_ensure_own_profile')
-- then SELECT your own profile as enforced by the existing RLS policy.
-- Existing rows, values and RLS policies remain unchanged.
