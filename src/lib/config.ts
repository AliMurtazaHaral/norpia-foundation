/**
 * Frontend Layer — browser-safe configuration.
 *
 * Only VITE_* values land here; server secrets never cross this boundary.
 */

const rawApiBaseUrl = (import.meta.env['VITE_API_BASE_URL'] as string | undefined)?.trim();
const rawAppEnv = (import.meta.env['VITE_APP_ENV'] as string | undefined)?.trim();
const rawSupabaseUrl = (import.meta.env['VITE_SUPABASE_URL'] as string | undefined)?.trim();
const rawSupabaseAnonKey = (import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined)?.trim();
const rawSupabasePublishableKey =
  (import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] as string | undefined)?.trim();

export const appConfig = {
  appName: "NORPIA",
  environment: rawAppEnv || import.meta.env.MODE,
  /** Same-origin by default; overridable when the API is hosted separately. */
  apiBaseUrl: rawApiBaseUrl || "/api/v1",
  supabase: {
    url: rawSupabaseUrl,
    anonKey: rawSupabaseAnonKey,
    publishableKey: rawSupabasePublishableKey,
    isConfigured: Boolean(rawSupabaseUrl && rawSupabaseAnonKey),
  },
  isDevelopment: import.meta.env.DEV,
} as const;

