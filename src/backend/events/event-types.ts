/**
 * Event Layer — the application event catalogue.
 *
 * Adding an event = add the name + payload here. Everything else (bus,
 * subscribers, typing) follows automatically.
 */

export interface DomainEventMap {
  "conversation.created": { conversationId: string; userId?: string };
  "message.created": { conversationId: string; messageId: string; role: "user" | "assistant" };
  "document.uploaded": { documentId: string; filename: string; sizeBytes: number };
  "workflow.started": { workflowId: string; runId: string };
  "workflow.completed": { workflowId: string; runId: string; status: "success" | "failed" };
  "ai.task.created": { taskId: string; provider: string; kind: string };
  "integration.connected": { integrationId: string };
  "system.健康"?: never;
}

export type DomainEventName = Exclude<keyof DomainEventMap, "system.健康">;

export interface DomainEvent<N extends DomainEventName = DomainEventName> {
  id: string;
  name: N;
  payload: DomainEventMap[N];
  occurredAt: string;
  /** Correlates an event with the request that produced it. */
  requestId?: string;
}

export const EVENT_CATALOGUE: DomainEventName[] = [
  "conversation.created",
  "message.created",
  "document.uploaded",
  "workflow.started",
  "workflow.completed",
  "ai.task.created",
  "integration.connected",
];
