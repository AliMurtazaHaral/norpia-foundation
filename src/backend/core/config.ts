/**
 * Backend Layer — centralized server-side configuration.
 *
 * Env vars MUST be read at call time (inside handlers): the worker runtime
 * injects the environment per request, so module-scope reads are undefined.
 * Nothing here is ever imported by UI code — see src/lib/config.ts for the
 * browser-safe counterpart.
 */

export type AppEnvironment = "development" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

function read(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function readNumber(name: string, fallback: number): number {
  const raw = read(name);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getConfig() {
  const environment: AppEnvironment =
    read("NODE_ENV") === "production" ? "production" : "development";

  return {
    environment,
    appName: read("APP_NAME") ?? "NORPIA",
    apiVersion: "v1",

    logging: {
      level: (read("LOG_LEVEL") ?? (environment === "production" ? "info" : "debug")) as LogLevel,
    },

    /** PostgreSQL foundation — consumed once persistence lands (Week 3+). */
    database: {
      url: read("DATABASE_URL"),
      poolMax: readNumber("DATABASE_POOL_MAX", 10),
      isConfigured: Boolean(read("DATABASE_URL")),
    },

    /** Object storage foundation — Phase 2. */
    storage: {
      provider: read("STORAGE_PROVIDER") ?? "local",
      bucket: read("STORAGE_BUCKET"),
      endpoint: read("STORAGE_ENDPOINT"),
      isConfigured: Boolean(read("STORAGE_ENDPOINT") && read("STORAGE_BUCKET")),
    },

    /** Declared for later phases; intentionally unused in Week 2. */
    ai: {
      openaiApiKey: read("OPENAI_API_KEY"),
      anthropicApiKey: read("ANTHROPIC_API_KEY"),
    },

    integrations: {
      n8nApiKey: read("N8N_API_KEY"),
      mcpServerUrl: read("MCP_SERVER_URL"),
    },
  };
}

export function requireEnv(name: string): string {
  const value = read(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
