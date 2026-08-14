/**
 * Backend/API Layer — HTTP adapter.
 *
 * The ONLY module that knows about Request/Response. It builds the request
 * context, runs middleware, validates input, and serializes the envelope.
 */

import type { z } from "zod";

import { API_VERSION, failurePayload, successPayload } from "./api-response";
import { AppError, toAppError, validationError } from "./errors";
import { compose, withAuthContext, withLogging, type ApiHandler, type ApiMiddleware } from "./middleware";
import { createRequestContext, type RequestContext } from "./request-context";

const baseMiddleware = compose(withLogging, withAuthContext);

function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
      "x-api-version": API_VERSION,
    },
  });
}

export interface RouteOptions {
  middleware?: ApiMiddleware[];
  status?: number;
}

/** Wraps a domain handler into a TanStack server-route handler. */
export function apiRoute<T>(handler: ApiHandler<T>, options: RouteOptions = {}) {
  const wrapped = compose(baseMiddleware, ...(options.middleware ?? []))(handler);

  return async ({ request }: { request: Request }): Promise<Response> => {
    const ctx = createRequestContext(request);
    try {
      const data = await wrapped(ctx);
      return jsonResponse(successPayload(data, ctx.requestId), options.status ?? 200, ctx.requestId);
    } catch (error) {
      const appError = toAppError(error);
      if (appError.status >= 500) console.error(appError);
      return jsonResponse(
        failurePayload(appError.code, appError.message, ctx.requestId, appError.details),
        appError.status,
        ctx.requestId,
      );
    }
  };
}

export async function parseJsonBody<S extends z.ZodTypeAny>(
  ctx: RequestContext,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    throw validationError("Request body must be valid JSON");
  }
  return parseWith(schema, raw);
}

export function parseQuery<S extends z.ZodTypeAny>(ctx: RequestContext, schema: S): z.infer<S> {
  const params = Object.fromEntries(new URL(ctx.request.url).searchParams.entries());
  return parseWith(schema, params);
}

export function parseWith<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw validationError("Validation failed", result.error.flatten());
  }
  return result.data;
}

export { AppError };
