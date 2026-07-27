import type { ArchGraph, ArchNode } from "../types";

export interface GraphInsight {
  id: string;
  type: "critical_chain" | "hotspot" | "drift" | "high_error" | "dependency_risk";
  title: string;
  description: string;
  nodeIds: string[];
  severity: "high" | "medium" | "low";
}

/** Auto-detect system insights from the graph. */
export function computeGraphInsights(graph: ArchGraph): GraphInsight[] {
  const insights: GraphInsight[] = [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // Fan-out (outbound edges) per node
  const fanOut = new Map<string, number>();
  const fanIn = new Map<string, number>();
  for (const e of graph.edges) {
    fanOut.set(e.source, (fanOut.get(e.source) ?? 0) + 1);
    fanIn.set(e.target, (fanIn.get(e.target) ?? 0) + 1);
  }

  // Hotspots: high fan-out nodes
  const HOTSPOT_THRESHOLD = 8;
  const hotspotNodes = graph.nodes.filter(
    (n) => (fanOut.get(n.id) ?? 0) >= HOTSPOT_THRESHOLD
  );
  for (const n of hotspotNodes.slice(0, 5)) {
    const out = fanOut.get(n.id) ?? 0;
    insights.push({
      id: `hotspot-${n.id}`,
      type: "hotspot",
      title: `High fan-out: ${n.label}`,
      description: `${out} outbound dependencies — potential single point of failure`,
      nodeIds: [n.id],
      severity: out >= 15 ? "high" : "medium",
    });
  }

  // Drift nodes
  const driftNodes = graph.nodes.filter((n) => n.isDrift);
  if (driftNodes.length > 0) {
    insights.push({
      id: "drift-summary",
      type: "drift",
      title: `${driftNodes.length} architecture drift`,
      description: `Nodes or edges differ from expected architecture`,
      nodeIds: driftNodes.slice(0, 10).map((n) => n.id),
      severity: driftNodes.length >= 5 ? "high" : "medium",
    });
  }

  // Critical/high violation nodes
  const violationNodes = graph.nodes.filter(
    (n) =>
      n.violationState?.highestSeverity === "critical" ||
      n.violationState?.highestSeverity === "high"
  );
  if (violationNodes.length > 0) {
    insights.push({
      id: "violations-summary",
      type: "critical_chain",
      title: `${violationNodes.length} violation(s)`,
      description: `Critical or high-severity architecture violations`,
      nodeIds: violationNodes.slice(0, 10).map((n) => n.id),
      severity: "high",
    });
  }

  // High error rate (from runtime metrics — we'd need runtimeSnapshot; skip if not present)
  // Dependency risk
  const riskNodes = graph.nodes.filter((n) => (n as ArchNode & { hasDependencyRisk?: boolean }).hasDependencyRisk);
  if (riskNodes.length > 0) {
    insights.push({
      id: "dep-risk-summary",
      type: "dependency_risk",
      title: `${riskNodes.length} dependency risk(s)`,
      description: `Nodes with supply-chain or vulnerability signals`,
      nodeIds: riskNodes.slice(0, 8).map((n) => n.id),
      severity: "medium",
    });
  }

  return insights;
}
