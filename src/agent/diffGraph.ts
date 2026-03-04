/**
 * diff_graph — AGENT_ROADMAP v4 §10d
 * Compares current graph to planned graph. Auto-invoked after commit.
 */

import type { ArchGraph, ArchEdge } from "../types";
import type { AgentPlan } from "./types";

export interface DiffGraphOutput {
  delta: {
    added: ArchEdge[];
    removed: ArchEdge[];
    layerMismatches: Array<{ edge: ArchEdge; violation: string }>;
  };
}

export function diffGraph(
  currentGraph: ArchGraph,
  plan: AgentPlan
): DiffGraphOutput {
  const plannedModules = new Set(plan.tasks.map((t) => t.module));
  const layerMismatches: Array<{ edge: ArchEdge; violation: string }> = [];
  const plannedEdges = new Set<string>();

  for (const task of plan.tasks) {
    const layer = task.layer;
    for (const other of plan.tasks) {
      if (task.module !== other.module) {
        plannedEdges.add(`${task.module}->${other.module}`);
      }
    }
  }

  const added: ArchEdge[] = [];
  const removed: ArchEdge[] = [];

  for (const e of currentGraph.edges) {
    const inPlan = plannedModules.has(e.source) || plannedModules.has(e.target);
    if (!inPlan) continue;
    if (e.isLayerViolation) {
      layerMismatches.push({
        edge: e,
        violation: `Edge ${e.source} → ${e.target} violates layer direction`,
      });
    }
  }

  return {
    delta: { added, removed, layerMismatches },
  };
}
