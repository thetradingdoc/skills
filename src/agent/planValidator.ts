/**
 * Plan validation — AGENT_ROADMAP v4 §2
 * JSON parse, schema validation, cycle detection, file conflict check, layer rules, module existence.
 */

import * as fs from "fs";
import * as path from "path";
import { parseJsonFromLLM } from "./llmJson";
import type { NodeLayer } from "../types";
import type { AgentPlan, ArchRulesV2, ProposedFileSpec } from "./types";

const VALID_LAYERS: NodeLayer[] = [
  "Presentation",
  "Business Logic",
  "Data Access",
  "Infrastructure",
  "External Services",
  "Utilities",
  "Configuration",
  "Uncategorized",
];
const VALID_ACTIONS = ["create", "modify", "refactor"] as const;

export interface PlanValidationResult {
  valid: boolean;
  plan?: AgentPlan;
  error?: string;
  layerViolation?: { taskId: string; module: string; layer: string; reason: string };
}

function readArchRulesV2(projectRoot: string): ArchRulesV2 | null {
  const p = path.join(projectRoot, ".arch-rules.json");
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as ArchRulesV2;
  } catch {
    return null;
  }
}

function isValidProposedFile(obj: unknown): obj is ProposedFileSpec {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    typeof o.purpose === "string" &&
    Array.isArray(o.todos) &&
    (o.todos as unknown[]).every((t) => typeof t === "string")
  );
}

function isValidAgentPlan(obj: unknown): obj is AgentPlan {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.goal !== "string") return false;
  if (!Array.isArray(o.tasks)) return false;
  for (const t of o.tasks) {
    if (!t || typeof t !== "object") return false;
    const task = t as Record<string, unknown>;
    if (typeof task.id !== "string") return false;
    if (typeof task.module !== "string") return false;
    if (!VALID_LAYERS.includes(task.layer as NodeLayer)) return false;
    if (!VALID_ACTIONS.includes(task.action as (typeof VALID_ACTIONS)[number])) return false;
    if (typeof task.expectedOutput !== "string") return false;
    if (task.proposedFiles !== undefined) {
      if (!Array.isArray(task.proposedFiles)) return false;
      for (const f of task.proposedFiles as unknown[]) {
        if (typeof f !== "string" && !isValidProposedFile(f)) return false;
      }
    }
  }
  if (!Array.isArray(o.dependencies)) return false;
  for (const d of o.dependencies) {
    if (!Array.isArray(d) || d.length !== 2) return false;
    if (typeof d[0] !== "string" || typeof d[1] !== "string") return false;
  }
  return true;
}

function detectCycle(plan: AgentPlan): string[] | null {
  const edges = new Map<string, string[]>();
  const ids = new Set(plan.tasks.map((t) => t.id));
  for (const [a, b] of plan.dependencies) {
    if (!ids.has(a) || !ids.has(b)) continue;
    if (!edges.has(a)) edges.set(a, []);
    edges.get(a)!.push(b);
  }
  const visited = new Set<string>();
  const recursion = new Set<string>();
  const path: string[] = [];
  const cycle: string[] = [];

  function dfs(u: string): boolean {
    visited.add(u);
    recursion.add(u);
    path.push(u);
    for (const v of edges.get(u) ?? []) {
      if (!visited.has(v)) {
        if (dfs(v)) return true;
      } else if (recursion.has(v)) {
        const idx = path.indexOf(v);
        for (let i = idx; i < path.length; i++) cycle.push(path[i]);
        cycle.push(v);
        return true;
      }
    }
    path.pop();
    recursion.delete(u);
    return false;
  }

  for (const id of ids) {
    if (!visited.has(id) && dfs(id)) return cycle;
  }
  return null;
}

function topoSortTasks(plan: AgentPlan): AgentPlan {
  const idToTask = new Map(plan.tasks.map((t) => [t.id, t]));
  const deps = new Map<string, Set<string>>();
  for (const t of plan.tasks) deps.set(t.id, new Set());
  for (const [blocker, blocked] of plan.dependencies) {
    if (idToTask.has(blocker) && idToTask.has(blocked)) {
      deps.get(blocked)!.add(blocker);
    }
  }

  const sorted: string[] = [];
  const visited = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of deps.get(id) ?? []) visit(dep);
    sorted.push(id);
  }

  for (const t of plan.tasks) visit(t.id);

  return {
    ...plan,
    tasks: sorted.map((id) => idToTask.get(id)!),
  };
}

