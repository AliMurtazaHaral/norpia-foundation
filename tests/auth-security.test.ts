import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { mapAuthError } from "../src/lib/auth/errors";
import { hasRole, isAdministrator, navForRole } from "../src/lib/auth/roles";
import { signInSchema, signUpSchema } from "../src/lib/auth/schemas";

const sql = [
  readFileSync("infrastructure/db/migrations/0002_auth_profiles.sql", "utf8"),
  readFileSync("infrastructure/db/migrations/0003_auth_hardening.sql", "utf8"),
].join("\n");

describe("validation", () => {
  it("rejects an invalid email", () => {
    expect(signInSchema.safeParse({ email: "nope", password: "Str0ngPass!" }).success).toBe(false);
  });

  it("rejects a weak password", () => {
    const r = signUpSchema.safeParse({
      firstName: "Ada",
      lastName: "L",
      email: "ada@example.com",
      password: "123",
      confirmPassword: "123",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a valid registration", () => {
    const r = signUpSchema.safeParse({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      password: "Str0ngPass!23",
      confirmPassword: "Str0ngPass!23",
    });
    expect(r.success).toBe(true);
  });
});

describe("auth error mapping", () => {
  it("returns a generic message for invalid credentials", () => {
    const mapped = mapAuthError({ message: "Invalid login credentials", status: 400 });
    expect(mapped.message.toLowerCase()).not.toContain("credentials are invalid because");
    expect(mapped.message.length).toBeGreaterThan(0);
  });

  it("never leaks raw stack traces", () => {
    const mapped = mapAuthError(new Error("PGRST301 jwt expired at db host 10.0.0.1"));
    expect(mapped.message).not.toContain("10.0.0.1");
  });
});

describe("role helpers", () => {
  it("hides administration from standard users", () => {
    expect(navForRole("standard_user").some((i) => i.to === "/admin")).toBe(false);
    expect(navForRole("administrator").some((i) => i.to === "/admin")).toBe(true);
    expect(navForRole(null).some((i) => i.to === "/admin")).toBe(false);
  });

  it("evaluates role checks", () => {
    expect(isAdministrator("administrator")).toBe(true);
    expect(isAdministrator("standard_user")).toBe(false);
    expect(hasRole("standard_user", "administrator")).toBe(false);
    expect(hasRole("standard_user", "standard_user", "administrator")).toBe(true);
  });
});

describe("row level security migration", () => {
  it("enables RLS on both user tables", () => {
    expect(sql).toContain("alter table public.profiles enable row level security");
    expect(sql).toContain("alter table public.user_roles enable row level security");
  });

  it("scopes profile reads and writes to the owner", () => {
    expect(sql).toContain("using (auth.uid() = id)");
    expect(sql).toContain("with check (auth.uid() = id)");
  });

  it("prevents clients from writing roles", () => {
    expect(sql).toContain("revoke insert, update, delete on public.user_roles from authenticated");
    expect(sql).toContain("Roles can only be modified server-side");
  });

  it("restricts profile updates to non-privileged columns", () => {
    expect(sql).toContain("revoke update on public.profiles from authenticated");
    expect(sql).toContain("grant  update (first_name, last_name, role, is_active)");
    expect(sql).toContain("new.role      := old.role");
  });

  it("keeps identity columns immutable", () => {
    expect(sql).toContain("new.id         := old.id");
    expect(sql).toContain("new.email      := old.email");
  });

  it("adds indexes and the unique email constraint", () => {
    expect(sql).toContain("profiles_email_lower_key");
    expect(sql).toContain("user_roles_user_id_idx");
  });
});

describe("secret hygiene", () => {
  const files = [
    "src/lib/supabase/client.ts",
    "src/lib/config.ts",
    "src/lib/auth/auth-context.tsx",
  ];

  it("never references the service-role key in client code", () => {
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      expect(content).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role/);
    }
  });

  it("ignores env files in git", () => {
    const gitignore = readFileSync(".gitignore", "utf8");
    expect(gitignore).toContain(".env");
  });
});
