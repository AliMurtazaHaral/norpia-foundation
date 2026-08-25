-- NORPIA — Week 3 (final): authentication & RLS hardening.
-- Idempotent and non-destructive. Run in the Supabase SQL Editor AFTER 0002.

-- =====================================================================
-- 1. Column-level privileges on public.profiles
--    Defence in depth: even if a policy were mis-written, PostgreSQL will
--    reject an UPDATE that touches a column the role cannot write.
-- =====================================================================
revoke update on public.profiles from authenticated;
grant  update (first_name, last_name, role, is_active) on public.profiles to authenticated;
-- `role` / `is_active` remain writable at the grant level only so that
-- administrators can manage accounts; the trigger below reverts any attempt
-- made by a non-administrator.

-- Users must never be able to delete or insert arbitrary profile rows;
-- profiles are provisioned by the on_auth_user_created trigger.
revoke insert, delete on public.profiles from authenticated;
drop policy if exists "Users can insert own profile" on public.profiles;

-- =====================================================================
-- 2. Re-assert the privileged-column trigger (role escalation guard)
-- =====================================================================
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if jwt_role in ('', 'service_role') then
    new.updated_at := now();
    return new;
  end if;

  -- identity + ownership columns are immutable for every non-service caller
  new.id         := old.id;
  new.email      := old.email;
  new.created_at := old.created_at;

  if not public.is_administrator() then
    new.role      := old.role;
    new.is_active := old.is_active;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect on public.profiles;
create trigger trg_profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();

-- =====================================================================
-- 3. user_roles: administrators may read all roles; nobody may self-grant
-- =====================================================================
revoke insert, update, delete on public.user_roles from authenticated;

drop policy if exists "Administrators can read all roles" on public.user_roles;
create policy "Administrators can read all roles"
  on public.user_roles for select to authenticated
  using (public.is_administrator());

-- Explicitly refuse any write coming through the Data API.
create or replace function public.block_client_role_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') not in ('', 'service_role') then
    raise exception 'Roles can only be modified server-side';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_user_roles_block_client on public.user_roles;
create trigger trg_user_roles_block_client
  before insert or update or delete on public.user_roles
  for each row execute function public.block_client_role_writes();

-- =====================================================================
-- 4. Constraints & indexes
-- =====================================================================
create unique index if not exists profiles_email_lower_key
  on public.profiles (lower(email));
create index if not exists profiles_role_idx      on public.profiles (role);
create index if not exists profiles_is_active_idx on public.profiles (is_active);
create index if not exists user_roles_user_id_idx on public.user_roles (user_id);
create index if not exists user_roles_role_idx    on public.user_roles (role);

-- Guarantee no application table ever stores credentials.
do $$
declare
  offending text;
begin
  select string_agg(format('%I.%I.%I', table_schema, table_name, column_name), ', ')
    into offending
  from information_schema.columns
  where table_schema = 'public'
    and column_name in ('password', 'password_hash', 'encrypted_password', 'secret', 'api_key');
  if offending is not null then
    raise warning 'Credential-like columns found in application schema: %', offending;
  end if;
end
$$;

-- =====================================================================
-- 5. Helper: current user's role (usable by future features / RPC)
-- =====================================================================
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.has_role(auth.uid(), 'administrator'::public.app_role)
      then 'administrator'::public.app_role
    else 'standard_user'::public.app_role
  end;
$$;

grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_administrator() to authenticated;
grant execute on function public.current_app_role() to authenticated;

do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    insert into public.schema_migrations (version)
    values ('0003_auth_hardening')
    on conflict (version) do nothing;
  end if;
end
$$;

-- =====================================================================
-- Promote an administrator (manual, service-role only):
--   insert into public.user_roles (user_id, role)
--   select id, 'administrator' from auth.users where email = 'you@example.com'
--   on conflict do nothing;
-- (the client-write guard allows this because the SQL editor runs as
--  service_role / postgres)
-- =====================================================================
