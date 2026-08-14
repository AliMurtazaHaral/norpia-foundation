import { describe, expect, it } from "vitest";
import { z } from "zod";

import { failurePayload, successPayload } from "@/backend/core/api-response";
import { AppError, ErrorCode, notFound, toAppError } from "@/backend/core/errors";
import { parseWith } from "@/backend/core/http";

describe("API envelope", () => {
  it("wraps success data with meta", () => {
    const payload = successPayload({ ok: true }, "req-1");
    expect(payload.success).toBe(true);
    expect(payload.meta).toMatchObject({ requestId: "req-1", apiVersion: "v1" });
  });

  it("wraps failures with a code", () => {
    const payload = failurePayload(ErrorCode.NOT_FOUND, "missing", "req-2");
    expect(payload).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });
});

describe("error taxonomy", () => {
  it("maps codes to status", () => {
    expect(notFound().status).toBe(404);
    expect(new AppError(ErrorCode.VALIDATION_ERROR, "x").status).toBe(422);
  });

  it("normalizes unknown errors", () => {
    expect(toAppError(new Error("oops")).code).toBe(ErrorCode.INTERNAL_ERROR);
  });
});

describe("validation", () => {
  it("throws a VALIDATION_ERROR for bad input", () => {
    expect(() => parseWith(z.object({ id: z.string() }), {})).toThrowError(AppError);
  });
});
