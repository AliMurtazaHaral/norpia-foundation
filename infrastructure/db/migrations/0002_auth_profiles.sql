-- NORPIA — Week 3: Authentication foundation (Supabase Auth).
-- Safe to run on an existing project: everything is IF NOT EXISTS / CREATE OR REPLACE.
-- Run this in the Supabase SQL Editor.

-- =====================================================================
-- 1. Roles enum + authoritative role table
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('administrator', 'standard_user');
  end if;
end
$$;

create table if not exists public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all    on public.user_roles to service_role;

alter table public.user_roles enable row level security;

drop policy if exists "Users can read their own roles" on public.user_roles;
create policy "Users can read their own roles"
  on public.user_roles for select
  to authenticated
  using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy: roles can only be changed by service_role
-- (server-side / SQL editor). A normal user can never grant themselves a role.

-- Security-definer role check, used by policies without recursion.
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

create or replace function public.is_administrator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'administrator'::public.app_role);
$$;

-- =====================================================================
-- 2. Profiles table (1:1 with auth.users)
-- =====================================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  first_name text,
  last_name  text,
  role       public.app_role not null default 'standard_user',  -- mirror of user_roles, read-only to users
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile"   on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Administrators can read all profiles"   on public.profiles;
drop policy if exists "Administrators can update all profiles" on public.profiles;

create policy "Users can read own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

create policy "Administrators can read all profiles"
  on public.profiles for select to authenticated
  using (public.is_administrator());

create policy "Administrators can update all profiles"
  on public.profiles for update to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

-- =====================================================================
-- 3. Column-level protection: nobody can escalate via profiles.role
-- =====================================================================
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role / SQL editor bypasses this guard
  if coalesce(current_setting('request.jwt.claim.role', true), '') in ('', 'service_role') then
    new.updated_at := now();
    return new;
  end if;

  if not public.is_administrator() then
    new.role      := old.role;
    new.is_active := old.is_active;
    new.id        := old.id;
    new.email     := old.email;
    new.created_at := old.created_at;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect on public.profiles;
create trigger trg_profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();

-- Keep profiles.role in sync with the authoritative user_roles table.
create or replace function public.sync_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set role = case when public.has_role(new.user_id, 'administrator'::public.app_role)
                     then 'administrator'::public.app_role
                     else 'standard_user'::public.app_role end,
         updated_at = now()
   where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists trg_user_roles_sync on public.user_roles;
create trigger trg_user_roles_sync
  after insert or update or delete on public.user_roles
  for each row execute function public.sync_profile_role();

-- =====================================================================
-- 4. Auto-provision profile + default role on signup
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, role)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', ''),
    'standard_user'
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'standard_user')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 5. Backfill existing users (idempotent)
-- =====================================================================
insert into public.profiles (id, email, first_name, last_name)
select u.id,
       u.email,
       nullif(u.raw_user_meta_data ->> 'first_name', ''),
       nullif(u.raw_user_meta_data ->> 'last_name', '')
from auth.users u
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
select u.id, 'standard_user' from auth.users u
on conflict (user_id, role) do nothing;

insert into public.schema_migrations (version)
values ('0002_auth_profiles')
on conflict (version) do nothing;

-- =====================================================================
-- Promote someone to administrator (run manually, never from the app):
--   insert into public.user_roles (user_id, role)
--   select id, 'administrator' from auth.users where email = 'you@example.com'
--   on conflict do nothing;
-- =====================================================================
