/**
 * Components apply — bind vendors onto a selected module, or place structural nodes.
 * Shared by click and drag/drop. Design graphs only at the App layer.
 */
import type { ArchGraph, ArchNode } from "./types";
import {
  getBuildItem,
  type BuildItem,
  resolveApplyMode,
} from "./blanko/buildCatalog";
import { buildItemToNode, paletteItemToNode } from "./greenfieldDesign";
import { setNodeProviderBinding } from "./platformInventory";

/** Offset when placing a structural item dropped on top of an existing node. */
export const PLACE_ON_NODE_OFFSET = 32;

export type ApplyComponentOpts = {
  position?: { x: number; y: number };
  /** Click-selection bind target (used when hitNodeId is absent). */
  selectedNodeId?: string | null;
  /**
   * Node under the pointer at drop time (live hit-test). Takes priority over
   * selectedNodeId for bind mode.
   */
  hitNodeId?: string | null;
};

export type ApplyComponentOk = {
  graph: ArchGraph;
  mode: "bind" | "place";
  focusNodeId?: string;
};

export type ApplyComponentResult = ApplyComponentOk | { error: string };

/** True when id is a real module in graph.nodes (not band/region/stale). */
export function resolveBindTarget(
  graph: ArchGraph,
  selectedNodeId: string | null | undefined
): ArchNode | null {
  if (!selectedNodeId || typeof selectedNodeId !== "string") return null;
  if (
    selectedNodeId.startsWith("band:") ||
    selectedNodeId.startsWith("subsystem:") ||
    selectedNodeId.startsWith("domain:") ||
    selectedNodeId.startsWith("n8n-group:")
  ) {
    return null;
  }
  return graph.nodes.find((n) => n.id === selectedNodeId) ?? null;
}

function placeNode(
  graph: ArchGraph,
  item: BuildItem,
  paletteId: string,
  position?: { x: number; y: number }
): ArchNode {
  const dropIndex = graph.nodes.length;
  return buildItemToNode(
    {
      ...item,
      providerId:
        item.providerId ?? (paletteId === "retell-channel" ? "retell" : undefined),
    },
    dropIndex,
    position
  );
}

/**
 * Apply a Components palette id to the graph.
 * - bind: update target node's platformBindings / llmProvider / cloudProvider
 * - place: append a new design node (no auto-edge)
 */
export function applyComponentToGraph(
  graph: ArchGraph,
  paletteId: string,
  opts: ApplyComponentOpts = {}
): ApplyComponentResult {
  const item = getBuildItem(paletteId);
  if (!item) {
    const legacy = paletteItemToNode(paletteId, graph.nodes.length, opts.position);
    if (!legacy) {
      return { error: `Unknown component “${paletteId}”` };
    }
    return {
      graph: {
        ...graph,
        nodes: [...graph.nodes, legacy],
        generatedAt: Date.now(),
      },
      mode: "place",
      focusNodeId: legacy.id,
    };
  }

  const mode = resolveApplyMode(item);

  if (mode === "bind") {
    // Drop-on-node wins over click selection.
    const target =
      resolveBindTarget(graph, opts.hitNodeId) ??
      resolveBindTarget(graph, opts.selectedNodeId);
    if (!target) {
      return { error: "Select a module to bind this provider" };
    }
    const providerId =
      item.providerId ?? (paletteId === "retell-channel" ? "retell" : undefined);
    if (!providerId) {
      return { error: "Select a module to bind this provider" };
    }
    const updated = setNodeProviderBinding(target, providerId, {
      status: "unbound",
      evidence: `components:${paletteId}`,
      role: "primary",
    });
    return {
      graph: {
        ...graph,
        nodes: graph.nodes.map((n) => (n.id === target.id ? updated : n)),
        generatedAt: Date.now(),
      },
      mode: "bind",
      focusNodeId: target.id,
    };
  }

  let position = opts.position;
  // Structural drop on an existing node: place adjacent, do not merge/bind.
  if (position && opts.hitNodeId && resolveBindTarget(graph, opts.hitNodeId)) {
    position = {
      x: position.x + PLACE_ON_NODE_OFFSET,
      y: position.y + PLACE_ON_NODE_OFFSET,
    };
  }

  const node = placeNode(graph, item, paletteId, position);
  return {
    graph: {
      ...graph,
      nodes: [...graph.nodes, node],
      generatedAt: Date.now(),
    },
    mode: "place",
    focusNodeId: node.id,
  };
}
