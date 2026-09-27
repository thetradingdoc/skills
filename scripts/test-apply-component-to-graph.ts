/**
 * Unit checks for applyComponentToGraph bind vs place branching.
 */
import assert from "node:assert/strict";
import { applyComponentToGraph, PLACE_ON_NODE_OFFSET } from "../webapp/client/src/applyComponentToGraph.ts";
import { resolveApplyMode, getBuildItem } from "../webapp/client/src/blanko/buildCatalog.ts";
import {
  createBlankDesignGraph,
  createDesignArchNode,
} from "../webapp/client/src/greenfieldDesign.ts";

const blank = createBlankDesignGraph("Apply component test");
const agent = createDesignArchNode({
  id: "agent-1",
  label: "Agent",
  layer: "Reasoning",
});
const withAgent = { ...blank, nodes: [agent], edges: [] as typeof blank.edges };

// --- Mode resolution ---
const anthropic = getBuildItem("anthropic");
assert.ok(anthropic);
assert.equal(resolveApplyMode(anthropic!), "bind", "llm + providerId → bind");

const queue = getBuildItem("queue");
assert.ok(queue);
assert.equal(resolveApplyMode(queue!), "place", "structural → place");

const langgraph = getBuildItem("langgraph");
assert.ok(langgraph);
assert.equal(resolveApplyMode(langgraph!), "place", "explicit applyMode override");

const langchain = getBuildItem("langchain");
assert.ok(langchain);
assert.equal(resolveApplyMode(langchain!), "bind", "framework + providerId → bind");

const aws = getBuildItem("aws");
assert.ok(aws);
assert.equal(resolveApplyMode(aws!), "bind", "cloud + providerId → bind");

// --- Unknown id ---
const unknown = applyComponentToGraph(withAgent, "not-a-real-component");
assert.ok("error" in unknown);
assert.match(String((unknown as { error: string }).error), /Unknown component/i);

// --- Bind with selection ---
const bound = applyComponentToGraph(withAgent, "anthropic", { selectedNodeId: "agent-1" });
assert.ok(!("error" in bound));
if (!("error" in bound)) {
  assert.equal(bound.mode, "bind");
  assert.equal(bound.graph.nodes.length, 1);
  assert.equal(bound.graph.edges.length, 0);
  const n = bound.graph.nodes[0]!;
  assert.equal(n.llmProvider, "anthropic");
  assert.ok(n.platformBindings?.some((b) => b.providerId === "anthropic" && b.status === "unbound"));
}

// --- Bind without selection ---
const noSel = applyComponentToGraph(withAgent, "anthropic", { selectedNodeId: null });
assert.ok("error" in noSel);
assert.match(String((noSel as { error: string }).error), /Select a module/i);
assert.equal(withAgent.nodes.length, 1, "original graph unchanged on bind error");

// --- Bind with stale id ---
const stale = applyComponentToGraph(withAgent, "anthropic", { selectedNodeId: "missing-node" });
assert.ok("error" in stale);
assert.match(String((stale as { error: string }).error), /Select a module/i);

// --- Place structural ---
const placed = applyComponentToGraph(withAgent, "queue", { position: { x: 10, y: 20 } });
assert.ok(!("error" in placed));
if (!("error" in placed)) {
  assert.equal(placed.mode, "place");
  assert.equal(placed.graph.nodes.length, 2);
  assert.equal(placed.graph.edges.length, 0);
  assert.ok(placed.focusNodeId?.startsWith("design-queue-"));
}

// --- Place override (langgraph) does not bind ---
const lg = applyComponentToGraph(withAgent, "langgraph", { selectedNodeId: "agent-1" });
assert.ok(!("error" in lg));
if (!("error" in lg)) {
  assert.equal(lg.mode, "place");
  assert.equal(lg.graph.nodes.length, 2);
  assert.equal(lg.graph.edges.length, 0);
}

// --- hitNodeId wins over selectedNodeId for bind ---
const agent2 = createDesignArchNode({ id: "agent-2", label: "Agent 2", layer: "Reasoning" });
const twoAgents = { ...blank, nodes: [agent, agent2], edges: [] as typeof blank.edges };
const hitBind = applyComponentToGraph(twoAgents, "anthropic", {
  selectedNodeId: "agent-1",
  hitNodeId: "agent-2",
});
assert.ok(!("error" in hitBind));
if (!("error" in hitBind)) {
  assert.equal(hitBind.mode, "bind");
  assert.equal(hitBind.focusNodeId, "agent-2");
  assert.equal(hitBind.graph.nodes.find((n) => n.id === "agent-2")?.llmProvider, "anthropic");
  assert.equal(hitBind.graph.nodes.find((n) => n.id === "agent-1")?.llmProvider, undefined);
}

// --- Place on node offsets position ---
const onNode = applyComponentToGraph(withAgent, "queue", {
  position: { x: 100, y: 200 },
  hitNodeId: "agent-1",
});
assert.ok(!("error" in onNode));
if (!("error" in onNode)) {
  assert.equal(onNode.mode, "place");
  assert.equal(onNode.graph.nodes.length, 2);
  const q = onNode.graph.nodes.find((n) => n.id === onNode.focusNodeId);
  assert.deepEqual(q?.position, {
    x: 100 + PLACE_ON_NODE_OFFSET,
    y: 200 + PLACE_ON_NODE_OFFSET,
  });
}

console.log("applyComponentToGraph helpers OK");
