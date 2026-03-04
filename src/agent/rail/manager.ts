import * as fs from "fs";
import * as path from "path";
import type {
  AgentTrace,
  LogicPathStep,
  Rail,
  RailId,
  RailRegistry,
  RailState,
  Task,
  TaskId,
} from "../types";
import { getJiraConfig, addLabel } from "../../jira/client";
import { removeSandbox } from "./sandbox";
import { getRailTelemetry } from "../rail/telemetry";
import { recordTaskLatency } from "./telemetry";
import { deregisterRail, loadRegistry, registerRail, saveRegistry, updateRailInRegistry } from "./registry";
import { getAgentTraces } from "../traceLogger";
import { recordRailCompletion } from "../nodeHistory";

type RailStore = {
  rails: Map<RailId, Rail>;
  tasks: Map<TaskId, Task>;
};

const inMemoryStore: RailStore = {
  rails: new Map(),
  tasks: new Map(),
};

const RAILS_DIR = ".agent/rails";

function getRailsDir(rootPath: string): string {
  return path.join(rootPath, RAILS_DIR);
}

function getRailPath(rootPath: string, railId: RailId): string {
  return path.join(getRailsDir(rootPath), `${railId}.json`);
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

export function loadRails(rootPath: string): void {
  // Load rails from disk into memory.
  const railsDir = getRailsDir(rootPath);
  if (!fs.existsSync(railsDir)) {
    // Ensure registry exists even if no rails yet.
    void loadRegistry(rootPath);
    return;
  }
  const files = fs.readdirSync(railsDir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(railsDir, f), "utf8");
      const rail = JSON.parse(raw) as Rail;
      if (rail?.id) {
        inMemoryStore.rails.set(rail.id, rail);
        for (const t of rail.tasks ?? []) {
          if (t?.id) inMemoryStore.tasks.set(t.id, t);
        }
      }
    } catch {
      // ignore corrupt rails for now
    }
  }

  // Rebuild registry from loaded rails to avoid drift.
  let next: RailRegistry = {
    version: 1,
    updatedAt: Date.now(),
    index: { byJira: {}, byNode: {}, byState: {}, bySession: {} },
    rails: {},
  };
  for (const rail of inMemoryStore.rails.values()) {
    next = registerRail(next, rail);
  }
  saveRegistry(rootPath, next);
}

export function saveRails(rootPath: string): void {
  for (const rail of inMemoryStore.rails.values()) {
    atomicWriteJson(getRailPath(rootPath, rail.id), rail);
  }

  let registry: RailRegistry = {
    version: 1,
    updatedAt: Date.now(),
    index: { byJira: {}, byNode: {}, byState: {}, bySession: {} },
    rails: {},
  };
  for (const rail of inMemoryStore.rails.values()) {
    registry = registerRail(registry, rail);
  }
  saveRegistry(rootPath, registry);
}

export function createRail(rootPath: string, rail: Rail): Rail {
  inMemoryStore.rails.set(rail.id, rail);
  atomicWriteJson(getRailPath(rootPath, rail.id), rail);
  const registry = loadRegistry(rootPath);
  const updated = registerRail(registry, rail);
  saveRegistry(rootPath, updated);
  return rail;
}

export function resumeRail(_rootPath: string, rail: Rail): Rail {
  // For now, resuming simply means putting the Rail back in memory.
  inMemoryStore.rails.set(rail.id, rail);
  return rail;
}

export function getRail(_rootPath: string, railId: RailId): Rail | null {
  return inMemoryStore.rails.get(railId) ?? null;
}

export function updateRailState(rootPath: string, railId: RailId, state: RailState): Rail | null {
  const existing = inMemoryStore.rails.get(railId);
  if (!existing) return null;
  const updatedRail: Rail = { ...existing, state, updatedAt: Date.now() };
  inMemoryStore.rails.set(railId, updatedRail);
  atomicWriteJson(getRailPath(rootPath, railId), updatedRail);
  const registry = loadRegistry(rootPath);
  const next = updateRailInRegistry(registry, updatedRail);
  saveRegistry(rootPath, next);
  return updatedRail;
}

/**
 * Scope locking helper for first entry into EXECUTING.
 *
 * Captures a frozen snapshot of the outcome, logicPath, and baseline node ids.
 * These are used as the canonical anchor for all subsequent reasoning and
 * drift checks, and must not change after EXECUTING begins.
 */
