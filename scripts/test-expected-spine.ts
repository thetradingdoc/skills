/**
 * G1-A: EXPECTED_SPINE edges present on trading-agent blueprint + spineWorkflowConnected.
 */
import assert from "node:assert/strict";
import { DESIGN_BLUEPRINTS } from "../webapp/client/src/designBlueprints.ts";
import {
  EXPECTED_SPINE_EDGES,
  EXPECTED_SPINE_RUNTIME_HOPS,
  applyTradingSpine,
  spineWorkflowConnected,
} from "../webapp/client/src/tradingSpine.ts";

const ta = DESIGN_BLUEPRINTS.find((b) => b.id === "trading-agent");
assert.ok(ta, "trading-agent blueprint");

const edgeKey = (s: string, t: string) => `${s}->${t}`;
const edges = new Set(ta!.graph.edges.map((e) => edgeKey(e.source, e.target)));
for (const [s, t] of EXPECTED_SPINE_EDGES) {
  assert.ok(edges.has(edgeKey(s, t)), `blueprint missing edge ${s} → ${t}`);
}

assert.ok(EXPECTED_SPINE_RUNTIME_HOPS.includes("assertCaller"));
assert.ok(EXPECTED_SPINE_RUNTIME_HOPS.includes("no_broker_submit_from_agent"));

const applied = applyTradingSpine({});
assert.ok(applied);
assert.equal(spineWorkflowConnected(applied), true);

// Without telegram→agent, not connected
const broken = {
  ...applied!,
  edges: applied!.edges.filter(
    (e) => !(e.source === "bp-ta-telegram" && e.target === "bp-ta-agent")
  ),
};
assert.equal(spineWorkflowConnected(broken), false);

console.log("ok: G1-A EXPECTED_SPINE Blanko edges + spineWorkflowConnected");
