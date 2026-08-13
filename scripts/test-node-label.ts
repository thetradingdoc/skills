/**
 * Trading Chat UI vs API label disambiguation.
 * Run: npx tsx scripts/test-node-label.ts
 */
import assert from "node:assert/strict";
import { refineNodeDisplayLabel, refineGraphNodeLabels } from "../webapp/client/src/nodeLabel.ts";
import { analyseGraph } from "../webapp/client/src/analysis/graphAnalyser.ts";
import type { ArchGraph, ArchNode } from "../webapp/client/src/types.ts";

function node(partial: Partial<ArchNode> & { id: string }): ArchNode {
  return {
    id: partial.id,
    label: partial.label ?? partial.id,
    path: partial.path,
    files: partial.files ?? [],
    health: { hasDocs: false, hasTests: false, hasContext: false },
    status: "unknown",
    isDrift: false,
    semanticSignals: { exports: [], externalImports: [], fileCount: 0 },
    ...partial,
  } as ArchNode;
}

const ui = node({
  id: "unified-dashboard/trading",
  label: "Trading Chat",
  suggestedLabel: "Trading Chat",
  files: ["unified-dashboard/trading/trading-chat.js"],
});
const api = node({
  id: "middleware-platform/routes",
  label: "Trading Chat",
  suggestedLabel: "Trading Chat",
  files: [
    "middleware-platform/routes/internal-service-ops.js",
    "middleware-platform/routes/trading-chat.js",
  ],
});
const svc = node({
  id: "middleware-platform/services",
  label: "Services",
  files: ["middleware-platform/services/trading-chat-service.js"],
});

assert.equal(refineNodeDisplayLabel(ui), "Trading Chat UI");
assert.equal(refineNodeDisplayLabel(api), "Trading Chat API");
assert.equal(refineNodeDisplayLabel(svc), "Trading Chat Service");

const g: ArchGraph = { nodes: [ui, api, svc], edges: [] };
const refined = refineGraphNodeLabels(g);
assert.equal(refined.nodes.find((n) => n.id === ui.id)?.suggestedLabel, "Trading Chat UI");
assert.equal(refined.nodes.find((n) => n.id === api.id)?.suggestedLabel, "Trading Chat API");

const analysed = analyseGraph(g);
assert.equal(analysed.nodes.find((n) => n.id === ui.id)?.suggestedLabel, "Trading Chat UI");
assert.equal(analysed.nodes.find((n) => n.id === api.id)?.suggestedLabel, "Trading Chat API");

console.log("ok: node-label trading chat disambiguation");
