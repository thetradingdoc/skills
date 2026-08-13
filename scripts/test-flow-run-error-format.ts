/**
 * Pure helpers for Flow run/approve error surfacing (mirrors FlowTasksBoard).
 * Run: npx tsx scripts/test-flow-run-error-format.ts
 */
import assert from "node:assert/strict";

function formatAgentApiError(d: { error?: string; code?: string }, fallback: string): string {
  if (d.code === "AGENT_PLAN_REQUIRED") {
    return d.error ?? "Fix with agent requires Pro or Team.";
  }
  if (d.code === "AGENT_KEY_MISSING") {
    return d.error ?? "Agent API key not configured on the server.";
  }
  const msg = d.error ?? fallback;
  if (/Auto-execution limit/i.test(msg) || /execution limit/i.test(msg)) {
    return "Another agent is running in this workspace — wait or Reset.";
  }
  return msg;
}

assert.match(formatAgentApiError({ code: "AGENT_PLAN_REQUIRED" }, "x"), /Pro or Team/);
assert.match(formatAgentApiError({ code: "AGENT_KEY_MISSING" }, "x"), /API key/);
assert.equal(
  formatAgentApiError(
    { error: "Auto-execution limit reached for this workspace. Try again later." },
    "Run failed"
  ),
  "Another agent is running in this workspace — wait or Reset."
);
assert.equal(formatAgentApiError({ error: "Approve failed: rail missing" }, "x"), "Approve failed: rail missing");

console.log("test-flow-run-error-format: ok");
