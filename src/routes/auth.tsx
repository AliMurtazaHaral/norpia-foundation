import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth/auth-context";
import { mapAuthError } from "@/lib/auth/errors";
import { signInSchema, signUpSchema } from "@/lib/auth/schemas";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — NORPIA" },
      {
        name: "description",
        content: "Sign in or create your NORPIA account to access the AI Operating System console.",
      },
      { property: "og:title", content: "Sign in — NORPIA" },
      { property: "og:description", content: "Access the NORPIA AI Operating System console." },
    ],
  }),
  component: AuthPage,
});

function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (error && typeof error === "object" && "issues" in error) {
    for (const issue of (error as { issues: { path: (string | number)[]; message: string }[] })
      .issues) {
      const key = String(issue.path[0] ?? "form");
      if (!out[key]) out[key] = issue.message;
    }
  }
  return out;
}

function AuthPage() {
  const { signIn, signUp, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("signin");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate({ to: "/dashboard", replace: true });
  }, [isAuthenticated, isLoading, navigate]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = signInSchema.safeParse({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setFormError(null);
    setVerifyNotice(null);
    setBusy(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
      toast.success("Signed in");
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      const failure = mapAuthError(error);
      setFormError(failure.message);
      if (failure.kind === "unverified") setUnverifiedEmail(parsed.data.email);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = signUpSchema.safeParse({
      firstName: String(form.get("firstName") ?? ""),
      lastName: String(form.get("lastName") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? ""),
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      const { needsEmailVerification } = await signUp(parsed.data);
      if (needsEmailVerification) {
        setVerifyNotice(
          `We sent a verification link to ${parsed.data.email}. Confirm your email address before signing in.`,
        );
        setTab("signin");
      } else {
        navigate({ to: "/dashboard", replace: true });
      }
    } catch (error) {
      setFormError(mapAuthError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 block text-center text-sm text-muted-foreground">
          ← Back to console
        </Link>
        <h1 className="text-center text-2xl font-bold tracking-tight text-foreground">NORPIA</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Authentication foundation — Week 3
        </p>

        {verifyNotice && (
          <div className="mt-6 rounded-md border border-accent/40 bg-accent/10 p-3 text-sm text-foreground">
            {verifyNotice}
          </div>
        )}

        {formError && (
          <div
            role="alert"
            className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground"
          >
            {formError}
            {unverifiedEmail && (
              <Link to="/verify-email" className="ml-1 font-medium underline">
                Resend verification email
              </Link>
            )}
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>

          <TabsContent value="signin">
            <form onSubmit={handleSignIn} className="space-y-4 rounded-lg border border-border p-6">
              <Field label="Email" name="email" type="email" error={errors['email']} />
              <Field label="Password" name="password" type="password" error={errors['password']} />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
              <Link
                to="/forgot-password"
                className="block text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Forgot your password?
              </Link>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-4 rounded-lg border border-border p-6">
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" name="firstName" error={errors['firstName']} />
                <Field label="Last name" name="lastName" error={errors['lastName']} />
              </div>
              <Field label="Email" name="email" type="email" error={errors['email']} />
              <Field label="Password" name="password" type="password" error={errors['password']} />
              <Field
                label="Confirm password"
                name="confirmPassword"
                type="password"
                error={errors['confirmPassword']}
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Creating account…" : "Create account"}
              </Button>
              <p className="text-xs text-muted-foreground">
                New accounts are created with the <strong>standard_user</strong> role.
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function Field({
  label,
  name,
  type = "text",
  error,
}: {
  label: string;
  name: string;
  type?: string;
  error?: string | undefined;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} autoComplete="on" />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
