/**
 * Unit check: Agents/Workspace dock width helpers + maximize Esc contract.
 * Run: npx tsx scripts/test-dock-layout.ts
 */
import assert from "node:assert/strict";
import {
  isWideDockMode,
  canMaximizeDockMode,
  nextDockEscAction,
  clampDockWidth,
  defaultDockWidthForMode,
  DOCK_NARROW_DEFAULT,
  DOCK_WIDE_DEFAULT,
  DOCK_WIDE_MIN,
  DOCK_WIDE_MAX,
  DOCK_NARROW_MIN,
  DOCK_NARROW_MAX,
} from "../webapp/client/src/blanko/dockLayout.ts";

assert.equal(isWideDockMode("agents"), true);
assert.equal(isWideDockMode("workspace"), true);
assert.equal(isWideDockMode("tasks"), true); // normalizes to workspace
assert.equal(isWideDockMode("insights"), false);
assert.equal(isWideDockMode("build"), false);
assert.equal(isWideDockMode("code"), false);

assert.equal(canMaximizeDockMode("agents"), true);
assert.equal(canMaximizeDockMode("workspace"), true);
assert.equal(canMaximizeDockMode("insights"), false);
assert.equal(canMaximizeDockMode("code"), false);

assert.equal(nextDockEscAction(true), "restore");
assert.equal(nextDockEscAction(false), "close");

assert.equal(defaultDockWidthForMode("agents", 1400), DOCK_WIDE_DEFAULT);
assert.equal(defaultDockWidthForMode("workspace", 1400), DOCK_WIDE_DEFAULT);
assert.equal(defaultDockWidthForMode("insights", 1400), DOCK_NARROW_DEFAULT);

// Small viewport: wide default clamps below 720
const small = defaultDockWidthForMode("agents", 600);
assert.ok(small <= 600 - 96, `expected viewport clamp, got ${small}`);
assert.ok(small >= DOCK_WIDE_MIN || small === 600 - 96);

assert.equal(clampDockWidth(400, "agents", 1400), DOCK_WIDE_MIN);
assert.equal(clampDockWidth(1000, "agents", 1400), DOCK_WIDE_MAX);
assert.equal(clampDockWidth(200, "insights", 1400), DOCK_NARROW_MIN);
assert.equal(clampDockWidth(700, "insights", 1400), DOCK_NARROW_MAX);

console.log("test-dock-layout: ok");
