/**
 * Table-driven unit checks for the pure design rule engine (no browser, no network).
 * Run with: npx tsx scripts/test-design-rules.ts
 */
import assert from "node:assert/strict";
import type { ArchEdge, ArchGraph, ArchNode, EdgeRelation } from "../webapp/client/src/types.ts";
import {
  createDesignArchNode,
  createDesignEdge,
} from "../webapp/client/src/greenfieldDesign.ts";
import {
  designScore,
  evaluateDesign,
  RULE_IDS,
  type DesignFinding,
} from "../webapp/client/src/designRules.ts";

function node(opts: { id: string; label: string; layer?: string; techKind?: ArchNode["techKind"] }): ArchNode {
  const n = createDesignArchNode({ id: opts.id, label: opts.label, layer: opts.layer });
  if (opts.techKind) n.techKind = opts.techKind;
  return n;
}

function edge(fromId: string, toId: string, relation?: EdgeRelation): ArchEdge {
  return createDesignEdge({ fromId, toId, relation });
}

function graphOf(nodes: ArchNode[], edges: ArchEdge[]): ArchGraph {
  return {
    nodes,
    edges,
    generatedAt: Date.now(),
    projectRoot: "",
    projectName: "test",
  };
}

function findingsFor(ruleId: string, findings: DesignFinding[]): DesignFinding[] {
  return findings.filter((f) => f.ruleId === ruleId);
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

// ── RULE_IDS sanity ─────────────────────────────────────────────────────

check("RULE_IDS lists exactly the 10 required rules", () => {
  assert.equal(RULE_IDS.length, 10);
  assert.deepEqual(
    [...RULE_IDS].sort(),
    [
      "api_no_auth",
      "client_to_db",
      "layer_inversion",
      "llm_to_broker",
      "missing_trading_spine",
      "no_config_secrets",
      "no_observability",
      "orphan_node",
      "single_external_no_fallback",
      "writes_no_queue",
    ].sort()
  );
});

check("llm_to_broker: blocker when agent calls Alpaca directly", () => {
  const ag = node({ id: "ag", label: "Agent / LLM", layer: "Reasoning" });
  const al = node({ id: "al", label: "Alpaca", layer: "External Services" });
  const g = graphOf([ag, al], [edge("ag", "al", "calls")]);
  const findings = findingsFor("llm_to_broker", evaluateDesign(g));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "blocker");
  assert.deepEqual(findings[0]!.nodeIds, ["ag", "al"]);
  assert.deepEqual(findings[0]!.edgeIds, [g.edges[0]!.id]);
});

check("missing_trading_spine: fires on trading scan without Payment/Policy/Risk/Execution", () => {
  const chat = node({ id: "trading-chat", label: "Trading Chat", layer: "Presentation" });
  const mid = node({ id: "middleware-platform", label: "Middleware Platform", layer: "Data Access" });
  const g = graphOf([chat, mid], []);
  (g as { projectName?: string }).projectName = "trading-agent";
  const findings = findingsFor("missing_trading_spine", evaluateDesign(g));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "risk");
});

check("missing_trading_spine: attributes to ingress + middleware, not arbitrary first nodes", () => {
  const noiseA = node({ id: "noise-a", label: "Utils", layer: "Business Logic" });
  const noiseB = node({ id: "noise-b", label: "Helpers", layer: "Business Logic" });
  const noiseC = node({ id: "noise-c", label: "Config Loader", layer: "Configuration" });
  const chat = node({ id: "trading-chat", label: "Trading Chat", layer: "Presentation" });
  const mid = node({ id: "middleware-platform", label: "Middleware Platform", layer: "Data Access" });
  const tg = node({ id: "telegram-bot", label: "Telegram Bot", layer: "Presentation" });
  // Noise first so a naive slice(0,3) would wrongly pick noise-a/b/c.
  const g = graphOf([noiseA, noiseB, noiseC, chat, mid, tg], []);
  (g as { projectName?: string }).projectName = "trading-agent";
  const findings = findingsFor("missing_trading_spine", evaluateDesign(g));
  assert.equal(findings.length, 1);
  const ids = new Set(findings[0]!.nodeIds);
  assert.ok(ids.has("trading-chat"), "expected trading-chat ingress");
  assert.ok(ids.has("middleware-platform"), "expected middleware shell");
  assert.ok(ids.has("telegram-bot"), "expected telegram ingress");
  assert.ok(!ids.has("noise-a") && !ids.has("noise-b") && !ids.has("noise-c"), "must not attribute to unrelated first nodes");
  assert.ok(findings[0]!.nodeIds.length <= 12);
});

