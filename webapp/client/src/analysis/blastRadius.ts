import type { ArchGraph, ArchNode } from "../types";

/** Compute downstream nodes reachable from sourceId (blast radius). */
export function computeBlastRadius(graph: ArchGraph, sourceId: string): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }

  const visited = new Set<string>();
  const queue = [sourceId];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (visited.has(curr)) continue;
    visited.add(curr);
    for (const next of adj.get(curr) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }

  visited.delete(sourceId);
  return visited;
}

/** Compute upstream nodes that can reach targetId. */
export function computeUpstream(graph: ArchGraph, targetId: string): Set<string> {
  const reverseAdj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!reverseAdj.has(e.target)) reverseAdj.set(e.target, []);
    reverseAdj.get(e.target)!.push(e.source);
  }

  const visited = new Set<string>();
  const queue = [targetId];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (visited.has(curr)) continue;
    visited.add(curr);
    for (const next of reverseAdj.get(curr) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }

  visited.delete(targetId);
  return visited;
}

/** Request paths: all paths from entry points to targetId (BFS, limited depth). */
export function computeRequestPaths(
  graph: ArchGraph,
  targetId: string,
  maxDepth = 10
): string[][] {
  const entryPoints = new Set<string>();
  const hasInbound = new Set<string>();
  for (const e of graph.edges) {
    hasInbound.add(e.target);
  }
  for (const n of graph.nodes) {
    if (!hasInbound.has(n.id)) entryPoints.add(n.id);
  }
  if (entryPoints.size === 0 && graph.nodes.length > 0) {
    entryPoints.add(graph.nodes[0]!.id);
  }

  const paths: string[][] = [];
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }

  function dfs(nodeId: string, path: string[], depth: number) {
    if (depth > maxDepth || path.includes(nodeId)) return;
    const next = [...path, nodeId];
    if (nodeId === targetId) {
      paths.push(next);
      return;
    }
    for (const n of adj.get(nodeId) ?? []) {
      dfs(n, next, depth + 1);
    }
  }

  for (const ep of entryPoints) {
    dfs(ep, [], 0);
  }
  return paths.slice(0, 20);
}

/** Critical path: longest path (by hop count) through the graph from entry to target. */
export function computeCriticalPath(
  graph: ArchGraph,
  sourceId: string,
  targetId: string
): string[] {
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }

  let bestPath: string[] = [];
  function dfs(nodeId: string, path: string[], visited: Set<string>) {
    if (visited.has(nodeId)) return;
    const next = [...path, nodeId];
    visited.add(nodeId);
    if (nodeId === targetId && next.length > bestPath.length) {
      bestPath = next;
    }
    for (const n of adj.get(nodeId) ?? []) {
      dfs(n, next, new Set(visited));
    }
    visited.delete(nodeId);
  }
  dfs(sourceId, [], new Set());
  return bestPath;
}

/** Severity-weighted blast radius: downstream nodes with violation severity scores. */
export function computeBlastRadiusWithSeverity(
  graph: ArchGraph,
  sourceId: string
): Map<string, "critical" | "high" | "medium" | "low"> {
  const radius = computeBlastRadius(graph, sourceId);
  const nodeById = new Map<string, ArchNode>(graph.nodes.map((n) => [n.id, n]));
  const result = new Map<string, "critical" | "high" | "medium" | "low">();
  for (const id of radius) {
    const n = nodeById.get(id);
    const sev = n?.violationState?.highestSeverity;
    if (sev) result.set(id, sev);
    else result.set(id, "low");
  }
  return result;
}
