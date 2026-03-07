"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RAIL_ARCHETYPES = void 0;
exports.inferLogicPath = inferLogicPath;
exports.computeHallucinationIndex = computeHallucinationIndex;
exports.RAIL_ARCHETYPES = {
    "ui-api-external": { layers: ["UI", "API", "External"] },
    "ui-api-persistence": { layers: ["UI", "API", "Infrastructure"] },
    "governance-violation": { layers: ["Service", "Infrastructure"] },
};
function inferLogicPath(outcome, archGraph, archetype, seedNodeIds) {
    const steps = [];
    const now = Date.now();
    // Very simple first pass: if seeds provided, just map them into steps in order.
    const seeds = seedNodeIds && seedNodeIds.length > 0
        ? seedNodeIds
        : archGraph.nodes
            .filter((n) => outcome.toLowerCase().includes((n.label ?? n.id).toLowerCase()))
            .slice(0, 3)
            .map((n) => n.id);
    const layers = exports.RAIL_ARCHETYPES[archetype].layers;
    seeds.forEach((nodeId, idx) => {
        const node = archGraph.nodes.find((n) => n.id === nodeId);
        const layer = node?.layer && layers.includes(node.layer) ? node.layer : layers[Math.min(idx, layers.length - 1)];
        steps.push({
            step: idx + 1,
            layer,
            nodeId,
            filePath: node?.path ?? "",
            action: "touch",
        });
    });
    // Fallback: if no seeds found, create a single external step.
    if (steps.length === 0) {
        steps.push({
            step: 1,
            layer: "External",
            nodeId: `external-${now}`,
            filePath: "",
            action: "unknown",
        });
    }
    return steps;
}
function computeHallucinationIndex(intendedPath, actuallyTouchedNodeIds) {
    if (intendedPath.length === 0)
        return 0;
    const intendedIds = new Set(intendedPath.map((s) => s.nodeId));
    const touchedSet = new Set(actuallyTouchedNodeIds);
    let matched = 0;
    for (const id of touchedSet) {
        if (intendedIds.has(id))
            matched += 1;
    }
    const coverage = matched / intendedIds.size;
    const extra = Array.from(touchedSet).filter((id) => !intendedIds.has(id)).length;
    const driftPenalty = extra > 0 ? Math.min(1, extra / (intendedIds.size + extra)) : 0;
    // Higher index means more drift: invert coverage and add penalty, clamp to [0,1].
    const index = Math.max(0, Math.min(1, 1 - coverage + driftPenalty));
    return index;
}
