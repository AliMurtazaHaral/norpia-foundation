import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { mapAuthError } from "@/lib/auth/errors";
import { ROLE_LABELS } from "@/lib/auth/roles";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Your profile — NORPIA" },
      { name: "description", content: "View and update your NORPIA profile details." },
      { property: "og:title", content: "Your profile — NORPIA" },
      { property: "og:description", content: "View and update your NORPIA profile details." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, profile, role, isEmailVerified, updateProfile } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setFirstName(profile?.first_name ?? "");
    setLastName(profile?.last_name ?? "");
  }, [profile?.first_name, profile?.last_name]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!firstName.trim()) next['firstName'] = "First name is required";
    if (!lastName.trim()) next['lastName'] = "Last name is required";
    if (firstName.length > 80 || lastName.length > 80) next['form'] = "Names are limited to 80 characters";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      await updateProfile({ firstName: firstName.trim(), lastName: lastName.trim() });
      toast.success("Profile updated");
    } catch (error) {
      toast.error(mapAuthError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Profile" description="Your NORPIA account identity and details.">
      <section className="rounded-lg border border-border p-6">
        <h2 className="text-sm font-semibold text-foreground">Account overview</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Detail label="First name" value={profile?.first_name ?? "—"} />
          <Detail label="Last name" value={profile?.last_name ?? "—"} />
          <Detail label="Email" value={profile?.email ?? user?.email ?? "—"} />
          <Detail label="Role" value={role ? ROLE_LABELS[role] : "—"} />
          <Detail
            label="Account status"
            value={profile?.is_active === false ? "Inactive" : "Active"}
            tone={profile?.is_active === false ? "destructive" : "ok"}
          />
          <Detail
            label="Email verification"
            value={isEmailVerified ? "Verified" : "Pending"}
            tone={isEmailVerified ? "ok" : "warn"}
          />
          <Detail
            label="Member since"
            value={
              profile?.created_at
                ? new Date(profile.created_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : "—"
            }
          />
        </dl>
      </section>

      <form onSubmit={handleSubmit} className="rounded-lg border border-border p-6">
        <h2 className="text-sm font-semibold text-foreground">Edit details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              value={firstName}
              maxLength={80}
              onChange={(event) => setFirstName(event.target.value)}
            />
            {errors['firstName'] && (
              <p className="text-xs text-destructive">{errors['firstName']}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              value={lastName}
              maxLength={80}
              onChange={(event) => setLastName(event.target.value)}
            />
            {errors['lastName'] && <p className="text-xs text-destructive">{errors['lastName']}</p>}
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          User ID, email, role and account status are managed server-side and cannot be changed
          here.
        </p>
        <Button type="submit" className="mt-4" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </AppShell>
  );
}

function Detail({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "destructive";
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground">
        {tone ? (
          <Badge
            variant={tone === "destructive" ? "destructive" : tone === "warn" ? "outline" : "secondary"}
          >
            {value}
          </Badge>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
