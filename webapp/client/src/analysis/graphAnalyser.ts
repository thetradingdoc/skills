import {
  ArchGraph,
  ArchEdge,
  ArchNode,
  EdgeImportance,
  NodeLayer,
} from "../types";
import { isLayerViolation } from "../architecture/layerModel";

const UTILITY_LAYERS: Set<NodeLayer> = new Set([
  "Utilities",
  "Configuration",
]);

function detectEntryPoints(graph: ArchGraph): Set<string> {
  const hasInbound = new Set<string>();
  const hasOutbound = new Set<string>();

  for (const edge of graph.edges) {
    hasInbound.add(edge.target);
    hasOutbound.add(edge.source);
  }

  const entryPoints = new Set<string>();
  for (const node of graph.nodes) {
    if (!hasInbound.has(node.id) && hasOutbound.has(node.id)) {
      entryPoints.add(node.id);
    }
  }

  if (entryPoints.size === 0) {
    let maxOut = 0;
    let candidate = graph.nodes[0]?.id;
    for (const node of graph.nodes) {
      const out = graph.edges.filter((e) => e.source === node.id).length;
      if (out > maxOut) {
        maxOut = out;
        candidate = node.id;
      }
    }
    if (candidate) entryPoints.add(candidate);
  }

  return entryPoints;
}

function computeDepths(
  graph: ArchGraph,
  entryPoints: Set<string>
): Map<string, number> {
  const depths = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [];

  for (const id of entryPoints) {
    depths.set(id, 0);
    queue.push({ id, depth: 0 });
  }

  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source)!.push(edge.target);
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    for (const neighbour of adj.get(id) ?? []) {
      if (!depths.has(neighbour)) {
        depths.set(neighbour, depth + 1);
        queue.push({ id: neighbour, depth: depth + 1 });
      }
    }
  }

  const maxDepth = Math.max(0, ...Array.from(depths.values()));
  for (const node of graph.nodes) {
    if (!depths.has(node.id)) depths.set(node.id, maxDepth + 1);
  }

  return depths;
}

function classifyEdge(
  edge: ArchEdge,
  nodeById: Map<string, ArchNode>
): EdgeImportance {
  const src = nodeById.get(edge.source);
  const tgt = nodeById.get(edge.target);

  if (!src || !tgt) return "utility";

  const srcLayer = (src.layer ?? "Uncategorized") as NodeLayer;
  const tgtLayer = (tgt.layer ?? "Uncategorized") as NodeLayer;

  if (UTILITY_LAYERS.has(tgtLayer)) return "utility";
  if (UTILITY_LAYERS.has(srcLayer)) return "utility";
  if (srcLayer === tgtLayer) return "utility";

  return "architectural";
}

export function analyseGraph(graph: ArchGraph): ArchGraph {
  const nodeById = new Map<string, ArchNode>(
    graph.nodes.map((n) => [n.id, n])
  );

  const entryPoints = detectEntryPoints(graph);
  const depths = computeDepths(graph, entryPoints);

  const enrichedEdges: ArchEdge[] = graph.edges.map((edge) => {
    const importance = classifyEdge(edge, nodeById);
    const src = nodeById.get(edge.source);
    const tgt = nodeById.get(edge.target);
    const srcLayer = (src?.layer ?? "Uncategorized") as string;
    const tgtLayer = (tgt?.layer ?? "Uncategorized") as string;
    return {
      ...edge,
      importance,
      isLayerViolation: isLayerViolation(srcLayer, tgtLayer),
    };
  });

  const enrichedNodes: ArchNode[] = graph.nodes.map((node) => ({
    ...node,
    isEntryPoint: entryPoints.has(node.id),
    depth: depths.get(node.id) ?? 0,
  }));

  return {
    ...graph,
    nodes: enrichedNodes,
    edges: enrichedEdges,
  };
}

export type EdgeFilter = "all" | "architectural" | "drift" | "violations" | "jira";

function edgeMatchesFilter(edge: ArchEdge, filter: EdgeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "drift") return !!edge.isDrift;
  if (filter === "violations") return !!edge.isLayerViolation;
  // Proxy: show edges that would generate Jira tickets (violations + drift).
  // Ideally this would filter by edges where the source/target node has jiraKey set.
  if (filter === "jira") return !!edge.isLayerViolation || !!edge.isDrift;
  if (filter === "architectural")
    return !!(
      edge.importance === "architectural" ||
      edge.isDrift ||
      edge.isLayerViolation
    );
  return true;
}

export function filterEdges(
  graph: ArchGraph,
  filter: EdgeFilter | Set<EdgeFilter>
): ArchGraph {
  const filters = filter instanceof Set ? filter : new Set<EdgeFilter>([filter]);
  if (filters.has("all") || filters.size === 0) return graph;

  const filtered = graph.edges.filter((edge) =>
    Array.from(filters).some((f) => edgeMatchesFilter(edge, f))
  );

  return { ...graph, edges: filtered };
}
