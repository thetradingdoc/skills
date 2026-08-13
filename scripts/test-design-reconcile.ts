/**
 * Table-driven unit checks for the design ↔ scan reconciliation engine (pure, no network).
 * Run with: npx tsx scripts/test-design-reconcile.ts
 */
import assert from "node:assert/strict";
import type { ArchEdge, ArchGraph, ArchNode } from "../src/types.ts";
import { reconcileDesignToScan } from "../webapp/server/src/designReconcile.ts";

function node(opts: Partial<ArchNode> & { id: string; label: string }): ArchNode {
  return {
    id: opts.id,
    label: opts.label,
    path: opts.path ?? opts.id,
    layer: opts.layer,
    archNodeId: opts.archNodeId,
    files: [],
    health: { hasDocs: false, hasTests: false, hasContext: false },
    semanticSignals: { exports: [], externalImports: [], fileCount: 0 },
    status: "new",
    isDrift: false,
    buildStatus: opts.buildStatus,
  };
}

function graphOf(nodes: ArchNode[], edges: ArchEdge[] = [], projectRoot = ""): ArchGraph {
  return { nodes, edges, generatedAt: Date.now(), projectRoot, projectName: "test" };
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

// ── exact id / path matching ────────────────────────────────────────────────

check("matches design and scan nodes with identical ids at confidence 1", () => {
  const design = graphOf([node({ id: "services/auth", label: "Auth Service", layer: "Business Logic" })]);
  const scanned = graphOf(
    [node({ id: "services/auth", label: "auth.ts", layer: "Business Logic" })],
    [],
    "/repo"
  );
  const result = reconcileDesignToScan(design, scanned);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0]!.designNodeId, "services/auth");
  assert.equal(result.matched[0]!.scanNodeId, "services/auth");
  assert.equal(result.matched[0]!.confidence, 1);
  assert.equal(result.matched[0]!.method, "exact_id");
  assert.equal(result.missing.length, 0);
  assert.equal(result.unplanned.length, 0);
});

check("matches on normalized path when ids differ but archNodeId/path agree", () => {
  const design = graphOf([
    node({ id: "design-auth-1700000000-0", label: "Auth", layer: "Safety", path: "services/auth" }),
  ]);
  const scanned = graphOf(
    [node({ id: "src/services/auth.ts", label: "auth", layer: "Safety", archNodeId: "services/auth" })],
    [],
    "/repo"
  );
  const result = reconcileDesignToScan(design, scanned);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0]!.method, "exact_id");
  assert.ok(result.matched[0]!.confidence >= 0.9);
});

// ── label fuzzy matching ─────────────────────────────────────────────────────

check("matches on fuzzy label similarity when ids and paths differ", () => {
  const design = graphOf([node({ id: "design-db-1", label: "Postgres Database", layer: "Data Access" })]);
  const scanned = graphOf(
    [node({ id: "src/db/pool.ts", label: "Postgres DB", layer: "Data Access" })],
    [],
    "/repo"
  );
  const result = reconcileDesignToScan(design, scanned);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0]!.method, "label_fuzzy");
  assert.ok(result.matched[0]!.confidence >= 0.5 && result.matched[0]!.confidence < 1);
});

// ── missing (planned, not built) ────────────────────────────────────────────

check("design node with no scan counterpart is reported missing", () => {
  const design = graphOf([
    node({ id: "queue", label: "Queue", layer: "Infrastructure", buildStatus: "planned" }),
  ]);
  const scanned = graphOf([node({ id: "src/api.ts", label: "API", layer: "Presentation" })], [], "/repo");
  const result = reconcileDesignToScan(design, scanned);
  assert.equal(result.matched.length, 0);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0]!.designNodeId, "queue");
  assert.equal(result.unplanned.length, 1);
});

check("design node marked built still reports missing if no scan match exists", () => {
  // Reconciliation reflects reality, not intent — a stale buildStatus doesn't fabricate a match.
  const design = graphOf([node({ id: "cache", label: "Redis Cache", layer: "Memory", buildStatus: "built" })]);
  const scanned = graphOf([], [], "/repo");
  const result = reconcileDesignToScan(design, scanned);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0]!.designNodeId, "cache");
});

// ── unplanned (built, not planned) ──────────────────────────────────────────

check("scan node with no design counterpart is reported unplanned", () => {
  const design = graphOf([node({ id: "api", label: "API", layer: "Presentation" })]);
  const scanned = graphOf(
    [
      node({ id: "src/api.ts", label: "API", layer: "Presentation" }),
      node({ id: "src/legacy/exporter.ts", label: "Legacy Exporter", layer: "Utilities" }),
    ],
    [],
    "/repo"
  );
  const result = reconcileDesignToScan(design, scanned);
  assert.equal(result.matched.length, 1);
  assert.equal(result.unplanned.length, 1);
  assert.equal(result.unplanned[0]!.scanNodeId, "src/legacy/exporter.ts");
});

// ── greedy 1:1 assignment ────────────────────────────────────────────────────

check("each node is matched at most once even with multiple plausible candidates", () => {
  const design = graphOf([
    node({ id: "svc-a", label: "User Service", layer: "Business Logic" }),
    node({ id: "svc-b", label: "User Service V2", layer: "Business Logic" }),
  ]);
  const scanned = graphOf(
    [node({ id: "src/services/user.ts", label: "User Service", layer: "Business Logic" })],
    [],
    "/repo"
  );
  const result = reconcileDesignToScan(design, scanned);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0]!.designNodeId, "svc-a", "exact label match should win over the runner-up");
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0]!.designNodeId, "svc-b");
});

check("unrelated nodes across layers with no label overlap do not match", () => {
  const design = graphOf([node({ id: "auth", label: "Auth", layer: "Safety" })]);
  const scanned = graphOf(
    [node({ id: "src/utils/formatDate.ts", label: "Format Date", layer: "Utilities" })],
    [],
    "/repo"
  );
  const result = reconcileDesignToScan(design, scanned);
  assert.equal(result.matched.length, 0);
  assert.equal(result.missing.length, 1);
  assert.equal(result.unplanned.length, 1);
});

// ── empty inputs ─────────────────────────────────────────────────────────────

check("empty design graph reports everything scanned as unplanned", () => {
  const design = graphOf([]);
  const scanned = graphOf([node({ id: "src/a.ts", label: "A" })], [], "/repo");
  const result = reconcileDesignToScan(design, scanned);
  assert.equal(result.matched.length, 0);
  assert.equal(result.missing.length, 0);
  assert.equal(result.unplanned.length, 1);
});

check("empty scanned graph reports everything designed as missing", () => {
  const design = graphOf([node({ id: "a", label: "A" }), node({ id: "b", label: "B" })]);
  const scanned = graphOf([], [], "/repo");
  const result = reconcileDesignToScan(design, scanned);
  assert.equal(result.matched.length, 0);
  assert.equal(result.missing.length, 2);
  assert.equal(result.unplanned.length, 0);
});

console.log(`\n${passed} design reconciliation checks passed`);
