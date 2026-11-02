-- DAapp / Step 8: applications to add a Shieli organization.
-- Run manually in Supabase SQL Editor, after inspecting existing schema.
-- Does not modify profiles, businesses, map_places or any existing row.
begin;

do $$
begin
  if to_regclass('public.place_submissions') is not null then
    raise exception 'public.place_submissions exists; inspect the current schema before applying migration 005.';
  end if;
end $$;

create table public.place_submissions (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  category text not null
    check (category in ('shop','cafe','beauty','hotel','taxi')),
  address text not null check (char_length(trim(address)) between 5 and 200),
  contact_phone text not null check (char_length(trim(contact_phone)) between 6 and 40),
  latitude double precision,
  longitude double precision,
  constraint shieli_submission_coordinates check (
    (latitude is null and longitude is null) or
    (latitude is not null and longitude is not null and
     latitude between 44.05 and 44.31 and longitude between 66.55 and 66.94)
  ),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

comment on table public.place_submissions is
  'Unverified applications. Private to the applicant; never automatically publish to map_places.';
create index place_submissions_applicant_time_idx
  on public.place_submissions (applicant_id, created_at desc);

alter table public.place_submissions enable row level security;

create policy "place_submissions_read_self"
on public.place_submissions for select to authenticated
using (applicant_id = (select auth.uid()));

create policy "place_submissions_create_self_pending"
on public.place_submissions for insert to authenticated
with check (applicant_id = (select auth.uid()) and status = 'pending');

-- Only safe user input columns can be provided by browser INSERT.
-- applicant_id comes from auth.uid() DEFAULT; status comes from DEFAULT pending.
-- No browser UPDATE, DELETE or public anonymous SELECT.
revoke all on public.place_submissions from public, anon, authenticated;
grant select (id, name, category, address, contact_phone,
              latitude, longitude, status, created_at)
  on public.place_submissions to authenticated;
grant insert (name, category, address, contact_phone, latitude, longitude)
  on public.place_submissions to authenticated;

commit;

-- Review and publication are ADMIN-ONLY actions in SQL Editor / trusted backend.
-- Do not publish requests to map_places automatically.
-- Before approving, independently verify the business name, address, and
-- precise coordinates (and permission to list the business).
-- Keep the phone in place_submissions private; map_places.phone is public.
-- Business submissions require user sign-in but NOT an elevated profile role.
-- Never expose any service/secret key in a browser or GitHub.
