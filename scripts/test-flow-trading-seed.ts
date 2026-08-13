/**
 * Trading spine seed cards must ship with fileScope for autocoding.
 * Run: npx tsx scripts/test-flow-trading-seed.ts
 */
import assert from "node:assert/strict";
import { TRADING_PIPELINE_SEED } from "../webapp/client/src/flowTradingSeed.ts";

assert.ok(TRADING_PIPELINE_SEED.length >= 4);
for (const card of TRADING_PIPELINE_SEED) {
  assert.ok(card.sourcePath.startsWith("trading-spine:"), card.title);
  assert.ok(Array.isArray(card.fileScope) && card.fileScope.length > 0, card.title);
  assert.ok(card.acceptanceCriteria.trim().length > 0, card.title);
  assert.equal(card.kind, "task");
}

console.log("test-flow-trading-seed: ok");
