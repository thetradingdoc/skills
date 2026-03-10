import type { ArchGraph } from "../../../src/types.js";

export interface NodeFileMapping {
  nodeId: string;
  files: string[];
  /** Primary path (first file or node.path) — useful for single-file nodes */
  primaryPath?: string;
}

/**
 * Build a reusable mapping from arch graph node IDs to concrete repo file paths.
 * Uses node.files when present, falls back to node.path (single file), then node.id as module path.
 */
export function buildNodeFileMap(graph: ArchGraph): Map<string, NodeFileMapping> {
  const map = new Map<string, NodeFileMapping>();
  const nodes = graph.nodes ?? [];
  for (const n of nodes) {
    if (!n.id) continue;
    const rawFiles = (n as { files?: string[]; path?: string }).files;
    let files: string[];
    if (Array.isArray(rawFiles) && rawFiles.length > 0) {
      files = rawFiles;
    } else {
      const pathVal = (n as { path?: string }).path;
      files = pathVal ? [pathVal] : [n.id];
    }
    const primaryPath = files[0] ?? (n as { path?: string }).path ?? n.id;
    map.set(n.id, { nodeId: n.id, files, primaryPath });
  }
  return map;
}

/** Get concrete file paths for a node. Returns empty array if node unknown. */
export function getFilesForNode(nodeId: string, graph: ArchGraph): string[] {
  const map = buildNodeFileMap(graph);
  const entry = map.get(nodeId);
  return entry?.files ?? [];
}

/** Get primary path for a node (first file or path). Falls back to nodeId if unknown. */
export function getPrimaryPathForNode(nodeId: string, graph: ArchGraph): string {
  const map = buildNodeFileMap(graph);
  const entry = map.get(nodeId);
  return entry?.primaryPath ?? entry?.files?.[0] ?? nodeId;
}

/** Build full node→files mapping as a plain array for API responses. */
export function buildNodeFileMappingArray(graph: ArchGraph): NodeFileMapping[] {
  return Array.from(buildNodeFileMap(graph).values());
}

