/**
 * Unit checks for the build-plan generator (P1 assisted design loop, workstream D).
 * Run with: npx tsx scripts/test-build-plan.ts
 */
import assert from "node:assert/strict";
import type { ArchEdge, ArchGraph, ArchNode, EdgeRelation } from "../webapp/client/src/types.ts";
import { createDesignArchNode, createDesignEdge } from "../webapp/client/src/greenfieldDesign.ts";
import { nextStep, planFromGraph } from "../webapp/client/src/buildPlan.ts";

function node(id: string, label: string, buildStatus?: "planned" | "building" | "built"): ArchNode {
  const n = createDesignArchNode({ id, label });
  if (buildStatus) n.buildStatus = buildStatus;
  return n;
}

function edge(fromId: string, toId: string, relation?: EdgeRelation): ArchEdge {
  return createDesignEdge({ fromId, toId, relation });
}

function graphOf(nodes: ArchNode[], edges: ArchEdge[]): ArchGraph {
  return { nodes, edges, generatedAt: Date.now(), projectRoot: "", projectName: "test" };
}

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    throw err;
  }
}

// ── planFromGraph ─────────────────────────────────────────────────────────

check("empty graph produces an empty plan", () => {
  assert.deepEqual(planFromGraph(graphOf([], [])), []);
});

check("independent nodes with no edges all have no dependencies", () => {
  const g = graphOf([node("a", "A"), node("b", "B")], []);
  const plan = planFromGraph(g);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan[0]!.dependsOn, []);
  assert.deepEqual(plan[1]!.dependsOn, []);
});

check("dependency target is built before the dependent source", () => {
  // frontend --calls--> api --reads--> db: db and api must precede frontend.
  const fe = node("fe", "Frontend");
  const api = node("api", "API");
  const db = node("db", "Database");
  const g = graphOf([fe, api, db], [edge("fe", "api", "calls"), edge("api", "db", "reads")]);
  const plan = planFromGraph(g);
  const order = plan.map((s) => s.nodeId);
  assert.ok(order.indexOf("db") < order.indexOf("api"), "db should come before api");
  assert.ok(order.indexOf("api") < order.indexOf("fe"), "api should come before frontend");
});

check("dependsOn references step ids of the node's dependencies", () => {
  const api = node("api", "API");
  const db = node("db", "Database");
  const g = graphOf([api, db], [edge("api", "db", "reads")]);
  const plan = planFromGraph(g);
  const apiStep = plan.find((s) => s.nodeId === "api")!;
  assert.deepEqual(apiStep.dependsOn, ["step-db"]);
  const dbStep = plan.find((s) => s.nodeId === "db")!;
  assert.deepEqual(dbStep.dependsOn, []);
});

check("every node appears exactly once, even with a self-loop edge", () => {
  const a = node("a", "A");
  const g = graphOf([a], [edge("a", "a", "calls")]);
  const plan = planFromGraph(g);
  assert.equal(plan.length, 1);
});

check("circular dependencies don't hang and still schedule every node once", () => {
  const a = node("a", "A");
  const b = node("b", "B");
  const g = graphOf([a, b], [edge("a", "b", "calls"), edge("b", "a", "calls")]);
  const plan = planFromGraph(g);
  assert.equal(plan.length, 2);
  assert.deepEqual(
    plan.map((s) => s.nodeId).sort(),
    ["a", "b"]
  );
});

check("ignores edges that reference a node not in the graph", () => {
  const a = node("a", "A");
  const g = graphOf([a], [edge("a", "ghost", "calls")]);
  const plan = planFromGraph(g);
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0]!.dependsOn, []);
});

// ── nextStep ──────────────────────────────────────────────────────────────

check("nextStep returns the first step when nothing is built yet", () => {
  const api = node("api", "API");
  const db = node("db", "Database");
  const g = graphOf([api, db], [edge("api", "db", "reads")]);
  const plan = planFromGraph(g);
  const step = nextStep(plan, g);
  assert.equal(step?.nodeId, "db");
});

check("nextStep skips steps whose node is already built", () => {
  const api = node("api", "API");
  const db = node("db", "Database", "built");
  const g = graphOf([api, db], [edge("api", "db", "reads")]);
  const plan = planFromGraph(g);
  const step = nextStep(plan, g);
  assert.equal(step?.nodeId, "api");
});

check("nextStep returns null when every node is built", () => {
  const api = node("api", "API", "built");
  const db = node("db", "Database", "built");
  const g = graphOf([api, db], [edge("api", "db", "reads")]);
  const plan = planFromGraph(g);
  assert.equal(nextStep(plan, g), null);
});

check("nextStep treats a node with no buildStatus as planned", () => {
  const a = createDesignArchNode({ id: "a", label: "A" });
  delete (a as { buildStatus?: unknown }).buildStatus;
  const g = graphOf([a], []);
  const plan = planFromGraph(g);
  assert.equal(nextStep(plan, g)?.nodeId, "a");
});

console.log(`\n${passed} build plan checks passed`);
