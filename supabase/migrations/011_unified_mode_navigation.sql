-- DAapp 011: one user entry, server-verified modes and cross-device resume.
-- Install ONCE after migrations 009 and 010.
begin;
do $$
begin
  if to_regclass('public.daapp_account_applications') is null or
     to_regclass('public.driver_registrations') is null or
     to_regclass('public.place_submissions') is null or
     to_regclass('public.daapp_control_settings') is null then
    raise exception 'Install SQL 009 and 010 (plus 001-007) before SQL 011';
  end if;
  if to_regclass('public.daapp_member_navigation') is not null then
    raise exception 'SQL 011 already installed; do not run twice';
  end if;
end $$;

create table public.daapp_member_navigation (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_mode text not null default 'resident'
    check (last_mode in ('resident','business','driver')),
  updated_at timestamptz not null default now()
);
alter table public.daapp_member_navigation enable row level security;
-- The browser has no direct writes to this table. Only the server-verified
-- RPC can save a new mode for the logged-in caller.
revoke all on public.daapp_member_navigation from public, anon, authenticated;

create function public.daapp_mode_status()
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_active boolean;
  v_driver boolean := false;
  v_business boolean := false;
  v_last text := 'resident';
  v_modes text[] := array[]::text[];
  v_account_status text := 'pending';
  v_driver_application text := 'none';
  v_business_application text := 'none';
begin
  if v_uid is null then
    raise exception 'Sign-in required' using errcode='28000';
  end if;

  v_active := public.daapp_account_approved();
  select coalesce(a.status,'legacy') into v_account_status
  from public.daapp_account_applications a where a.user_id=v_uid;
  v_account_status := coalesce(v_account_status,'legacy');

  if v_active then
    select d.review_status into v_driver_application
    from public.driver_registrations d where d.user_id=v_uid;
    v_driver_application := coalesce(v_driver_application,'none');
    select case
      when exists(select 1 from public.place_submissions p
        where p.applicant_id=v_uid and p.status='approved') then 'approved'
      when exists(select 1 from public.place_submissions p
        where p.applicant_id=v_uid and p.status='pending') then 'pending'
      when exists(select 1 from public.place_submissions p
        where p.applicant_id=v_uid and p.status='rejected') then 'rejected'
      else 'none'
    end into v_business_application;

    v_driver := v_driver_application='approved';
    v_business := v_business_application='approved';
    v_modes := array['resident']::text[];
    if v_business then v_modes := array_append(v_modes,'business'); end if;
    if v_driver then v_modes := array_append(v_modes,'driver'); end if;
    select n.last_mode into v_last from public.daapp_member_navigation n
      where n.user_id=v_uid;
    v_last := coalesce(v_last,'resident');
    if not v_last = any(v_modes) then v_last := 'resident'; end if;
  end if;

  return jsonb_build_object(
    'approved',v_active,
    'account_status',v_account_status,
    'available_modes',to_jsonb(v_modes),
    'last_mode',v_last,
    'driver_application',v_driver_application,
    'business_application',v_business_application
  );
end;
$$;
revoke all on function public.daapp_mode_status() from public,anon,authenticated;
grant execute on function public.daapp_mode_status() to authenticated;

create function public.daapp_set_last_mode(p_mode text)
returns text
language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null or not public.daapp_account_approved() then
    raise exception 'Approved account required' using errcode='42501';
  end if;
  if p_mode is null or p_mode not in ('resident','driver','business') then
    raise exception 'Invalid mode' using errcode='22023';
  end if;
  if p_mode='driver' and not exists(
    select 1 from public.driver_registrations d
    where d.user_id=v_uid and d.review_status='approved'
  ) then
    raise exception 'Driver review is required' using errcode='42501';
  end if;
  if p_mode='business' and not exists(
    select 1 from public.place_submissions b
    where b.applicant_id=v_uid and b.status='approved'
  ) then
    raise exception 'Business review is required' using errcode='42501';
  end if;

  insert into public.daapp_member_navigation(user_id,last_mode)
  values(v_uid,p_mode)
  on conflict(user_id) do update set
    last_mode=excluded.last_mode,updated_at=now();
  return p_mode;
end;
$$;
revoke all on function public.daapp_set_last_mode(text)
  from public,anon,authenticated;
grant execute on function public.daapp_set_last_mode(text)
  to authenticated;

-- Prevent a blocked member from modifying driver online/offline state through
-- an older SECURITY DEFINER RPC that predates account approval (SQL 007).
create or replace function public.daapp_driver_set_online(p_online boolean)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null or not public.daapp_account_approved() then
    raise exception 'Approved DAapp account required' using errcode='42501';
  end if;
  if p_online is null then
    raise exception 'Invalid availability' using errcode='22023';
  end if;
  update public.driver_registrations
    set is_online=p_online
    where user_id=v_uid and review_status='approved';
  if not found then
    raise exception 'Approved driver registration required' using errcode='42501';
  end if;
  return p_online;
end;
$$;

-- Immediately disconnect suspended drivers from the available line. Their
-- reviewed driver record remains intact for a later account restoration.
create function public.daapp_stop_suspended_driver()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.status <> 'approved' then
    update public.driver_registrations
      set is_online=false where user_id=new.user_id and is_online=true;
  end if;
  return new;
end;
$$;
revoke all on function public.daapp_stop_suspended_driver()
  from public,anon,authenticated;
create trigger daapp_stop_driver_on_suspension
after update of status on public.daapp_account_applications
for each row when (old.status is distinct from new.status)
execute function public.daapp_stop_suspended_driver();

commit;
-- This state survives app restarts and phone reboots because Supabase stores
-- the last allowed mode in Postgres. Passwords remain solely in Supabase Auth.
-- Static module URLs are not credentials. All privileged operations continue
-- to rely on Supabase server-side policy and review status.
