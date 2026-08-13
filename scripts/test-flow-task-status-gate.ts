/**
 * Unit tests: Flow Tasks manual status gates (no rail → free Move; rail → Approve/Reject only).
 *
 * Run: npx tsx scripts/test-flow-task-status-gate.ts
 */
import assert from "node:assert/strict";
import { canManualAdvanceTodo } from "../webapp/client/src/todoStatusGate.ts";
import { manualStatusPatchBlocked } from "../webapp/server/src/todoPhase1.ts";

// No rail_id → may manual-advance to done / needs_review
assert.equal(canManualAdvanceTodo({ status: "needs_review", rail_id: null }, "done").ok, true);
assert.equal(canManualAdvanceTodo({ status: "in_progress", rail_id: null }, "needs_review").ok, true);
assert.equal(canManualAdvanceTodo({ status: "todo" }, "in_progress").ok, true);

// With rail_id → cannot manual-advance to done or needs_review
const blockDone = canManualAdvanceTodo({ status: "needs_review", rail_id: "rail-1" }, "done");
assert.equal(blockDone.ok, false);
if (!blockDone.ok) assert.match(blockDone.reason, /Approve/);

const blockReview = canManualAdvanceTodo({ status: "in_progress", rail_id: "rail-1" }, "needs_review");
assert.equal(blockReview.ok, false);
if (!blockReview.ok) assert.match(blockReview.reason, /agent|Reject/i);

// Still allow other transitions with rail (e.g. back to todo is reject path; Move todo→doing ok)
assert.equal(canManualAdvanceTodo({ status: "todo", rail_id: "rail-1" }, "in_progress").ok, true);

// Server mirror
assert.equal(manualStatusPatchBlocked("done", null), null);
assert.equal(manualStatusPatchBlocked("needs_review", ""), null);
assert.match(manualStatusPatchBlocked("done", "abc") ?? "", /Approve/);
assert.match(manualStatusPatchBlocked("needs_review", "abc") ?? "", /agent|Reject/i);
assert.equal(manualStatusPatchBlocked("in_progress", "abc"), null);
assert.equal(manualStatusPatchBlocked("todo", "abc"), null);

console.log("test-flow-task-status-gate: ok");
