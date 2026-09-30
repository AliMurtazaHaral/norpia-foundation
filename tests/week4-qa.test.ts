/**
 * Month 2 Week 4 — final QA: registry integrity, end-to-end tool flow,
 * security, user isolation, Week 2 memory regression through tools, and
 * provider independence of the tool layer.
 */
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { applyToolStep, planToolCall } from "@/backend/ai/orchestration/tool-planner";
import { resolveToolAccess } from "@/backend/tools/tool-http";
import { executeTool } from "@/backend/tools/tool-executor";
import { getTool, listTools, permissionsForRole, registerTool, unregisterTool } from "@/backend/tools/tool-registry";
import { defineTool } from "@/backend/tools/tool-types";
import type { AiTurn } from "@/backend/ai/provider/provider-types";

vi.spyOn(console, "info").mockImplementation(() => {});

const USER_A = "aaaaaaaa-0000-0000-0000-000000000000";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000000";

/** Fake RLS-scoped DB: rows only visible when the query filters on the caller. */
function fakeSupabase(owner: string, rows: Record<string, unknown>[], opts: { fail?: boolean } = {}) {
  const filters: [string, unknown][] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "in", "order", "gte", "neq", "update"]) chain[m] = () => chain;
  chain["eq"] = (c: string, v: unknown) => (filters.push([c, v]), chain);
  const resolve = async () => {
    if (opts.fail) return { data: null, error: { message: "db down: password=x" } };
    const uid = filters.find(([c]) => c === "user_id")?.[1];
    // RLS: only the session owner's rows are ever returned.
    return { data: uid === owner ? rows.filter((r) => r["user_id"] === owner) : [], error: null };
  };
  chain["limit"] = resolve;
  chain["then"] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => resolve().then(res, rej);
  return { from: () => chain, filters } as never as { from: () => unknown; filters: [string, unknown][] };
}

const memRow = (user: string, content: string) => ({
  id: crypto.randomUUID(), user_id: user, content, category: "business", importance: 4,
  confidence: 0.9, active: true, source: "conversation", metadata: {},
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_used_at: null,
});

const ctx = (userId: string, supabase: unknown, role: "standard_user" | "administrator" = "standard_user") => ({
  userId, role, permissions: permissionsForRole(role), supabase: supabase as never, requestId: "qa-req",
});

afterEach(() => unregisterTool("qa.tool"));

describe("2. registry QA", () => {
  const tools = listTools();
  it("ids and names are unique; descriptions, input and output schemas exist", () => {
    expect(new Set(tools.map((t) => t.id)).size).toBe(tools.length);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    for (const d of tools) {
      const def = getTool(d.id)!;
      expect(d.description.length).toBeGreaterThan(10);
      expect(def.inputSchema).toBeInstanceOf(z.ZodType);
      expect(def.outputSchema).toBeInstanceOf(z.ZodType);
      expect(def.timeoutMs).toBeGreaterThan(0);
    }
  });
  it("disabled and unknown tools cannot execute", async () => {
    registerTool(defineTool({
      id: "qa.tool", name: "QA", description: "disabled qa tool", category: "system", source: "internal",
      inputSchema: z.object({}).strict(), outputSchema: z.object({}), permissions: ["system:read"],
      auth: { kind: "none" }, enabled: false, timeoutMs: 100, handler: vi.fn(),
    }));
    const off = await executeTool({ toolId: "qa.tool" }, ctx(USER_A, {}));
    expect(!off.ok && off.error.code).toBe("tool_disabled");
    const unk = await executeTool({ toolId: "nope.tool" }, ctx(USER_A, {}));
    expect(!unk.ok && unk.error.code).toBe("unknown_tool");
  });
  it("non-internal (MCP/API) sources are declared-only and never execute", async () => {
    registerTool(defineTool({
      id: "qa.tool", name: "QA", description: "mcp qa tool", category: "system", source: "mcp",
      inputSchema: z.object({}).strict(), outputSchema: z.object({}), permissions: ["system:read"],
      auth: { kind: "none" }, enabled: true, timeoutMs: 100, handler: vi.fn(),
    }));
    const r = await executeTool({ toolId: "qa.tool" }, ctx(USER_A, {}));
    expect(!r.ok && r.error.code).toBe("not_configured");
  });
});

