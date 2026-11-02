-- DAapp 008: ONE identity, multiple complementary activities.
-- Execute once in Supabase SQL Editor AFTER migrations 001 and 007.
-- Existing email users, profiles, organisations, driver applications untouched.
begin;
do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.driver_registrations') is null
     or to_regclass('public.place_submissions') is null then
    raise exception 'Required profiles / driver_registrations / place_submissions missing. Apply earlier migrations first.';
  end if;
  if to_regclass('public.daapp_member_accounts') is not null
     or to_regprocedure('public.daapp_claim_username(text,integer)') is not null then
    raise exception 'DAapp identity migration already present. Inspect before applying 008.';
  end if;
end $$;

-- Usernames are private to owner. Username lookup from browser is forbidden.
-- Phone is stored and verified by Supabase Auth, not duplicated here.
create table public.daapp_member_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (
    username = lower(username)
    and username ~ '^[a-z][a-z0-9_]{3,23}$'
  ),
  age_at_registration integer not null check (age_at_registration between 13 and 120),
  registered_at timestamptz not null default now()
);
create unique index daapp_member_username_unique_idx
  on public.daapp_member_accounts(username);

alter table public.daapp_member_accounts enable row level security;
create policy "daapp_member_read_self"
  on public.daapp_member_accounts for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.daapp_member_accounts from public, anon, authenticated;
grant select (user_id, username, age_at_registration, registered_at)
  on public.daapp_member_accounts to authenticated;

-- Binding username to an account happens ONLY after actual Supabase phone OTP
-- verification. Passwords and OTP codes never enter the application DB.
create function public.daapp_claim_username(p_username text, p_age integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_username text := lower(btrim(p_username));
  v_confirmed boolean;
  v_existing text;
begin
  if v_actor is null then
    raise exception 'Sign-in required' using errcode = '28000';
  end if;
  if v_username is null or v_username !~ '^[a-z][a-z0-9_]{3,23}$' then
    raise exception 'Username must be 4-24 Latin letters/numbers/underscore; start with a letter'
      using errcode = '22023';
  end if;
  if p_age is null or p_age not between 13 and 120 then
    raise exception 'Invalid reported age' using errcode = '22023';
  end if;

  select (u.phone_confirmed_at is not null and coalesce(u.phone,'') <> '')
    into v_confirmed
  from auth.users u where u.id = v_actor;
  if coalesce(v_confirmed, false) = false then
    raise exception 'Verified phone number required before claiming username'
      using errcode = '42501';
  end if;

  select a.username into v_existing
    from public.daapp_member_accounts a where a.user_id = v_actor;
  if v_existing is not null then
    if v_existing <> v_username then
      raise exception 'Username for this account is already set'
        using errcode = '23505';
    end if;
    return v_existing;
  end if;

  insert into public.daapp_member_accounts(user_id,username,age_at_registration)
  values(v_actor,v_username,p_age);
  return v_username;
end;
$$;

revoke all on function public.daapp_claim_username(text,integer)
  from public, anon, authenticated;
grant execute on function public.daapp_claim_username(text,integer)
  to authenticated;
commit;

-- This migration NEVER grants a driver/business/admin role.
-- All accounts remain eligible for ordinary resident/guest functionality.
-- Driver and business rights depend on their independent verified records.
