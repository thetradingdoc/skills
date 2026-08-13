/**
 * P1 assisted design loop — BE persistence round-trip checks.
 *
 * Where relation/buildStatus/position actually live:
 * - Saved workspace graphs: `graphs.graph_json` (webapp/server/src/workspaces.ts
 *   POST /workspaces/:id/save inserts `req.body.graph` verbatim; GET .../load
 *   selects `graph_json` and only *adds* fields like hasTraces/domain/tier —
 *   it never deletes or whitelists node/edge keys). Because the graph is
 *   stored as an opaque JSON blob, `ArchNode.buildStatus`/`position` and
 *   `ArchEdge.relation` round-trip for free as long as nothing upstream
 *   strips them before the save call — this script proves that with the
 *   client's own JSON serialization plus a live network-free simulation of
 *   the insert/select shape used by /save and /load.
 * - Greenfield session drafts (ephemeral, pre-save): `.agent/greenfield/draft-*.json`
 *   on disk (webapp/server/src/greenfieldDraft.ts). This script exercises the
 *   real save/load functions against a temp directory (no network needed).
 *
 * Run with: npx tsx scripts/test-design-persistence.ts
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ArchGraph } from "../src/types.ts";
import {
  createDesignArchNode,
  createDesignEdge,
  setDesignNodeBuildStatus,
  setDesignNodePosition,
} from "../webapp/client/src/greenfieldDesign.ts";
import { saveDraft, loadDraft, type DraftNode, type DraftEdge } from "../webapp/server/src/greenfieldDraft.ts";

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

// ── Saved workspace graph JSON (the real persistence shape for buildStatus/relation/position) ──

check("workspace graph JSON round-trip preserves relation, buildStatus, and position", () => {
  const api = createDesignArchNode({ id: "api", label: "API", layer: "Presentation" });
  let db = createDesignArchNode({ id: "db", label: "Database", layer: "Data Access" });
  db = setDesignNodeBuildStatus({ nodes: [db], edges: [], generatedAt: 0, projectRoot: "" }, "db", "building")
    .nodes[0]!;
  const positioned = setDesignNodePosition(
    { nodes: [api, db], edges: [], generatedAt: Date.now(), projectRoot: "" },
    "api",
    { x: 120, y: 40 }
  );
  const edge = createDesignEdge({ fromId: "api", toId: "db", relation: "reads" });
  const graph: ArchGraph = { ...positioned, edges: [edge] };

  assert.equal(graph.projectRoot, "", "design graph must have empty projectRoot (isDesignGraph)");

  // Mirror exactly what /workspaces/:id/save does (insert graph_json: graph)
  // and what /workspaces/:id/load does (select graph_json, JSON round-trip
  // over the wire/DB — no field whitelist in either direction).
  const persistedRow = { graph_json: JSON.parse(JSON.stringify(graph)) };
  const loaded = persistedRow.graph_json as ArchGraph;

  const loadedApi = loaded.nodes.find((n) => n.id === "api")!;
  const loadedDb = loaded.nodes.find((n) => n.id === "db")!;
  const loadedEdge = loaded.edges.find((e) => e.source === "api" && e.target === "db")!;

  assert.deepEqual(loadedApi.position, { x: 120, y: 40 }, "position must survive save/load");
  assert.equal(loadedDb.buildStatus, "building", "buildStatus must survive save/load");
  assert.equal(loadedEdge.relation, "reads", "edge relation must survive save/load");
  assert.equal(loaded.projectRoot, "", "empty projectRoot (no repo linked) must survive save/load");
});

check("workspace graph JSON round-trip works with no projectRoot AND no repo — pure design save", () => {
  const node = setDesignNodeBuildStatus(
    { nodes: [createDesignArchNode({ id: "svc", label: "Service" })], edges: [], generatedAt: 0, projectRoot: "" },
    "svc",
    "built"
  ).nodes[0]!;
  const graph: ArchGraph = { nodes: [node], edges: [], generatedAt: Date.now(), projectRoot: "" };
  const roundTripped = JSON.parse(JSON.stringify(graph)) as ArchGraph;
  assert.equal(roundTripped.projectRoot, "");
  assert.equal(roundTripped.nodes[0]!.buildStatus, "built");
});

// ── Greenfield session drafts (real fs read/write, no network) ─────────────

function withTempBase(fn: (basePath: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greenfield-draft-test-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

check("greenfield draft save/load round-trips node buildStatus and position", () => {
  withTempBase((basePath) => {
    const sessionId = "session-1";
    const nodes: DraftNode[] = [
      { id: "a", label: "A", layer: "Presentation", buildStatus: "building", position: { x: 10, y: 20 } },
    ];
    saveDraft(sessionId, { nodes, edges: [] }, basePath);
    const loaded = loadDraft(sessionId, basePath);
    assert.ok(loaded);
    assert.equal(loaded!.nodes[0]!.buildStatus, "building");
    assert.deepEqual(loaded!.nodes[0]!.position, { x: 10, y: 20 });
  });
});

check("greenfield draft save/load round-trips edge relation", () => {
  withTempBase((basePath) => {
    const sessionId = "session-2";
    const nodes: DraftNode[] = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    const edges: DraftEdge[] = [{ source: "a", target: "b", relation: "publishes" }];
    saveDraft(sessionId, { nodes, edges }, basePath);
    const loaded = loadDraft(sessionId, basePath);
    assert.ok(loaded);
    assert.equal(loaded!.edges[0]!.relation, "publishes");
  });
});

check("greenfield draft round-trips relation/buildStatus/position together across a full save cycle", () => {
  withTempBase((basePath) => {
    const sessionId = "session-3";
    const nodes: DraftNode[] = [
      { id: "fe", label: "Frontend", buildStatus: "built", position: { x: 0, y: 0 } },
      { id: "api", label: "API", buildStatus: "planned", position: { x: 200, y: 0 } },
    ];
    const edges: DraftEdge[] = [{ source: "fe", target: "api", relation: "calls" }];
    saveDraft(sessionId, { nodes, edges, workspaceId: "ws-1" }, basePath);

    // Re-load and re-save (simulates a second autosave tick) to confirm
    // nothing gets dropped on a subsequent write.
    const first = loadDraft(sessionId, basePath)!;
    saveDraft(sessionId, { nodes: first.nodes, edges: first.edges, workspaceId: first.workspaceId }, basePath);
    const second = loadDraft(sessionId, basePath)!;

    assert.equal(second.nodes.find((n) => n.id === "fe")!.buildStatus, "built");
    assert.deepEqual(second.nodes.find((n) => n.id === "api")!.position, { x: 200, y: 0 });
    assert.equal(second.edges[0]!.relation, "calls");
    assert.equal(second.workspaceId, "ws-1");
  });
});

console.log(`\n${passed} design persistence round-trip checks passed`);
