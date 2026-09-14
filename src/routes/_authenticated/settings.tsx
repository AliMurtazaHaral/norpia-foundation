import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { MemoryManager } from "@/components/memory/memory-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth/auth-context";
import { mapAuthError } from "@/lib/auth/errors";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { resetPasswordSchema } from "@/lib/auth/schemas";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Account settings — NORPIA" },
      { name: "description", content: "Manage your NORPIA profile, security and preferences." },
      { property: "og:title", content: "Account settings — NORPIA" },
      { property: "og:description", content: "Manage your NORPIA profile, security and preferences." },
    ],
  }),
  component: SettingsPage,
});

const PREFS_KEY = "norpia.preferences";

interface Preferences {
  timezone: string;
  language: string;
  productUpdates: boolean;
  securityAlerts: boolean;
}

const DEFAULT_PREFS: Preferences = {
  timezone: "UTC",
  language: "en",
  productUpdates: false,
  securityAlerts: true,
};

function SettingsPage() {
  const { user, profile, role, isEmailVerified, updateProfile, updatePassword, signOut } =
    useAuth();
  const navigate = useNavigate();

  return (
    <AppShell title="Account settings" description="Profile, security and preferences.">
      <Tabs defaultValue="profile">
        <TabsList className="grid w-full max-w-xl grid-cols-4">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
        </TabsList>

        <TabsContent value="memory" className="mt-6">
          <MemoryManager />
        </TabsContent>

        <TabsContent value="profile" className="mt-6">
          <ProfileSection
            firstNameInitial={profile?.first_name ?? ""}
            lastNameInitial={profile?.last_name ?? ""}
            email={profile?.email ?? user?.email ?? "—"}
            roleLabel={role ? ROLE_LABELS[role] : "—"}
            onSave={updateProfile}
          />
        </TabsContent>

        <TabsContent value="security" className="mt-6 space-y-6">
          <ChangePasswordSection onUpdate={updatePassword} />

          <section className="rounded-lg border border-border p-6">
            <h2 className="text-sm font-semibold text-foreground">Email verification</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <Badge variant={isEmailVerified ? "secondary" : "outline"}>
                {isEmailVerified ? "Verified" : "Pending"}
              </Badge>
              <span className="text-muted-foreground">{user?.email}</span>
              {!isEmailVerified && (
                <Link to="/verify-email" className="text-sm font-medium underline">
                  Resend verification email
                </Link>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border p-6">
            <h2 className="text-sm font-semibold text-foreground">Session</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign out of NORPIA on this device.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth", replace: true });
              }}
            >
              Sign out
            </Button>
          </section>
        </TabsContent>

        <TabsContent value="preferences" className="mt-6">
          <PreferencesSection />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function ProfileSection({
  firstNameInitial,
  lastNameInitial,
  email,
  roleLabel,
  onSave,
}: {
  firstNameInitial: string;
  lastNameInitial: string;
  email: string;
  roleLabel: string;
  onSave: (input: { firstName: string; lastName: string }) => Promise<void>;
}) {
  const [firstName, setFirstName] = useState(firstNameInitial);
  const [lastName, setLastName] = useState(lastNameInitial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFirstName(firstNameInitial);
    setLastName(lastNameInitial);
  }, [firstNameInitial, lastNameInitial]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First and last name are required");
      return;
    }
    setBusy(true);
    try {
      await onSave({ firstName: firstName.trim(), lastName: lastName.trim() });
      toast.success("Profile updated");
    } catch (error) {
      toast.error(mapAuthError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border p-6">
      <h2 className="text-sm font-semibold text-foreground">Profile</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="settings-first">First name</Label>
          <Input
            id="settings-first"
            value={firstName}
            maxLength={80}
            onChange={(event) => setFirstName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="settings-last">Last name</Label>
          <Input
            id="settings-last"
            value={lastName}
            maxLength={80}
            onChange={(event) => setLastName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="settings-email">Email</Label>
          <Input id="settings-email" value={email} disabled readOnly />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="settings-role">Role</Label>
          <Input id="settings-role" value={roleLabel} disabled readOnly />
        </div>
      </div>
      <Button type="submit" className="mt-4" disabled={busy}>
        {busy ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

function ChangePasswordSection({ onUpdate }: { onUpdate: (password: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = resetPasswordSchema.safeParse({
      password: String(data.get("password") ?? ""),
      confirmPassword: String(data.get("confirmPassword") ?? ""),
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
      await onUpdate(parsed.data.password);
      form.reset();
      toast.success("Password changed");
    } catch (error) {
      toast.error(mapAuthError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border p-6">
      <h2 className="text-sm font-semibold text-foreground">Change password</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        At least 8 characters, with upper- and lowercase letters and a number.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" name="password" type="password" autoComplete="new-password" />
          {errors['password'] && <p className="text-xs text-destructive">{errors['password']}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <Input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
          />
          {errors['confirmPassword'] && (
            <p className="text-xs text-destructive">{errors['confirmPassword']}</p>
          )}
        </div>
      </div>
      <Button type="submit" className="mt-4" disabled={busy}>
        {busy ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}

function PreferencesSection() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PREFS_KEY);
      if (stored) setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(stored) as Partial<Preferences>) });
    } catch {
      /* ignore malformed local preferences */
    }
  }, []);

  function save(next: Preferences) {
    setPrefs(next);
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    toast.success("Preferences saved");
  }

  return (
    <section className="rounded-lg border border-border p-6">
      <h2 className="text-sm font-semibold text-foreground">Preferences</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Foundation only — stored locally until account preferences move server-side.
      </p>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="timezone">Timezone</Label>
          <Select value={prefs.timezone} onValueChange={(v) => save({ ...prefs, timezone: v })}>
            <SelectTrigger id="timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UTC">UTC</SelectItem>
              <SelectItem value="Europe/Zurich">Europe / Zurich</SelectItem>
              <SelectItem value="Europe/Paris">Europe / Paris</SelectItem>
              <SelectItem value="America/New_York">America / New York</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="language">Language</Label>
          <Select value={prefs.language} onValueChange={(v) => save({ ...prefs, language: v })}>
            <SelectTrigger id="language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="de">German</SelectItem>
              <SelectItem value="fr">French</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        <ToggleRow
          id="product-updates"
          label="Product updates"
          description="Occasional emails about new NORPIA capabilities."
          checked={prefs.productUpdates}
          onChange={(checked) => save({ ...prefs, productUpdates: checked })}
        />
        <ToggleRow
          id="security-alerts"
          label="Security alerts"
          description="Notifications about sign-ins and account changes."
          checked={prefs.securityAlerts}
          onChange={(checked) => save({ ...prefs, securityAlerts: checked })}
        />
      </div>
    </section>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
