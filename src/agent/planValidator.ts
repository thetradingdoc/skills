/**
 * Plan validation — AGENT_ROADMAP v4 §2
 * JSON parse, schema validation, cycle detection, file conflict check, layer rules, module existence.
 */

import * as fs from "fs";
import * as path from "path";
import { parseJsonFromLLM } from "./llmJson";
import type { NodeLayer } from "../types";
import type { AgentPlan, ArchRulesV2, ProposedFileSpec, SuccessCheck } from "./types";

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

function isValidSuccessCheck(obj: unknown): obj is SuccessCheck {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.kind !== "string") return false;
  if (o.kind === "staging_write") return o.required === true;
  if (o.kind === "lint") return o.required === true && (o.paths === undefined || Array.isArray(o.paths));
  if (o.kind === "vitest") return o.required === true && (o.pattern === undefined || typeof o.pattern === "string");
  if (o.kind === "playwright") {
    return (
      o.required === true &&
      Array.isArray(o.specs) &&
      (o.specs as unknown[]).every((s) => typeof s === "string") &&
      (o.baseUrl === undefined || typeof o.baseUrl === "string")
    );
  }
  return false;
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
    if (task.successChecks !== undefined) {
      if (!Array.isArray(task.successChecks)) return false;
      for (const c of task.successChecks as unknown[]) {
        if (!isValidSuccessCheck(c)) return false;
      }
    }
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

function checkTaskIdsUnique(plan: AgentPlan): string | null {
  const seen = new Set<string>();
  for (const t of plan.tasks) {
    if (seen.has(t.id)) return t.id;
    seen.add(t.id);
  }
  return null;
}

function checkDependenciesReferenceExisting(plan: AgentPlan): { missing: string[]; self: string[] } {
  const ids = new Set(plan.tasks.map((t) => t.id));
  const missing = new Set<string>();
  const self = new Set<string>();
  for (const [a, b] of plan.dependencies) {
    if (a === b) self.add(a);
    if (!ids.has(a)) missing.add(a);
    if (!ids.has(b)) missing.add(b);
  }
  return { missing: [...missing], self: [...self] };
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

function checkNamingConventions(
  plan: AgentPlan,
  projectRoot: string
): { taskId: string; module: string; layer: string; reason: string } | null {
  const rules = readArchRulesV2(projectRoot);
  const conventions = rules?.namingConventions;
  if (!conventions || conventions.length === 0) return null;

  for (const task of plan.tasks) {
    const module = task.module.replace(/\\/g, "/");
    const base = module.split("/").filter(Boolean).pop() ?? module;
    for (const c of conventions) {
      try {
        const re = new RegExp(c.pattern);
        if (re.test(base) && task.layer !== (c.expectedLayer as NodeLayer)) {
          return {
            taskId: task.id,
            module: task.module,
            layer: task.layer,
            reason: `Naming convention mismatch: "${base}" matches ${c.pattern} → expected layer "${c.expectedLayer}", got "${task.layer}"`,
          };
        }
      } catch {
        // Ignore invalid regex patterns in rules file
      }
    }
  }
  return null;
}

function hasTestsUnderPath(fullPath: string): boolean {
  const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx)$/i;
  const stack = [fullPath];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        stack.push(path.join(cur, e.name));
      } else if (TEST_FILE.test(e.name)) {
        return true;
      }
    }
  }
  return false;
}

function hasContextOrDocsUnderPath(fullPath: string): boolean {
  const DOC_FILES = new Set([".context.md", "README.md", "readme.md"]);
  try {
    if (fs.statSync(fullPath).isFile()) return DOC_FILES.has(path.basename(fullPath));
  } catch {}
  const stack = [fullPath];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        stack.push(path.join(cur, e.name));
      } else if (DOC_FILES.has(e.name)) {
        return true;
      }
    }
  }
  return false;
}

