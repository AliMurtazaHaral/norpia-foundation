import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { mapAuthError } from "@/lib/auth/errors";

export const Route = createFileRoute("/verify-email")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Verify your email — NORPIA" },
      {
        name: "description",
        content: "Confirm your NORPIA email address to activate access to the console.",
      },
      { property: "og:title", content: "Verify your email — NORPIA" },
      { property: "og:description", content: "Confirm your NORPIA email address." },
    ],
  }),
  component: VerifyEmailPage,
});

type Status = "checking" | "verified" | "failed" | "pending";

function VerifyEmailPage() {
  const { isEmailVerified, isLoading, user, resendVerification, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  // Supabase consumes the link tokens itself (detectSessionInUrl). We only read
  // the *error* description it leaves behind — never parse or validate tokens.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const errorCode = hash.get("error_code") ?? query.get("error_code");
    const errorDescription = hash.get("error_description") ?? query.get("error_description");

    if (errorCode || errorDescription) {
      setStatus("failed");
      setFailureMessage(
        errorCode?.includes("expired") || errorDescription?.includes("expired")
          ? "This verification link has expired. Request a new one below."
          : "This verification link is no longer valid. Request a new one below.",
      );
      return;
    }
    if (isLoading) return;
    if (isEmailVerified) {
      setStatus("verified");
      void refreshProfile();
    } else {
      setStatus("pending");
    }
  }, [isLoading, isEmailVerified, refreshProfile]);

  useEffect(() => {
    if (user?.email) setEmail(user.email);
  }, [user?.email]);

  async function handleResend() {
    if (!email) {
      toast.error("Enter the email address you registered with.");
      return;
    }
    setBusy(true);
    try {
      await resendVerification(email);
      setResent(true);
    } catch (error) {
      toast.error(mapAuthError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-border p-6">
        <h1 className="text-lg font-semibold text-foreground">Email verification</h1>

        {status === "checking" && (
          <p className="mt-3 text-sm text-muted-foreground">Checking your verification status…</p>
        )}

        {status === "verified" && (
          <>
            <p className="mt-3 rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-foreground">
              Your email address is verified. Your NORPIA account is ready.
            </p>
            <Button
              className="mt-4 w-full"
              onClick={() => navigate({ to: "/dashboard", replace: true })}
            >
              Continue to dashboard
            </Button>
          </>
        )}

        {(status === "failed" || status === "pending") && (
          <>
            <p
              className={`mt-3 rounded-md p-3 text-sm text-foreground ${
                status === "failed"
                  ? "border border-destructive/40 bg-destructive/10"
                  : "border border-accent/40 bg-accent/10"
              }`}
            >
              {status === "failed"
                ? failureMessage
                : "Verification is still pending. Open the link in the email we sent you, or request a new one."}
            </p>

            {resent ? (
              <p className="mt-4 text-sm text-muted-foreground">
                If that address needs verification, a new link is on its way.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="verify-email">Email</Label>
                  <Input
                    id="verify-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <Button className="w-full" onClick={handleResend} disabled={busy}>
                  {busy ? "Sending…" : "Resend verification email"}
                </Button>
              </div>
            )}
          </>
        )}

        <Link
          to="/auth"
          className="mt-6 block text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
