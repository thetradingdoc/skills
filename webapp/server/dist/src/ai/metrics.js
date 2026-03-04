"use strict";
/**
 * Metrics for architecture tasks: LLM latency, criticScore, materialize, etc.
 * Lightweight in-memory store; can be extended with external backends.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordTaskMetrics = recordTaskMetrics;
exports.recordMaterializeMetrics = recordMaterializeMetrics;
exports.getTaskMetricsSummary = getTaskMetricsSummary;
exports.getMaterializeMetricsSummary = getMaterializeMetricsSummary;
const taskMetrics = [];
const materializeMetrics = [];
const MAX_ENTRIES = 500;
function trim(arr) {
    if (arr.length > MAX_ENTRIES) {
        arr.splice(0, arr.length - MAX_ENTRIES);
    }
}
function recordTaskMetrics(m) {
    taskMetrics.push(m);
    trim(taskMetrics);
    if (process.env.METRICS_LOG === "1") {
        console.log(`[metrics] task traceId=${m.traceId} mode=${m.mode} latencyMs=${m.latencyMs ?? "-"} criticScore=${m.criticScore ?? "-"} error=${m.error ?? "-"}`);
    }
}
function recordMaterializeMetrics(m) {
    materializeMetrics.push(m);
    trim(materializeMetrics);
    if (process.env.METRICS_LOG === "1") {
        console.log(`[metrics] materialize nodeCount=${m.nodeCount} created=${m.createdCount} success=${m.success}`);
    }
}
function getTaskMetricsSummary() {
    const greenfield = taskMetrics.filter((m) => m.mode === "greenfield");
    const analysis = taskMetrics.filter((m) => m.mode === "analysis");
    const withLatency = taskMetrics.filter((m) => m.latencyMs != null);
    const withScore = taskMetrics.filter((m) => m.criticScore != null);
    const errors = taskMetrics.filter((m) => m.error);
    return {
        totalTasks: taskMetrics.length,
        greenfieldCount: greenfield.length,
        analysisCount: analysis.length,
        avgLatencyMs: withLatency.length > 0
            ? withLatency.reduce((s, m) => s + (m.latencyMs ?? 0), 0) / withLatency.length
            : null,
        avgCriticScore: withScore.length > 0
            ? withScore.reduce((s, m) => s + (m.criticScore ?? 0), 0) / withScore.length
            : null,
        errorCount: errors.length,
    };
}
function getMaterializeMetricsSummary() {
    const success = materializeMetrics.filter((m) => m.success);
    const createdSum = materializeMetrics.reduce((s, m) => s + m.createdCount, 0);
    return {
        totalMaterializes: materializeMetrics.length,
        successCount: success.length,
        avgNodesCreated: materializeMetrics.length > 0 ? createdSum / materializeMetrics.length : 0,
    };
}
