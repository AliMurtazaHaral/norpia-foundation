import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth/auth-context";
import { ROLE_LABELS, isAdministrator } from "@/lib/auth/roles";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — NORPIA" },
      { name: "description", content: "Your NORPIA account overview, role and session status." },
      { property: "og:title", content: "Dashboard — NORPIA" },
      { property: "og:description", content: "Your NORPIA account overview and session status." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user, profile, role, isEmailVerified } = useAuth();
  const name = profile?.first_name ? `Welcome back, ${profile.first_name}` : "Welcome back";

  return (
    <AppShell title={name} description={user?.email ?? undefined}>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Role" value={role ? ROLE_LABELS[role] : "—"} />
        <Stat label="Account status" value={profile?.is_active === false ? "Inactive" : "Active"} />
        <Stat label="Email" value={isEmailVerified ? "Verified" : "Pending"} />
        <Stat
          label="Member since"
          value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : "—"}
        />
      </section>

      <section className="rounded-lg border border-border p-6">
        <h2 className="text-sm font-semibold text-foreground">Account management</h2>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link to="/profile" className="rounded-md border border-border px-4 py-2 hover:bg-secondary">
            Profile
          </Link>
          <Link
            to="/settings"
            className="rounded-md border border-border px-4 py-2 hover:bg-secondary"
          >
            Account settings
          </Link>
          {isAdministrator(role) && (
            <Link
              to="/admin"
              className="rounded-md border border-border px-4 py-2 hover:bg-secondary"
            >
              Administration
            </Link>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <Badge variant="secondary" className="mt-2">
        {value}
      </Badge>
    </div>
  );
}