function checkPlanCoversHealthGaps(
  plan: AgentPlan,
  projectRoot: string
): { taskId: string; module: string; reason: string } | null {
  // Heuristic “red/amber” proxy for now (until ModuleSignals are wired in here):
  // - missing tests OR missing docs/context in an existing module requires explicit coverage in plan.
  // Explicit coverage can be either:
  // - successChecks include lint/vitest/playwright for that task, OR
  // - expectedOutput mentions tests/docs/context, OR
  // - proposedFiles includes .context.md / test/spec files.
  const coverageKeywords = /(test|vitest|jest|playwright|eslint|lint|\.context\.md|readme|docs?)/i;

  function taskClaimsCoverage(t: AgentPlan["tasks"][number]): boolean {
    const checks = t.successChecks ?? [];
    const hasVerification =
      checks.some((c) => c.kind === "lint" || c.kind === "vitest" || c.kind === "playwright") ||
      checks.some((c) => c.kind === "staging_write");
    const mentions = coverageKeywords.test(t.expectedOutput);
    const proposed = (t.proposedFiles ?? []).some((f) => {
      if (!f) return false;
      if (typeof f === "string") return coverageKeywords.test(f);
      return coverageKeywords.test(f.name);
    });
    return hasVerification || mentions || proposed;
  }

  for (const t of plan.tasks) {
    if (t.action === "create") continue;
    const full = path.isAbsolute(t.module) ? t.module : path.join(projectRoot, t.module);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    const baseDir = stat.isDirectory() ? full : path.dirname(full);
    const hasTests = hasTestsUnderPath(baseDir);
    const hasDocs = hasContextOrDocsUnderPath(baseDir);
    if (!hasTests || !hasDocs) {
      const sameModuleTasks = plan.tasks.filter((x) => x.module === t.module);
      const covered = sameModuleTasks.some(taskClaimsCoverage);
      if (!covered) {
        const missing = [
          !hasTests ? "tests" : null,
          !hasDocs ? "docs/context (.context.md/README.md)" : null,
        ]
          .filter(Boolean)
          .join(" and ");
        return {
          taskId: t.id,
          module: t.module,
          reason: `Plan touches existing module missing ${missing} but has no explicit coverage (tests/docs/verification) in any task for that module.`,
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

  if (!plan.goal.trim()) {
    return { valid: false, error: "Schema validation failed: goal must be a non-empty string." };
  }
  if (plan.tasks.length === 0) {
    return { valid: false, error: "Schema validation failed: tasks must be a non-empty array." };
  }
  const dup = checkTaskIdsUnique(plan);
  if (dup) {
    return { valid: false, error: `Schema validation failed: duplicate task id "${dup}".` };
  }
  const depRef = checkDependenciesReferenceExisting(plan);
  if (depRef.self.length > 0) {
    return { valid: false, error: `Dependency validation failed: self-dependency detected for task(s): ${depRef.self.join(", ")}.` };
  }
  if (depRef.missing.length > 0) {
    return { valid: false, error: `Dependency validation failed: unknown task id(s) referenced: ${depRef.missing.join(", ")}.` };
  }

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

  for (const t of plan.tasks) {
    const checks = t.successChecks ?? [];
    const hasStagingCheck = checks.some((c) => c.kind === "staging_write" && c.required === true);
    if (!hasStagingCheck) {
      return {
        valid: false,
        error: `Success criteria validation failed: task ${t.id} is missing required successChecks including {kind:"staging_write", required:true}.`,
      };
    }
  }

  const missingModule = checkModuleExists(plan, projectRoot);
  if (missingModule) {
    return {
      valid: false,
      error: `Module does not exist: ${missingModule.module} (task ${missingModule.taskId})`,
    };
  }

  const namingViolation = checkNamingConventions(plan, projectRoot);
  if (namingViolation) {
    return {
      valid: false,
      plan,
      layerViolation: {
        taskId: namingViolation.taskId,
        module: namingViolation.module,
        layer: namingViolation.layer,
        reason: namingViolation.reason,
      },
      error: namingViolation.reason,
    };
  }

  const healthGap = checkPlanCoversHealthGaps(plan, projectRoot);
  if (healthGap) {
    return { valid: false, error: healthGap.reason };
  }

  return { valid: true, plan: topoSortTasks(plan) };
}
