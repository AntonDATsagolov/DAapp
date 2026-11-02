-- Real DB integration for DAapp driver onboarding in disposable daapp_ci ONLY.
\set ON_ERROR_STOP on
\echo 'DAapp Driver: applicant registers, cannot approve self or go online'
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

insert into public.driver_registrations
  (full_name,contact_phone,vehicle_type,vehicle_model,vehicle_plate)
values ('Driver Example','+77001112233','passenger','Toyota Camry','999 AAA 11');

do $$
begin
  if (select count(*) from public.driver_registrations where review_status='pending' and not is_online) <> 1 then
    raise exception 'Registration must start pending and offline';
  end if;
  begin
    update public.driver_registrations set review_status='approved';
    raise exception 'Driver changed approval status directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.driver_registrations
      (user_id,full_name,contact_phone,vehicle_type,vehicle_model,vehicle_plate)
    values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Impersonated Admin','+77000000000',
       'cargo','Truck','AA 123');
    raise exception 'Driver used a foreign user ID';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.daapp_driver_set_online(true);
    raise exception 'Pending driver went online';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.daapp_admin_list_drivers();
    raise exception 'Unapproved driver read private moderation queue';
  exception when insufficient_privilege then null;
  end;
end;
$$;

\echo 'DAapp Driver: unrelated user cannot read private vehicle details'
set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
begin
  if (select count(*) from public.driver_registrations) <> 0 then
    raise exception 'Driver private details leaked under RLS';
  end if;
end;
$$;

-- Second driver application can be rejected.
insert into public.driver_registrations
  (full_name,contact_phone,vehicle_type,vehicle_model,vehicle_plate)
values ('Other Driver','+77002223344','cargo','Ford Transit','222 BBB 11');

\echo 'DAapp Driver: admin review queue and approval'
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
begin
  if (select count(*) from public.driver_registrations) <> 0 then
    raise exception 'Admin unexpectedly bypassed driver RLS SELECT';
  end if;
  if (select count(*) from public.daapp_admin_list_drivers()) <> 2 then
    raise exception 'Admin driver queue does not contain pending applications';
  end if;
  if (select count(*) from public.daapp_admin_list_submissions()) <> 0 then
    raise exception 'Driver onboarding modified existing business submission queue';
  end if;
end;
$$;

select public.daapp_admin_review_driver(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','approved');

do $$
begin
  if (select count(*) from public.daapp_admin_list_drivers()) <> 1 then
    raise exception 'Approved driver still appears pending';
  end if;
  begin
    perform public.daapp_admin_review_driver(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','approved');
    raise exception 'Driver approved twice';
  exception when no_data_found then null;
  end;
end;
$$;

select public.daapp_admin_review_driver(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc','rejected');

\echo 'DAapp Driver: rejected user cannot enter shift'
set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
begin
  begin
    perform public.daapp_driver_set_online(true);
    raise exception 'Rejected driver went online';
  exception when insufficient_privilege then null;
  end;
end;
$$;

\echo 'DAapp Driver: approved user can turn line on and off'
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.daapp_driver_set_online(true);
do $$
begin
  if (select count(*) from public.driver_registrations where review_status='approved' and is_online=true) <> 1 then
    raise exception 'Approved driver is not online';
  end if;
end;
$$;
select public.daapp_driver_set_online(false);
do $$
begin
  if (select count(*) from public.driver_registrations where is_online=true) <> 0 then
    raise exception 'Approved driver did not go offline';
  end if;
end;
$$;

\echo 'DAapp Driver: anonymous users cannot see private roster'
reset role;
set role anon;
set request.jwt.claim.sub='';
do $$
begin
  begin
    perform count(*) from public.driver_registrations;
    raise exception 'Anonymous read the driver table';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.daapp_driver_set_online(true);
    raise exception 'Anonymous accessed driver availability';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
do $$
begin
  if (select count(*) from public.driver_registrations where review_status='approved' and not is_online) <> 1
    or (select count(*) from public.driver_registrations where review_status='rejected' and not is_online) <> 1 then
    raise exception 'Incorrect final reviewed driver statuses';
  end if;
end;
$$;
\echo 'PASS: driver application, private RLS, admin review and controlled line status'
