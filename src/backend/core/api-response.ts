/**
 * Backend/API Layer — the single response envelope used by every /api/v1 route.
 *
 *   success: { success: true,  data, meta }
 *   failure: { success: false, error: { code, message, details? }, meta }
 */

import type { ErrorCode } from "./errors";

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
  apiVersion: string;
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ApiFailure {
  success: false;
  error: { code: ErrorCode | string; message: string; details?: unknown };
  meta: ResponseMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface PaginatedData<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const API_VERSION = "v1";

export function buildMeta(requestId: string, extra?: Record<string, unknown>): ResponseMeta {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    apiVersion: API_VERSION,
    ...extra,
  };
}

export function successPayload<T>(
  data: T,
  requestId: string,
  extra?: Record<string, unknown>,
): ApiSuccess<T> {
  return { success: true, data, meta: buildMeta(requestId, extra) };
}

export function failurePayload(
  code: ErrorCode | string,
  message: string,
  requestId: string,
  details?: unknown,
): ApiFailure {
  return { success: false, error: { code, message, details }, meta: buildMeta(requestId) };
}
