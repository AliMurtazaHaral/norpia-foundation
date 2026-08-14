/**
 * Backend/API Layer — composable, transport-level middleware.
 *
 * Middleware are plain async functions wrapping a handler. Week 3 will add the
 * real authentication resolver behind `requireAuth`; the contract stays stable.
 */

import { unauthorized } from "./errors";
import type { RequestContext } from "./request-context";

export type ApiHandler<T> = (ctx: RequestContext) => Promise<T> | T;
export type ApiMiddleware = <T>(next: ApiHandler<T>) => ApiHandler<T>;

export function compose(...middlewares: ApiMiddleware[]): ApiMiddleware {
  return <T>(handler: ApiHandler<T>) =>
    middlewares.reduceRight<ApiHandler<T>>((acc, mw) => mw(acc), handler);
}

/** Structured request logging. Replaceable by a real observability sink later. */
export const withLogging: ApiMiddleware = (next) => async (ctx) => {
  const result = await next(ctx);
  console.info(
    JSON.stringify({
      scope: "api",
      requestId: ctx.requestId,
      method: ctx.request.method,
      path: new URL(ctx.request.url).pathname,
      durationMs: Date.now() - ctx.startedAt,
    }),
  );
  return result;
};

/**
 * Authentication-ready middleware.
 * Week 2: resolves nothing and leaves `principal` null (no auth implemented).
 * Week 3: this is the single place that verifies the bearer token / session.
 */
export const withAuthContext: ApiMiddleware = (next) => async (ctx) => {
  // Intentionally a no-op resolver until the Authentication Layer lands.
  return next(ctx);
};

/** Guard for routes that will require a signed-in principal. */
export const requireAuth: ApiMiddleware = (next) => async (ctx) => {
  if (!ctx.principal) throw unauthorized();
  return next(ctx);
};
