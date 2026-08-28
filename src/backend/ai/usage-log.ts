/**
 * Minimal AI usage logging (Week 4 cost control).
 *
 * Structured, content-free: only ids, counts and estimates are recorded, never
 * message text, never credentials. A billing system is explicitly out of scope;
 * this is the hook a future metering table can subscribe to.
 */

export interface AiUsageRecord {
  conversationId: string;
  userId: string;
  provider: string;
  model: string;
  promptVersion: string;
  historyMessages: number;
  droppedMessages: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  durationMs: number;
  status: "completed" | "interrupted" | "empty";
}

export function logAiUsage(record: AiUsageRecord): void {
  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      event: "ai.chat.usage",
      ...record,
      // Hash-free short ids keep logs readable without exposing full uuids.
      conversationId: record.conversationId.slice(0, 8),
      userId: record.userId.slice(0, 8),
    }),
  );
}
