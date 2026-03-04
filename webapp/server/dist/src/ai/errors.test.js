"use strict";
/**
 * Error handling tests.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const errors_1 = require("./errors");
(0, vitest_1.describe)("toUserMessage", () => {
    (0, vitest_1.it)("returns ArchError.userMessage for ArchError", () => {
        const err = new errors_1.ArchError({
            code: errors_1.ErrorCode.RATE_LIMIT,
            userMessage: "Service overloaded.",
        });
        (0, vitest_1.expect)((0, errors_1.toUserMessage)(err)).toBe("Service overloaded.");
    });
    (0, vitest_1.it)("maps rate limit errors to user-friendly message", () => {
        (0, vitest_1.expect)((0, errors_1.toUserMessage)(new Error("Rate limit exceeded"))).toContain("overloaded");
        (0, vitest_1.expect)((0, errors_1.toUserMessage)(new Error("429 Too Many Requests"))).toContain("overloaded");
    });
    (0, vitest_1.it)("maps API key errors to user-friendly message", () => {
        (0, vitest_1.expect)((0, errors_1.toUserMessage)(new Error("Invalid API key"))).toMatch(/API key|configuration/);
    });
    (0, vitest_1.it)("maps timeout/network errors to user-friendly message", () => {
        (0, vitest_1.expect)((0, errors_1.toUserMessage)(new Error("Request timeout"))).toMatch(/network|timeout|connection/);
    });
    (0, vitest_1.it)("returns generic message for unknown errors", () => {
        const msg = (0, errors_1.toUserMessage)(new Error("Something weird happened"));
        (0, vitest_1.expect)(msg).toBeTruthy();
        (0, vitest_1.expect)(msg).not.toContain("Something weird");
    });
});
