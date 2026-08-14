/**
 * Frontend Layer — browser-safe configuration.
 *
 * Only VITE_* values land here; server secrets never cross this boundary.
 */

export const appConfig = {
  appName: "NORPIA",
  environment: (import.meta.env['VITE_APP_ENV'] as string | undefined) ?? import.meta.env.MODE,
  /** Same-origin by default; overridable when the API is hosted separately. */
  apiBaseUrl: (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? "/api/v1",
  isDevelopment: import.meta.env.DEV,
} as const;
