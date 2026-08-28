/**
 * JARVIS persona registry + model configuration.
 *
 * Isolated on purpose: the prompt and the model are expected to change often,
 * and nothing else in the codebase should hard-code either of them.
 *
 * The prompt is VERSIONED: add a new entry to `PROMPT_VERSIONS` and switch the
 * active version with the `AI_PROMPT_VERSION` env var — no code change at the
 * call sites, and old conversations can be traced back through the
 * `prompt_version` stored in each assistant message's metadata.
 */

export type PromptVersion = "v1";

const PROMPT_V1 = `You are JARVIS, the assistant of the NORPIA AI Operating System.

Personality and behaviour:
- Professional, intelligent and genuinely helpful.
- Concise when a short answer is enough; thorough when the problem needs it.
- Reason carefully and show the key steps of your reasoning when it helps the user.
- Stay focused on helping the user accomplish their objective.
- Use the conversation history above to resolve references such as "it", "that",
  "my company" or "the plan we discussed". Remember facts the user stated earlier
  in this conversation and use them without asking again.

Hard rules:
- Never claim to have performed a real-world action that you did not perform.
- You can only execute an action when the required integration or tool is actually
  connected to this system. Today NO integrations are connected: you have no access
  to email, calendars, files, documents, CRM systems, browsers, automation tools,
  or any external API. If the user asks for one of those, say plainly that the
  integration is not connected yet and offer what you can do instead.
- Never invent data, sources, or system state. If you do not know, say so.
- Use Markdown for structure, and fenced code blocks with a language tag for code.`;

export const PROMPT_VERSIONS: Record<PromptVersion, string> = {
  v1: PROMPT_V1,
};

export const DEFAULT_PROMPT_VERSION: PromptVersion = "v1";

/** Backwards-compatible export used by existing call sites and tests. */
export const JARVIS_SYSTEM_PROMPT = PROMPT_V1;

export function getSystemPrompt(version: PromptVersion = DEFAULT_PROMPT_VERSION): string {
  return PROMPT_VERSIONS[version] ?? PROMPT_V1;
}

export interface AiModelConfig {
  provider: "openai";
  model: string;
  promptVersion: PromptVersion;
  /** MAX_OUTPUT_TOKENS — cost control on the model's answer. */
  maxOutputTokens: number;
  temperature: number;
  /** MAX_CONTEXT_MESSAGES — how many prior messages are replayed to the model. */
  maxHistoryMessages: number;
  /** Cost control: maximum characters accepted for a single user message. */
  maxMessageLength: number;
  /** Cost control: hard ceiling on the characters sent as history. */
  maxContextCharacters: number;
}

/** Single source of truth for the MVP model. Override via env, no code redeploy. */
export function getAiModelConfig(): AiModelConfig {
  const env = (name: string) => (typeof process !== "undefined" ? process.env?.[name] : undefined);
  const num = (names: string[], fallback: number) => {
    for (const name of names) {
      const parsed = Number(env(name));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return fallback;
  };

  const version = env("AI_PROMPT_VERSION");
  const promptVersion: PromptVersion =
    version && version in PROMPT_VERSIONS ? (version as PromptVersion) : DEFAULT_PROMPT_VERSION;

  return {
    provider: "openai",
    model: env("AI_MODEL") ?? "gpt-4o-mini",
    promptVersion,
    maxOutputTokens: num(["MAX_OUTPUT_TOKENS", "AI_MAX_OUTPUT_TOKENS"], 1024),
    temperature: Number.isFinite(Number(env("AI_TEMPERATURE"))) ? Number(env("AI_TEMPERATURE")) : 0.4,
    maxHistoryMessages: num(["MAX_CONTEXT_MESSAGES", "AI_MAX_HISTORY_MESSAGES"], 20),
    maxMessageLength: num(["MAX_MESSAGE_LENGTH", "AI_MAX_MESSAGE_LENGTH"], 8000),
    maxContextCharacters: num(["MAX_CONTEXT_CHARACTERS"], 24000),
  };
}
