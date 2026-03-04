"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyseGraph = analyseGraph;
exports.filterEdges = filterEdges;
const layerModel_1 = require("../architecture/layerModel");
const UTILITY_LAYERS = new Set([
    "Utilities",
    "Configuration",
]);
function detectEntryPoints(graph) {
    const hasInbound = new Set();
    const hasOutbound = new Set();
    for (const edge of graph.edges) {
        hasInbound.add(edge.target);
        hasOutbound.add(edge.source);
    }
    const entryPoints = new Set();
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
        if (candidate)
            entryPoints.add(candidate);
    }
    return entryPoints;
}
function computeDepths(graph, entryPoints) {
    const depths = new Map();
    const queue = [];
    for (const id of entryPoints) {
        depths.set(id, 0);
        queue.push({ id, depth: 0 });
    }
    const adj = new Map();
    for (const edge of graph.edges) {
        if (!adj.has(edge.source))
            adj.set(edge.source, []);
        adj.get(edge.source).push(edge.target);
    }
    while (queue.length > 0) {
        const { id, depth } = queue.shift();
        for (const neighbour of adj.get(id) ?? []) {
            if (!depths.has(neighbour)) {
                depths.set(neighbour, depth + 1);
                queue.push({ id: neighbour, depth: depth + 1 });
            }
        }
    }
    const maxDepth = Math.max(0, ...Array.from(depths.values()));
    for (const node of graph.nodes) {
        if (!depths.has(node.id))
            depths.set(node.id, maxDepth + 1);
    }
    return depths;
}
function classifyEdge(edge, nodeById) {
    const src = nodeById.get(edge.source);
    const tgt = nodeById.get(edge.target);
    if (!src || !tgt)
        return "utility";
    const srcLayer = (src.layer ?? "Uncategorized");
    const tgtLayer = (tgt.layer ?? "Uncategorized");
    if (UTILITY_LAYERS.has(tgtLayer))
        return "utility";
    if (UTILITY_LAYERS.has(srcLayer))
        return "utility";
    if (srcLayer === tgtLayer)
        return "utility";
    return "architectural";
}
function analyseGraph(graph) {
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const entryPoints = detectEntryPoints(graph);
    const depths = computeDepths(graph, entryPoints);
    const enrichedEdges = graph.edges.map((edge) => {
        const importance = classifyEdge(edge, nodeById);
        const src = nodeById.get(edge.source);
        const tgt = nodeById.get(edge.target);
        const srcLayer = (src?.layer ?? "Uncategorized");
        const tgtLayer = (tgt?.layer ?? "Uncategorized");
        const layerViolation = (0, layerModel_1.isLayerViolation)(srcLayer, tgtLayer);
        return {
            ...edge,
            importance,
            isLayerViolation: layerViolation,
        };
    });
    const enrichedNodes = graph.nodes.map((node) => ({
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
function filterEdges(graph, filter) {
    if (filter === "all")
        return graph;
    const filtered = graph.edges.filter((edge) => {
        if (filter === "drift")
            return edge.isDrift;
        if (filter === "violations")
            return edge.isLayerViolation;
        if (filter === "architectural")
            return (edge.importance === "architectural" ||
                edge.isDrift ||
                edge.isLayerViolation);
        return true;
    });
    return { ...graph, edges: filtered };
}
