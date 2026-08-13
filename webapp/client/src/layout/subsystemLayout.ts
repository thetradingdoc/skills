/**
 * Subsystem layout: pack ArchNodes into quant cockpit regions
 * (ingress / strategy / risk_execution / data_obs / unclassified).
 */
import type { ArchGraph, ArchNode, NodeSubsystem } from "../types";
import {
  SUBSYSTEM_LABELS,
  SUBSYSTEM_ORDER,
  classifySubsystem,
  summarizeSubsystemReadiness,
} from "../subsystemClassify";
import { NODE_W } from "./canvasConstants";

export interface SubsystemRegion {
  id: string;
  subsystem: NodeSubsystem;
  label: string;
  readiness: string;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeCount: number;
}

export interface SubsystemLayoutResult {
  nodePositions: Map<string, { x: number; y: number }>;
  subsystemRegions: SubsystemRegion[];
}

export interface SubsystemLayoutOptions {
  /** Card width used for packing + fit (light theme uses NODE_W_LIGHT). */
  nodeW?: number;
  /** Card height budget for packing + fit. */
  nodeH?: number;
}

const DEFAULT_NODE_H = 100;
const PAD = 48;
const HEADER_H = 44;
const COL_GAP = 28;
const ROW_GAP = 24;
const REGION_GAP = 40;
const COLS = 3;
const MIN_REGION_W = 320;

function ensureSubsystem(n: ArchNode): NodeSubsystem {
  return n.subsystem ?? classifySubsystem(n).subsystem;
}

/**
 * Pack nodes into stacked subsystem regions. Positions are relative to region
 * geometry so members start inside their box.
 */
export function computeSubsystemLayout(
  graph: ArchGraph,
  opts: SubsystemLayoutOptions = {}
): SubsystemLayoutResult {
  const nodeW = opts.nodeW ?? NODE_W;
  const nodeH = opts.nodeH ?? DEFAULT_NODE_H;
  const positions = new Map<string, { x: number; y: number }>();
  const bySub = new Map<NodeSubsystem, ArchNode[]>();
  for (const s of SUBSYSTEM_ORDER) bySub.set(s, []);

  for (const n of graph.nodes) {
    const s = ensureSubsystem(n);
    if (!bySub.has(s)) bySub.set(s, []);
    bySub.get(s)!.push(n);
  }

  // Only show regions that have nodes (always include unclassified if non-empty).
  const active = SUBSYSTEM_ORDER.filter((s) => (bySub.get(s)?.length ?? 0) > 0);

  const regions: SubsystemRegion[] = [];
  let cursorY = 40;

  for (const subsystem of active) {
    const nodes = bySub.get(subsystem) ?? [];
    const cols = Math.min(COLS, Math.max(1, nodes.length));
    const rows = Math.ceil(nodes.length / cols);
    const innerW = cols * nodeW + (cols - 1) * COL_GAP;
    const innerH = rows * nodeH + Math.max(0, rows - 1) * ROW_GAP;
    const width = Math.max(innerW + PAD * 2, MIN_REGION_W);
    const height = HEADER_H + innerH + PAD;
    const x0 = 40;
    const y0 = cursorY;

    nodes.forEach((n, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.set(n.id, {
        x: x0 + PAD + col * (nodeW + COL_GAP),
        y: y0 + HEADER_H + PAD / 2 + row * (nodeH + ROW_GAP),
      });
    });

    regions.push({
      id: `subsystem:${subsystem}`,
      subsystem,
      label: SUBSYSTEM_LABELS[subsystem],
      readiness: summarizeSubsystemReadiness(subsystem),
      x: x0,
      y: y0,
      width,
      height,
      nodeCount: nodes.length,
    });

    cursorY += height + REGION_GAP;
  }

  return { nodePositions: positions, subsystemRegions: regions };
}

/**
 * Expand/move each region so every member node (by subsystem) is fully inside
 * the box. Use after any canvas-wide transform (widen, overrides, lane shift).
 */
export function fitSubsystemRegionsToNodes(
  regions: SubsystemRegion[],
  nodes: Array<Pick<ArchNode, "id" | "subsystem"> & { subsystem?: NodeSubsystem }>,
  positions: Map<string, { x: number; y: number }>,
  opts: SubsystemLayoutOptions = {}
): SubsystemRegion[] {
  const nodeW = opts.nodeW ?? NODE_W;
  const nodeH = opts.nodeH ?? DEFAULT_NODE_H;
  const pad = PAD;

  const bySub = new Map<NodeSubsystem, string[]>();
  for (const n of nodes) {
    const s = n.subsystem ?? "unclassified";
    if (!bySub.has(s)) bySub.set(s, []);
    bySub.get(s)!.push(n.id);
  }

  return regions.map((region) => {
    const ids = bySub.get(region.subsystem) ?? [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let counted = 0;
    for (const id of ids) {
      const pos = positions.get(id);
      if (!pos) continue;
      counted += 1;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + nodeW);
      maxY = Math.max(maxY, pos.y + nodeH);
    }
    if (counted === 0) {
      return { ...region, nodeCount: 0 };
    }

    const x = Math.min(region.x, minX - pad);
    const y = Math.min(region.y, minY - HEADER_H - pad / 2);
    const right = Math.max(region.x + region.width, maxX + pad);
    const bottom = Math.max(region.y + region.height, maxY + pad);
    return {
      ...region,
      x,
      y,
      width: Math.max(right - x, MIN_REGION_W),
      height: Math.max(bottom - y, HEADER_H + nodeH + pad),
      nodeCount: counted,
    };
  });
}

/** True when every member node's card bbox is inside its region. */
export function subsystemRegionsContainNodes(
  regions: SubsystemRegion[],
  nodes: Array<Pick<ArchNode, "id" | "subsystem"> & { subsystem?: NodeSubsystem }>,
  positions: Map<string, { x: number; y: number }>,
  opts: SubsystemLayoutOptions = {}
): boolean {
  const nodeW = opts.nodeW ?? NODE_W;
  const nodeH = opts.nodeH ?? DEFAULT_NODE_H;
  const bySub = new Map(regions.map((r) => [r.subsystem, r]));
  for (const n of nodes) {
    const s = n.subsystem ?? "unclassified";
    const region = bySub.get(s);
    const pos = positions.get(n.id);
    if (!region || !pos) continue;
    if (pos.x < region.x || pos.y < region.y) return false;
    if (pos.x + nodeW > region.x + region.width) return false;
    if (pos.y + nodeH > region.y + region.height) return false;
  }
  return true;
}
