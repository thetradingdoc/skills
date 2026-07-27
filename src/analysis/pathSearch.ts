import type { ArchGraph } from "../types.js";

/** Find shortest path from source to target using BFS. Returns node IDs in order. */
export function findPath(
  graph: ArchGraph,
  sourceId: string,
  targetId: string,
  direction: "outbound" | "inbound" | "both" = "outbound"
): string[] {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return [];

  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }

  const reverseAdj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!reverseAdj.has(e.target)) reverseAdj.set(e.target, []);
    reverseAdj.get(e.target)!.push(e.source);
  }

  const getNeighbours = (id: string): string[] => {
    if (direction === "outbound") return adj.get(id) ?? [];
    if (direction === "inbound") return reverseAdj.get(id) ?? [];
    return [...(adj.get(id) ?? []), ...(reverseAdj.get(id) ?? [])];
  };

  const parent = new Map<string, string>();
  const queue = [sourceId];
  parent.set(sourceId, "");

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === targetId) {
      const path: string[] = [];
      let n: string | undefined = targetId;
      while (n) {
        path.unshift(n);
        n = parent.get(n) || undefined;
      }
      return path;
    }
    for (const next of getNeighbours(curr)) {
      if (!parent.has(next)) {
        parent.set(next, curr);
        queue.push(next);
      }
    }
  }
  return [];
}