check("missing_trading_spine: silent when architectureBoard is set", () => {
  const chat = node({ id: "trading-chat", label: "Trading Chat", layer: "Presentation" });
  const g = graphOf([chat], []);
  (g as { projectName?: string; architectureBoard?: boolean }).projectName = "trading-agent";
  (g as { architectureBoard?: boolean }).architectureBoard = true;
  assert.equal(findingsFor("missing_trading_spine", evaluateDesign(g)).length, 0);
});

// ── client_to_db ──────────────────────────────────────────────────────────

check("client_to_db: fires when frontend connects directly to database", () => {
  const fe = node({ id: "fe", label: "Frontend", layer: "Presentation" });
  const db = node({ id: "db", label: "Database", layer: "Data Access" });
  const g = graphOf([fe, db], [edge("fe", "db", "reads")]);
  const findings = findingsFor("client_to_db", evaluateDesign(g));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "blocker");
  assert.deepEqual(findings[0]!.nodeIds, ["fe", "db"]);
  assert.ok(findings[0]!.fix && findings[0]!.fix.length >= 2, "expected a fix");
  const createCmd = findings[0]!.fix!.find((c) => c.action === "create_node");
  assert.ok(createCmd, "expected a create_node fix command for the API layer");
});

check("client_to_db: does not fire when frontend goes through an API", () => {
  const fe = node({ id: "fe", label: "Frontend", layer: "Presentation" });
  const api = node({ id: "api", label: "API Gateway", layer: "Presentation" });
  const db = node({ id: "db", label: "Database", layer: "Data Access" });
  const g = graphOf([fe, api, db], [edge("fe", "api", "calls"), edge("api", "db", "reads")]);
  assert.equal(findingsFor("client_to_db", evaluateDesign(g)).length, 0);
});

// ── api_no_auth ───────────────────────────────────────────────────────────

check("api_no_auth: fires when API has no authenticates_via edge", () => {
  const api = node({ id: "api", label: "Public API", layer: "Presentation" });
  const db = node({ id: "db", label: "Database", layer: "Data Access" });
  const g = graphOf([api, db], [edge("api", "db", "reads")]);
  const findings = findingsFor("api_no_auth", evaluateDesign(g));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "blocker");
  const createCmd = findings[0]!.fix!.find((c) => c.action === "create_node");
  assert.ok(createCmd, "expected an Auth create_node fix");
});

check("api_no_auth: does not fire when API authenticates via an Auth node", () => {
  const api = node({ id: "api", label: "Public API", layer: "Presentation" });
  const auth = node({ id: "auth", label: "Auth", layer: "Safety" });
  const g = graphOf([api, auth], [edge("api", "auth", "authenticates_via")]);
  assert.equal(findingsFor("api_no_auth", evaluateDesign(g)).length, 0);
});

// ── orphan_node ───────────────────────────────────────────────────────────

check("orphan_node: fires for a node with no edges", () => {
  const lonely = node({ id: "lonely", label: "Lonely Service", layer: "Business Logic" });
  const other = node({ id: "other", label: "Other", layer: "Business Logic" });
  const g = graphOf([lonely, other], []);
  const findings = findingsFor("orphan_node", evaluateDesign(g));
  assert.equal(findings.length, 2);
  assert.equal(findings[0]!.severity, "suggestion");
  assert.equal(findings[0]!.fix, undefined);
});

check("orphan_node: does not fire when every node has at least one edge", () => {
  const a = node({ id: "a", label: "A" });
  const b = node({ id: "b", label: "B" });
  const g = graphOf([a, b], [edge("a", "b", "calls")]);
  assert.equal(findingsFor("orphan_node", evaluateDesign(g)).length, 0);
});

