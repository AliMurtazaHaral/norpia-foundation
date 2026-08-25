import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Your account — NORPIA" },
      { name: "description", content: "Manage your NORPIA profile, role and session." },
      { property: "og:title", content: "Your account — NORPIA" },
      { property: "og:description", content: "Manage your NORPIA profile, role and session." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user, profile, role, isEmailVerified, isLoading, signOut, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFirstName(profile?.first_name ?? "");
    setLastName(profile?.last_name ?? "");
  }, [profile?.first_name, profile?.last_name]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await updateProfile({ firstName, lastName });
      toast.success("Profile updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (isLoading) {
    return <main className="p-8 text-sm text-muted-foreground">Loading session…</main>;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Your account</h1>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          Sign out
        </Button>
      </header>

      <section className="mt-8 grid gap-3 rounded-lg border border-border p-6 text-sm">
        <Row label="Role" value={role ?? "—"} />
        <Row label="Email verified" value={isEmailVerified ? "Yes" : "No"} />
        <Row label="Active" value={profile?.is_active ? "Yes" : "No"} />
        <Row
          label="Member since"
          value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : "—"}
        />
      </section>

      <form onSubmit={handleSave} className="mt-6 space-y-4 rounded-lg border border-border p-6">
        <h2 className="text-sm font-semibold text-foreground">Profile</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Role and account status are managed server-side and cannot be changed here.
        </p>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
