/**
 * Transport glue for the memory API: authenticates the request and translates
 * memory/auth failures into the canonical AppError taxonomy so /api/v1 routes
 * keep returning the standard envelope. No technical detail reaches the client.
 */

import { AppError, ErrorCode } from "@/backend/core/errors";
import { authenticateRequest, RequestAuthError } from "@/backend/core/supabase-request";
import { MemoryError } from "@/backend/memory/memory-service";

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  422: ErrorCode.VALIDATION_ERROR,
  503: ErrorCode.INTEGRATION_ERROR,
};

export function toApiError(error: unknown): AppError {
  if (error instanceof MemoryError || error instanceof RequestAuthError) {
    return new AppError(CODE_BY_STATUS[error.status] ?? ErrorCode.INTERNAL_ERROR, error.message);
  }
  if (error instanceof AppError) return error;
  return new AppError(ErrorCode.INTERNAL_ERROR, "Something went wrong. Please try again.");
}

export async function memoryAuth(request: Request) {
  try {
    return await authenticateRequest(request);
  } catch (error) {
    throw toApiError(error);
  }
}

/** Last path segment of the request URL — the memory id for /memories/:id. */
export function pathId(request: Request): string {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}