export function enterExecutingState(rootPath: string, railId: RailId): Rail | null {
  const existing = inMemoryStore.rails.get(railId);
  if (!existing) return null;

  const alreadyExecuting = existing.state === "EXECUTING";
  const frozenOutcome = existing.frozenOutcome ?? existing.outcome;
  const frozenLogicPath = existing.frozenLogicPath ?? existing.logicPath;
  const baselineNodeIds =
    existing.baselineNodeIds ??
    Array.from(
      new Set(
        (existing.logicPath ?? [])
          .map((step) => step.nodeId)
          .filter((id) => typeof id === "string" && id.length > 0)
      )
    );

  const nextState: RailState = "EXECUTING";
  const updated: Rail = {
    ...existing,
    state: alreadyExecuting ? existing.state : nextState,
    frozenOutcome,
    frozenLogicPath,
    baselineNodeIds,
    updatedAt: Date.now(),
  };

  inMemoryStore.rails.set(railId, updated);
  atomicWriteJson(getRailPath(rootPath, railId), updated);
  const registry = loadRegistry(rootPath);
  const next = updateRailInRegistry(registry, updated);
  saveRegistry(rootPath, next);
  return updated;
}

export function updateRailVersion(rootPath: string, railId: RailId): Rail | null {
  const existing = inMemoryStore.rails.get(railId);
  if (!existing) return null;
  const updated: Rail = { ...existing, version: (existing.version ?? 0) + 1, updatedAt: Date.now() };
  inMemoryStore.rails.set(railId, updated);
  atomicWriteJson(getRailPath(rootPath, railId), updated);
  const registry = loadRegistry(rootPath);
  saveRegistry(rootPath, updateRailInRegistry(registry, updated));
  return updated;
}

export function createTask(task: Task): Task {
  inMemoryStore.tasks.set(task.id, task);
  const rail = inMemoryStore.rails.get(task.railId);
  if (rail) {
    const updatedRail: Rail = {
      ...rail,
      tasks: [...(rail.tasks ?? []), task],
      updatedAt: Date.now(),
      version: (rail.version ?? 0) + 1,
    };
    inMemoryStore.rails.set(task.railId, updatedRail);
  }
  return task;
}

export function getTask(taskId: TaskId): Task | null {
  return inMemoryStore.tasks.get(taskId) ?? null;
}

export function updateTaskEvidence(taskId: TaskId, evidence: string): Task | null {
  const existing = inMemoryStore.tasks.get(taskId);
  if (!existing) return null;
  const updated: Task = { ...existing, evidence };
  inMemoryStore.tasks.set(taskId, updated);
  const rail = inMemoryStore.rails.get(updated.railId);
  if (rail) {
    const tasks = (rail.tasks ?? []).map((t) => (t.id === taskId ? updated : t));
    const updatedRail: Rail = { ...rail, tasks, updatedAt: Date.now(), version: (rail.version ?? 0) + 1 };
    inMemoryStore.rails.set(rail.id, updatedRail);
  }
  return updated;
}

export function updateTaskStatus(taskId: TaskId, status: Task["status"]): Task | null {
  const existing = inMemoryStore.tasks.get(taskId);
  if (!existing) return null;
  const now = Date.now();
  const updated: Task = {
    ...existing,
    status,
    resolvedAt: status === "completed" ? now : existing.resolvedAt,
  };
  inMemoryStore.tasks.set(taskId, updated);
  const rail = inMemoryStore.rails.get(updated.railId);
  if (rail) {
    const tasks = (rail.tasks ?? []).map((t) => (t.id === taskId ? updated : t));
    const updatedRail: Rail = { ...rail, tasks, updatedAt: Date.now(), version: (rail.version ?? 0) + 1 };
    inMemoryStore.rails.set(rail.id, updatedRail);
    if (status === "completed" && typeof updated.createdAt === "number") {
      const latencyMs = now - updated.createdAt;
      recordTaskLatency(updated.railId, updated.id, latencyMs);
    }
  }
  return updated;
}

export function getTasksByRail(railId: RailId): Task[] {
  const rail = inMemoryStore.rails.get(railId);
  if (rail?.tasks?.length) return rail.tasks;
  return Array.from(inMemoryStore.tasks.values()).filter((t) => t.railId === railId);
}

export function getAllRails(): Rail[] {
  return Array.from(inMemoryStore.rails.values());
}

export function getAllTasks(): Task[] {
  return Array.from(inMemoryStore.tasks.values());
}

export function getRailsByJiraKey(rootPath: string, jiraKey: string): Rail[] {
  const registry = loadRegistry(rootPath);
  const ids = registry.index.byJira[jiraKey] ?? [];
  return ids.map((id) => inMemoryStore.rails.get(id)).filter(Boolean) as Rail[];
}

