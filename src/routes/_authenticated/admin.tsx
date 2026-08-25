import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/lib/auth/auth-context";
import { isAdministrator } from "@/lib/auth/roles";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Administration — NORPIA" },
      { name: "description", content: "NORPIA administration area for administrator accounts." },
      { property: "og:title", content: "Administration — NORPIA" },
      { property: "og:description", content: "NORPIA administration area." },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { role, isLoading } = useAuth();

  if (isLoading) {
    return <AppShell title="Administration">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </AppShell>;
  }

  if (!isAdministrator(role)) {
    return (
      <AppShell title="Administration">
        <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-6">
          <h2 className="text-sm font-semibold text-foreground">Not authorised</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This area is limited to administrator accounts.
          </p>
          <Link to="/dashboard" className="mt-4 inline-block text-sm underline">
            Back to dashboard
          </Link>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell title="Administration" description="Administrator-only area.">
      <section className="rounded-lg border border-border p-6">
        <h2 className="text-sm font-semibold text-foreground">Foundation</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Role-aware navigation is in place. Administration tooling (user management, audit) is
          scheduled after the Week 3 authentication foundation.
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Authorization is enforced by Supabase RLS and the <code>public.user_roles</code> table —
          this screen only reflects it.
        </p>
      </section>
    </AppShell>
  );
}
