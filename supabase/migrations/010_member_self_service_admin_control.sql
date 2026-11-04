-- DAapp 010: resident self-service after EMAIL confirmation; admin/architect
-- control center. Apply ONCE after 009. Does not change Auth passwords.
begin;
do $$
begin
 if to_regclass('public.daapp_account_applications') is null
    or to_regclass('public.daapp_admins') is null
    or to_regclass('public.driver_registrations') is null then
   raise exception 'SQL 009 and previous migrations 001-007 must be installed first';
 end if;
 if to_regclass('public.daapp_architects') is not null then
   raise exception 'SQL 010 already installed; do not run twice';
 end if;
end $$;

alter table public.daapp_account_applications
 add column onboarding_goal text not null default 'resident'
 check (onboarding_goal in ('resident','business','driver'));

-- Every member is primarily a resident or guest. Business/driver are just
-- initial onboarding intents; they never confer transport or commercial rights.
create function public.daapp_set_initial_goal()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_goal text;
begin
 select u.raw_user_meta_data->'daapp_registration'->>'goal' into v_goal
 from auth.users u where u.id=new.user_id;
 if v_goal in ('business','driver') then
   update public.daapp_account_applications
      set onboarding_goal=v_goal where user_id=new.user_id;
 end if;
 return new;
end;
$$;
revoke all on function public.daapp_set_initial_goal()
 from public,anon,authenticated;
create trigger daapp_application_set_goal
after insert on public.daapp_account_applications
for each row execute function public.daapp_set_initial_goal();

update public.daapp_account_applications a
set onboarding_goal=u.raw_user_meta_data->'daapp_registration'->>'goal'
from auth.users u
where u.id=a.user_id and
      u.raw_user_meta_data->'daapp_registration'->>'goal'
        in ('business','driver');

