-- Disposable PostgreSQL test only. Run AFTER DAapp migrations 001/002/003.
\set ON_ERROR_STOP on
\echo 'DAapp Auth registration: backfilled users must have lowest privilege profiles'
do $$
begin
  if (select count(*) from public.profiles) <> 3 then
    raise exception 'Existing synthetic Auth users were not backfilled';
  end if;
  if (select count(*) from public.profiles where role='client') <> 3 then
    raise exception 'Existing users have unexpected elevated roles';
  end if;
end;
$$;

\echo 'DAapp Auth registration: a newly created Auth user receives profile via trigger'
insert into auth.users(id,email)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','test-new-user@example.invalid');

do $$
begin
  if (select count(*) from public.profiles
      where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and role='client') <> 1 then
    raise exception 'Auth signup trigger failed to create client profile';
  end if;
end;
$$;

set role authenticated;
set request.jwt.claim.sub='dddddddd-dddd-4ddd-8ddd-dddddddddddd';

\echo 'DAapp Auth registration: new user can read and update only own profile'
do $$
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'RLS incorrectly showed other users profiles';
  end if;
  begin
    update public.profiles set role='business_owner';
    raise exception 'New account illegally elevated own role';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.profiles(id,role)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','driver');
    raise exception 'New account inserted arbitrary profile';
  exception when insufficient_privilege then null;
  end;
end;
$$;

update public.profiles set full_name='Test New Resident', phone_number='+77001234567';
select public.daapp_ensure_own_profile();

reset role;
do $$
begin
  if (select count(*) from public.profiles
      where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and
            role='client' and full_name='Test New Resident') <> 1 then
    raise exception 'New user profile update did not persist';
  end if;
end;
$$;
\echo 'PASS: synthetic Auth signup trigger, profile RLS and self-repair'
