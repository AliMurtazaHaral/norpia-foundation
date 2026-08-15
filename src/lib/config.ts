/**
 * Frontend Layer — browser-safe configuration.
 *
 * Only VITE_* values land here; server secrets never cross this boundary.
 */

const rawApiBaseUrl = (import.meta.env['VITE_API_BASE_URL'] as string | undefined)?.trim();
const rawAppEnv = (import.meta.env['VITE_APP_ENV'] as string | undefined)?.trim();

export const appConfig = {
  appName: "NORPIA",
  environment: rawAppEnv || import.meta.env.MODE,
  /** Same-origin by default; overridable when the API is hosted separately. */
  apiBaseUrl: rawApiBaseUrl || "/api/v1",
  isDevelopment: import.meta.env.DEV,
} as const;

