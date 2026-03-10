/**
 * layerLayout.ts
 *
 * Forces nodes into horizontal bands by architectural layer.
 * Replaces depth-based layout with layer-priority layout.
 *
 * Layer order (top to bottom):
 *   Presentation → Business Logic → Data Access →
 *   Infrastructure → External Services → Utilities → Configuration → Uncategorized
 */

import type { ArchNode } from "../types";
import { NODE_W } from "../canvasConstants";

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

type NodeLayer =
  | "Presentation"
  | "Business Logic"
  | "Data Access"
  | "Infrastructure"
  | "External Services"
  | "Utilities"
  | "Configuration"
  | "Uncategorized";

const LAYER_RANK: Record<NodeLayer | string, number> = {
  Presentation: 0,
  "Business Logic": 1,
  "Data Access": 2,
  Infrastructure: 3,
  "External Services": 4,
  Utilities: 5,
  Configuration: 6,
  Uncategorized: 7,
};

const LAYER_Y_BAND = 220;
const NODE_X_SPACING = NODE_W + 80;
const CANVAS_PADDING = 80;

/**
 * Assign (x, y) positions to nodes based on their architectural layer.
 * Nodes in the same layer are distributed horizontally.
 * Layers flow top to bottom in dependency order.
 */
export function computeLayerLayout(
  nodes: ArchNode[],
  canvasWidth = 1200
): LayoutNode[] {
  const groups = new Map<number, ArchNode[]>();

  for (const node of nodes) {
    const rank = LAYER_RANK[node.layer ?? "Uncategorized"] ?? 7;
    if (!groups.has(rank)) groups.set(rank, []);
    groups.get(rank)!.push(node);
  }

  const result: LayoutNode[] = [];

  for (const [rank, groupNodes] of Array.from(groups.entries()).sort(
    ([a], [b]) => a - b
  )) {
    const y = CANVAS_PADDING + rank * LAYER_Y_BAND;
    const totalWidth = (groupNodes.length - 1) * NODE_X_SPACING;
    const startX = Math.max(CANVAS_PADDING, (canvasWidth - totalWidth) / 2);

    groupNodes.forEach((node, i) => {
      result.push({
        id: node.id,
        x: startX + i * NODE_X_SPACING,
        y,
      });
    });
  }

  return result;
}

/**
 * Within each layer, order nodes by number of connections (most connected first)
 * so the "busiest" modules appear near the center of their band.
 */
export function sortLayerByConnectivity(
  nodes: ArchNode[],
  edgeSourceIds: string[],
  edgeTargetIds: string[]
): ArchNode[] {
  const connectionCount = new Map<string, number>();
  for (const id of [...edgeSourceIds, ...edgeTargetIds]) {
    connectionCount.set(id, (connectionCount.get(id) ?? 0) + 1);
  }

  return [...nodes].sort(
    (a, b) => (connectionCount.get(b.id) ?? 0) - (connectionCount.get(a.id) ?? 0)
  );
}

export function getLayerBandLabel(rank: number): string {
  const labels: Record<number, string> = {
    0: "PRESENTATION",
    1: "BUSINESS LOGIC",
    2: "DATA ACCESS",
    3: "INFRASTRUCTURE",
    4: "EXTERNAL SERVICES",
    5: "UTILITIES",
    6: "CONFIGURATION",
    7: "UNCATEGORIZED",
  };
  return labels[rank] ?? "";
}

export function getLayerBandY(rank: number): { top: number; height: number } {
  return {
    top: CANVAS_PADDING + rank * LAYER_Y_BAND - LAYER_Y_BAND / 2,
    height: LAYER_Y_BAND,
  };
}
