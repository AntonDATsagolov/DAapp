-- Real PostgreSQL integration in disposable daapp_ci database only.
\set ON_ERROR_STOP on
\echo 'Unified identity: the same verified person may be resident, driver and business applicant'
update auth.users set phone='+77771234567', phone_confirmed_at=now()
where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.daapp_claim_username('shieli_owner', 36);

do $$
begin
  if (select count(*) from public.daapp_member_accounts where username='shieli_owner'
      and age_at_registration=36) <> 1 then
    raise exception 'Verified owner username was not saved';
  end if;
  if (select count(*) from public.profiles where role='client') <> 1 then
    raise exception 'Resident base role was lost';
  end if;
  if (select count(*) from public.driver_registrations
      where review_status='approved') <> 1 then
    raise exception 'Independent driver status was lost';
  end if;
  if (select count(*) from public.place_submissions
      where status='approved') <> 1 then
    raise exception 'Independent approved business submission was lost';
  end if;
  begin
    insert into public.daapp_member_accounts
      (user_id,username,age_at_registration)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bad_direct',36);
    raise exception 'Browser inserted username directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.daapp_member_accounts set username='bad_change';
    raise exception 'Browser edited username directly';
  exception when insufficient_privilege then null;
  end;
end;
$$;

\echo 'Unified identity: unverified user cannot claim username'
set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
begin
  if (select count(*) from public.daapp_member_accounts) <> 0 then
    raise exception 'RLS leaked a different users private username';
  end if;
  begin
    perform public.daapp_claim_username('shieli_guest',22);
    raise exception 'Unverified user claimed username';
  exception when insufficient_privilege then null;
  end;
end;
$$;

\echo 'Unified identity: second verified user cannot steal existing username'
reset role;
update auth.users set phone='+77776543210',phone_confirmed_at=now()
where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set role authenticated;
set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
begin
  begin
    perform public.daapp_claim_username('shieli_owner',23);
    raise exception 'Duplicate username accepted';
  exception when unique_violation then null;
  end;
end;
$$;

\echo 'Unified identity: anonymous account info is private'
reset role;
set role anon;
set request.jwt.claim.sub='';
do $$
begin
  begin
    perform count(*) from public.daapp_member_accounts;
    raise exception 'Anonymous username lookup is exposed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.daapp_claim_username('anonymous_thing',33);
    raise exception 'Anonymous claimed username';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
\echo 'PASS: verified phone account, RLS, username uniqueness and combined resident+driver+business status'
