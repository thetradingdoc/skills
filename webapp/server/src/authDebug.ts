/**
 * Auth debug logging — enabled when DEBUG_AUTH=true.
 * Logs getUser calls and errors to the terminal so you can trace Supabase auth issues.
 */

const DEBUG = process.env.DEBUG_AUTH === "true";

export function logAuth(
  middleware: string,
  opts: {
    hasToken: boolean;
    tokenPreview?: string;
    success?: boolean;
    userId?: string;
    error?: string;
    errorCode?: string;
    networkError?: boolean;
  }
) {
  if (!DEBUG) return;

  const parts = [`[Auth] ${middleware}`];
  if (opts.hasToken) {
    parts.push(`token:${opts.tokenPreview ?? "***"}`);
  } else {
    parts.push("no token");
  }
  if (opts.success !== undefined) {
    parts.push(opts.success ? "ok" : "fail");
  }
  if (opts.userId) parts.push(`user=${opts.userId}`);
  if (opts.error) parts.push(`error=${opts.error}`);
  if (opts.errorCode) parts.push(`code=${opts.errorCode}`);
  if (opts.networkError) parts.push("network_error");

  console.log(parts.join(" | "));
}
