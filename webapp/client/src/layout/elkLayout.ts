import ELK from "elkjs/lib/elk.bundled.js";
import type { ArchGraph } from "../types";

const elk = new ELK();

const elkOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.spacing.nodeNode": "80",
  "elk.layered.spacing.nodeNodeBetweenLayers": "100",
};

export interface LayoutResult {
  nodePositions: Map<string, { x: number; y: number }>;
  parentIds: Map<string, string>;
  parentLayout: Map<string, { x: number; y: number; width: number; height: number }>;
}

function collectPositions(
  node: { id?: string; x?: number; y?: number; width?: number; height?: number; children?: Array<{ id?: string; x?: number; y?: number; children?: unknown[] }> },
  acc: Map<string, { x: number; y: number }>,
  parentLayout: Map<string, { x: number; y: number; width: number; height: number }>,
  parentX: number,
  parentY: number
): void {
  const absX = (node.x ?? 0) + parentX;
  const absY = (node.y ?? 0) + parentY;
  if (node.id?.startsWith("layer:")) {
    parentLayout.set(node.id, {
      x: absX,
      y: absY,
      width: node.width ?? 400,
      height: node.height ?? 200,
    });
    for (const child of node.children ?? []) {
      collectPositions(child, acc, parentLayout, absX, absY);
    }
  } else if (node.id !== undefined && node.id !== null) {
    acc.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
  }
}

export async function computeLayout(graph: ArchGraph): Promise<LayoutResult> {
  const layerMap = new Map<string, string[]>();
  const uncategorized = "Uncategorized";

  for (const node of graph.nodes) {
    const layer = node.layer || uncategorized;
    if (!layerMap.has(layer)) {
      layerMap.set(layer, []);
    }
    layerMap.get(layer)!.push(node.id);
  }

  const nodeWidth = 170;
  const nodeHeight = 80;

  const layerChildren = Array.from(layerMap.entries()).map(
    ([layer, childIds]) => {
      const children = childIds.map((id) => ({
        id,
        width: nodeWidth,
        height: nodeHeight,
      }));
      return {
        id: `layer:${layer}`,
        width: 200,
        height: 120,
        layoutOptions: { "elk.padding": "[top=20,left=20,bottom=20,right=20]" },
        children,
      };
    }
  );

  const parentIds = new Map<string, string>();
  for (const [layer, ids] of layerMap) {
    for (const id of ids) {
      parentIds.set(id, `layer:${layer}`);
    }
  }

  const edges = graph.edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  const elkGraph = {
    id: "root",
    layoutOptions: elkOptions,
    children: layerChildren,
    edges,
  };

  const layout = await elk.layout(elkGraph);
  const nodePositions = new Map<string, { x: number; y: number }>();
  const parentLayout = new Map<string, { x: number; y: number; width: number; height: number }>();

  for (const child of layout.children ?? []) {
    collectPositions(child, nodePositions, parentLayout, 0, 0);
  }

  return { nodePositions, parentIds, parentLayout };
}
