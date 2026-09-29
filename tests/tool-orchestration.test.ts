import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  applyToolStep,
  planToolCall,
  renderToolResult,
  withToolResult,
} from "@/backend/ai/orchestration/tool-planner";
import { permissionsForRole, registerTool, unregisterTool } from "@/backend/tools/tool-registry";
import { defineTool } from "@/backend/tools/tool-types";
import type { AiTurn } from "@/backend/ai/provider/provider-types";

vi.spyOn(console, "info").mockImplementation(() => {});

const user = permissionsForRole("standard_user");
const history: AiTurn[] = [
  { role: "system", content: "You are JARVIS." },
  { role: "system", content: "## Long-term memory\n- Company is based in Switzerland" },
  { role: "user", content: "Hi" },
  { role: "assistant", content: "Hello" },
  { role: "user", content: "What time is it in Paris?" },
];
const ctx = (permissions = user) => ({
  supabase: {} as never,
  userId: "11111111-2222-3333-4444-555555555555",
  role: "standard_user" as const,
  permissions,
  requestId: "req-1",
});

describe("tool-aware orchestration", () => {
  afterEach(() => unregisterTool("test.fail"));

  it("A: normal conversation runs no tool", async () => {
    expect(planToolCall("Explain our pricing strategy", user)).toBeNull();
    const step = await applyToolStep("Explain our pricing strategy", history, ctx());
    expect(step.record).toBeNull();
    expect(step.messages).toBe(history);
    expect(step.intent).toBe("conversation");
  });

  it("B + F: time request selects system.time and the real result reaches the provider", async () => {
    const plan = planToolCall("What time is it in Paris?", user);
    expect(plan).toEqual({ toolId: "system.time", input: { timeZone: "Europe/Paris" }, reason: "time-question" });
    const step = await applyToolStep("What time is it in Paris?", history, ctx());
    expect(step.record?.status).toBe("success");
    expect(step.record?.toolName).toBe("Current time");
    expect(step.record?.requestId).toBe("req-1");
    const out = step.record?.result as { timeZone: string; iso: string };
    expect(out.timeZone).toBe("Europe/Paris");
    // Tool block sits right before the current user message; memory context preserved (G).
    const idx = step.messages.length - 2;
    expect(step.messages[idx].role).toBe("system");
    expect(step.messages[idx].content).toContain(out.iso);
    expect(step.messages[1].content).toContain("Switzerland");
    expect(step.messages.at(-1)?.content).toBe("What time is it in Paris?");
  });

  it("C: invalid input is rejected before execution", async () => {
    const handler = vi.fn();
    registerTool(
      defineTool({
        id: "test.fail", name: "t", description: "t", category: "system", source: "internal",
        inputSchema: z.object({ n: z.number() }).strict(), outputSchema: z.object({}),
        permissions: ["system:read"], auth: { kind: "none" }, enabled: true, timeoutMs: 500, handler,
      }),
    );
    const { executePlannedTool } = await import("@/backend/ai/orchestration/tool-planner");
    const rec = await executePlannedTool({ toolId: "test.fail", input: { n: "x" }, reason: "t" }, ctx());
    expect(rec.status).toBe("error");
    expect(rec.error?.category).toBe("invalid_input");
    expect(handler).not.toHaveBeenCalled();
  });

  it("D: caller without permission never gets the tool", async () => {
    expect(planToolCall("What time is it?", [])).toBeNull();
    const step = await applyToolStep("What time is it?", history, ctx([]));
    expect(step.record).toBeNull();
    expect(step.intent).toBe("tool");
  });

  it("E: a failing tool is normalised and safe", async () => {
    const step = await applyToolStep("What time is it in Mars/Base?", history, ctx());
    expect(step.record?.status).toBe("success"); // unknown zone ignored → UTC
    registerTool(
      defineTool({
        id: "test.fail", name: "t", description: "t", category: "system", source: "internal",
        inputSchema: z.object({}).strict(), outputSchema: z.object({}),
        permissions: ["system:read"], auth: { kind: "none" }, enabled: true, timeoutMs: 500,
        handler: async () => { throw new Error("secret db password leaked"); },
      }),
    );
    const { executePlannedTool } = await import("@/backend/ai/orchestration/tool-planner");
    const rec = await executePlannedTool({ toolId: "test.fail", input: {}, reason: "t" }, ctx());
    expect(rec.error?.category).toBe("execution_failed");
    const block = renderToolResult(rec);
    expect(block).not.toContain("secret");
    expect(block).toContain('"status":"error"');
  });

  it("injects before the last user message", () => {
    const out = withToolResult([{ role: "user", content: "q" }], "B");
    expect(out.map((m) => m.content)).toEqual(["B", "q"]);
  });
});
