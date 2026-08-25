import { createClient } from "@supabase/supabase-js";

import { appConfig } from "@/lib/config";

/**
 * Browser Supabase client. Only the public anon/publishable key is ever used
 * here — the service-role key must never reach frontend code.
 */
const supabaseUrl = appConfig.supabase.url ?? "https://placeholder.supabase.co";
const supabaseAnonKey =
  appConfig.supabase.anonKey ?? appConfig.supabase.publishableKey ?? "public-anon-key";

if (!appConfig.supabase.isConfigured && typeof window !== "undefined") {
  console.warn("Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
