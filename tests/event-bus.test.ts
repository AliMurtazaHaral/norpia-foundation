import { describe, expect, it, vi } from "vitest";

import { InMemoryEventBus } from "@/backend/events/event-bus";

describe("InMemoryEventBus", () => {
  it("delivers a published event to subscribers", async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribe("conversation.created", handler);

    await bus.publish("conversation.created", { conversationId: "c1" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      name: "conversation.created",
      payload: { conversationId: "c1" },
    });
  });

  it("isolates subscriber failures from the publisher", async () => {
    const bus = new InMemoryEventBus();
    vi.spyOn(console, "error").mockImplementation(() => {});
    bus.subscribe("message.created", () => {
      throw new Error("boom");
    });

    await expect(
      bus.publish("message.created", { conversationId: "c1", messageId: "m1", role: "user" }),
    ).resolves.toBeDefined();
  });

  it("unsubscribes and records recent events", async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    const off = bus.subscribe("workflow.started", handler);
    off();

    await bus.publish("workflow.started", { workflowId: "w1", runId: "r1" });

    expect(handler).not.toHaveBeenCalled();
    expect(bus.recent()).toHaveLength(1);
  });
});
