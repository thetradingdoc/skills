/**
 * Layer layout for greenfield / proposed nodes.
 * Groups nodes by layer, places horizontally in bands (no depth/entry-point).
 * Self-contained: uses local LAYER_SEQUENCE so we don't depend on layerModel export shape.
 */

import { NODE_W } from "./canvasConstants";

const LAYER_SEQUENCE: string[] = [
  "Presentation",
  "Business Logic",
  "Data Access",
  "Infrastructure",
  "External Services",
  "Utilities",
  "Configuration",
  "Uncategorized",
];
const BAND_H = 220;

export interface ProposedNodeLike {
  id: string;
  label: string;
  layer?: string;
}

export interface LayerBand {
  id: string;
  layer: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayerLayoutResult {
  nodePositions: Map<string, { x: number; y: number }>;
  layerBands: LayerBand[];
}

export function computeLayerLayout(
  nodes: ProposedNodeLike[]
): LayerLayoutResult {
  if (nodes.length === 0) return { nodePositions: new Map(), layerBands: [] };

  const positions = new Map<string, { x: number; y: number }>();
  const layerBands: LayerBand[] = [];

  const layerGroups = new Map<string, ProposedNodeLike[]>();
  for (const n of nodes) {
    const l = (n.layer ?? "Uncategorized") as string;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(n);
  }

  const orderedLayers = LAYER_SEQUENCE.filter((l) => layerGroups.has(l));
  let bandY = 0;

  for (const layer of orderedLayers) {
    const layerNodes = layerGroups.get(layer)!;
    const ids = layerNodes.map((n) => n.id);
    const totalW = Math.max(ids.length * (NODE_W + 80), 600);
    const startX = -(totalW / 2);

    layerBands.push({
      id: `band:${layer}`,
      layer,
      x: -totalW / 2,
      y: bandY - 20,
      width: totalW + 120,
      height: BAND_H,
    });

    for (let i = 0; i < ids.length; i++) {
      const x = startX + i * (NODE_W + 80);
      positions.set(ids[i], { x, y: bandY });
    }

    bandY += BAND_H;
  }

  // Place nodes with unrecognized layers (e.g. "Auth", custom) at the bottom
  const placedLayers = new Set<string>(orderedLayers);
  for (const [layer, layerNodes] of layerGroups) {
    if (placedLayers.has(layer)) continue;
    const ids = layerNodes.map((n) => n.id);
    const totalW = Math.max(ids.length * (NODE_W + 80), 600);
    const startX = -(totalW / 2);
    layerBands.push({
      id: `band:${layer}`,
      layer,
      x: -totalW / 2,
      y: bandY - 20,
      width: totalW + 120,
      height: BAND_H,
    });
    for (let i = 0; i < ids.length; i++) {
      positions.set(ids[i], { x: startX + i * (NODE_W + 80), y: bandY });
    }
    bandY += BAND_H;
  }

  let minX = Infinity;
  let minY = Infinity;
  for (const p of positions.values()) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }
  for (const p of positions.values()) {
    p.x = p.x - minX + 80;
    p.y = p.y - minY + 80;
  }
  for (const band of layerBands) {
    band.x = band.x - minX + 80;
    band.y = band.y - minY + 80;
  }

  return { nodePositions: positions, layerBands };
}
