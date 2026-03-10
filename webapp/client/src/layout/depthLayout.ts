import type { ArchGraph, ArchNode } from "../types";
import { LAYER_ORDER } from "../architecture/layerModel";
import { NODE_W } from "./canvasConstants";

export interface LayerBand {
  id: string;
  layer: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DepthLayoutResult {
  nodePositions: Map<string, { x: number; y: number }>;
  layerBands: LayerBand[];
}

export function computeDepthLayout(graph: ArchGraph): DepthLayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  const layerBands: LayerBand[] = [];

  const layerGroups = new Map<string, ArchNode[]>();
  for (const n of graph.nodes) {
    const l = (n.layer ?? "Uncategorized") as string;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(n);
  }

  const orderedLayers = LAYER_ORDER.filter((l) => layerGroups.has(l));
  const BAND_H = 220;
  const BAND_PAD_X = 60;

  let bandY = 0;
  for (const layer of orderedLayers) {
    const nodes = layerGroups.get(layer)!;
    const sorted = [...nodes].sort(
      (a, b) => (a.depth ?? 999) - (b.depth ?? 999)
    );
    const ids = sorted.map((n) => n.id);

    const totalW = Math.max(ids.length * (NODE_W + 80), 600);
    const startX = -(totalW / 2) + BAND_PAD_X;

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
