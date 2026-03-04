import { loadAntiPatterns } from "./rail/manager";
import { loadNodeHistory, type NodeHistoryStore } from "./nodeHistory";
import type { GateType } from "./types";

export interface NodeHistorySummary {
  nodeId: string;
  successCount: number;
  failureCount: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
}

export interface ViolationSummary {
  nodeId: string;
  highestSeverity: "critical" | "high" | "medium" | "low" | null;
  count: number;
  lastSeenAt?: number;
}

export interface PlannerContext {
  antiPatterns: string[];
  nodeHistory: NodeHistorySummary[];
  violations: ViolationSummary[];
  skillHints: string[];
  gates: GateType[];
}

function summarizeNodeHistory(store: NodeHistoryStore): NodeHistorySummary[] {
  return Object.values(store.nodes).map((n) => ({
    nodeId: n.nodeId,
    successCount: n.successCount,
    failureCount: n.failureCount,
    lastSuccessAt: n.lastSuccessAt,
    lastFailureAt: n.lastFailureAt,
  }));
}

export function loadPlannerContext(rootPath: string, archetype?: string | null): PlannerContext {
  const anti = loadAntiPatterns(rootPath, archetype);
  const history = loadNodeHistory(rootPath);

  const antiPatterns = anti.map((p) => `Avoid: ${p.reason} (from outcome "${p.outcome}")`);

  return {
    antiPatterns,
    nodeHistory: summarizeNodeHistory(history),
    violations: [],
    skillHints: [],
    gates: [],
  };
}