-- All rights are still bounded by SQL 009 restrictive RLS policies.
create table public.daapp_control_settings (
 id boolean primary key default true check(id),
 auto_activate_after_email boolean not null default true,
 public_directory_enabled boolean not null default true,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
insert into public.daapp_control_settings(id) values(true);
alter table public.daapp_control_settings enable row level security;
revoke all on public.daapp_control_settings from public,anon,authenticated;

create table public.daapp_architects (
 user_id uuid primary key references public.daapp_admins(user_id) on delete cascade,
 assigned_at timestamptz not null default now()
);
alter table public.daapp_architects enable row level security;
revoke all on public.daapp_architects from public,anon,authenticated;

create table public.daapp_control_audit (
 id bigint generated always as identity primary key,
 actor_id uuid not null references auth.users(id),
 operation text not null,
 target_user_id uuid references auth.users(id),
 before_state jsonb not null default '{}'::jsonb,
 after_state jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.daapp_control_audit enable row level security;
revoke all on public.daapp_control_audit from public,anon,authenticated;

create function public.daapp_admin_is_architect()
returns boolean language sql stable security definer set search_path=''
as $$
 select (select auth.uid()) is not null
   and exists(select 1 from public.daapp_architects a
      where a.user_id=(select auth.uid()));
$$;
revoke all on function public.daapp_admin_is_architect()
 from public,anon,authenticated;
grant execute on function public.daapp_admin_is_architect()
 to authenticated;

-- A valid completed account becomes an ordinary member as soon as the
-- user verifies email. NO manual approval is needed for this base access.
create function public.daapp_activate_verified_member()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if new.email_confirmed_at is not null
   and exists(select 1 from public.daapp_control_settings s
     where s.id=true and s.auto_activate_after_email)
   and exists(select 1 from public.daapp_member_accounts m
     where m.user_id=new.id)
 then
   update public.daapp_account_applications a
      set status='approved', reviewed_at=now()
    where a.user_id=new.id and a.status='pending'
      and a.residency in ('resident','guest')
      and a.phone_number is not null;
 end if;
 return new;
end;
$$;
revoke all on function public.daapp_activate_verified_member()
 from public,anon,authenticated;
-- Alphabetic order: create-profile/application triggers execute before zzz.
create trigger zzz_daapp_activate_new_member
after insert on auth.users for each row
execute function public.daapp_activate_verified_member();
create trigger daapp_activate_confirmed_member
after update of email_confirmed_at on auth.users for each row
execute function public.daapp_activate_verified_member();

-- Existing pending confirmed members can proceed without another email.
update public.daapp_account_applications a
 set status='approved',reviewed_at=now()
from auth.users u
where a.user_id=u.id
 and a.status='pending'
 and u.email_confirmed_at is not null
 and a.residency in ('resident','guest') and a.phone_number is not null
 and exists(select 1 from public.daapp_member_accounts m where m.user_id=u.id);

-- Useful metrics, from trustworthy SQL (no client-side guessed counts).
create function public.daapp_admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
 if not exists(select 1 from public.daapp_admins a
   where a.user_id=(select auth.uid())) then
   raise exception 'Administrator required' using errcode='42501';
 end if;
 return jsonb_build_object(
   'all_auth_users',(select count(*) from auth.users),
   'member_accounts',(select count(*) from public.daapp_member_accounts),
   'new_7d',(select count(*) from public.daapp_account_applications a
      where a.created_at>=now()-interval '7 days'),
   'pending_email',(select count(*) from public.daapp_account_applications a
      join auth.users u on u.id=a.user_id
      where a.status='pending' and u.email_confirmed_at is null),
   'member_pending',(select count(*) from public.daapp_account_applications
      where status='pending'),
   'member_approved',(select count(*) from public.daapp_account_applications
      where status='approved'),
   'member_rejected',(select count(*) from public.daapp_account_applications
      where status='rejected'),
   'driver_pending',(select count(*) from public.driver_registrations
      where review_status='pending'),
   'driver_approved',(select count(*) from public.driver_registrations
      where review_status='approved'),
   'driver_online',(select count(*) from public.driver_registrations
      where is_online=true),
   'business_pending',(select count(*) from public.place_submissions
      where status='pending'),
   'business_approved',(select count(*) from public.place_submissions
      where status='approved'),
   'map_published',(select count(*) from public.map_places
      where is_published=true),
   'settings',(select jsonb_build_object(
      'auto_activate_after_email',s.auto_activate_after_email,
      'public_directory_enabled',s.public_directory_enabled,
      'updated_at',s.updated_at)
      from public.daapp_control_settings s where s.id=true),
   'is_architect',public.daapp_admin_is_architect()
 );
end;
$$;
revoke all on function public.daapp_admin_dashboard()
 from public,anon,authenticated;
grant execute on function public.daapp_admin_dashboard()
 to authenticated;

-- Admin-only searchable member register with bounded pagination.
create function public.daapp_admin_member_register(
 p_search text default '',
 p_filter text default 'all',
 p_limit integer default 40,
 p_offset integer default 0
)
returns table(
 user_id uuid,username text,email text,phone_number text,
 residency text,onboarding_goal text,account_status text,
 email_verified boolean,public_phone boolean,registered_at timestamptz,
 driver_status text,business_count bigint
)
language plpgsql stable security definer set search_path=''
as $$
declare v_search text:=lower(btrim(coalesce(p_search,'')));
begin
 if not exists(select 1 from public.daapp_admins a
   where a.user_id=(select auth.uid())) then
   raise exception 'Administrator required' using errcode='42501';
 end if;
 if char_length(v_search)>100 then
   raise exception 'Search term too long' using errcode='22023';
 end if;
 if p_filter not in ('all','approved','pending','rejected','legacy') then
   raise exception 'Invalid member filter' using errcode='22023';
 end if;
 return query
 select u.id,m.username,u.email::text,a.phone_number,a.residency,
        a.onboarding_goal,coalesce(a.status,'legacy')::text,
        u.email_confirmed_at is not null,a.public_phone,
        coalesce(a.created_at,now()),
        d.review_status,
        (select count(*) from public.place_submissions b
           where b.applicant_id=u.id)
 from auth.users u
 left join public.daapp_account_applications a on a.user_id=u.id
 left join public.daapp_member_accounts m on m.user_id=u.id
 left join public.driver_registrations d on d.user_id=u.id
 where (p_filter='all' or coalesce(a.status,'legacy')=p_filter)
   and (v_search='' or lower(coalesce(m.username,'')) like '%'||v_search||'%'
      or lower(coalesce(u.email,'')) like '%'||v_search||'%'
      or coalesce(a.phone_number,'') like '%'||v_search||'%')
 order by a.created_at desc nulls last, u.id
 limit least(greatest(coalesce(p_limit,40),1),100)
 offset least(greatest(coalesce(p_offset,0),0),10000);
end;
$$;
revoke all on function public.daapp_admin_member_register(
 text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.daapp_admin_member_register(
 text,text,integer,integer) to authenticated;

create function public.daapp_architect_update_settings(
 p_auto_activate boolean,p_public_directory boolean)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_before jsonb;v_after jsonb;
begin
 if not public.daapp_admin_is_architect() then
   raise exception 'Architect access required' using errcode='42501';
 end if;
 if p_auto_activate is null or p_public_directory is null then
   raise exception 'Invalid setting' using errcode='22023';
 end if;
 select jsonb_build_object('auto_activate_after_email',auto_activate_after_email,
   'public_directory_enabled',public_directory_enabled)
 into v_before from public.daapp_control_settings where id=true for update;
 update public.daapp_control_settings set
   auto_activate_after_email=p_auto_activate,
   public_directory_enabled=p_public_directory,
   updated_at=now(),updated_by=(select auth.uid())
 where id=true;
 v_after:=jsonb_build_object('auto_activate_after_email',p_auto_activate,
   'public_directory_enabled',p_public_directory);
 if v_before is distinct from v_after then
   insert into public.daapp_control_audit(
      actor_id,operation,before_state,after_state)
   values((select auth.uid()),'settings_update',v_before,v_after);
 end if;
 return v_after;
end;
$$;
revoke all on function public.daapp_architect_update_settings(boolean,boolean)
 from public,anon,authenticated;
grant execute on function public.daapp_architect_update_settings(boolean,boolean)
 to authenticated;

-- Account freeze/unfreeze: architect only. No self or other-admin lockouts.
-- Applies immediately through existing SQL 009 restrictive RLS.
create function public.daapp_architect_set_member_state(
 p_user_id uuid,p_state text,p_reason text)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_old text;v_verified boolean;
begin
 if not public.daapp_admin_is_architect() then
   raise exception 'Architect access required' using errcode='42501';
 end if;
 if p_user_id is null or p_state not in ('approved','rejected') or
    p_state is null or char_length(btrim(coalesce(p_reason,'')))<5 or
    char_length(p_reason)>400 then
   raise exception 'A valid state and reason are required'
    using errcode='22023';
 end if;
 if p_user_id=(select auth.uid()) or exists(
   select 1 from public.daapp_admins a where a.user_id=p_user_id
 ) then
   raise exception 'Cannot change administrator access here' using errcode='42501';
 end if;
 select a.status, u.email_confirmed_at is not null
 into v_old,v_verified from public.daapp_account_applications a
 join auth.users u on u.id=a.user_id
 where a.user_id=p_user_id for update of a;
 if not found then
   raise exception 'Account is legacy or missing; no change made' using errcode='P0002';
 end if;
 if p_state='approved' and not v_verified then
   raise exception 'Email must be confirmed before activation'
     using errcode='42501';
 end if;
 if v_old<>p_state then
   update public.daapp_account_applications
      set status=p_state, reviewed_at=now(),reviewed_by=(select auth.uid())
      where user_id=p_user_id;
   insert into public.daapp_control_audit
      (actor_id,operation,target_user_id,before_state,after_state)
   values((select auth.uid()),'member_state_change',p_user_id,
     jsonb_build_object('status',v_old),
     jsonb_build_object('status',p_state,'reason',btrim(p_reason)));
 end if;
 return true;
end;
$$;
revoke all on function public.daapp_architect_set_member_state(uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.daapp_architect_set_member_state(uuid,text,text)
 to authenticated;

create function public.daapp_architect_recent_audit(p_limit integer default 30)
returns table(
 audit_id bigint,operation text,actor_id uuid,target_user_id uuid,
 before_state jsonb,after_state jsonb,created_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not public.daapp_admin_is_architect() then
   raise exception 'Architect access required' using errcode='42501';
 end if;
 return query select a.id,a.operation,a.actor_id,a.target_user_id,
   a.before_state,a.after_state,a.created_at
 from public.daapp_control_audit a order by a.id desc
 limit least(greatest(coalesce(p_limit,30),1),100);
end;
$$;
revoke all on function public.daapp_architect_recent_audit(integer)
 from public,anon,authenticated;
grant execute on function public.daapp_architect_recent_audit(integer)
 to authenticated;

-- Reuse SQL 009 verified, opted-in adult member directory; additionally
-- allow the architect to temporarily disable directory lookups.
create or replace function public.daapp_public_member_directory(p_limit integer default 50)
returns table(user_id uuid,username text,phone_number text,avatar_path text)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not public.daapp_account_approved() then
   raise exception 'Approved account required' using errcode='42501';
 end if;
 if not exists(select 1 from public.daapp_control_settings
   where id=true and public_directory_enabled=true) then
   return;
 end if;
 return query
   select r.user_id,m.username,r.phone_number,r.avatar_path
   from public.daapp_account_applications r
   join public.daapp_member_accounts m on m.user_id=r.user_id
   where r.status='approved' and r.public_phone=true and
     r.phone_number is not null and m.age_at_registration>=18
   order by m.username asc
   limit least(greatest(coalesce(p_limit,50),1),100);
end;
$$;

commit;
-- Manual architect bootstrap, ONLY for your own EXISTING admin account:
-- insert into public.daapp_architects(user_id)
-- select a.user_id from public.daapp_admins a
-- join auth.users u on u.id=a.user_id where u.email='YOUR_ADMIN_EMAIL'
-- on conflict(user_id) do nothing;
-- Never expose Supabase service role keys in GitHub Pages.
