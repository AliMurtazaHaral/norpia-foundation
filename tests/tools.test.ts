import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { executeTool } from "@/backend/tools/tool-executor";
import {
  getTool,
  listTools,
  listToolsFor,
  permissionsForRole,
  registerTool,
  unregisterTool,
} from "@/backend/tools/tool-registry";
import { defineTool, type ToolExecutionContext } from "@/backend/tools/tool-types";

vi.spyOn(console, "info").mockImplementation(() => {});

function ctx(overrides: Partial<ToolExecutionContext> = {}) {
  return {
    userId: "user-a-000000",
    role: "standard_user" as const,
    permissions: permissionsForRole("standard_user"),
    supabase: {} as ToolExecutionContext["supabase"],
    requestId: "req",
    ...overrides,
  };
}

const temp: string[] = [];
function add(def: Parameters<typeof defineTool>[0]) {
  registerTool(defineTool(def));
  temp.push(def.id);
}
afterEach(() => {
  temp.splice(0).forEach(unregisterTool);
  delete process.env["TOOLS_DISABLED"];
  delete process.env["TEST_TOOL_KEY"];
});

const base = {
  name: "Test",
  description: "t",
  category: "system" as const,
  source: "internal" as const,
  inputSchema: z.object({ n: z.number() }).strict(),
  outputSchema: z.object({ doubled: z.number() }),
  permissions: ["system:read" as const],
  auth: { kind: "user-session" as const },
  enabled: true,
  timeoutMs: 200,
  handler: async ({ n }: { n: number }) => ({ doubled: n * 2 }),
};

describe("tool registry", () => {
  it("registers and discovers built-in tools", () => {
    expect(getTool("system.time")).toBeDefined();
    expect(listTools().map((t) => t.id)).toEqual(expect.arrayContaining(["system.time", "memory.search"]));
  });
  it("rejects duplicates and invalid ids", () => {
    expect(() => registerTool(getTool("system.time")!)).toThrow();
    expect(() => registerTool({ ...base, id: "Bad Id" })).toThrow();
  });
  it("descriptors expose no handler or schema internals", () => {
    const d = listTools().find((t) => t.id === "memory.search")!;
    expect(d).not.toHaveProperty("handler");
    expect(d.inputFields).toEqual(["query", "limit"]);
  });
  it("discovery filters by permission", () => {
    add({ ...base, id: "test.admin", permissions: ["admin"] });
    expect(listToolsFor(permissionsForRole("standard_user")).map((t) => t.id)).not.toContain("test.admin");
    expect(listToolsFor(permissionsForRole("administrator")).map((t) => t.id)).toContain("test.admin");
  });
});