describe("1 + 5. end-to-end tool flow with Week 2 memory", () => {
  const history = (q: string): AiTurn[] => [
    { role: "system", content: "You are JARVIS." },
    { role: "user", content: q },
  ];
  it("'What do you know about my company?' → memory.search → Switzerland reaches the provider", async () => {
    const db = fakeSupabase(USER_A, [memRow(USER_A, "User's company is based in Switzerland")]);
    const q = "What do you know about my company?";
    expect(planToolCall(q, permissionsForRole("standard_user"))?.toolId).toBe("memory.search");
    const step = await applyToolStep(q, history(q), ctx(USER_A, db));
    expect(step.record?.status).toBe("success");
    expect(step.record?.requestId).toBe("qa-req");
    const toolBlock = step.messages.at(-2)!;
    expect(toolBlock.role).toBe("system");
    expect(toolBlock.content).toContain("Switzerland");
    expect(step.messages.at(-1)?.content).toBe(q);
    expect(db.filters).toContainEqual(["user_id", USER_A]);
  });
});

describe("3 + 4. security and user isolation", () => {
  it("User A never receives User B's memories through the tool", async () => {
    const db = fakeSupabase(USER_B, [memRow(USER_B, "B's secret: Company in Norway")]);
    const r = await executeTool({ toolId: "memory.search", input: { query: "company" } }, ctx(USER_A, db));
    expect(r.ok && JSON.stringify(r.output)).not.toContain("Norway");
  });
  it("cannot spoof another user id, role or permission via input", async () => {
    for (const input of [{ query: "x", userId: USER_B }, { query: "x", role: "administrator" }, { query: "x", permissions: ["admin"] }]) {
      const r = await executeTool({ toolId: "memory.search", input }, ctx(USER_A, {}));
      expect(!r.ok && r.error.code).toBe("invalid_input");
    }
  });
  it("rejects missing params and malicious/oversized input", async () => {
    for (const input of [{}, { query: "" }, { query: "x".repeat(600) }, { query: { $ne: 1 } }, { query: "x", limit: 999 }]) {
      const r = await executeTool({ toolId: "memory.search", input }, ctx(USER_A, {}));
      expect(!r.ok && r.error.code).toBe("invalid_input");
    }
  });
  it("unauthenticated and empty user id are refused", async () => {
    expect((await executeTool({ toolId: "system.time" }, null)).ok).toBe(false);
    const r = await executeTool({ toolId: "system.time" }, { ...ctx("", {}) });
    expect(!r.ok && r.error.code).toBe("unauthenticated");
  });
  it("role is resolved server-side from user_roles; unknown/absent role → standard_user", async () => {
    const q = (roles: string[]) => ({ from: () => ({ select: () => ({ eq: async () => ({ data: roles.map((role) => ({ role })) }) }) }) }) as never;
    expect((await resolveToolAccess(q([]), USER_A)).role).toBe("standard_user");
    expect((await resolveToolAccess(q(["superuser"]), USER_A)).role).toBe("standard_user");
    expect((await resolveToolAccess(q(["administrator"]), USER_A)).permissions).toContain("admin");
  });
});

describe("9. error handling", () => {
  it("database failure becomes a safe tool error; chat context still intact", async () => {
    const db = fakeSupabase(USER_A, [], { fail: true });
    const q = "What do you know about my company?";
    const step = await applyToolStep(q, [{ role: "user", content: q }], ctx(USER_A, db));
    expect(step.messages.at(-1)?.content).toBe(q);
    const text = JSON.stringify(step);
    expect(text).not.toContain("password");
  });
  it("normal conversation runs no tool (no extra DB/API calls)", async () => {
    const from = vi.fn();
    const step = await applyToolStep("Draft a pricing email", [{ role: "user", content: "Draft a pricing email" }], ctx(USER_A, { from }));
    expect(step.record).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});

describe("6. provider independence", () => {
  it("no provider adapter imports the tool layer", () => {
    const dir = "src/backend/ai/provider";
    for (const f of readdirSync(dir)) {
      expect(readFileSync(`${dir}/${f}`, "utf8")).not.toMatch(/backend\/tools|tool-planner|tool-bridge/);
    }
  });
});
