import * as fs from "fs";
import * as path from "path";
import type { Rail, RailId, RailRegistry } from "../types";

const REGISTRY_FILENAME = ".agent/rail_registry.json";

function getRegistryPath(rootPath: string): string {
  return path.join(rootPath, REGISTRY_FILENAME);
}

export function loadRegistry(rootPath: string): RailRegistry {
  const filePath = getRegistryPath(rootPath);
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      updatedAt: Date.now(),
      index: { byJira: {}, byNode: {}, byState: {}, bySession: {} },
      rails: {},
    };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as RailRegistry;
    return parsed;
  } catch {
    // Corrupt registry – start fresh to avoid blocking the agent.
    return {
      version: 1,
      updatedAt: Date.now(),
      index: { byJira: {}, byNode: {}, byState: {}, bySession: {} },
      rails: {},
    };
  }
}

export function saveRegistry(rootPath: string, registry: RailRegistry): void {
  const filePath = getRegistryPath(rootPath);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function registerRail(registry: RailRegistry, rail: Rail): RailRegistry {
  const next: RailRegistry = {
    ...registry,
    updatedAt: Date.now(),
    rails: {
      ...registry.rails,
      [rail.id]: {
        id: rail.id,
        outcome: rail.outcome,
        state: rail.state,
        jiraKeys: rail.jiraKeys,
        updatedAt: Date.now(),
      },
    },
  };

  for (const key of rail.jiraKeys) {
    const list = next.index.byJira[key] ?? [];
    if (!list.includes(rail.id)) next.index.byJira[key] = [...list, rail.id];
  }
  for (const step of rail.logicPath) {
    const list = next.index.byNode[step.nodeId] ?? [];
    if (!list.includes(rail.id)) next.index.byNode[step.nodeId] = [...list, rail.id];
  }
  const stateList = next.index.byState[rail.state] ?? [];
  if (!stateList.includes(rail.id)) next.index.byState[rail.state] = [...stateList, rail.id];

  const sessionList = next.index.bySession[rail.sessionId] ?? [];
  if (!sessionList.includes(rail.id)) next.index.bySession[rail.sessionId] = [...sessionList, rail.id];

  return next;
}

export function deregisterRail(registry: RailRegistry, railId: RailId): RailRegistry {
  const railMeta = registry.rails[railId];
  if (!railMeta) return registry;
  const next: RailRegistry = {
    ...registry,
    updatedAt: Date.now(),
    rails: { ...registry.rails },
  };
  delete next.rails[railId];

  for (const [key, ids] of Object.entries(next.index.byJira)) {
    next.index.byJira[key] = ids.filter((id) => id !== railId);
  }
  for (const [key, ids] of Object.entries(next.index.byNode)) {
    next.index.byNode[key] = ids.filter((id) => id !== railId);
  }
  for (const [state, ids] of Object.entries(next.index.byState)) {
    next.index.byState[state as keyof RailRegistry["index"]["byState"]] = ids.filter(
      (id) => id !== railId
    );
  }
  for (const [session, ids] of Object.entries(next.index.bySession)) {
    next.index.bySession[session] = ids.filter((id) => id !== railId);
  }

  return next;
}

export function updateRailInRegistry(registry: RailRegistry, rail: Rail): RailRegistry {
  const without = deregisterRail(registry, rail.id);
  return registerRail(without, rail);
}

