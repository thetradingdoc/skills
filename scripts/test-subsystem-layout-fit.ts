/**
 * Subsystem cockpit: nodes must stay inside their colored region boxes.
 * Run: npx tsx scripts/test-subsystem-layout-fit.ts
 */
import assert from "node:assert/strict";
import {
  computeSubsystemLayout,
  fitSubsystemRegionsToNodes,
  subsystemRegionsContainNodes,
} from "../webapp/client/src/layout/subsystemLayout.ts";
import { classifySubsystem } from "../webapp/client/src/subsystemClassify.ts";
import type { ArchGraph, ArchNode } from "../webapp/client/src/types.ts";
import { NODE_W, NODE_W_LIGHT } from "../webapp/client/src/layout/canvasConstants.ts";

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

const graph: ArchGraph = {
  nodes: [
    node({ id: "trading-chat", path: "middleware-platform/services/telegram-bot.js", label: "Trading Chat" }),
    node({
      id: "investment-agent",
      path: "middleware-platform/services/investment-agent.js",
      label: "Investment Agent",
    }),
    node({ id: "greeting", path: "middleware-platform/utils/greeting.js", label: "Greeting" }),
    node({ id: "tests", path: "middleware-platform/__tests__/agent.test.js", label: "Agent Tests" }),
  ],
  edges: [],
};

const classifiedNodes = graph.nodes.map((n) => ({
  id: n.id,
  subsystem: classifySubsystem(n).subsystem,
}));

const light = computeSubsystemLayout(graph, { nodeW: NODE_W_LIGHT, nodeH: 118 });
assert.ok(light.subsystemRegions.length >= 2, "expected multiple regions");
assert.ok(
  subsystemRegionsContainNodes(light.subsystemRegions, classifiedNodes, light.nodePositions, {
    nodeW: NODE_W_LIGHT,
    nodeH: 118,
  }),
  "packed light-theme layout must enclose all cards"
);

const dark = computeSubsystemLayout(graph, { nodeW: NODE_W, nodeH: 100 });
assert.ok(
  subsystemRegionsContainNodes(dark.subsystemRegions, classifiedNodes, dark.nodePositions, {
    nodeW: NODE_W,
    nodeH: 100,
  }),
  "dark packing must enclose cards"
);

// Simulate the old widen bug: stretch node X without updating regions
const xs = [...light.nodePositions.values()].map((p) => p.x);
const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
const widened = new Map<string, { x: number; y: number }>();
for (const [id, pos] of light.nodePositions) {
  widened.set(id, { x: centerX + (pos.x - centerX) * 2.2, y: pos.y });
}
assert.equal(
  subsystemRegionsContainNodes(light.subsystemRegions, classifiedNodes, widened, {
    nodeW: NODE_W_LIGHT,
    nodeH: 118,
  }),
  false,
  "widened nodes should escape unfitted boxes (repro)"
);

const fitted = fitSubsystemRegionsToNodes(light.subsystemRegions, classifiedNodes, widened, {
  nodeW: NODE_W_LIGHT,
  nodeH: 118,
});
assert.ok(
  subsystemRegionsContainNodes(fitted, classifiedNodes, widened, {
    nodeW: NODE_W_LIGHT,
    nodeH: 118,
  }),
  "fitSubsystemRegionsToNodes must pull boxes around escaped cards"
);

console.log("ok: subsystem layout fit");
