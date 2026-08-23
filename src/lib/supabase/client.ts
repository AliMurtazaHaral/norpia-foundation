import { createClient } from "@supabase/supabase-js";

import { appConfig } from "@/lib/config";

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in your environment (see .env.example) before using Supabase.`,
    );
  }
  return value;
}

const supabaseUrl = requireValue(appConfig.supabase.url, "VITE_SUPABASE_URL");
const supabaseAnonKey = requireValue(appConfig.supabase.anonKey, "VITE_SUPABASE_ANON_KEY");

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
