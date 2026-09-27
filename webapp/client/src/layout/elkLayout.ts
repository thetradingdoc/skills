/**
 * ELK-based layout for architecture graphs.
 * Uses elkjs for automatic node arrangement with hierarchy awareness.
 * Namespace import handles CJS/UMD module that lacks ESM default export in Vite dev.
 */

import * as ELKModule from "elkjs/lib/elk-api.js";
const ELK = (ELKModule as { default?: typeof ELKModule }).default ?? ELKModule;
import type { ArchGraph } from "../types";
import { NODE_W } from "./canvasConstants";
import type { LayerBand } from "./depthLayout";

const elk = new ELK({
  workerFactory: () => new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url)),
  defaultLayoutOptions: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.layered.spacing.nodeNodeBetween": "40",
    "elk.spacing.nodeNode": "60",
  },
});

export interface ElkLayoutResult {
  nodePositions: Map<string, { x: number; y: number }>;
  layerBands: LayerBand[];
}

export async function computeElkLayout(graph: ArchGraph): Promise<ElkLayoutResult> {
  const positions = new Map<string, { x: number; y: number }>();
  const layerBands: LayerBand[] = [];

  const nodes = graph.nodes.map((n) => ({
    id: n.id,
    width: NODE_W,
    height: 80,
  }));

  const edges = graph.edges
    .filter((e) => graph.nodes.some((n) => n.id === e.source) && graph.nodes.some((n) => n.id === e.target))
    .map((e, i) => ({
      id: `e${i}`,
      sources: [e.source],
      targets: [e.target],
    }));

  const graphElk = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetween": "40",
      "elk.spacing.nodeNode": "60",
    },
    children: nodes,
    edges,
  };

  try {
    const result = await elk.layout(graphElk);
    if (!result.children) {
      return { nodePositions: positions, layerBands };
    }
    for (const child of result.children) {
      if (child.id && child.x != null && child.y != null) {
        positions.set(child.id, { x: child.x, y: child.y });
      }
    }
  } catch (err) {
    console.warn("[elkLayout] ELK failed, falling back to empty:", err);
  }

  return { nodePositions: positions, layerBands };
}
