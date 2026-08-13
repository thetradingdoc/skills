/**
 * Forbidden GitHub-dark hexes must not appear in Workspace/Agents dock views.
 * Run: npx tsx scripts/test-blanko-theme-hex-gate.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const FILES = [
  "webapp/client/src/ChangesView.tsx",
  "webapp/client/src/PlatformInventoryView.tsx",
  "webapp/client/src/ManagementRollupView.tsx",
  "webapp/client/src/AgentsView.tsx",
  "webapp/client/src/ReachView.tsx",
  "webapp/client/src/LayersView.tsx",
  "webapp/client/src/GuardView.tsx",
  "webapp/client/src/AssessmentView.tsx",
  "webapp/client/src/UsageView.tsx",
  "webapp/client/src/LayersAssessmentView.tsx",
  "webapp/client/src/FlowTasksBoard.tsx",
  "webapp/client/src/FlowView.tsx",
];

const FORBIDDEN = [/#0d1117/i, /#21262d/i, /#e6edf3/i];

const failures: string[] = [];
for (const rel of FILES) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  for (const re of FORBIDDEN) {
    if (re.test(text)) failures.push(`${rel} matches ${re}`);
  }
}

assert.equal(failures.length, 0, failures.join("\n"));
console.log("test-blanko-theme-hex-gate: ok");