export function archiveRail(rootPath: string, railId: RailId): Rail | null {
  const rail = inMemoryStore.rails.get(railId);
  if (!rail) return null;
  const allTraces: AgentTrace[] = getAgentTraces();
  const railTraces = allTraces.filter((t) => t.railId === railId);
  const telemetry = getRailTelemetry(railId);
  const updated: Rail = {
    ...rail,
    state: "ARCHIVED",
    updatedAt: Date.now(),
    version: (rail.version ?? 0) + 1,
    snapshotPath: getRailPath(rootPath, railId),
    traces: railTraces,
    telemetry,
  };
  inMemoryStore.rails.set(railId, updated);
  atomicWriteJson(getRailPath(rootPath, railId), updated);
  removeSandbox(rootPath, railId);
  const registry = loadRegistry(rootPath);
  saveRegistry(rootPath, updateRailInRegistry(registry, updated));
  recordRailCompletion(rootPath, updated, "ARCHIVED");
  // Best-effort: stamp any linked Jira issues with the Rail id (issue keys only; project keys are skipped).
  const issueKeys = (updated.jiraKeys ?? []).filter((k) => /^[A-Z][A-Z0-9]*-[0-9]+$/.test(k));
  if (issueKeys.length > 0) {
    const config = getJiraConfig();
    if (config) {
      for (const issueKey of issueKeys) {
        try {
          void addLabel(config, issueKey, `arch-rail-${updated.id}`);
        } catch {
          /* Stamping Jira is best-effort; never block archive. */
        }
      }
    }
  }
  // If this rail has an archetype and verification tasks are all completed, write a template.
  if (updated.archetype) {
    const verifTasks = (updated.tasks ?? []).filter((t) => t.kind === "verification");
    const allVerifCompleted =
      verifTasks.length === 0 || verifTasks.every((t) => t.status === "completed");
    if (allVerifCompleted) {
      const tmplDir = path.join(rootPath, ".agent", "rails", "templates");
      const tmplPath = path.join(tmplDir, `${updated.archetype}.json`);
      const tmpl = {
        archetype: updated.archetype,
        outcome: updated.outcome,
        logicPath: updated.logicPath,
        tasks: updated.tasks?.map((t) => ({
          kind: t.kind,
          description: t.description,
        })),
        telemetry,
      };
      if (!fs.existsSync(tmplDir)) {
        fs.mkdirSync(tmplDir, { recursive: true });
      }
      const tmp = `${tmplPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(tmpl, null, 2), "utf8");
      fs.renameSync(tmp, tmplPath);
    }
  }
  return updated;
}

export function suspendRail(rootPath: string, railId: RailId): Rail | null {
  return updateRailState(rootPath, railId, "SUSPENDED");
}

export function failRail(rootPath: string, railId: RailId, reason: string): Rail | null {
  const rail = inMemoryStore.rails.get(railId);
  if (!rail) return null;
  const updated: Rail = {
    ...rail,
    state: "FAILED",
    updatedAt: Date.now(),
    version: (rail.version ?? 0) + 1,
    tasks: [
      ...(rail.tasks ?? []),
      {
        id: `task_fail_${Date.now()}`,
        railId,
        kind: "meta",
        description: `Rail failed: ${reason}`,
        files: [],
        autoCapable: false,
        status: "awaiting_hitl",
        agent: "reviewer",
        logicStep: 0,
        hitlPrompt: reason,
        createdAt: Date.now(),
      },
    ],
  };
  inMemoryStore.rails.set(railId, updated);
  atomicWriteJson(getRailPath(rootPath, railId), updated);
  removeSandbox(rootPath, railId);
  const registry = loadRegistry(rootPath);
  saveRegistry(rootPath, updateRailInRegistry(registry, updated));
  // Persist anti-pattern snapshot for analysis.
  try {
    const antiDir = path.join(rootPath, ".agent", "rails", "anti-patterns");
    if (!fs.existsSync(antiDir)) {
      fs.mkdirSync(antiDir, { recursive: true });
    }
    const ts = Date.now();
    const file = path.join(antiDir, `${ts}-${railId}.json`);
    const anti = {
      railId,
      outcome: updated.outcome,
      archetype: updated.archetype ?? null,
      logicPath: updated.logicPath,
      reason,
    };
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(anti, null, 2), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    // Anti-pattern recording is best-effort; never block failRail.
  }
  recordRailCompletion(rootPath, updated, "FAILED");
  return updated;
}

export function deleteRail(rootPath: string, railId: RailId): void {
  inMemoryStore.rails.delete(railId);
  for (const [taskId, task] of inMemoryStore.tasks.entries()) {
    if (task.railId === railId) inMemoryStore.tasks.delete(taskId);
  }
  const railPath = getRailPath(rootPath, railId);
  try {
    if (fs.existsSync(railPath)) fs.unlinkSync(railPath);
  } catch {
    /* ignore */
  }
  const registry = loadRegistry(rootPath);
  saveRegistry(rootPath, deregisterRail(registry, railId));
}

// ─── Section 10.3: Canonical templates ────────────────────────────────────────

export type TemplateData = {
  archetype: string;
  outcome: string;
  logicPath: LogicPathStep[];
  tasks: Array<{ kind: string; description: string }>;
};

export function loadTemplateForArchetype(
  rootPath: string,
  archetype: string
): TemplateData | null {
  const tmplPath = path.join(rootPath, ".agent", "rails", "templates", `${archetype}.json`);
  try {
    if (!fs.existsSync(tmplPath)) return null;
    const raw = fs.readFileSync(tmplPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    const outcome = typeof o.outcome === "string" ? o.outcome : "";
    const logicPath = Array.isArray(o.logicPath) ? (o.logicPath as LogicPathStep[]) : [];
    const tasks = Array.isArray(o.tasks)
      ? (o.tasks as Array<{ kind?: string; description?: string }>).map((t) => ({
          kind: typeof t.kind === "string" ? t.kind : "code_change",
          description: typeof t.description === "string" ? t.description : "",
        }))
      : [];
    return { archetype, outcome, logicPath, tasks };
  } catch {
    return null;
  }
}

export function listTemplateArchetypes(rootPath: string): string[] {
  const tmplDir = path.join(rootPath, ".agent", "rails", "templates");
  try {
    if (!fs.existsSync(tmplDir)) return [];
    return fs.readdirSync(tmplDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

// ─── Section 10.4: Anti-patterns feedback loop ─────────────────────────────────

export type AntiPatternData = {
  railId: string;
  outcome: string;
  archetype: string | null;
  logicPath: LogicPathStep[];
  reason: string;
};

export function loadAntiPatterns(
  rootPath: string,
  archetype?: string | null
): AntiPatternData[] {
  const antiDir = path.join(rootPath, ".agent", "rails", "anti-patterns");
  try {
    if (!fs.existsSync(antiDir)) return [];
    const files = fs.readdirSync(antiDir).filter((f) => f.endsWith(".json"));
    const results: AntiPatternData[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(antiDir, f), "utf8");
        const o = JSON.parse(raw) as Record<string, unknown>;
        const railId = typeof o.railId === "string" ? o.railId : "";
        const outcome = typeof o.outcome === "string" ? o.outcome : "";
        const a = o.archetype;
        const archetypeVal = a === null || a === undefined ? null : typeof a === "string" ? a : null;
        const logicPath = Array.isArray(o.logicPath) ? (o.logicPath as LogicPathStep[]) : [];
        const reason = typeof o.reason === "string" ? o.reason : "";
        if (archetype != null && archetype !== undefined && archetypeVal !== archetype) continue;
        results.push({ railId, outcome, archetype: archetypeVal, logicPath, reason });
      } catch {
        /* skip corrupt files */
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function getAntiPatternWarnings(rootPath: string, archetype?: string | null): string[] {
  const patterns = loadAntiPatterns(rootPath, archetype);
  if (patterns.length === 0) return [];
  return patterns.map((p) => `Avoid: ${p.reason} (from outcome: "${p.outcome}")`);
}

// ─── Rail partial update (for template seeding) ────────────────────────────────

export function updateRailPartial(
  rootPath: string,
  railId: RailId,
  partial: Partial<
    Pick<
      Rail,
      | "logicPath"
      | "archetype"
      | "outcome"
      | "overlaps"
      | "hallucinationIndex"
      | "hallucinationAcknowledgedAt"
      | "intentSummary"
      | "intentDriftScore"
      | "lastCritique"
    >
  >
): Rail | null {
  const existing = inMemoryStore.rails.get(railId);
  if (!existing) return null;

  // Once a rail has entered EXECUTING, its high-level scope is locked.
  // Prevent late mutations to outcome/logicPath that would invalidate
  // the frozen anchor and baseline captured on EXECUTING entry.
  const scopeLockedStates: RailState[] = [
    "EXECUTING",
    "AWAITING_HITL",
    "VERIFYING",
    "SELF_CORRECTING",
    "MATERIALIZING",
    "ARCHIVED",
    "SUSPENDED",
    "FAILED",
  ];
  const isScopeLocked = scopeLockedStates.includes(existing.state);

  const safePartial: typeof partial = isScopeLocked
    ? (() => {
        const { logicPath, outcome, ...rest } = partial;
        return rest;
      })()
    : partial;

  const updated: Rail = { ...existing, ...safePartial, updatedAt: Date.now() };
  inMemoryStore.rails.set(railId, updated);
  atomicWriteJson(getRailPath(rootPath, railId), updated);
  const registry = loadRegistry(rootPath);
  saveRegistry(rootPath, updateRailInRegistry(registry, updated));
  return updated;
}

