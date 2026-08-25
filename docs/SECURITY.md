# NORPIA — Security (Week 3)

## Trust boundaries

- **Browser** — only the Supabase anon/publishable key. All data access goes
  through PostgREST with RLS applied as the signed-in user.
- **Database** — RLS is the enforcement point. UI role checks are convenience
  only.
- **Service role** — used exclusively from the SQL editor / server-side jobs.
  It is never imported, bundled or referenced in `src/`.

## Row Level Security

### `public.profiles`

| Policy | Effect |
| --- | --- |
| Users can read own profile | `select` where `auth.uid() = id` |
| Users can update own profile | `update` using/with check `auth.uid() = id` |
| Administrators can read all profiles | `select` using `is_administrator()` |
| Administrators can update all profiles | `update` using/with check `is_administrator()` |

Additional layers (migration `0003`):

- `revoke update on public.profiles from authenticated`, then
  `grant update (first_name, last_name, role, is_active)` — column-level
  privileges block writes to `id`, `email`, `created_at` outright.
- `insert` / `delete` revoked from `authenticated`; profiles are created only
  by the `on_auth_user_created` trigger.
- `protect_profile_privileged_columns()` (BEFORE UPDATE) restores `id`,
  `email`, `created_at` for every non-service caller and restores `role` /
  `is_active` for non-administrators.

### `public.user_roles`

- `select` own rows; administrators may select all.
- No insert/update/delete policy **and** those privileges are revoked from
  `authenticated`; `block_client_role_writes()` raises an exception on any
  write that arrives with a non-service JWT role.
- Therefore a user cannot grant themselves `administrator` by any client path.

### Verified properties

| Requirement | Mechanism |
| --- | --- |
| User A cannot read User B's profile | owner-scoped `select` policy |
| User A cannot update User B's profile | owner-scoped `update` policy |
| User cannot change their own role | revoked column write + trigger + role table |
| User cannot self-assign administrator | no write policy/grant on `user_roles` + trigger |
| User cannot modify another account | RLS + immutable identity columns |
| No passwords in app tables | credentials live only in `auth.users`; migration warns on credential-like columns |

## Schema quality

- FKs: `profiles.id → auth.users(id) ON DELETE CASCADE`,
  `user_roles.user_id → auth.users(id) ON DELETE CASCADE`.
- Unique: `user_roles (user_id, role)`, unique index on `lower(profiles.email)`.
- Indexes: `profiles(role)`, `profiles(is_active)`, `user_roles(user_id)`,
  `user_roles(role)`.
- Timestamps: `created_at` / `updated_at`, `updated_at` maintained by trigger.

## Secrets

- `.env` and `.env.*` (except `.env.example`) are git-ignored.
- No service-role key, API secret, password or private key is present in
  frontend code — asserted by `tests/auth-security.test.ts`.
- Only `VITE_`-prefixed variables reach the browser bundle.

## Error handling

`src/lib/auth/errors.ts` maps Supabase failures to short, user-safe messages
(invalid credentials, unverified email, rate limit, expired link, weak
password, duplicate registration). Raw messages, stack traces, hostnames and
Postgres codes are never rendered.

Password recovery and verification resend always return a generic response so
they cannot be used for account enumeration.

## Known limitations

- `is_active = false` shows a banner but does not yet block data access; add an
  `is_active` predicate to RLS policies when Week 4 tables land.
- Preferences (timezone / language) are stored client-side only.
- Administrator promotion is a manual SQL step by design.
- No audit log or MFA yet (planned beyond Week 3).
