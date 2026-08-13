/**
 * Client-only join: AgentSurface.file → ArchNode.id for layer-completeness badges.
 * Does not mutate graph.agents / graph.nodes. Mirrors pathMatchesNode file/path
 * prefix rules (githubArchEvents) without importing the server module.
 */
import type { AgentInventoryResult, ArchGraph, ArchNode } from "./types";

export type LayerSummary = {
  /** Surfaces whose file maps onto this module node. */
  agentCount: number;
  /** Union of layer display names with status === "empty" across those agents. */
  missingLayerNames: string[];
};

function normalizePath(p: string): string {
  return p.trim().replace(/^\.\//, "").replace(/\\/g, "/").toLowerCase();
}

/**
 * True when agentFile belongs to this module node (files list or path/id prefix).
 * Same confidence order as pathMatchesNode for files + node.path; also treats
 * node.id as a directory prefix (module ids are folder paths).
 */
export function agentFileMatchesNode(agentFile: string, node: ArchNode): boolean {
  const cp = normalizePath(agentFile);
  if (!cp) return false;

  for (const f of node.files ?? []) {
    const nf = normalizePath(f);
    if (!nf) continue;
    if (cp === nf || cp.startsWith(nf + "/") || nf.startsWith(cp + "/")) return true;
  }

  const nodePath = normalizePath(node.path ?? "");
  if (nodePath && (cp === nodePath || cp.startsWith(nodePath + "/"))) return true;

  const nodeId = normalizePath(node.id ?? "");
  if (nodeId && nodeId !== "." && (cp === nodeId || cp.startsWith(nodeId + "/"))) return true;

  return false;
}

/**
 * Map nodeId → layer completeness for nodes that own at least one agent surface.
 * Nodes with no attached agents are omitted (no badge).
 */
export function buildAgentLayerSummaryByNodeId(
  graph: Pick<ArchGraph, "nodes" | "agents"> | null | undefined
): Map<string, LayerSummary> {
  const out = new Map<string, LayerSummary>();
  const agents = graph?.agents?.agents;
  const nodes = graph?.nodes;
  if (!agents?.length || !nodes?.length) return out;

  for (const node of nodes) {
    const attached: NonNullable<AgentInventoryResult["agents"]> = [];
    for (const a of agents) {
      if (!a?.file || typeof a.file !== "string") continue;
      if (agentFileMatchesNode(a.file, node)) attached.push(a);
    }
    if (attached.length === 0) continue;

    const missing = new Set<string>();
    for (const a of attached) {
      for (const layer of a.layers ?? []) {
        if (layer.status === "empty" && layer.name) missing.add(layer.name);
      }
    }

    out.set(node.id, {
      agentCount: attached.length,
      missingLayerNames: [...missing].sort((a, b) => a.localeCompare(b)),
    });
  }

  return out;
}
