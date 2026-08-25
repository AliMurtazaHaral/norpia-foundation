import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth/auth-context";
import { hasRole } from "@/lib/auth/roles";
import type { AppRole } from "@/lib/auth/auth-context";

/**
 * Reusable client-side authorization gate for future protected features.
 *
 * SECURITY: this only hides UI. Every privileged read/write must additionally
 * be protected by Supabase RLS (see infrastructure/db/migrations).
 */
export function RequireRole({
  roles,
  children,
  fallback,
}: {
  roles: AppRole[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { role, isLoading } = useAuth();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Checking permissions…</p>;
  }

  if (!hasRole(role, ...roles)) {
    return (
      fallback ?? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-6">
          <h2 className="text-sm font-semibold text-foreground">Not authorised</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account does not have permission to view this area.
          </p>
          <Link to="/dashboard" className="mt-4 inline-block text-sm underline">
            Back to dashboard
          </Link>
        </section>
      )
    );
  }

  return <>{children}</>;
}
