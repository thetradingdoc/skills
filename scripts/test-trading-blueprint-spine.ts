/**
 * Unit check: trading blueprint spine includes Payment (no browser).
 */
import assert from "node:assert/strict";
import { DESIGN_BLUEPRINTS } from "../webapp/client/src/designBlueprints.ts";
import { TRADING_PIPELINE_SEED } from "../webapp/client/src/flowTradingSeed.ts";

const ta = DESIGN_BLUEPRINTS.find((b) => b.id === "trading-agent");
assert.ok(ta, "trading-agent blueprint exists");
const labels = ta!.graph.nodes.map((n) => n.label);
assert.ok(labels.some((l) => /Payment/i.test(l)), "Payment node on canvas blueprint");
assert.ok(labels.some((l) => /Policy/i.test(l)), "Policy node");
assert.ok(labels.some((l) => /Risk/i.test(l)), "Risk node");
assert.ok(labels.some((l) => /Execution/i.test(l)), "Execution node");
assert.ok(labels.some((l) => /Alpaca/i.test(l)), "Alpaca node");
assert.ok(labels.some((l) => /Mobile/i.test(l)), "Mobile app node");
assert.equal(TRADING_PIPELINE_SEED[0]?.sourcePath, "trading-spine:p1-payment");
assert.ok(/Payment/i.test(TRADING_PIPELINE_SEED[0]!.title));
console.log("ok: trading blueprint + seed Payment-first");
