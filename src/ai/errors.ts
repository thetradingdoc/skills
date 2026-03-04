/**
 * Structured error types for architecture task execution.
 * Maps internal errors to user-facing messages; never surfaces raw LLM output or stack traces.
 */

export const ErrorCode = {
  VALIDATION: "VALIDATION",
  CRITIC_REJECTION: "CRITIC_REJECTION",
  LLM_PARSE_FAILURE: "LLM_PARSE_FAILURE",
  RATE_LIMIT: "RATE_LIMIT",
  TRANSIENT: "TRANSIENT",
  PREFLIGHT_FAILED: "PREFLIGHT_FAILED",
  NO_API_KEY: "NO_API_KEY",
  UNKNOWN: "UNKNOWN",
} as const;

export type ArchErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ArchErrorDetails {
  code: ArchErrorCode;
  userMessage: string;
  traceId?: string;
  /** Internal details for logs only; never sent to client */
  internal?: string;
}

export class ArchError extends Error {
  readonly code: ArchErrorCode;
  readonly userMessage: string;
  readonly traceId?: string;
  readonly internal?: string;

  constructor(details: ArchErrorDetails) {
    super(details.userMessage);
    this.name = "ArchError";
    this.code = details.code;
    this.userMessage = details.userMessage;
    this.traceId = details.traceId;
    this.internal = details.internal;
  }

  toJSON() {
    return {
      error: this.userMessage,
      code: this.code,
      traceId: this.traceId,
    };
  }
}

/** Map error to user-facing message; never expose raw output or stack */
export function toUserMessage(err: unknown, traceId?: string): string {
  if (err instanceof ArchError) {
    return err.userMessage;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (
    lower.includes("rate") ||
    lower.includes("429") ||
    lower.includes("overloaded") ||
    lower.includes("capacity")
  ) {
    return "The AI service is temporarily overloaded. Please try again in a few moments.";
  }
  if (lower.includes("api key") || lower.includes("authentication") || lower.includes("401")) {
    return "API key is missing or invalid. Please check your configuration.";
  }
  if (
    lower.includes("timeout") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("network")
  ) {
    return "A network or timeout error occurred. Please check your connection and try again.";
  }
  if (lower.includes("invalid") || lower.includes("parse") || lower.includes("json")) {
    return "The AI response could not be interpreted. Please try rephrasing your question.";
  }

  return "An unexpected error occurred. Please try again. If the problem persists, check your configuration.";
}

/** Log error with traceId; internal details only in dev or when explicitly set */
export function logArchError(err: unknown, traceId?: string, context?: string): void {
  const prefix = traceId ? `[manager] traceId=${traceId}` : "[manager]";
  const ctx = context ? ` ${context}` : "";
  if (err instanceof ArchError && err.internal) {
    console.error(`${prefix}${ctx}`, err.code, err.internal);
  } else if (err instanceof Error) {
    console.error(`${prefix}${ctx}`, err.message);
  } else {
    console.error(`${prefix}${ctx}`, String(err));
  }
}
