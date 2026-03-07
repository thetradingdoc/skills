"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPlannerContext = loadPlannerContext;
const manager_1 = require("./rail/manager");
const nodeHistory_1 = require("./nodeHistory");
function summarizeNodeHistory(store) {
    return Object.values(store.nodes).map((n) => ({
        nodeId: n.nodeId,
        successCount: n.successCount,
        failureCount: n.failureCount,
        lastSuccessAt: n.lastSuccessAt,
        lastFailureAt: n.lastFailureAt,
    }));
}
function loadPlannerContext(rootPath, archetype) {
    const anti = (0, manager_1.loadAntiPatterns)(rootPath, archetype);
    const history = (0, nodeHistory_1.loadNodeHistory)(rootPath);
    const antiPatterns = anti.map((p) => `Avoid: ${p.reason} (from outcome "${p.outcome}")`);
    return {
        antiPatterns,
        nodeHistory: summarizeNodeHistory(history),
        violations: [],
        skillHints: [],
        gates: [],
    };
}
