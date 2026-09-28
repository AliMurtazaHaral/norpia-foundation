/**
 * Frontend client for the tool registry (Developer/Admin area only).
 */

import { apiFetch } from "@/lib/api/client";
import { supabase } from "@/lib/supabase/client";
import type { ToolDescriptor } from "@/backend/tools/tool-types";

export type { ToolDescriptor };

export interface ToolDiscovery {
  role: string;
  permissions: string[];
  available: ToolDescriptor[];
  registry?: ToolDescriptor[];
}

export async function fetchToolDiscovery(): Promise<ToolDiscovery> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return apiFetch<ToolDiscovery>("/tools", { headers: { Authorization: `Bearer ${token}` } });
}
