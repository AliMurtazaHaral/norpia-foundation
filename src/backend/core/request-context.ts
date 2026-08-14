/**
 * Backend/API Layer — per-request context.
 *
 * Carries identity (populated by the Authentication Layer in Week 3), tracing
 * metadata, and the request itself. Services receive a RequestContext instead
 * of the raw Request so they stay transport-agnostic.
 */

export interface AuthPrincipal {
  userId: string;
  email?: string;
  roles: string[];
}

export interface RequestContext {
  requestId: string;
  startedAt: number;
  request: Request;
  /** null until the Authentication Layer is implemented (Week 3). */
  principal: AuthPrincipal | null;
}

export function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function createRequestContext(request: Request): RequestContext {
  return {
    requestId: request.headers.get("x-request-id") ?? createRequestId(),
    startedAt: Date.now(),
    request,
    principal: null,
  };
}
