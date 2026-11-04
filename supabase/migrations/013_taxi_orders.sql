-- DAapp SQL 013: first real taxi orders, database-enforced dispatch and in-app alerts.
-- Apply ONCE in the working Supabase SQL Editor after SQL 012.
-- No direct table access, no public passenger/driver contact data, no fake orders.
begin;

do $$
begin
  if to_regclass('public.driver_registrations') is null
     or to_regclass('public.daapp_account_applications') is null
     or to_regprocedure('public.daapp_account_approved()') is null
     or to_regprocedure('public.daapp_public_available_drivers()') is null then
    raise exception 'Apply SQL 001-012 before SQL 013';
  end if;
  if to_regclass('public.daapp_taxi_orders') is not null then
    raise exception 'SQL 013 already installed; do not run it twice';
  end if;
end $$;

create table public.daapp_taxi_orders (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references auth.users(id) on delete cascade,
  driver_id uuid references public.driver_registrations(user_id) on delete set null,
  pickup text not null check (char_length(btrim(pickup)) between 5 and 160),
  destination text not null check (char_length(btrim(destination)) between 5 and 160),
  note text check (note is null or char_length(note) <= 240),
  status text not null default 'requested'
    check (status in ('requested','accepted','completed','cancelled','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  constraint taxi_assignment_consistent check (
    (status in ('requested','expired') and driver_id is null)
    or (status in ('accepted','completed') and driver_id is not null)
    or status='cancelled'
  )
);
create unique index daapp_one_active_taxi_per_passenger
  on public.daapp_taxi_orders(passenger_id)
  where status in ('requested','accepted');
create unique index daapp_one_accepted_taxi_per_driver
  on public.daapp_taxi_orders(driver_id)
  where status='accepted';
create index daapp_taxi_requested_recent
  on public.daapp_taxi_orders(created_at desc) where status='requested';
create index daapp_taxi_driver_active
  on public.daapp_taxi_orders(driver_id,updated_at desc) where driver_id is not null;

alter table public.daapp_taxi_orders enable row level security;
revoke all on public.daapp_taxi_orders from public,anon,authenticated;
-- Only tightly scoped SECURITY DEFINER RPCs below may touch taxi rows.

-- Keep old, unanswered requests from blocking future orders indefinitely.
-- Called inside trusted RPCs, never as browser-side SQL.
create function public.daapp_taxi_expire_old()
returns void language sql security definer set search_path=''
as $$
  update public.daapp_taxi_orders
  set status='expired',updated_at=now()
  where status='requested' and created_at<now()-interval '30 minutes';
$$;
revoke all on function public.daapp_taxi_expire_old()
  from public,anon,authenticated;

create function public.daapp_taxi_create_order(
  p_pickup text,p_destination text,p_note text default null
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_order uuid;
  v_pickup text:=btrim(coalesce(p_pickup,''));
  v_destination text:=btrim(coalesce(p_destination,''));
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  if v_uid is null or not public.daapp_account_approved() then
    raise exception 'Verified DAapp account required' using errcode='42501';
  end if;
  if char_length(v_pickup) not between 5 and 160
     or char_length(v_destination) not between 5 and 160
     or (v_note is not null and char_length(v_note)>240) then
    raise exception 'Pickup/destination must be 5-160 chars; note <=240 chars'
      using errcode='22023';
  end if;
  perform public.daapp_taxi_expire_old();
  if exists(select 1 from public.daapp_taxi_orders
            where passenger_id=v_uid and created_at>now()-interval '45 seconds') then
    raise exception 'Try again later' using errcode='P0001';
  end if;
  insert into public.daapp_taxi_orders(passenger_id,pickup,destination,note)
  values(v_uid,v_pickup,v_destination,v_note)
  returning id into v_order;
  return v_order;
end;
$$;

-- Passengers can only see their own orders. Driver phone appears ONLY after
-- an accepted trip and never in a public list.
create function public.daapp_taxi_my_orders()
returns table (
  id uuid,pickup text,destination text,note text,status text,
  created_at timestamptz,updated_at timestamptz,
  driver_name text,driver_phone text
)
language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null or not public.daapp_account_approved() then
    raise exception 'Verified DAapp account required' using errcode='42501';
  end if;
  perform public.daapp_taxi_expire_old();
  return query
  select o.id,o.pickup,o.destination,o.note,o.status,o.created_at,o.updated_at,
         case when o.status in ('accepted','completed') then d.full_name else null end,
         case when o.status in ('accepted','completed') then d.contact_phone else null end
  from public.daapp_taxi_orders o
  left join public.driver_registrations d on d.user_id=o.driver_id
  where o.passenger_id=v_uid
  order by o.created_at desc limit 10;
end;
$$;

-- Even an approved driver cannot browse orders unless they switched ON.
-- Their own accepted trip remains visible if they switch OFF during the ride.
-- Passenger phone is disclosed ONLY to the assigned driver.
create function public.daapp_taxi_driver_orders()
returns table (
  id uuid,pickup text,destination text,note text,status text,
  created_at timestamptz,updated_at timestamptz,
  passenger_phone text
)
language plpgsql security definer set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_online boolean;
begin
  if v_uid is null or not public.daapp_account_approved() then
    raise exception 'Verified DAapp account required' using errcode='42501';
  end if;
  select d.is_online into v_online from public.driver_registrations d
  where d.user_id=v_uid and d.review_status='approved';
  if not found then
    raise exception 'Approved driver required' using errcode='42501';
  end if;
  perform public.daapp_taxi_expire_old();
  return query
  select o.id,o.pickup,o.destination,o.note,o.status,o.created_at,o.updated_at,
         case when o.driver_id=v_uid and o.status='accepted'
           then (select a.phone_number from public.daapp_account_applications a
                 where a.user_id=o.passenger_id and a.status='approved')
           else null end
  from public.daapp_taxi_orders o
  where (
    (v_online and o.status='requested' and
      o.created_at>=now()-interval '30 minutes'
      and o.passenger_id<>v_uid
      and not exists(
        select 1 from public.daapp_taxi_orders busy
        where busy.driver_id=v_uid and busy.status='accepted'
      ))
    or (o.driver_id=v_uid and o.status in ('accepted','cancelled')
       and o.updated_at>=now()-interval '24 hours')
  )
  order by case when o.driver_id=v_uid and o.status='accepted' then 0
                when o.status='requested' then 1 else 2 end,
           o.created_at desc
  limit 25;
end;
$$;

-- Single atomic claim: two drivers competing cannot both receive the same
-- trip. A driver can have only one accepted trip (unique partial index).
create function public.daapp_taxi_accept_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null or not public.daapp_account_approved() then
    raise exception 'Verified DAapp account required' using errcode='42501';
  end if;
  if p_order_id is null then
    raise exception 'Order ID required' using errcode='22023';
  end if;
  perform public.daapp_taxi_expire_old();
  if not exists (
    select 1 from public.driver_registrations d
    where d.user_id=v_uid and d.review_status='approved' and d.is_online
  ) then
    raise exception 'Go online as approved driver first' using errcode='42501';
  end if;
  if exists (
    select 1 from public.daapp_taxi_orders
    where driver_id=v_uid and status='accepted'
  ) then
    raise exception 'Finish your current order first' using errcode='P0001';
  end if;
  update public.daapp_taxi_orders o
  set driver_id=v_uid,status='accepted',accepted_at=now(),updated_at=now()
  where o.id=p_order_id and o.status='requested'
    and o.created_at>=now()-interval '30 minutes'
    and o.passenger_id<>v_uid;
  if not found then
    raise exception 'Order is no longer available' using errcode='P0002';
  end if;
  return true;
end;
$$;

create function public.daapp_taxi_complete_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null or not public.daapp_account_approved() then
    raise exception 'Verified DAapp account required' using errcode='42501';
  end if;
  update public.daapp_taxi_orders
  set status='completed',completed_at=now(),updated_at=now()
  where id=p_order_id and driver_id=v_uid and status='accepted';
  if not found then
    raise exception 'Only assigned driver may finish an accepted trip'
      using errcode='42501';
  end if;
  return true;
end;
$$;

create function public.daapp_taxi_cancel_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null or not public.daapp_account_approved() then
    raise exception 'Verified DAapp account required' using errcode='42501';
  end if;
  update public.daapp_taxi_orders
  set status='cancelled',updated_at=now()
  where id=p_order_id and passenger_id=v_uid and status in ('requested','accepted');
  if not found then
    raise exception 'Only passenger may cancel their active order'
      using errcode='42501';
  end if;
  return true;
end;
$$;

revoke all on function public.daapp_taxi_create_order(text,text,text)
  from public,anon,authenticated;
revoke all on function public.daapp_taxi_my_orders()
  from public,anon,authenticated;
revoke all on function public.daapp_taxi_driver_orders()
  from public,anon,authenticated;
revoke all on function public.daapp_taxi_accept_order(uuid)
  from public,anon,authenticated;
revoke all on function public.daapp_taxi_complete_order(uuid)
  from public,anon,authenticated;
revoke all on function public.daapp_taxi_cancel_order(uuid)
  from public,anon,authenticated;

grant execute on function public.daapp_taxi_create_order(text,text,text)
  to authenticated;
grant execute on function public.daapp_taxi_my_orders()
  to authenticated;
grant execute on function public.daapp_taxi_driver_orders()
  to authenticated;
grant execute on function public.daapp_taxi_accept_order(uuid)
  to authenticated;
grant execute on function public.daapp_taxi_complete_order(uuid)
  to authenticated;
grant execute on function public.daapp_taxi_cancel_order(uuid)
  to authenticated;

commit;
-- NOTE: No browser push is installed here. In-app polling runs while the
-- driver dashboard is open. Background push requires a separate service worker
-- + secure push subscription and delivery function.
