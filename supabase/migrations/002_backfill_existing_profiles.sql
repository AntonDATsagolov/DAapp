-- DAapp / Step 4 repair: backfill profiles for EXISTING Supabase Auth users.
-- Run via Supabase SQL Editor (trusted database administrator).
-- Never run this from frontend JavaScript or with a browser-side secret key.
-- Requires public.profiles(id, role); does not delete or overwrite existing rows.
begin;

-- Fail without changing data if required table / columns are missing.
do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles does not exist. Review the original migration before backfilling.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'
  ) then
    raise exception 'public.profiles.role is missing. Review schema before backfilling.';
  end if;
end $$;

-- Users created before the signup trigger need their own profiles.
-- A missing profile receives the least-privileged role, client.
-- Existing roles / names / phones / vehicle types are untouched.
insert into public.profiles (id, role)
select u.id, 'client'
from auth.users as u
where not exists (
  select 1 from public.profiles as p where p.id = u.id
)
on conflict (id) do nothing;

commit;

-- Verification: counts only. No email addresses or identifiers are returned.
select
  (select count(*) from auth.users) as users_in_auth,
  (select count(*) from public.profiles) as rows_in_profiles,
  (select count(*) from auth.users as u
     where not exists (select 1 from public.profiles as p where p.id = u.id))
    as users_still_missing_profiles;

-- Check whether the original new-user trigger is installed.
select exists (
  select 1
  from pg_trigger t
  where t.tgrelid = 'auth.users'::regclass
    and t.tgname = 'daapp_auth_user_created'
    and not t.tgisinternal
) as daapp_new_user_trigger_exists;

-- If the last column is false, the new-user signup trigger still needs setup.
-- If profiles exist but the app says "not found", check authenticated SELECT
-- privileges and RLS policy (auth.uid() = profiles.id).
