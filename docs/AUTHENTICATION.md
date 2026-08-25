# NORPIA — Authentication (Week 3)

Authentication is provided entirely by **Supabase Auth**. There is no custom
JWT system, no bespoke token parsing and no credential storage in application
tables.

## Architecture

| Concern | Implementation |
| --- | --- |
| Identity store | `auth.users` (Supabase-managed) |
| Application profile | `public.profiles` (1:1 with `auth.users`) |
| Authoritative roles | `public.user_roles` |
| Browser client | `src/lib/supabase/client.ts` (anon/publishable key only) |
| Session state | `src/lib/auth/auth-context.tsx` (`AuthProvider` / `useAuth`) |
| Validation | `src/lib/auth/schemas.ts` (Zod) |
| Error mapping | `src/lib/auth/errors.ts` |
| Role helpers | `src/lib/auth/roles.ts`, `src/lib/auth/require-role.tsx` |
| Route guard | `src/routes/_authenticated/route.tsx` (`ssr:false` + `getUser()`) |

## Session management

`AuthProvider` registers `supabase.auth.onAuthStateChange` **before** calling
`getSession()`, so no transition is lost on first paint. Profile loading is
deferred out of the listener callback to avoid Supabase deadlocks. Tokens are
persisted and auto-refreshed by the Supabase client (`persistSession`,
`autoRefreshToken`, `detectSessionInUrl`).

Sign-out clears local session + profile state and redirects to `/auth`.

## Pages

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | public | Console + `SiteHeader` (Sign in / Sign up, or Profile when logged in) |
| `/auth?mode=signin\|signup` | public | Login and registration tabs |
| `/verify-email` | public | Verification status + resend |
| `/forgot-password` | public | Request a recovery email |
| `/reset-password` | public (recovery session) | Set a new password |
| `/dashboard` | authenticated | Account overview |
| `/profile` | authenticated | View / edit first + last name |
| `/settings` | authenticated | Profile, Security, Preferences tabs |
| `/admin` | administrator | Administrator-only area (`RequireRole`) |

## Flows

- **Registration** — `signUp()` with `emailRedirectTo=/verify-email`; role is
  never accepted from the client. A trigger provisions the profile and the
  default `standard_user` role.
- **Email verification** — `/verify-email` shows pending / verified / failed
  states and can resend (`auth.resend({ type: "signup" })`). An unverified user
  sees a banner on every authenticated page.
- **Login** — `signInWithPassword`; unverified accounts get a link to resend.
- **Password recovery** — `resetPasswordForEmail(redirectTo=/reset-password)`
  always answers generically ("if an account exists…"). `/reset-password`
  accepts only a recovery session and calls `updateUser({ password })`.
- **Logout** — `signOut()` then redirect to `/auth`.

## Supabase dashboard configuration

1. Auth → Providers → Email: confirmations **enabled**.
2. Auth → URL Configuration → Site URL: your deployed origin.
3. Redirect URLs: `<origin>/verify-email`, `<origin>/reset-password`, `<origin>/auth`.
4. Password policy: minimum 8 characters (matches the Zod schema).

## Environment variables

Browser (safe, `VITE_` prefixed): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`),
`VITE_API_BASE_URL`.

Server-only (never `VITE_`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`DATABASE_URL`. The service-role key is not referenced anywhere in `src/`.

## Future RBAC expansion

`public.user_roles` + `has_role()` already model many-roles-per-user. To grow:
add enum values, add a `permissions` / `role_permissions` table, and extend
`RequireRole` with a permission check — RLS policies keep using `has_role()`.
