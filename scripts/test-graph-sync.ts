/**
 * Post-V1 multiplayer design graph sync — pure merge unit checks (no network).
 * Exercises the server copy directly; the client copy (webapp/client/src/graphSync.ts)
 * is a byte-for-byte twin, so covering one covers the logic for both.
 *
 * Run with: npx tsx scripts/test-graph-sync.ts
 */
import assert from "node:assert/strict";
import { mergeGraphs, applyNodePatch, type SyncGraph, type SyncNode } from "../webapp/server/src/graphSync.ts";

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

function node(id: string, updatedAt: number, extra: Record<string, unknown> = {}): SyncNode {
  return { id, updatedAt, ...extra };
}

function graph(nodes: SyncNode[], edges: SyncGraph["edges"] = [], revision = 0): SyncGraph {
  return { nodes, edges, revision };
}

// ── two clients edit different nodes → merge keeps both ────────────────────

check("two clients editing different nodes both survive the merge", () => {
  const base = graph([node("a", 100, { label: "A" }), node("b", 100, { label: "B" })], [], 1);
  const local = graph(
    [node("a", 200, { label: "A (local edit)" }), node("b", 100, { label: "B" })],
    [],
    1
  );
  const remote = graph(
    [node("a", 100, { label: "A" }), node("b", 200, { label: "B (remote edit)" })],
    [],
    1
  );

  const merged = mergeGraphs(base, local, remote);
  assert.equal(merged.nodes.length, 2);
  const a = merged.nodes.find((n) => n.id === "a")!;
  const b = merged.nodes.find((n) => n.id === "b")!;
  assert.equal(a.label, "A (local edit)", "local-only change to a must win");
  assert.equal(b.label, "B (remote edit)", "remote-only change to b must win");
});

check("a brand-new node added only on one side is added to the merge", () => {
  const base = graph([node("a", 100)], [], 1);
  const local = graph([node("a", 100), node("c", 300, { label: "New local node" })], [], 1);
  const remote = graph([node("a", 100)], [], 1);

  const merged = mergeGraphs(base, local, remote);
  assert.equal(merged.nodes.length, 2);
  assert.ok(merged.nodes.some((n) => n.id === "c"), "new local-only node must survive merge");
});

// ── same node conflict → higher updatedAt wins ──────────────────────────────

check("same node changed on both sides — higher updatedAt (remote) wins", () => {
  const base = graph([node("x", 100, { label: "original" })], [], 1);
  const local = graph([node("x", 150, { label: "local wins?" })], [], 1);
  const remote = graph([node("x", 500, { label: "remote wins" })], [], 1);

  const merged = mergeGraphs(base, local, remote);
  assert.equal(merged.nodes.length, 1);
  assert.equal(merged.nodes[0]!.label, "remote wins", "higher updatedAt (remote) must win the conflict");
});

check("same node changed on both sides — higher updatedAt (local) wins", () => {
  const base = graph([node("x", 100, { label: "original" })], [], 1);
  const local = graph([node("x", 900, { label: "local wins" })], [], 1);
  const remote = graph([node("x", 300, { label: "remote loses" })], [], 1);

  const merged = mergeGraphs(base, local, remote);
  assert.equal(merged.nodes[0]!.label, "local wins", "higher updatedAt (local) must win the conflict");
});

check("equal updatedAt on both sides breaks the tie deterministically toward local", () => {
  const base = graph([node("x", 100, { label: "original" })], [], 1);
  const local = graph([node("x", 700, { label: "local tie" })], [], 1);
  const remote = graph([node("x", 700, { label: "remote tie" })], [], 1);

  const merged = mergeGraphs(base, local, remote);
  assert.equal(merged.nodes[0]!.label, "local tie", "ties must resolve deterministically (local wins)");
});

// ── orphan edge dropped ─────────────────────────────────────────────────────

check("an edge whose target node was removed on both sides is dropped", () => {
  const base = graph(
    [node("a", 100), node("b", 100)],
    [{ id: "e1", source: "a", target: "b", updatedAt: 100 }],
    1
  );
  // Both sides delete node b (it's simply absent from both local and remote).
  const local = graph([node("a", 100)], [{ id: "e1", source: "a", target: "b", updatedAt: 100 }], 1);
  const remote = graph([node("a", 100)], [{ id: "e1", source: "a", target: "b", updatedAt: 100 }], 1);

  const merged = mergeGraphs(base, local, remote);
  assert.equal(merged.nodes.length, 1, "orphaned target node b must not reappear");
  assert.equal(merged.edges.length, 0, "edge pointing at a missing node must be dropped");
});

check("an edge surviving with both endpoints present is kept", () => {
  const base = graph(
    [node("a", 100), node("b", 100)],
    [{ id: "e1", source: "a", target: "b", updatedAt: 100 }],
    1
  );
  const local = graph(
    [node("a", 200, { label: "moved" }), node("b", 100)],
    [{ id: "e1", source: "a", target: "b", updatedAt: 100 }],
    1
  );
  const remote = graph(
    [node("a", 100), node("b", 100)],
    [{ id: "e1", source: "a", target: "b", updatedAt: 100 }],
    1
  );

  const merged = mergeGraphs(base, local, remote);
  assert.equal(merged.edges.length, 1);
  assert.equal(merged.edges[0]!.id, "e1");
});

// ── revision increments ─────────────────────────────────────────────────────

check("revision is max(base, local, remote) + 1", () => {
  const base = graph([node("a", 100)], [], 4);
  const local = graph([node("a", 100)], [], 7);
  const remote = graph([node("a", 100)], [], 5);

  const merged = mergeGraphs(base, local, remote);
  assert.equal(merged.revision, 8, "revision must be max(4,7,5)+1 = 8");
});

check("revision defaults missing base.revision to 0", () => {
  const base: SyncGraph = { nodes: [], edges: [] };
  const local = graph([], [], 0);
  const remote = graph([], [], 0);

  const merged = mergeGraphs(base, local, remote);
  assert.equal(merged.revision, 1);
});

// ── applyNodePatch ───────────────────────────────────────────────────────────

check("applyNodePatch bumps updatedAt and merges fields on an existing node", () => {
  const g = graph([node("a", 100, { label: "old", x: 1 })], [], 1);
  const patched = applyNodePatch(g, "a", { label: "new" }, 999);
  const a = patched.nodes.find((n) => n.id === "a")!;
  assert.equal(a.label, "new");
  assert.equal(a.x, 1, "unrelated fields must be preserved");
  assert.equal(a.updatedAt, 999);
});

check("applyNodePatch creates the node when it doesn't exist yet", () => {
  const g = graph([], [], 1);
  const patched = applyNodePatch(g, "new-node", { label: "brand new" }, 555);
  assert.equal(patched.nodes.length, 1);
  assert.equal(patched.nodes[0]!.id, "new-node");
  assert.equal(patched.nodes[0]!.updatedAt, 555);
});

check("mergeGraphs is pure — does not mutate its inputs", () => {
  const base = graph([node("a", 100)], [], 1);
  const local = graph([node("a", 200)], [], 1);
  const remote = graph([node("a", 100)], [], 1);
  const baseSnapshot = JSON.stringify(base);
  const localSnapshot = JSON.stringify(local);
  const remoteSnapshot = JSON.stringify(remote);

  mergeGraphs(base, local, remote);

  assert.equal(JSON.stringify(base), baseSnapshot);
  assert.equal(JSON.stringify(local), localSnapshot);
  assert.equal(JSON.stringify(remote), remoteSnapshot);
});

console.log(`\n${passed} graph sync merge checks passed`);
