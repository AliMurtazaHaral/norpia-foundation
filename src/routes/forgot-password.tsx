import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { forgotPasswordSchema } from "@/lib/auth/schemas";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset your password — NORPIA" },
      { name: "description", content: "Request a password reset link for your NORPIA account." },
      { property: "og:title", content: "Reset your password — NORPIA" },
      { property: "og:description", content: "Request a NORPIA password reset link by email." },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) return setError("Enter a valid email address");
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(parsed.data.email);
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send reset email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border p-6">
        <h1 className="text-lg font-semibold text-foreground">Forgot password</h1>
        {sent ? (
          <p className="mt-3 text-sm text-muted-foreground">
            If an account exists for that address, a reset link is on its way.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
        <Link
          to="/auth"
          className="mt-4 block text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
