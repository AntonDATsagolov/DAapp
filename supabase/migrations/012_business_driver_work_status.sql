-- DAapp / SQL 012: manual work status for reviewed businesses and drivers.
-- Run ONCE in Supabase SQL Editor after 001-011. Never put this SQL in browsers.
begin;

do $$
begin
 if to_regclass('public.map_places') is null
    or to_regclass('public.place_submissions') is null
    or to_regclass('public.daapp_moderation_log') is null
    or to_regclass('public.driver_registrations') is null
    or to_regprocedure('public.daapp_account_approved()') is null then
   raise exception 'Install SQL 001-011 before SQL 012';
 end if;
 if exists(select 1 from information_schema.columns
   where table_schema='public' and table_name='map_places'
     and column_name='is_working') then
   raise exception 'SQL 012 is already installed; do not run twice';
 end if;
end $$;

-- New listings default to "Not working" until the owner explicitly opens.
alter table public.map_places
  add column is_working boolean not null default false,
  add column work_status_changed_at timestamptz;
-- No direct client UPDATE; older column-limited public SELECT grants remain.
grant select(is_working,work_status_changed_at) on public.map_places
  to anon,authenticated;

-- Restrict business controls to the exact published place created by a
-- successfully approved submission belonging to this same Auth account.
-- Never guess ownership by name, phone number, legacy profiles.role, or a URL.
create function public.daapp_business_my_workplaces()
returns table(place_id uuid, name text, category text,
              is_working boolean, changed_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null or not public.daapp_account_approved() then
   raise exception 'Approved account required' using errcode='42501';
 end if;
 return query
 select p.id,p.name,p.category,p.is_working,p.work_status_changed_at
 from public.map_places p
 where p.is_published
   and exists(
     select 1
     from public.daapp_moderation_log ml
     join public.place_submissions ps on ps.id=ml.submission_id
     where ml.published_place_id=p.id and ml.decision='approved'
       and ps.applicant_id=v_uid and ps.status='approved'
   )
 order by p.name,p.id;
end;
$$;

create function public.daapp_business_set_working(p_place_id uuid, p_working boolean)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null or not public.daapp_account_approved() then
   raise exception 'Approved account required' using errcode='42501';
 end if;
 if p_place_id is null or p_working is null then
   raise exception 'Valid place and work status required' using errcode='22023';
 end if;
 update public.map_places p
 set is_working=p_working,work_status_changed_at=now()
 where p.id=p_place_id and p.is_published
   and exists(
     select 1
     from public.daapp_moderation_log ml
     join public.place_submissions ps on ps.id=ml.submission_id
     where ml.published_place_id=p.id and ml.decision='approved'
       and ps.applicant_id=v_uid and ps.status='approved'
   );
 if not found then
   raise exception 'Approved own published place required' using errcode='42501';
 end if;
 return p_working;
end;
$$;

revoke all on function public.daapp_business_my_workplaces()
  from public,anon,authenticated;
grant execute on function public.daapp_business_my_workplaces()
  to authenticated;

revoke all on function public.daapp_business_set_working(uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.daapp_business_set_working(uuid,boolean)
  to authenticated;

-- Residents only see the TOTAL of approved, online drivers.
-- NO phone, name, plate, location, private application or user ID is exposed.
-- Both guest and signed-in resident may view this aggregate without signup.
create function public.daapp_public_available_drivers()
returns integer
language sql stable security definer set search_path=''
as $$
  select count(*)::integer
  from public.driver_registrations d
  where d.review_status='approved' and d.is_online
    and (
      not exists(select 1 from public.daapp_account_applications a
                 where a.user_id=d.user_id)
      or exists(select 1 from public.daapp_account_applications a
                where a.user_id=d.user_id and a.status='approved')
    );
$$;
revoke all on function public.daapp_public_available_drivers()
  from public,anon,authenticated;
grant execute on function public.daapp_public_available_drivers()
  to anon,authenticated;

commit;
-- Presence is a self-reported MANUAL status, not verified shop opening hours.
-- Existing driver controls continue to use daapp_driver_set_online(boolean)
-- from SQL 011; the RPC is already restricted to approved drivers.
