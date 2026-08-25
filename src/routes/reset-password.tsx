import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { mapAuthError } from "@/lib/auth/errors";
import { resetPasswordSchema } from "@/lib/auth/schemas";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password — NORPIA" },
      { name: "description", content: "Choose a new password for your NORPIA account." },
      { property: "og:title", content: "Set a new password — NORPIA" },
      { property: "og:description", content: "Complete your NORPIA password reset." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { updatePassword, isAuthenticated, isLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Supabase handles the recovery token itself; we only surface link errors.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const errorDescription = hash.get("error_description") ?? query.get("error_description");
    if (errorDescription) {
      setLinkError("This reset link has expired or is no longer valid. Request a new one.");
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = resetPasswordSchema.safeParse({
      password: String(form.get("password") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? ""),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await updatePassword(parsed.data.password);
      setDone(true);
    } catch (error) {
      toast.error(mapAuthError(error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-foreground">Password updated</h1>
        <p className="mt-3 rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-foreground">
          Your password has been changed. You can now sign in with your new password.
        </p>
        <Button
          className="mt-4 w-full"
          onClick={async () => {
            await signOut();
            navigate({ to: "/auth", replace: true });
          }}
        >
          Go to sign in
        </Button>
      </Shell>
    );
  }

  if (linkError || (!isLoading && !isAuthenticated)) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-foreground">Reset link problem</h1>
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
          {linkError ?? "Open this page from the reset link in your email to set a new password."}
        </p>
        <Link
          to="/forgot-password"
          className="mt-4 block text-center text-sm font-medium underline"
        >
          Request a new reset link
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={handleSubmit} className="space-y-4">
        <h1 className="text-lg font-semibold text-foreground">Set a new password</h1>
        <p className="text-xs text-muted-foreground">
          At least 8 characters, with upper- and lowercase letters and a number.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" />
          {errors['password'] && <p className="text-xs text-destructive">{errors['password']}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
          />
          {errors['confirmPassword'] && (
            <p className="text-xs text-destructive">{errors['confirmPassword']}</p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Saving…" : "Update password"}
        </Button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-border p-6">{children}</div>
    </main>
  );
}
