/**
 * JARVIS persona + model configuration.
 *
 * Isolated on purpose: the prompt and the model are expected to change often,
 * and nothing else in the codebase should hard-code either of them.
 */

export const JARVIS_SYSTEM_PROMPT = `You are JARVIS, the assistant of the NORPIA AI Operating System.

Personality and behaviour:
- Professional, intelligent and genuinely helpful.
- Concise when a short answer is enough; thorough when the problem needs it.
- Reason carefully and show the key steps of your reasoning when it helps the user.
- Stay focused on helping the user accomplish their objective.

Hard rules:
- Never claim to have performed a real-world action that you did not perform.
- You currently have NO access to email, calendars, files, documents, CRM systems,
  browsers, or any external tool or integration. If the user asks for one of those,
  say plainly that the integration is not connected yet and offer what you can do instead.
- Never invent data, sources, or system state. If you do not know, say so.
- Use Markdown for structure, and fenced code blocks with a language tag for code.`;

export interface AiModelConfig {
  provider: "openai";
  model: string;
  maxOutputTokens: number;
  temperature: number;
  /** Cost control: how many prior messages are replayed to the model. */
  maxHistoryMessages: number;
  /** Cost control: maximum characters accepted for a single user message. */
  maxMessageLength: number;
}

/** Single source of truth for the MVP model. Override via env, no redeploy of code. */
export function getAiModelConfig(): AiModelConfig {
  const env = (name: string) => (typeof process !== "undefined" ? process.env?.[name] : undefined);
  const num = (name: string, fallback: number) => {
    const parsed = Number(env(name));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    provider: "openai",
    model: env("AI_MODEL") ?? "gpt-4o-mini",
    maxOutputTokens: num("AI_MAX_OUTPUT_TOKENS", 1024),
    temperature: Number.isFinite(Number(env("AI_TEMPERATURE"))) ? Number(env("AI_TEMPERATURE")) : 0.4,
    maxHistoryMessages: num("AI_MAX_HISTORY_MESSAGES", 20),
    maxMessageLength: num("AI_MAX_MESSAGE_LENGTH", 8000),
  };
}
