import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/layout/app-shell";
import { RequireRole } from "@/lib/auth/require-role";

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
  return (
    <AppShell title="Administration" description="Administrator-only area.">
      <RequireRole roles={["administrator"]}>
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
      </RequireRole>
    </AppShell>
  );
}
