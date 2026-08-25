/**
 * Role-aware UI helpers.
 *
 * SECURITY: this module is a *convenience layer only*. Real authorization is
 * enforced by Supabase RLS policies and the `public.user_roles` table.
 */
import type { AppRole } from "./auth-context";

export const ROLE_LABELS: Record<AppRole, string> = {
  administrator: "Administrator",
  standard_user: "Standard user",
};

export interface NavItem {
  label: string;
  to: string;
  roles?: AppRole[]; // undefined = visible to every signed-in user
}

export const APP_NAV: NavItem[] = [
  { label: "Dashboard", to: "/dashboard" },
  { label: "Profile", to: "/profile" },
  { label: "Settings", to: "/settings" },
  { label: "Administration", to: "/admin", roles: ["administrator"] },
];

export function navForRole(role: AppRole | null): NavItem[] {
  return APP_NAV.filter((item) => !item.roles || (role !== null && item.roles.includes(role)));
}

export function hasRole(role: AppRole | null, ...allowed: AppRole[]): boolean {
  return role !== null && allowed.includes(role);
}

export function isAdministrator(role: AppRole | null): boolean {
  return role === "administrator";
}
