import { layerIndexToY } from "./layerElevation";

export const LAYOUT_SCALE = 0.004;
export const Y_SCALE = 1.6;

export function layerToY3D(layer: string): number {
  return layerIndexToY(layer) * Y_SCALE;
}

/**
 * Maps 2D layout positions to 3D coordinates for R3F.
 */
export function layoutTo3D(
  nodePositions: Map<string, { x: number; y: number }>,
  nodes: Array<{ id: string; layer?: string }>
): Map<string, { x: number; y: number; z: number }> {
  const out = new Map<string, { x: number; y: number; z: number }>();
  for (const node of nodes) {
    const pos = nodePositions.get(node.id) ?? { x: 0, y: 0 };
    const layer = (node.layer ?? "Uncategorized") as string;
    out.set(node.id, {
      x: pos.x * LAYOUT_SCALE,
      y: layerToY3D(layer),
      z: pos.y * LAYOUT_SCALE,
    });
  }
  return out;
}
