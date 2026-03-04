/**
 * ModuleSignals — AGENT_ROADMAP v4 §7
 * Structural signal extraction from ArchGraph.
 */

import type { ArchGraph, ArchNode, ArchEdge } from "../types";

export interface ModuleSignals {
  moduleId: string;
  filePaths: string[];
  fanIn: number;
  fanOut: number;
  externalImportCount: number;
  exportCount: number;
  fileCount: number;
  hasTests: boolean;
  hasContextMd: boolean;
  circularDependencies: string[][];
  health: "green" | "amber" | "red";
  healthReasons: string[];
}

const FAN_IN_WARN = 8;
const FAN_IN_BAD = 15;
const FAN_OUT_WARN = 6;
const FAN_OUT_BAD = 10;
const FAN_BOTH_BAD = 5;
const EXPORT_WARN = 15;
const EXPORT_BAD = 25;
const FILE_WARN = 8;
const FILE_BAD = 15;
const EXTERNAL_WARN = 5;
const EXTERNAL_BAD = 10;
const DUMP_PATTERNS = ["utils", "helpers", "common", "shared", "misc"];

function detectCycles(edges: ArchEdge[], nodes: ArchNode[]): string[][] {
  const cycles: string[][] = [];
  const idToIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const n = nodes.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    const a = idToIndex.get(e.source);
    const b = idToIndex.get(e.target);
    if (a != null && b != null) adj[a].push(b);
  }
  const visited = new Uint8Array(n);
  const rec = new Uint8Array(n);
  const path: number[] = [];
  const pathSet = new Set<number>();

  function dfs(u: number): boolean {
    visited[u] = 1;
    rec[u] = 1;
    path.push(u);
    pathSet.add(u);
    for (const v of adj[u]) {
      if (!visited[v]) {
        if (dfs(v)) return true;
      } else if (rec[v]) {
        const idx = path.indexOf(v);
        cycles.push(path.slice(idx).map((i) => nodes[i].id));
        return true;
      }
    }
    path.pop();
    pathSet.delete(u);
    rec[u] = 0;
    return false;
  }
  for (let i = 0; i < n; i++) {
    if (!visited[i]) dfs(i);
  }
  return cycles;
}

export function computeModuleSignals(graph: ArchGraph): ModuleSignals[] {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  const externalImports = new Map<string, Set<string>>();

  for (const n of graph.nodes) {
    fanIn.set(n.id, 0);
    fanOut.set(n.id, 0);
    externalImports.set(n.id, new Set());
  }

  for (const e of graph.edges) {
    fanIn.set(e.target, (fanIn.get(e.target) ?? 0) + 1);
    fanOut.set(e.source, (fanOut.get(e.source) ?? 0) + 1);
  }

  for (const n of graph.nodes) {
    const ext = (n.semanticSignals?.externalImports ?? []) as string[];
    externalImports.set(n.id, new Set(ext));
  }

  const cycles = detectCycles(graph.edges, graph.nodes);
  const cycleSet = new Set(cycles.flat());

  const result: ModuleSignals[] = [];

  for (const node of graph.nodes) {
    const fi = fanIn.get(node.id) ?? 0;
    const fo = fanOut.get(node.id) ?? 0;
    const extCount = externalImports.get(node.id)?.size ?? 0;
    const expCount = (node.semanticSignals?.exports ?? []).length;
    const fileCount = node.files?.length ?? 1;
    const hasTests = node.health?.hasTests ?? false;
    const hasContext = node.health?.hasContext ?? false;
    const inCycle = cycleSet.has(node.id);
    const dumpGround =
      expCount > EXPORT_WARN &&
      DUMP_PATTERNS.some((p) => node.id.toLowerCase().includes(p));

    const reasons: string[] = [];
    let health: "green" | "amber" | "red" = "green";

    if (inCycle) {
      health = "red";
      reasons.push("Circular dependency");
    }
    if (fi > FAN_BOTH_BAD && fo > FAN_BOTH_BAD) {
      health = "red";
      reasons.push(`Fan-in (${fi}) and fan-out (${fo}) both exceed ${FAN_BOTH_BAD}`);
    }
    if (dumpGround) {
      health = "red";
      reasons.push("Dumping ground (high exports + utils/helpers/common)");
    }
    if (fi > FAN_IN_BAD || fo > FAN_OUT_BAD || expCount > EXPORT_BAD || fileCount > FILE_BAD || extCount > EXTERNAL_BAD) {
      if (health !== "red") health = "red";
      if (fi > FAN_IN_BAD) reasons.push(`Fan-in ${fi} > ${FAN_IN_BAD}`);
      if (fo > FAN_OUT_BAD) reasons.push(`Fan-out ${fo} > ${FAN_OUT_BAD}`);
      if (expCount > EXPORT_BAD) reasons.push(`Export count ${expCount} > ${EXPORT_BAD}`);
      if (fileCount > FILE_BAD) reasons.push(`File count ${fileCount} > ${FILE_BAD}`);
      if (extCount > EXTERNAL_BAD) reasons.push(`External imports ${extCount} > ${EXTERNAL_BAD}`);
    }
    if (health === "green" && (fi > FAN_IN_WARN || fo > FAN_OUT_WARN || expCount > EXPORT_WARN || fileCount > FILE_WARN || extCount > EXTERNAL_WARN || !hasTests || !hasContext)) {
      health = "amber";
      if (fi > FAN_IN_WARN) reasons.push(`Fan-in ${fi} > ${FAN_IN_WARN}`);
      if (fo > FAN_OUT_WARN) reasons.push(`Fan-out ${fo} > ${FAN_OUT_WARN}`);
      if (expCount > EXPORT_WARN) reasons.push(`Export count ${expCount} > ${EXPORT_WARN}`);
      if (fileCount > FILE_WARN) reasons.push(`File count ${fileCount} > ${FILE_WARN}`);
      if (extCount > EXTERNAL_WARN) reasons.push(`External imports ${extCount} > ${EXTERNAL_WARN}`);
      if (!hasTests) reasons.push("Missing tests");
      if (!hasContext) reasons.push("Missing .context.md");
    }

    const nodeCycles = cycles.filter((c) => c.includes(node.id));

    result.push({
      moduleId: node.id,
      filePaths: node.files ?? [node.path],
      fanIn: fi,
      fanOut: fo,
      externalImportCount: extCount,
      exportCount: expCount,
      fileCount,
      hasTests,
      hasContextMd: hasContext,
      circularDependencies: nodeCycles,
      health,
      healthReasons: reasons,
    });
  }

  return result;
}
