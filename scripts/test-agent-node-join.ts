/**
 * Unit checks for client-only agent ↔ node join (layer badges).
 * Run: npx tsx scripts/test-agent-node-join.ts
 */
import assert from "node:assert/strict";
import {
  agentFileMatchesNode,
  buildAgentLayerSummaryByNodeId,
} from "../webapp/client/src/agentNodeJoin.ts";
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
  } as ArchNode;
}

const mod = node({
  id: "middleware-platform/services",
  path: "middleware-platform/services",
  files: [
    "middleware-platform/services/execute-turn.js",
    "middleware-platform/services/other.js",
  ],
});

assert.equal(
  agentFileMatchesNode("middleware-platform/services/execute-turn.js", mod),
  true
);
assert.equal(agentFileMatchesNode("middleware-platform/services/execute-turn.js", {
  ...mod,
  files: [],
}), true); // path/id prefix
assert.equal(agentFileMatchesNode("other-pkg/foo.js", mod), false);

const graph = {
  nodes: [
    mod,
    node({ id: "trading-chat", path: "trading-chat", files: ["trading-chat/index.js"] }),
  ],
  agents: {
    agents: [
      {
        file: "middleware-platform/services/execute-turn.js",
        provider: "anthropic",
        evidence: "x",
        model: null,
        systemPrompt: null,
        toolCandidates: [],
        confidence: "high",
        kind: "agent",
        kindSignal: "test",
        loopKind: "tool-loop",
        tools: [],
        layers: [
          { id: "knowledge", name: "Knowledge", question: "", whyItMatters: "", status: "empty", components: [] },
          { id: "observability", name: "Observability", question: "", whyItMatters: "", status: "empty", components: [] },
          { id: "tools", name: "Tools", question: "", whyItMatters: "", status: "filled", components: [{ id: "t", label: "t", evidence: "e" }] },
        ],
      },
      {
        file: "middleware-platform/services/helper.js",
        provider: "none",
        evidence: "x",
        model: null,
        systemPrompt: null,
        toolCandidates: [],
        confidence: "low",
        kind: "helper",
        kindSignal: "test",
        loopKind: null,
        tools: [],
      },
    ],
    scannedFiles: 2,
    languages: {},
    pythonAgents: [],
    searchedFor: [],
  },
} as ArchGraph;

const map = buildAgentLayerSummaryByNodeId(graph);
assert.equal(map.has("trading-chat"), false);
assert.ok(map.has("middleware-platform/services"));
const s = map.get("middleware-platform/services")!;
assert.equal(s.agentCount, 2);
assert.deepEqual(s.missingLayerNames, ["Knowledge", "Observability"]);

console.log("ok: agentNodeJoin");