function expandModuleToFilePaths(projectRoot: string, modulePath: string): string[] {
  const fullPath = path.isAbsolute(modulePath)
    ? modulePath
    : path.join(projectRoot, modulePath);
  if (!fs.existsSync(fullPath)) return [modulePath];
  const stat = fs.statSync(fullPath);
  if (stat.isFile()) return [modulePath];
  const allowed = /\.(ts|tsx|js|jsx|md)$/i;
  const files: string[] = [];
  function walk(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = path.join(prefix, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(path.join(dir, e.name), rel);
      } else if (allowed.test(e.name)) {
        files.push(path.join(modulePath, rel).replace(/\\/g, "/"));
      }
    }
  }
  walk(fullPath, "");
  return files.length > 0 ? files : [modulePath];
}

function checkFileConflicts(plan: AgentPlan, projectRoot: string): { taskA: string; taskB: string; path: string } | null {
  const moduleToFiles = new Map<string, string[]>();
  for (const t of plan.tasks) {
    moduleToFiles.set(t.id, expandModuleToFilePaths(projectRoot, t.module));
  }
  const fileToTasks = new Map<string, string[]>();
  for (const [taskId, files] of moduleToFiles) {
    for (const f of files) {
      const norm = path.normalize(f).replace(/\\/g, "/");
      if (!fileToTasks.has(norm)) fileToTasks.set(norm, []);
      fileToTasks.get(norm)!.push(taskId);
    }
  }
  for (const [file, tasks] of fileToTasks) {
    if (tasks.length > 1) {
      return { taskA: tasks[0], taskB: tasks[1], path: file };
    }
  }
  return null;
}

function checkModuleExists(plan: AgentPlan, projectRoot: string): { taskId: string; module: string } | null {
  for (const task of plan.tasks) {
    if (task.action === "create") continue; // New module may not exist yet
    const fullPath = path.isAbsolute(task.module)
      ? task.module
      : path.join(projectRoot, task.module);
    if (!fs.existsSync(fullPath)) {
      return { taskId: task.id, module: task.module };
    }
  }
  return null;
}

function checkLayerRules(plan: AgentPlan, projectRoot: string): { taskId: string; module: string; layer: string; reason: string } | null {
  const rules = readArchRulesV2(projectRoot);
  const directions = rules?.layerDirections;
  if (!directions || directions.length === 0) return null;

  for (const task of plan.tasks) {
    const layer = task.layer;
    for (const d of directions) {
      if (d.from === layer && d.allowed === false) {
        return {
          taskId: task.id,
          module: task.module,
          layer,
          reason: `Layer "${layer}" cannot be used (rule: ${d.from} → ${d.to} disallowed)`,
        };
      }
    }
  }
  return null;
}

/**
 * Validate a plan. On failure, returns error message for model feedback.
 * Layer violation returns layerViolation for routing to Arch Planner.
 */
export function validatePlan(raw: string, projectRoot: string): PlanValidationResult {
  const parsed = parseJsonFromLLM(raw) as unknown;
  if (!parsed) {
    return { valid: false, error: "Invalid JSON or no JSON object found in plan output" };
  }

  if (!isValidAgentPlan(parsed)) {
    return {
      valid: false,
      error: "Schema validation failed: required fields (goal, tasks, dependencies) or task fields (id, module, layer, action, expectedOutput) missing or invalid.",
    };
  }

  const plan = parsed;

  const cycle = detectCycle(plan);
  if (cycle) {
    return {
      valid: false,
      error: `Circular dependency detected between tasks: ${cycle.join(" → ")}`,
    };
  }

  const conflict = checkFileConflicts(plan, projectRoot);
  if (conflict) {
    return {
      valid: false,
      error: `Tasks ${conflict.taskA} and ${conflict.taskB} both touch path ${conflict.path}. Split or merge tasks.`,
    };
  }

  const missingModule = checkModuleExists(plan, projectRoot);
  if (missingModule) {
    return {
      valid: false,
      error: `Module does not exist: ${missingModule.module} (task ${missingModule.taskId})`,
    };
  }

  const layerViolation = checkLayerRules(plan, projectRoot);
  if (layerViolation) {
    return {
      valid: false,
      plan,
      layerViolation,
      error: layerViolation.reason,
    };
  }

  return { valid: true, plan: topoSortTasks(plan) };
}
