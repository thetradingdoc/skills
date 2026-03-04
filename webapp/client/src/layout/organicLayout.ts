import type { ArchGraph } from "../types";

const LAYER_ORDER = [
  "Presentation",
  "Business Logic",
  "Data Access",
  "External Services",
  "Infrastructure",
  "Utilities",
  "Configuration",
  "Uncategorized",
];

const LAYER_Y: Record<string, number> = {
  Presentation: 0,
  "Business Logic": 220,
  "Data Access": 440,
  "External Services": 300,
  Infrastructure: 550,
  Utilities: 500,
  Configuration: 600,
  Uncategorized: 350,
};

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function relaxPositions(
  positions: Map<string, { x: number; y: number }>,
  iterations = 60
): void {
  const ids = Array.from(positions.keys());
  const minDist = 200;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = positions.get(ids[i])!;
        const b = positions.get(ids[j])!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < minDist) {
          const force = ((minDist - dist) / dist) * 0.4;
          const mx = dx * force;
          const my = dy * force;
          a.x -= mx;
          a.y -= my;
          b.x += mx;
          b.y += my;
        }
      }
    }
  }
}

export interface LayoutResult {
  nodePositions: Map<string, { x: number; y: number }>;
}

export function computeLayout(graph: ArchGraph): LayoutResult {
  const rand = seededRandom(42);
  const nodePositions = new Map<string, { x: number; y: number }>();

  const layerGroups = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const layer = node.layer ?? "Uncategorized";
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer)!.push(node.id);
  }

  for (const [layer, ids] of layerGroups) {
    const baseY = LAYER_Y[layer] ?? 300;
    const count = ids.length;
    const totalWidth = Math.max(count * 220, 400);
    const startX = -(totalWidth / 2) + 100;

    for (let i = 0; i < ids.length; i++) {
      const baseX = startX + i * 220;
      const jitterX = (rand() - 0.5) * 120;
      const jitterY = (rand() - 0.5) * 80;
      nodePositions.set(ids[i], {
        x: baseX + jitterX,
        y: baseY + jitterY,
      });
    }
  }

  for (const edge of graph.edges) {
    const src = nodePositions.get(edge.source);
    const tgt = nodePositions.get(edge.target);
    if (!src || !tgt) continue;
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const strength = 0.05;
    src.x += dx * strength;
    tgt.x -= dx * strength;
  }

  relaxPositions(nodePositions);

  let minX = Infinity;
  let minY = Infinity;
  for (const pos of nodePositions.values()) {
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
  }
  for (const pos of nodePositions.values()) {
    pos.x = pos.x - minX + 80;
    pos.y = pos.y - minY + 80;
  }

  return { nodePositions };
}
