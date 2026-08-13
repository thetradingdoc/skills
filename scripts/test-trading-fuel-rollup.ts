/**
 * Fuel rollup + subsystem classify smoke tests.
 * Run: npx tsx scripts/test-trading-fuel-rollup.ts
 */
import assert from "node:assert/strict";
import { rollupFuelBySubsystem } from "../webapp/server/src/usage.ts";
import { classifySubsystem, summarizeSubsystemReadiness } from "../webapp/client/src/subsystemClassify.ts";
import { computeSubsystemLayout } from "../webapp/client/src/layout/subsystemLayout.ts";
import type { ArchGraph, ArchNode } from "../webapp/client/src/types.ts";

function node(opts: Partial<ArchNode> & { id: string }): ArchNode {
  return {
    id: opts.id,
    label: opts.label ?? opts.id,
    path: opts.path ?? opts.id,
    files: opts.files ?? [],
    health: { hasDocs: false, hasTests: false, hasContext: false },
    status: "unknown",
    isDrift: false,
    semanticSignals: { exports: [], externalImports: [], fileCount: 0 },
    ...opts,
  } as ArchNode;
}

const fuel = rollupFuelBySubsystem(
  [
    {
      source: "market_data_api",
      node_id: "middleware-platform/services",
      cost_cents: 12,
      metadata: { call_count: 3 },
    },
    {
      source: "fda_api",
      node_id: "middleware-platform/services",
      cost_cents: 5,
      metadata: { call_count: 2 },
    },
    {
      source: "chat",
      node_id: "x",
      cost_cents: 99,
      metadata: { call_count: 9 },
    },
  ],
  { "middleware-platform/services": "data_obs" }
);
assert.equal(fuel.length, 1);
assert.equal(fuel[0].subsystem, "data_obs");
assert.equal(fuel[0].callCount, 5);
assert.equal(fuel[0].costCents, 17);

assert.equal(
  classifySubsystem(
    node({
      id: "s",
      files: ["middleware-platform/services/strategy/pead.js"],
    })
  ).subsystem,
  "strategy"
);
assert.match(summarizeSubsystemReadiness("strategy"), /PEAD/i);

const layout = computeSubsystemLayout({
  nodes: [
    node({
      id: "a",
      subsystem: "ingress",
      files: ["telegram-bot.js"],
    }),
    node({
      id: "b",
      subsystem: "strategy",
      files: ["pead.js"],
    }),
  ],
  edges: [],
  generatedAt: new Date().toISOString(),
} as ArchGraph);
assert.ok(layout.subsystemRegions.some((r) => r.subsystem === "ingress"));
assert.ok(layout.subsystemRegions.some((r) => r.subsystem === "strategy"));
assert.ok(layout.nodePositions.has("a"));

console.log("ok: trading-fuel-rollup + subsystem layout");
