/**
 * Backend/API Layer — canonical error taxonomy.
 *
 * Every layer (service, repository, integration) throws AppError subclasses.
 * The HTTP adapter (core/http.ts) is the only place that maps them to a
 * transport-level status code, so transport concerns never leak into services.
 */

export const ErrorCode = {
  BAD_REQUEST: "BAD_REQUEST",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  INTEGRATION_ERROR: "INTEGRATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  NOT_IMPLEMENTED: 501,
  INTEGRATION_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError(ErrorCode.BAD_REQUEST, m, d);
export const validationError = (m: string, d?: unknown) =>
  new AppError(ErrorCode.VALIDATION_ERROR, m, d);
export const unauthorized = (m = "Authentication required") =>
  new AppError(ErrorCode.UNAUTHORIZED, m);
export const forbidden = (m = "Not allowed") => new AppError(ErrorCode.FORBIDDEN, m);
export const notFound = (m = "Resource not found") => new AppError(ErrorCode.NOT_FOUND, m);
export const notImplemented = (m: string) => new AppError(ErrorCode.NOT_IMPLEMENTED, m);
export const integrationError = (m: string, d?: unknown) =>
  new AppError(ErrorCode.INTEGRATION_ERROR, m, d);

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : "Unexpected error";
  return new AppError(ErrorCode.INTERNAL_ERROR, message);
}
