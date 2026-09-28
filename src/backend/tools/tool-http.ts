/**
 * Transport glue for /api/v1/tools: authenticates the caller, resolves their
 * role from the RLS-protected `user_roles` table and derives tool permissions.
 * The client can never send its own role or permissions.
 */

import { AppError, ErrorCode } from "@/backend/core/errors";
import { authenticateRequest, RequestAuthError } from "@/backend/core/supabase-request";

import { permissionsForRole } from "./tool-registry";
import type { ToolErrorCode, ToolExecutionContext, UserRoleName } from "./tool-types";

export async function toolAuth(
  request: Request,
  requestId: string,
): Promise<Omit<ToolExecutionContext, "signal">> {
  let auth;
  try {
    auth = await authenticateRequest(request);
  } catch (error) {
    if (error instanceof RequestAuthError) {
      throw new AppError(
        error.status === 401 ? ErrorCode.UNAUTHORIZED : ErrorCode.INTEGRATION_ERROR,
        error.message,
      );
    }
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Something went wrong. Please try again.");
  }

  const { data } = await auth.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.userId);
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  const role: UserRoleName = roles.includes("administrator") ? "administrator" : "standard_user";

  return { ...auth, role, permissions: permissionsForRole(role), requestId };
}

export const TOOL_ERROR_STATUS: Record<ToolErrorCode, ErrorCode> = {
  unauthenticated: ErrorCode.UNAUTHORIZED,
  unknown_tool: ErrorCode.NOT_FOUND,
  tool_disabled: ErrorCode.FORBIDDEN,
  not_configured: ErrorCode.NOT_IMPLEMENTED,
  forbidden: ErrorCode.FORBIDDEN,
  invalid_input: ErrorCode.VALIDATION_ERROR,
  invalid_output: ErrorCode.INTEGRATION_ERROR,
  timeout: ErrorCode.INTEGRATION_ERROR,
  execution_failed: ErrorCode.INTEGRATION_ERROR,
};
