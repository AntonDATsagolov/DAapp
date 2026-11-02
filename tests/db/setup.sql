-- Refuse accidental execution in a real Supabase project.
do $$
begin
  if current_database() <> 'daapp_ci' then
    raise exception 'CI test only: expected disposable database daapp_ci';
  end if;
end;
$$;

-- Integration-only Supabase Auth emulation for disposable PostgreSQL 16 CI.
-- NEVER run this file in your real Supabase project.
create role anon nologin;
create role authenticated nologin;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text unique,
  phone text,
  phone_confirmed_at timestamptz
);

-- Supabase auth.uid() derives the caller from the verified JWT.
-- CI substitutes a test JWT subject, never a real access token.
create function auth.uid()
returns uuid language sql stable set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

insert into auth.users(id,email) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test-admin@example.invalid'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'test-owner@example.invalid'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'test-other@example.invalid');

-- This authorization happens only in an ephemeral CI database.
-- Production permissions are NEVER changed by these integration tests.
-- Admin table is created by migration 006; apply after migrations.
