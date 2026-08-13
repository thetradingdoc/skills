/**
 * Post-V1 multiplayer design graph sync — pure CRDT-lite merge (no Yjs).
 *
 * Client twin lives at `webapp/client/src/graphSync.ts` and must stay logically
 * identical (duplicated on purpose: client/server already keep separate
 * `types.ts` copies in this repo rather than sharing an import path across the
 * server/browser boundary). Keep this file dependency-free and pure so both
 * copies can be unit-tested the same way (see scripts/test-graph-sync.ts).
 *
 * Model: last-write-wins per node/edge using `updatedAt`, plus a monotonic
 * `revision` counter for optimistic-concurrency saves. This intentionally
 * skips full CRDT semantics (no tombstones for deletes): a node removed on
 * one side but left unchanged on the other reappears after merge, since there
 * is no delete marker to reconcile against. That's an acceptable trade-off
 * for a lightweight design-graph editor where deletes are rare and explicit
 * re-merges are cheap.
 */

export type SyncNode = { id: string; [k: string]: unknown; updatedAt?: number };
export type SyncEdge = { id: string; source: string; target: string; [k: string]: unknown; updatedAt?: number };
export type SyncGraph = { nodes: SyncNode[]; edges: SyncEdge[]; revision?: number };

type Identifiable = { id: string; updatedAt?: number; [k: string]: unknown };

/**
 * Merges one entity collection (nodes or edges) using base/local/remote,
 * three-way LWW per id. Only ids present in `local` or `remote` survive —
 * an id dropped from both is treated as deleted; an id dropped from only
 * one side but still present (unchanged) on the other side survives via
 * that other side (see file header re: no tombstones).
 */
function mergeEntities<T extends Identifiable>(base: T[], local: T[], remote: T[]): T[] {
  const baseById = new Map(base.map((e) => [e.id, e]));
  const localById = new Map(local.map((e) => [e.id, e]));
  const remoteById = new Map(remote.map((e) => [e.id, e]));

  const ids = new Set<string>([...localById.keys(), ...remoteById.keys()]);
  const merged: T[] = [];

  for (const id of ids) {
    const b = baseById.get(id);
    const l = localById.get(id);
    const r = remoteById.get(id);

    if (l && !r) {
      merged.push(l);
      continue;
    }
    if (r && !l) {
      merged.push(r);
      continue;
    }
    // Both sides have this id — decide which one changed relative to base.
    const localChanged = !b || (l!.updatedAt ?? 0) !== (b.updatedAt ?? 0);
    const remoteChanged = !b || (r!.updatedAt ?? 0) !== (b.updatedAt ?? 0);

    if (localChanged && remoteChanged) {
      // Conflict: both touched the same entity since base. LWW by updatedAt;
      // ties resolve to local for determinism.
      const localTs = l!.updatedAt ?? 0;
      const remoteTs = r!.updatedAt ?? 0;
      merged.push(remoteTs > localTs ? r! : l!);
    } else if (remoteChanged) {
      merged.push(r!);
    } else {
      // Neither changed (or only local "changed" by virtue of being equal to base) — take local.
      merged.push(l!);
    }
  }

  return merged;
}

/**
 * Three-way merge of a base graph plus two divergent copies (local + remote).
 * Pure function — no I/O, no mutation of inputs.
 */
export function mergeGraphs(base: SyncGraph, local: SyncGraph, remote: SyncGraph): SyncGraph {
  const mergedNodes = mergeEntities<SyncNode>(base.nodes ?? [], local.nodes ?? [], remote.nodes ?? []);
  const nodeIds = new Set(mergedNodes.map((n) => n.id));

  const mergedEdgesRaw = mergeEntities<SyncEdge>(base.edges ?? [], local.edges ?? [], remote.edges ?? []);
  // Orphaned edges (dangling source/target after node merge) are dropped rather than repaired.
  const mergedEdges = mergedEdgesRaw.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  const revision = Math.max(base.revision ?? 0, local.revision ?? 0, remote.revision ?? 0) + 1;

  return { nodes: mergedNodes, edges: mergedEdges, revision };
}

/**
 * Returns a new graph with `nodeId` patched (or created if absent), stamping
 * `updatedAt = now` so subsequent merges treat this as a fresh change. Does
 * not touch `revision` — callers bump revision at the point they persist or
 * broadcast, not on every local patch.
 */
export function applyNodePatch(
  graph: SyncGraph,
  nodeId: string,
  patch: Record<string, unknown>,
  now: number
): SyncGraph {
  const idx = graph.nodes.findIndex((n) => n.id === nodeId);
  const nodes = graph.nodes.slice();
  if (idx === -1) {
    nodes.push({ ...patch, id: nodeId, updatedAt: now });
  } else {
    nodes[idx] = { ...nodes[idx], ...patch, id: nodeId, updatedAt: now };
  }
  return { ...graph, nodes };
}
