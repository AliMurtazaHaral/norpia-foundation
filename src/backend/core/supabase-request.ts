/**
 * Shared server-side helper: turn an incoming Request into an RLS-scoped
 * Supabase client for the authenticated caller.
 *
 * Public project URL + anon key only — the service-role key is never used on
 * these paths, so Row Level Security stays the enforcement boundary.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { appConfig } from "@/lib/config";

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

export class RequestAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RequestAuthError";
  }
}

export interface AuthenticatedRequestContext {
  supabase: SupabaseClient;
  userId: string;
}

export async function authenticateRequest(
  request: Request,
): Promise<AuthenticatedRequestContext> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new RequestAuthError("You must be signed in.", 401);

  const url = env("SUPABASE_URL") ?? env("VITE_SUPABASE_URL") ?? appConfig.supabase.url;
  const key =
    env("SUPABASE_ANON_KEY") ??
    env("VITE_SUPABASE_ANON_KEY") ??
    appConfig.supabase.anonKey ??
    appConfig.supabase.publishableKey;
  if (!url || !key) throw new RequestAuthError("The service is not configured yet.", 503);

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new RequestAuthError("Your session has expired. Please sign in again.", 401);
  }

  return { supabase, userId: data.user.id };
}
