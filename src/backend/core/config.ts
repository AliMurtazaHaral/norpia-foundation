/**
 * Backend Layer — server-side configuration accessor.
 *
 * Env vars MUST be read at call time (inside handlers): the worker runtime
 * injects the environment per request, so module-scope reads are undefined.
 */

export type AppEnvironment = "development" | "production";

function read(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

export function getConfig() {
  return {
    environment: (read("NODE_ENV") === "production" ? "production" : "development") as AppEnvironment,
    apiVersion: "v1",
    /** Declared for later phases; intentionally unused in Week 2. */
    integrations: {
      openaiApiKey: read("OPENAI_API_KEY"),
      anthropicApiKey: read("ANTHROPIC_API_KEY"),
      n8nApiKey: read("N8N_API_KEY"),
    },
  };
}

export function requireEnv(name: string): string {
  const value = read(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
