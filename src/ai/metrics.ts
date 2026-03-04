/**
 * Metrics for architecture tasks: LLM latency, criticScore, materialize, etc.
 * Lightweight in-memory store; can be extended with external backends.
 */

import type { AgentMode } from "../types";

export interface TaskMetrics {
  traceId: string;
  mode: AgentMode;
  timestamp: number;
  latencyMs?: number;
  criticScore?: number;
  tokenUsage?: number;
  error?: string;
}

export interface MaterializeMetrics {
  traceId?: string;
  timestamp: number;
  nodeCount: number;
  createdCount: number;
  errorCount: number;
  success: boolean;
}

const taskMetrics: TaskMetrics[] = [];
const materializeMetrics: MaterializeMetrics[] = [];
const MAX_ENTRIES = 500;

function trim(arr: unknown[]) {
  if (arr.length > MAX_ENTRIES) {
    arr.splice(0, arr.length - MAX_ENTRIES);
  }
}

export function recordTaskMetrics(m: TaskMetrics): void {
  taskMetrics.push(m);
  trim(taskMetrics);
  if (process.env.METRICS_LOG === "1") {
    console.log(
      `[metrics] task traceId=${m.traceId} mode=${m.mode} latencyMs=${m.latencyMs ?? "-"} criticScore=${m.criticScore ?? "-"} error=${m.error ?? "-"}`
    );
  }
}

export function recordMaterializeMetrics(m: MaterializeMetrics): void {
  materializeMetrics.push(m);
  trim(materializeMetrics);
  if (process.env.METRICS_LOG === "1") {
    console.log(
      `[metrics] materialize nodeCount=${m.nodeCount} created=${m.createdCount} success=${m.success}`
    );
  }
}

export function getTaskMetricsSummary(): {
  totalTasks: number;
  greenfieldCount: number;
  analysisCount: number;
  avgLatencyMs: number | null;
  avgCriticScore: number | null;
  errorCount: number;
} {
  const greenfield = taskMetrics.filter((m) => m.mode === "greenfield");
  const analysis = taskMetrics.filter((m) => m.mode === "analysis");
  const withLatency = taskMetrics.filter((m) => m.latencyMs != null);
  const withScore = taskMetrics.filter((m) => m.criticScore != null);
  const errors = taskMetrics.filter((m) => m.error);

  return {
    totalTasks: taskMetrics.length,
    greenfieldCount: greenfield.length,
    analysisCount: analysis.length,
    avgLatencyMs:
      withLatency.length > 0
        ? withLatency.reduce((s, m) => s + (m.latencyMs ?? 0), 0) / withLatency.length
        : null,
    avgCriticScore:
      withScore.length > 0
        ? withScore.reduce((s, m) => s + (m.criticScore ?? 0), 0) / withScore.length
        : null,
    errorCount: errors.length,
  };
}

export function getMaterializeMetricsSummary(): {
  totalMaterializes: number;
  successCount: number;
  avgNodesCreated: number;
} {
  const success = materializeMetrics.filter((m) => m.success);
  const createdSum = materializeMetrics.reduce((s, m) => s + m.createdCount, 0);
  return {
    totalMaterializes: materializeMetrics.length,
    successCount: success.length,
    avgNodesCreated:
      materializeMetrics.length > 0 ? createdSum / materializeMetrics.length : 0,
  };
}
