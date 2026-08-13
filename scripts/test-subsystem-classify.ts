/**
 * Unit checks for subsystemClassify.
 * Run: npx tsx scripts/test-subsystem-classify.ts
 */
import assert from "node:assert/strict";
import {
  classifySubsystem,
  applySubsystemsToGraph,
  parseSubsystemOverride,
  summarizeSubsystemReadiness,
} from "../webapp/client/src/subsystemClassify.ts";
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

assert.equal(parseSubsystemOverride("risk_execution"), "risk_execution");
assert.equal(parseSubsystemOverride("Risk Execution"), "risk_execution");
assert.equal(parseSubsystemOverride("data"), "data_obs");

{
  const r = classifySubsystem(
    node({
      id: "middleware-platform/services/strategy",
      path: "middleware-platform/services/strategy",
      files: ["middleware-platform/services/strategy/pead.js"],
    })
  );
  assert.equal(r.subsystem, "strategy");
  assert.ok(r.confidence === "high" || r.confidence === "medium");
}

{
  const r = classifySubsystem(
    node({
      id: "middleware-platform/services/broker",
      files: ["middleware-platform/services/broker/paper-broker.js"],
    })
  );
  assert.equal(r.subsystem, "risk_execution");
}

{
  const r = classifySubsystem(
    node({
      id: "middleware-platform/services/telegram-bot",
      files: ["middleware-platform/services/telegram-bot.js"],
    })
  );
  assert.equal(r.subsystem, "ingress");
}

{
  const r = classifySubsystem(
    node({
      id: "middleware-platform/utils/helpers",
      path: "middleware-platform/utils/helpers",
      files: ["middleware-platform/utils/helpers.js"],
    })
  );
  assert.equal(r.subsystem, "unclassified");
}

{
  const r = classifySubsystem(
    node({ id: "x", path: "somewhere", files: ["x.js"] }),
    { contextSubsystem: "strategy" }
  );
  assert.equal(r.subsystem, "strategy");
  assert.equal(r.reason.includes("context"), true);
}

{
  const g = applySubsystemsToGraph({
    nodes: [
      node({
        id: "signal",
        files: ["middleware-platform/services/signal-engine.js"],
      }),
    ],
    edges: [],
    generatedAt: new Date().toISOString(),
  } as ArchGraph);
  assert.equal(g.nodes[0].subsystem, "strategy");
}

assert.ok(summarizeSubsystemReadiness("strategy").includes("PEAD"));
assert.ok(summarizeSubsystemReadiness("strategy").includes("paper"));

console.log("ok: subsystemClassify");
