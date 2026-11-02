-- DAapp / Step 7. Public map catalog for Shieli (Шиели).
-- Execute once in Supabase SQL Editor after inspecting the project.
-- This is NEW, separate from businesses. Existing tables are untouched.
-- Publication and editing are done only by trusted administrators for now.
begin;

do $$
begin
  if to_regclass('public.map_places') is not null then
    raise exception 'public.map_places already exists: inspect schema before applying migration 004.';
  end if;
end $$;

create table public.map_places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  category text not null
    check (category in ('shop', 'cafe', 'beauty', 'hotel', 'taxi')),
  address text check (address is null or char_length(address) <= 200),
  phone text check (phone is null or char_length(phone) <= 40),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.map_places is
  'Manually verified, publishable Shieli map pins. Not a replacement for businesses.';

create index map_places_published_category_idx
  on public.map_places(category) where is_published = true;

alter table public.map_places enable row level security;

-- Public map readers can see ONLY explicitly published rows.
create policy "map_places_public_read_published"
on public.map_places for select to anon, authenticated
using (is_published = true);

-- No public writes, no owner role assumptions, no RLS bypass from client code.
revoke all on public.map_places from public, anon, authenticated;
grant select (id, name, category, address, phone, latitude, longitude, is_published)
  on public.map_places to anon, authenticated;

commit;

-- This migration intentionally inserts NO organizations or coordinates.
-- To publish a verified real place, use the SQL Editor (as administrator):
--
-- insert into public.map_places
--   (name, category, address, phone, latitude, longitude, is_published)
-- values
--   ('ПРОВЕРЕННОЕ НАЗВАНИЕ', 'shop', 'ПРОВЕРЕННЫЙ АДРЕС',
--    null, 44.17603, 66.74096, false);
--
-- IMPORTANT: Coordinates above are only the town center, not business location!
-- Replace them with actual verified coordinates before setting is_published=true.
-- NEVER mark a placeholder example or unverified listing as published.