describe("tool execution contract", () => {
  it("executes successfully and normalises output", async () => {
    add({ ...base, id: "test.double" });
    const r = await executeTool({ toolId: "test.double", input: { n: 2 } }, ctx());
    expect(r.ok && r.output).toEqual({ doubled: 4 });
    expect(r.meta.executionId).toBeTruthy();
  });
  it("runs the real system.time tool", async () => {
    const r = await executeTool({ toolId: "system.time", input: { timeZone: "Europe/Zurich" } }, ctx());
    expect(r.ok).toBe(true);
  });
  it("requires authentication", async () => {
    const r = await executeTool({ toolId: "system.time" }, null);
    expect(!r.ok && r.error.code).toBe("unauthenticated");
  });
  it("rejects malformed requests and unknown tools", async () => {
    expect((await executeTool({ nope: 1 }, ctx())).ok).toBe(false);
    const r = await executeTool({ toolId: "does.not.exist" }, ctx());
    expect(!r.ok && r.error.code).toBe("unknown_tool");
  });
  it("enforces permissions", async () => {
    add({ ...base, id: "test.admin2", permissions: ["admin"] });
    const r = await executeTool({ toolId: "test.admin2", input: { n: 1 } }, ctx());
    expect(!r.ok && r.error.code).toBe("forbidden");
    const ok = await executeTool(
      { toolId: "test.admin2", input: { n: 1 } },
      ctx({ role: "administrator", permissions: permissionsForRole("administrator") }),
    );
    expect(ok.ok).toBe(true);
  });
  it("validates input, including unknown keys", async () => {
    add({ ...base, id: "test.input" });
    const r = await executeTool({ toolId: "test.input", input: { n: "x" } }, ctx());
    expect(!r.ok && r.error.code).toBe("invalid_input");
    const r2 = await executeTool({ toolId: "test.input", input: { n: 1, userId: "b" } }, ctx());
    expect(!r2.ok && r2.error.code).toBe("invalid_input");
  });
  it("blocks disabled tools (definition and operator switch)", async () => {
    add({ ...base, id: "test.off", enabled: false });
    expect((await executeTool({ toolId: "test.off", input: { n: 1 } }, ctx())).ok).toBe(false);
    process.env["TOOLS_DISABLED"] = "system.time";
    const r = await executeTool({ toolId: "system.time" }, ctx());
    expect(!r.ok && r.error.code).toBe("tool_disabled");
  });
  it("reports missing credentials without leaking the variable", async () => {
    add({ ...base, id: "test.cred", auth: { kind: "env-credential", envVar: "TEST_TOOL_KEY" } });
    const r = await executeTool({ toolId: "test.cred", input: { n: 1 } }, ctx());
    expect(!r.ok && r.error.code).toBe("not_configured");
    expect(JSON.stringify(r)).not.toContain("TEST_TOOL_KEY");
    process.env["TEST_TOOL_KEY"] = "secret";
    expect((await executeTool({ toolId: "test.cred", input: { n: 1 } }, ctx())).ok).toBe(true);
  });
  it("times out slow tools and aborts them", async () => {
    let aborted = false;
    add({
      ...base,
      id: "test.slow",
      timeoutMs: 20,
      handler: (_i, c) =>
        new Promise((res) => {
          c.signal.addEventListener("abort", () => (aborted = true));
          setTimeout(() => res({ doubled: 0 }), 500);
        }),
    });
    const r = await executeTool({ toolId: "test.slow", input: { n: 1 } }, ctx());
    expect(!r.ok && r.error.code).toBe("timeout");
    expect(aborted).toBe(true);
  });
  it("hides raw failure details", async () => {
    add({ ...base, id: "test.boom", handler: async () => { throw new Error("DB password=hunter2"); } });
    const r = await executeTool({ toolId: "test.boom", input: { n: 1 } }, ctx());
    expect(!r.ok && r.error.code).toBe("execution_failed");
    expect(JSON.stringify(r)).not.toContain("hunter2");
  });
  it("rejects invalid tool output", async () => {
    add({ ...base, id: "test.badout", handler: async () => ({ wrong: true }) as never });
    const r = await executeTool({ toolId: "test.badout", input: { n: 1 } }, ctx());
    expect(!r.ok && r.error.code).toBe("invalid_output");
  });
  it("memory.search stays scoped to the caller's user id", async () => {
    const eqCalls: [string, unknown][] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "in", "order"]) chain[m] = () => chain;
    chain["eq"] = (col: string, val: unknown) => (eqCalls.push([col, val]), chain);
    chain["limit"] = async () => ({ data: [], error: null });
    const supabase = { from: () => chain } as unknown as ToolExecutionContext["supabase"];
    const r = await executeTool(
      { toolId: "memory.search", input: { query: "company" } },
      ctx({ supabase, userId: "user-a-000000" }),
    );
    expect(r.ok).toBe(true);
    expect(eqCalls).toContainEqual(["user_id", "user-a-000000"]);
    const spoof = await executeTool(
      { toolId: "memory.search", input: { query: "x", userId: "user-b" } },
      ctx({ supabase }),
    );
    expect(!spoof.ok && spoof.error.code).toBe("invalid_input");
  });
});
