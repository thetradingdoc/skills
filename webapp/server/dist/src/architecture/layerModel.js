"use strict";
/**
 * ArchiMate-style layer model for solution architecture.
 * Top (index 0) = user-facing, Bottom = infrastructure.
 * Dependencies should flow downward: higher layers may depend on lower layers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LAYER_ORDER = void 0;
exports.isLayerViolation = isLayerViolation;
exports.getLayerViolationReason = getLayerViolationReason;
/**
 * Canonical layer order: top (Presentation) → bottom (Infrastructure).
 * Includes AI-oriented layers (Orchestration, Reasoning, Memory, Safety).
 */
exports.LAYER_ORDER = [
    "Presentation",
    "Orchestration",
    "Reasoning",
    "Business Logic",
    "Memory",
    "Data Access",
    "Safety",
    "External Services",
    "Infrastructure",
    "Utilities",
    "Configuration",
    "Uncategorized",
];
/** Layers that may be used by any other layer (cross-cutting concerns) */
const CROSS_CUTTING = new Set([
    "Utilities",
    "Configuration",
]);
/** Index of each layer (0 = top, higher = lower in architecture) */
const LAYER_INDEX = new Map(exports.LAYER_ORDER.map((l, i) => [l, i]));
function getIndex(layer) {
    return LAYER_INDEX.get(layer) ?? exports.LAYER_ORDER.length;
}
/**
 * Check if source → target is a conformant dependency.
 * Violation: source is below target (sourceIndex > targetIndex).
 * Cross-cutting targets (Utilities, Configuration) are always allowed.
 */
function isLayerViolation(sourceLayer, targetLayer) {
    const src = sourceLayer;
    const tgt = targetLayer;
    if (CROSS_CUTTING.has(tgt))
        return false;
    if (CROSS_CUTTING.has(src))
        return false;
    if (src === tgt)
        return false;
    const srcIdx = getIndex(sourceLayer);
    const tgtIdx = getIndex(targetLayer);
    return srcIdx > tgtIdx;
}
function getLayerViolationReason(sourceLayer, targetLayer) {
    const src = sourceLayer;
    const tgt = targetLayer;
    if (CROSS_CUTTING.has(tgt) || CROSS_CUTTING.has(src))
        return "cross_cutting";
    if (src === tgt)
        return "same_layer";
    const srcIdx = getIndex(sourceLayer);
    const tgtIdx = getIndex(targetLayer);
    if (srcIdx > tgtIdx)
        return "higher_layer_imports_lower";
    return "conformant";
}
