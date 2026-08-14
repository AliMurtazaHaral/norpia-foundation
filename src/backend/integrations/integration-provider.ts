/**
 * Integration Layer — contracts for every external system.
 *
 * Nothing outside this layer may call a third-party API directly. Services
 * depend on `IntegrationProvider`, so credentials, retries, and rate limits
 * stay in one place.
 */

export type IntegrationCategory = "ai" | "automation" | "productivity" | "protocol";

export type IntegrationStatus = "planned" | "connected" | "error";

export type IntegrationAuthKind = "api-key" | "oauth2" | "none";

export interface IntegrationDescriptor {
  id: string;
  label: string;
  category: IntegrationCategory;
  auth: IntegrationAuthKind;
  scopes?: string[];
  status: IntegrationStatus;
  plannedFor: string;
}

export interface IntegrationAction<TInput = unknown, TOutput = unknown> {
  id: string;
  description: string;
  execute(input: TInput): Promise<TOutput>;
}

export interface IntegrationProvider {
  readonly descriptor: IntegrationDescriptor;
  isConfigured(): boolean;
  /** Lightweight connectivity probe used by the health endpoint. */
  healthcheck(): Promise<{ ok: boolean; message: string }>;
  listActions(): IntegrationAction[];
}
