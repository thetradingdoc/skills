/**
 * Unit checks for the P2c design export markdown/JSON generators.
 * Run with: npx tsx scripts/test-export-markdown.ts
 */
import assert from "node:assert/strict";
import type { ArchEdge, ArchGraph, ArchNode, EdgeRelation } from "../webapp/client/src/types.ts";
import { createDesignArchNode, createDesignEdge } from "../webapp/client/src/greenfieldDesign.ts";
import { evaluateDesign, designScore } from "../webapp/client/src/designRules.ts";
import {
  exportDesignReadme,
  exportDesignAdr,
  exportDesignScoreCard,
} from "../webapp/client/src/exporters.ts";

function node(opts: { id: string; label: string; layer?: string }): ArchNode {
  return createDesignArchNode({ id: opts.id, label: opts.label, layer: opts.layer });
}

function edge(fromId: string, toId: string, relation?: EdgeRelation): ArchEdge {
  return createDesignEdge({ fromId, toId, relation });
}

function graphOf(nodes: ArchNode[], edges: ArchEdge[], projectName = "Test Project"): ArchGraph {
  return { nodes, edges, generatedAt: Date.now(), projectRoot: "", projectName };
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

const fe = node({ id: "fe", label: "Frontend", layer: "Presentation" });
const db = node({ id: "db", label: "Database", layer: "Data Access" });
const tinyGraph = graphOf([fe, db], [edge("fe", "db", "reads")]);

// ── exportDesignReadme ─────────────────────────────────────────────────────

check("exportDesignReadme: produces a non-empty markdown string for a tiny graph", () => {
  const text = exportDesignReadme(tinyGraph);
  assert.ok(typeof text === "string" && text.length > 0);
  assert.ok(text.includes("Test Project"));
  assert.ok(text.includes("Frontend"));
  assert.ok(text.includes("Database"));
});

check("exportDesignReadme: includes findings when the design has issues", () => {
  const findings = evaluateDesign(tinyGraph);
  assert.ok(findings.length > 0, "expected client_to_db to fire for this fixture");
  const text = exportDesignReadme(tinyGraph, findings, designScore(findings));
  assert.ok(text.includes("Open issues"));
  assert.ok(text.includes(String(designScore(findings))));
});

check("exportDesignReadme: reports no open issues on a clean graph", () => {
  const api = node({ id: "api", label: "API", layer: "Presentation" });
  const auth = node({ id: "auth", label: "Auth", layer: "Safety" });
  const clean = graphOf([api, auth], [edge("api", "auth", "authenticates_via")], "Clean");
  const text = exportDesignReadme(clean, [], 100);
  assert.ok(text.includes("None found"));
});

// ── exportDesignAdr ────────────────────────────────────────────────────────

check("exportDesignAdr: produces a non-empty markdown string with Context/Decision/Consequences", () => {
  const text = exportDesignAdr(tinyGraph);
  assert.ok(typeof text === "string" && text.length > 0);
  assert.ok(text.includes("## Context"));
  assert.ok(text.includes("## Decision"));
  assert.ok(text.includes("## Consequences"));
});

check("exportDesignAdr: lists blockers found by the design review", () => {
  const text = exportDesignAdr(tinyGraph);
  assert.ok(text.includes("Blockers"));
  assert.ok(text.toLowerCase().includes("frontend talks directly to the database"));
});

check("exportDesignAdr: has no blockers/risks section for a clean graph", () => {
  const solo = graphOf([node({ id: "svc", label: "Service" })], []);
  const text = exportDesignAdr(solo);
  // orphan_node is only a suggestion, so no Blockers/risk callouts expected.
  assert.ok(!text.includes("**Blockers"));
});

// ── exportDesignScoreCard ──────────────────────────────────────────────────

check("exportDesignScoreCard: produces valid non-empty JSON for a tiny graph", () => {
  const text = exportDesignScoreCard(tinyGraph);
  assert.ok(typeof text === "string" && text.length > 0);
  const parsed = JSON.parse(text);
  assert.equal(typeof parsed.score, "number");
  assert.ok(parsed.score >= 0 && parsed.score <= 100);
  assert.ok(Array.isArray(parsed.findings));
  assert.ok(parsed.findings.length > 0);
  assert.ok(parsed.breakdown && typeof parsed.breakdown.blocker === "number");
});

check("exportDesignScoreCard: score is 100 and findings empty for an empty graph", () => {
  const empty = graphOf([], []);
  const text = exportDesignScoreCard(empty);
  const parsed = JSON.parse(text);
  assert.equal(parsed.score, 100);
  assert.deepEqual(parsed.findings, []);
});

console.log(`\n${passed} export markdown/JSON checks passed`);
