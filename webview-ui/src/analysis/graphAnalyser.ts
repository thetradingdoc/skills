import type { ArchGraph } from "../types";

export type EdgeFilter = "all" | "architectural" | "drift" | "violations" | "jira";

export function filterEdges(graph: ArchGraph, filter: EdgeFilter): ArchGraph {
  if (filter === "all") return graph;

  const filtered = graph.edges.filter((edge) => {
    if (filter === "drift") return edge.isDrift;
    if (filter === "violations") return edge.isLayerViolation;
    if (filter === "jira") return edge.isLayerViolation || edge.isDrift;
    if (filter === "architectural")
      return (
        edge.importance === "architectural" ||
        edge.isDrift ||
        edge.isLayerViolation
      );
    return true;
  });

  return { ...graph, edges: filtered };
}
