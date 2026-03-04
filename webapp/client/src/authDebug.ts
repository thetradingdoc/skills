/**
 * Auth debug logging — hash errors always logged; verbose events when VITE_DEBUG_AUTH=true.
 * Helps trace Supabase auth issues (otp_expired, access_denied, etc.) in the browser console.
 */

const DEBUG = import.meta.env.VITE_DEBUG_AUTH === "true";

function log(prefix: string, ...args: unknown[]) {
  if (DEBUG) {
    console.log(`[Auth] ${prefix}`, ...args);
  }
}

export type ParsedAuthHashError = {
  error: string;
  errorCode: string | null;
  errorDescription: string;
};

/** Parse Supabase auth errors from URL hash. Returns null if no error. */
export function parseAuthHashError(): ParsedAuthHashError | null {
  const hash = window.location.hash;
  if (!hash || !hash.includes("error=")) return null;

  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const error = params.get("error");
  const errorCode = params.get("error_code");
  const errorDescription = params.get("error_description")?.replace(/\+/g, " ") ?? "Authentication error.";

  if (!error && !errorCode && !errorDescription) return null;

  return {
    error: error ?? "",
    errorCode,
    errorDescription,
  };
}

/** Parse, log, and return URL hash auth errors. Caller should act on the returned value. */
export function logAuthHashErrors(): ParsedAuthHashError | null {
  const parsed = parseAuthHashError();
  if (parsed) {
    console.warn("[Auth] URL hash Supabase error:", {
      error: parsed.error || undefined,
      error_code: parsed.errorCode ?? undefined,
      error_description: parsed.errorDescription,
    });
  }
  return parsed;
}

export function logAuthStateChange(event: string, session: { access_token?: string } | null) {
  log(`onAuthStateChange: ${event}`, {
    hasSession: !!session,
    tokenPreview: session?.access_token ? `${session.access_token.slice(0, 20)}...` : undefined,
  });
}

export function logAuthApiCall(
  method: string,
  args: Record<string, unknown>,
  result: { error?: { message?: string; code?: string }; data?: unknown }
) {
  if (result.error) {
    console.warn(`[Auth] ${method} failed:`, {
      error: result.error.message,
      code: result.error.code,
      args: Object.keys(args),
    });
  } else {
    log(`${method} ok`, { dataKeys: result.data ? Object.keys(result.data as object) : [] });
  }
}
