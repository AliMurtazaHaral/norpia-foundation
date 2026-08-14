/**
 * Frontend Layer — the ONLY way the UI reaches the backend.
 *
 * Components never fetch arbitrary URLs and never import backend modules;
 * they call this typed client, which speaks the /api/v1 envelope.
 */

export interface ApiEnvelopeMeta {
  requestId: string;
  timestamp: string;
  apiVersion: string;
}

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const BASE = "/api/v1";

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const body = (await response.json().catch(() => null)) as
    | { success: boolean; data?: T; error?: { code: string; message: string; details?: unknown } }
    | null;

  if (!body) {
    throw new ApiClientError("INTERNAL_ERROR", "Malformed API response", response.status);
  }
  if (!body.success || !response.ok) {
    throw new ApiClientError(
      body.error?.code ?? "INTERNAL_ERROR",
      body.error?.message ?? "Request failed",
      response.status,
      body.error?.details,
    );
  }
  return body.data as T;
}

export const api = {
  health: () => apiFetch<{ status: string; service: string; apiVersion: string; uptimeMs: number }>("/health"),
  architecture: () => apiFetch<ArchitectureSnapshot>("/system/architecture"),
  events: () => apiFetch<{ catalogue: string[]; recent: unknown[] }>("/events"),
};

export interface ArchitectureSnapshot {
  product: string;
  phase: string;
  apiVersion: string;
  layers: { id: string; name: string; responsibility: string; status: string }[];
  aiProviders: { id: string; label: string; capabilities: string[]; status: string }[];
  integrations: {
    id: string;
    label: string;
    category: string;
    auth: string;
    status: string;
    plannedFor: string;
  }[];
}
