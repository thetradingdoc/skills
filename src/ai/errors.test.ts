/**
 * Error handling tests.
 */

import { describe, it, expect } from "vitest";
import { ArchError, ErrorCode, toUserMessage } from "./errors";

describe("toUserMessage", () => {
  it("returns ArchError.userMessage for ArchError", () => {
    const err = new ArchError({
      code: ErrorCode.RATE_LIMIT,
      userMessage: "Service overloaded.",
    });
    expect(toUserMessage(err)).toBe("Service overloaded.");
  });

  it("maps rate limit errors to user-friendly message", () => {
    expect(toUserMessage(new Error("Rate limit exceeded"))).toContain("overloaded");
    expect(toUserMessage(new Error("429 Too Many Requests"))).toContain("overloaded");
  });

  it("maps API key errors to user-friendly message", () => {
    expect(toUserMessage(new Error("Invalid API key"))).toMatch(/API key|configuration/);
  });

  it("maps timeout/network errors to user-friendly message", () => {
    expect(toUserMessage(new Error("Request timeout"))).toMatch(/network|timeout|connection/);
  });

  it("returns generic message for unknown errors", () => {
    const msg = toUserMessage(new Error("Something weird happened"));
    expect(msg).toBeTruthy();
    expect(msg).not.toContain("Something weird");
  });
});
