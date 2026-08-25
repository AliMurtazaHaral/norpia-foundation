import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { mapAuthError } from "@/lib/auth/errors";
import { ROLE_LABELS } from "@/lib/auth/roles";

/**
 * Public site header. Shows Sign in / Sign up for anonymous visitors and a
 * Profile entry point (plus sign out) for authenticated users.
 */
export function SiteHeader() {
  const { isAuthenticated, isLoading, profile, user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      navigate({ to: "/auth", replace: true });
    } catch (error) {
      toast.error(mapAuthError(error).message);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <Link to="/" className="font-display text-sm font-extrabold tracking-[0.3em]">
          NORPIA
        </Link>

        <div className="flex-1" />

        {isLoading ? (
          <div className="h-9 w-40 animate-pulse rounded-md bg-muted/40" aria-hidden />
        ) : isAuthenticated ? (
          <nav aria-label="Account" className="flex flex-wrap items-center gap-2">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium text-foreground">{name || user?.email}</p>
              <p className="text-[11px] text-muted-foreground">
                {role ? ROLE_LABELS[role] : "Standard user"}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard">Dashboard</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/profile">Profile</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </nav>
        ) : (
          <nav aria-label="Account" className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/auth" search={{ mode: "signin" }}>
                Sign in
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/auth" search={{ mode: "signup" }}>
                Sign up
              </Link>
            </Button>
          </nav>
        )}
      </div>
    </header>
  );
}
