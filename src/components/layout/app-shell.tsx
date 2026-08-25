import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { mapAuthError } from "@/lib/auth/errors";
import { navForRole, ROLE_LABELS } from "@/lib/auth/roles";

/**
 * Shared shell for authenticated pages: role-aware navigation, verification
 * banner and sign-out. Navigation filtering is UI convenience only — access is
 * enforced by the route guard and Supabase RLS.
 */
export function AppShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
}) {
  const { profile, role, user, isEmailVerified, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const items = navForRole(role);

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      navigate({ to: "/auth", replace: true });
    } catch (error) {
      toast.error(mapAuthError(error).message);
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-4">
          <Link to="/" className="text-sm font-bold tracking-[0.2em] text-foreground">
            NORPIA
          </Link>
          <nav aria-label="Main" className="flex flex-1 flex-wrap items-center gap-1">
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden text-right sm:block">
            <p className="text-xs font-medium text-foreground">{name || user?.email}</p>
            <p className="text-xs text-muted-foreground">
              {role ? ROLE_LABELS[role] : "Loading role…"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </header>

      {profile?.is_active === false && (
        <div className="border-b border-destructive/40 bg-destructive/10">
          <div className="mx-auto max-w-5xl px-4 py-2 text-sm text-foreground">
            This account is inactive. Contact your NORPIA administrator to restore access.
          </div>
        </div>
      )}

      {!isEmailVerified && (
        <div className="border-b border-accent/40 bg-accent/10">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-foreground">
            <span>Your email address is not verified yet.</span>
            <Link to="/verify-email" className="text-sm font-medium underline">
              Resend verification email
            </Link>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        <div className="mt-8 space-y-6">{children}</div>
      </main>
    </div>
  );
}
