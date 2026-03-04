/**
 * ArchiMate-style layer model for solution architecture.
 * Top (index 0) = user-facing, Bottom = infrastructure.
 * Dependencies should flow downward: higher layers may depend on lower layers.
 */

import type { NodeLayer } from "../types";

/** Canonical layer order: top (Presentation) → bottom (Infrastructure). Includes AI-oriented layers. */
export const LAYER_ORDER: NodeLayer[] = [
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
const CROSS_CUTTING: Set<NodeLayer> = new Set([
  "Utilities",
  "Configuration",
]);

/** Index of each layer (0 = top, higher = lower in architecture) */
const LAYER_INDEX = new Map<string, number>(
  LAYER_ORDER.map((l, i) => [l, i])
);

function getIndex(layer: string): number {
  return LAYER_INDEX.get(layer) ?? LAYER_ORDER.length;
}

/**
 * Check if source → target is a conformant dependency.
 * Violation: source is below target (sourceIndex > targetIndex).
 * Cross-cutting targets (Utilities, Configuration) are always allowed.
 */
export function isLayerViolation(
  sourceLayer: string,
  targetLayer: string
): boolean {
  const src = sourceLayer as NodeLayer;
  const tgt = targetLayer as NodeLayer;

  if (CROSS_CUTTING.has(tgt)) return false;
  if (CROSS_CUTTING.has(src)) return false;
  if (src === tgt) return false;

  const srcIdx = getIndex(sourceLayer);
  const tgtIdx = getIndex(targetLayer);

  return srcIdx > tgtIdx;
}
