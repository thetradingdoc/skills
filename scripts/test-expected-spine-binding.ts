/**
 * Phase 7 — Blanko side of EXPECTED_SPINE cross-repo binding.
 * Tradeoff: duplicated fixtures/expected-spine.json in both repos (no shared npm
 * package). This script fails if Blanko constants drift from the fixture, or if
 * the trading-agent scan-clone fixture hash differs when that tree is present.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_SPINE_EDGES,
  EXPECTED_SPINE_RUNTIME_HOPS,
} from "../webapp/client/src/tradingSpine.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOCAL_FIXTURE = path.join(ROOT, "fixtures/expected-spine.json");

function sha256File(p: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

const fix = JSON.parse(fs.readFileSync(LOCAL_FIXTURE, "utf8"));
assert.deepEqual([...EXPECTED_SPINE_EDGES], fix.edges, "Blanko edges ≠ fixture");
assert.deepEqual([...EXPECTED_SPINE_RUNTIME_HOPS], fix.runtime_hops, "Blanko hops ≠ fixture");

const runtimeCandidates = [
  process.env.TRADING_AGENT_ROOT,
  path.join(process.env.HOME || "", ".arch-viz/repos/21a6c9c0-4774-4a8c-9cac-128919b48170"),
  "/Users/ojrichard/.arch-viz/repos/21a6c9c0-4774-4a8c-9cac-128919b48170",
].filter(Boolean);

let runtimeFixture: string | null = null;
for (const root of runtimeCandidates) {
  const candidate = path.join(root, "middleware-platform/fixtures/expected-spine.json");
  if (fs.existsSync(candidate)) {
    runtimeFixture = candidate;
    break;
  }
}

if (runtimeFixture) {
  assert.equal(
    sha256File(LOCAL_FIXTURE),
    sha256File(runtimeFixture),
    "Blanko vs runtime expected-spine.json hash drift — sync both fixtures"
  );
} else {
  console.warn("runtime fixture not found — local Blanko binding only");
}

console.log("ok: Phase 7 EXPECTED_SPINE Blanko↔fixture(+runtime) binding");
