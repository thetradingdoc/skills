"use strict";
/**
 * diff_graph — AGENT_ROADMAP v4 §10d
 * Compares current graph to planned graph. Auto-invoked after commit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.diffGraph = diffGraph;
function diffGraph(currentGraph, plan) {
    const plannedModules = new Set(plan.tasks.map((t) => t.module));
    const layerMismatches = [];
    const plannedEdges = new Set();
    for (const task of plan.tasks) {
        const layer = task.layer;
        for (const other of plan.tasks) {
            if (task.module !== other.module) {
                plannedEdges.add(`${task.module}->${other.module}`);
            }
        }
    }
    const added = [];
    const removed = [];
    for (const e of currentGraph.edges) {
        const inPlan = plannedModules.has(e.source) || plannedModules.has(e.target);
        if (!inPlan)
            continue;
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