// ── layer_inversion ───────────────────────────────────────────────────────

check("layer_inversion: fires when Data Access edges target Presentation", () => {
  const db = node({ id: "db", label: "Database", layer: "Data Access" });
  const ui = node({ id: "ui", label: "Frontend", layer: "Presentation" });
  const g = graphOf([db, ui], [edge("db", "ui", "calls")]);
  const findings = findingsFor("layer_inversion", evaluateDesign(g));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "risk");
  assert.equal(findings[0]!.fix, undefined);
});

check("layer_inversion: does not fire for normal top-down edges", () => {
  const ui = node({ id: "ui", label: "Frontend", layer: "Presentation" });
  const db = node({ id: "db", label: "Database", layer: "Data Access" });
  const g = graphOf([ui, db], [edge("ui", "db", "reads")]);
  assert.equal(findingsFor("layer_inversion", evaluateDesign(g)).length, 0);
});

// ── single_external_no_fallback ────────────────────────────────────────────

check("single_external_no_fallback: fires with one External Services node and no queue", () => {
  const ext = node({ id: "ext", label: "Payment Provider", layer: "External Services" });
  const api = node({ id: "api", label: "API", layer: "Presentation" });
  const g = graphOf([api, ext], [edge("api", "ext", "calls")]);
  const findings = findingsFor("single_external_no_fallback", evaluateDesign(g));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "risk");
  assert.equal(findings[0]!.fix, undefined);
});

check("single_external_no_fallback: does not fire when a queue exists", () => {
  const ext = node({ id: "ext", label: "Payment Provider", layer: "External Services" });
  const queue = node({ id: "queue", label: "Queue", layer: "Infrastructure" });
  const g = graphOf([ext, queue], [edge("queue", "ext", "calls")]);
  assert.equal(findingsFor("single_external_no_fallback", evaluateDesign(g)).length, 0);
});

check("single_external_no_fallback: does not fire with two external services", () => {
  const ext1 = node({ id: "ext1", label: "Payment Provider", layer: "External Services" });
  const ext2 = node({ id: "ext2", label: "Email Provider", layer: "External Services" });
  const g = graphOf([ext1, ext2], []);
  assert.equal(findingsFor("single_external_no_fallback", evaluateDesign(g)).length, 0);
});

// ── writes_no_queue ───────────────────────────────────────────────────────

check("writes_no_queue: fires when writes go directly to datastore with no queue", () => {
  const svc = node({ id: "svc", label: "Order Service", layer: "Business Logic" });
  const db = node({ id: "db", label: "Database", layer: "Data Access" });
  const g = graphOf([svc, db], [edge("svc", "db", "writes")]);
  const findings = findingsFor("writes_no_queue", evaluateDesign(g));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "risk");
  const createCmd = findings[0]!.fix!.find((c) => c.action === "create_node");
  assert.ok(createCmd, "expected a Queue create_node fix");
});

check("writes_no_queue: does not fire when a queue/worker node exists", () => {
  const svc = node({ id: "svc", label: "Order Service", layer: "Business Logic" });
  const db = node({ id: "db", label: "Database", layer: "Data Access" });
  const queue = node({ id: "queue", label: "Queue", layer: "Infrastructure" });
  const g = graphOf([svc, db, queue], [edge("svc", "db", "writes")]);
  assert.equal(findingsFor("writes_no_queue", evaluateDesign(g)).length, 0);
});

// ── no_observability ──────────────────────────────────────────────────────

check("no_observability: fires with >=5 nodes and no observability node", () => {
  const nodes = ["a", "b", "c", "d", "e"].map((id) => node({ id, label: id.toUpperCase() }));
  const g = graphOf(nodes, []);
  const findings = findingsFor("no_observability", evaluateDesign(g));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "suggestion");
});

check("no_observability: does not fire with fewer than 5 nodes", () => {
  const nodes = ["a", "b", "c"].map((id) => node({ id, label: id.toUpperCase() }));
  const g = graphOf(nodes, []);
  assert.equal(findingsFor("no_observability", evaluateDesign(g)).length, 0);
});

