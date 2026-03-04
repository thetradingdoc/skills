import * as fs from "fs";
import * as path from "path";
import type { LogicPathStep, Rail } from "./types";

export interface NodeHistoryEntry {
  nodeId: string;
  successCount: number;
  failureCount: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  rails: Array<{
    railId: string;
    outcome: string;
    archetype?: string;
    state: "ARCHIVED" | "FAILED";
    finishedAt: number;
  }>;
}

export interface NodeHistoryStore {
  version: number;
  nodes: Record<string, NodeHistoryEntry>;
}

function getNodeHistoryPath(rootPath: string): string {
  return path.join(rootPath, ".agent", "nodes", "history.json");
}

function ensureDir(rootPath: string): void {
  const dir = path.join(rootPath, ".agent", "nodes");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadNodeHistory(rootPath: string): NodeHistoryStore {
  ensureDir(rootPath);
  const p = getNodeHistoryPath(rootPath);
  if (!fs.existsSync(p)) {
    const empty: NodeHistoryStore = { version: 1, nodes: {} };
    fs.writeFileSync(p, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as NodeHistoryStore;
    if (!parsed || typeof parsed !== "object" || !parsed.nodes) {
      return { version: 1, nodes: {} };
    }
    return parsed;
  } catch {
    return { version: 1, nodes: {} };
  }
}

export function saveNodeHistory(rootPath: string, store: NodeHistoryStore): void {
  ensureDir(rootPath);
  const p = getNodeHistoryPath(rootPath);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

function nodeIdsFromLogicPath(logicPath: LogicPathStep[]): string[] {
  const ids = new Set<string>();
  for (const s of logicPath) {
    if (s.nodeId && typeof s.nodeId === "string") {
      ids.add(s.nodeId);
    }
  }
  return Array.from(ids);
}

export function recordRailCompletion(
  rootPath: string,
  rail: Rail,
  state: "ARCHIVED" | "FAILED"
): void {
  const store = loadNodeHistory(rootPath);
  const finishedAt = Date.now();
  const nodeIds = nodeIdsFromLogicPath(rail.logicPath ?? []);

  for (const nodeId of nodeIds) {
    const existing = store.nodes[nodeId] ?? {
      nodeId,
      successCount: 0,
      failureCount: 0,
      rails: [],
    };
    const next: NodeHistoryEntry = {
      ...existing,
      rails: [
        ...existing.rails,
        {
          railId: rail.id,
          outcome: rail.outcome,
          archetype: rail.archetype,
          state,
          finishedAt,
        },
      ].slice(-20),
    };
    if (state === "ARCHIVED") {
      next.successCount += 1;
      next.lastSuccessAt = finishedAt;
    } else {
      next.failureCount += 1;
      next.lastFailureAt = finishedAt;
    }
    store.nodes[nodeId] = next;
  }

  saveNodeHistory(rootPath, store);
}

