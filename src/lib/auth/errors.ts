/**
 * Maps Supabase / network errors onto safe, user-facing messages.
 * Raw technical details are never surfaced to the UI.
 */
export type AuthFailure = {
  message: string;
  kind: "credentials" | "unverified" | "inactive" | "rate_limit" | "network" | "unknown";
};

export function mapAuthError(error: unknown): AuthFailure {
  const raw = (
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : typeof error === "string"
        ? error
        : ""
  ).toLowerCase();

  if (!raw || raw.includes("failed to fetch") || raw.includes("networkerror")) {
    return {
      kind: "network",
      message: "We couldn't reach the authentication service. Check your connection and try again.",
    };
  }
  if (raw.includes("email not confirmed") || raw.includes("not confirmed")) {
    return {
      kind: "unverified",
      message: "Your email address isn't verified yet. Use the verification link we emailed you.",
    };
  }
  if (raw.includes("invalid login") || raw.includes("invalid credentials")) {
    return { kind: "credentials", message: "Incorrect email address or password." };
  }
  if (raw.includes("user already registered") || raw.includes("already been registered")) {
    return {
      kind: "credentials",
      message: "An account with that email already exists. Try signing in instead.",
    };
  }
  if (raw.includes("rate limit") || raw.includes("too many")) {
    return { kind: "rate_limit", message: "Too many attempts. Please wait a moment and try again." };
  }
  if (raw.includes("disabled") || raw.includes("banned") || raw.includes("inactive")) {
    return {
      kind: "inactive",
      message: "This account is inactive. Contact your NORPIA administrator.",
    };
  }
  if (raw.includes("expired") || raw.includes("invalid token") || raw.includes("otp")) {
    return { kind: "unknown", message: "That link has expired or is no longer valid." };
  }
  if (raw.includes("same password")) {
    return { kind: "unknown", message: "Choose a password different from your current one." };
  }
  return { kind: "unknown", message: "Something went wrong. Please try again." };
}

export const ACCOUNT_INACTIVE_MESSAGE =
  "This account has been deactivated. Contact your NORPIA administrator.";