check("no_observability: does not fire when a logging/metrics node exists", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => node({ id, label: id.toUpperCase() }));
  nodes.push(node({ id: "obs", label: "Metrics & Logging", layer: "Infrastructure" }));
  const g = graphOf(nodes, []);
  assert.equal(findingsFor("no_observability", evaluateDesign(g)).length, 0);
});

// ── no_config_secrets ─────────────────────────────────────────────────────

check("no_config_secrets: fires when Auth exists with no Configuration layer", () => {
  const auth = node({ id: "auth", label: "Auth", layer: "Safety" });
  const g = graphOf([auth], []);
  const findings = findingsFor("no_config_secrets", evaluateDesign(g));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "suggestion");
  const createCmd = findings[0]!.fix!.find((c) => c.action === "create_node");
  assert.ok(createCmd, "expected a Configuration create_node fix");
});

check("no_config_secrets: does not fire when a Configuration node exists", () => {
  const auth = node({ id: "auth", label: "Auth", layer: "Safety" });
  const config = node({ id: "config", label: "Configuration", layer: "Configuration" });
  const g = graphOf([auth, config], []);
  assert.equal(findingsFor("no_config_secrets", evaluateDesign(g)).length, 0);
});

check("no_config_secrets: does not fire without Auth/External/Database", () => {
  const a = node({ id: "a", label: "Business Logic", layer: "Business Logic" });
  const g = graphOf([a], []);
  assert.equal(findingsFor("no_config_secrets", evaluateDesign(g)).length, 0);
});

// ── designScore ───────────────────────────────────────────────────────────

check("designScore: 100 for no findings", () => {
  assert.equal(designScore([]), 100);
});

check("designScore: blockers hurt more than risks and suggestions", () => {
  const blocker: DesignFinding = {
    id: "b1",
    ruleId: "client_to_db",
    severity: "blocker",
    title: "t",
    whyItMatters: "w",
    nodeIds: [],
    edgeIds: [],
  };
  const risk: DesignFinding = { ...blocker, id: "r1", severity: "risk" };
  const suggestion: DesignFinding = { ...blocker, id: "s1", severity: "suggestion" };

  const blockerScore = designScore([blocker]);
  const riskScore = designScore([risk]);
  const suggestionScore = designScore([suggestion]);

  assert.ok(blockerScore < riskScore, "blocker should score lower than risk");
  assert.ok(riskScore < suggestionScore, "risk should score lower than suggestion");
  assert.ok(blockerScore < 100 && riskScore < 100 && suggestionScore < 100);
});

check("designScore: floors at 0 and never goes negative", () => {
  const blockers: DesignFinding[] = Array.from({ length: 10 }, (_, i) => ({
    id: `b${i}`,
    ruleId: "client_to_db",
    severity: "blocker" as const,
    title: "t",
    whyItMatters: "w",
    nodeIds: [],
    edgeIds: [],
  }));
  assert.equal(designScore(blockers), 0);
});

// ── Integration: evaluateDesign runs all rules together without throwing ──

check("evaluateDesign: composite graph produces findings from multiple rules", () => {
  const fe = node({ id: "fe", label: "Frontend", layer: "Presentation" });
  const db = node({ id: "db", label: "Database", layer: "Data Access" });
  const ext = node({ id: "ext", label: "Payment Provider", layer: "External Services" });
  const lonely = node({ id: "lonely", label: "Unused Service", layer: "Business Logic" });
  const g = graphOf([fe, db, ext, lonely], [edge("fe", "db", "writes")]);

  const findings = evaluateDesign(g);
  const ruleIdsFired = new Set(findings.map((f) => f.ruleId));

  assert.ok(ruleIdsFired.has("client_to_db"));
  assert.ok(ruleIdsFired.has("orphan_node"));
  assert.ok(ruleIdsFired.has("single_external_no_fallback"));
  assert.ok(ruleIdsFired.has("writes_no_queue"));
  assert.ok(designScore(findings) < 100);
});

console.log(`\n${passed} design rule checks passed`);
