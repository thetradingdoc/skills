/**
 * Rails API — expose Rail registry for Board view and task detail.
 * Requires rootPath (project root where .agent/rails lives) or workspaceId.
 * When workspaceId is provided, resolves rootPath from workspace.project_root if set.
 */

import { Router } from "express";
import * as path from "path";
import { optionalUser } from "./middleware/optionalUser.js";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { getAllRails, getRail, loadRails, updateRailState } from "../../../src/agent/rail/manager.js";
import {
  createTask as createRailTask,
  updateTaskStatus as updateRailTaskStatus,
  updateTaskEvidence as updateRailTaskEvidence,
  updateRailPartial,
} from "../../../src/agent/rail/manager.js";
import { transitionRail } from "../../../src/agent/rail/orchestrator.js";
import { ensureSandbox, getSandboxPath } from "../../../src/agent/rail/sandbox.js";
import { syncSandboxFromRoot } from "../../../src/agent/rail/executor.js";
import { runTaskAtIndex } from "../../../src/agent/taskRunner.js";
import { runLint } from "../../../src/agent/runLint.js";
import { runVitest } from "../../../src/agent/runVitest.js";
import { createTask, setTaskRunning, setTaskCompleted, setTaskFailed, isTaskCancelled } from "./tasks.js";
import * as fs from "fs";

const router = Router();

function walkDir(dir: string, base: string, maxDepth: number): string[] {
  const out: string[] = [];
  if (maxDepth <= 0) return out;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = path.relative(base, path.join(dir, e.name));
      if (e.isDirectory()) {
        out.push(rel + "/");
        out.push(...walkDir(path.join(dir, e.name), base, maxDepth - 1));
      } else {
        out.push(rel);
      }
    }
  } catch {
    // ignore
  }
  return out.sort();
}

function resolveRootPath(raw: string | undefined): { root: string } | { error: string } {
  if (!raw || typeof raw !== "string" || raw.trim() === "") {
    return { error: "rootPath query is required." };
  }
  const root = path.resolve(raw.trim());
  const baseDir = process.env.PROJECTS_BASE_DIR?.trim();
  if (baseDir) {
    const baseNorm = path.resolve(baseDir);
    if (!root.startsWith(baseNorm + path.sep) && root !== baseNorm) {
      return { error: "rootPath must be within the allowed projects directory." };
    }
  }
  return { root };
}

async function resolveRootFromWorkspace(
  workspaceId: string,
  ownerId: string
): Promise<string | null> {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("workspaces")
      .select("project_root")
      .eq("id", workspaceId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error || !data) return null;
    const pr = (data as { project_root?: string | null }).project_root;
    return typeof pr === "string" && pr.trim() ? path.resolve(pr.trim()) : null;
  } catch {
    return null;
  }
}

router.get("/rails", optionalUser, async (req, res) => {
  const rootPath = (req.query.rootPath as string)?.trim();
  const workspaceId = (req.query.workspaceId as string)?.trim();
  let resolved: { root: string } | { error: string };
  if (rootPath) {
    resolved = resolveRootPath(rootPath);
  } else if (workspaceId && req.user?.id) {
    const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
    resolved = root ? { root } : { error: "Workspace has no project_root. Set project_root or pass rootPath." };
  } else {
    resolved = { error: "rootPath or workspaceId (with auth) is required." };
  }
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error });
    return;
  }
  try {
    loadRails(resolved.root);
    const rails = getAllRails();
    res.json({
      rails: rails.map((r) => ({
        id: r.id,
        outcome: r.outcome,
        state: r.state,
        archetype: r.archetype,
        logicPath: r.logicPath,
        sessionId: r.sessionId,
        originSummary: r.originSummary ?? null,
        jiraKeys: r.jiraKeys ?? [],
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
        lastCritique: r.lastCritique ?? null,
        hallucinationIndex: r.hallucinationIndex ?? null,
        acceptanceCriteria: r.acceptanceCriteria ?? null,
        tasks: (r.tasks ?? []).map((t) => ({
          id: t.id,
          kind: t.kind,
          description: t.description,
          status: t.status,
          createdAt: t.createdAt,
        })),
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get("/rails/:railId", optionalUser, async (req, res) => {
  const rootPath = (req.query.rootPath as string)?.trim();
  const workspaceId = (req.query.workspaceId as string)?.trim();
  let resolved: { root: string } | { error: string };
  if (rootPath) {
    resolved = resolveRootPath(rootPath);
  } else if (workspaceId && req.user?.id) {
    const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
    resolved = root ? { root } : { error: "Workspace has no project_root." };
  } else {
    resolved = { error: "rootPath or workspaceId (with auth) is required." };
  }
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error });
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    res.status(400).json({ error: "railId is required." });
    return;
  }
  try {
    loadRails(resolved.root);
    const rail = getRail(resolved.root, railId);
    if (!rail) {
      res.status(404).json({ error: "Rail not found." });
      return;
    }
    res.json({
      id: rail.id,
      outcome: rail.outcome,
      state: rail.state,
      archetype: rail.archetype,
      logicPath: rail.logicPath,
      baselineNodeIds: rail.baselineNodeIds ?? null,
      sessionId: rail.sessionId,
      originSummary: rail.originSummary ?? null,
      jiraKeys: rail.jiraKeys ?? [],
      updatedAt: rail.updatedAt,
      createdAt: rail.createdAt,
      lastCritique: rail.lastCritique ?? null,
      hallucinationIndex: rail.hallucinationIndex ?? null,
      acceptanceCriteria: rail.acceptanceCriteria ?? null,
      tasks: rail.tasks ?? [],
      traces: rail.traces ?? null,
      telemetry: rail.telemetry ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/rails/:railId/state", optionalUser, async (req, res) => {
  const rootPath = (req.query.rootPath as string)?.trim();
  const workspaceId = (req.query.workspaceId as string)?.trim();
  let resolved: { root: string } | { error: string };
  if (rootPath) {
    resolved = resolveRootPath(rootPath);
  } else if (workspaceId && req.user?.id) {
    const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
    resolved = root ? { root } : { error: "Workspace has no project_root." };
  } else {
    resolved = { error: "rootPath or workspaceId (with auth) is required." };
  }
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error });
    return;
  }
  const railId = req.params.railId;
  const to = (req.body?.state as string | undefined)?.trim();
  if (!railId || !to) {
    res.status(400).json({ error: "railId and state are required." });
    return;
  }
  try {
    loadRails(resolved.root);
    const current = getRail(resolved.root, railId);
    if (!current) {
      res.status(404).json({ error: "Rail not found." });
      return;
    }
    const result = transitionRail(resolved.root, railId, to as any);
    if (!result.ok || !result.rail) {
      res.status(400).json({ error: result.error ?? "Invalid transition." });
      return;
    }
    updateRailState(resolved.root, railId, result.rail.state);
    res.json({
      id: result.rail.id,
      state: result.rail.state,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

/** Execute analysis rail in sandbox: code-writer + lint/vitest, gate on verification. */
router.post("/rails/:railId/execute", requireUser, async (req, res) => {
  const workspaceId = (req.query.workspaceId as string)?.trim();
  if (!workspaceId || !req.user?.id) {
    res.status(400).json({ error: "workspaceId and auth required." });
    return;
  }
  const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
  if (!root) {
    res.status(400).json({ error: "Workspace has no project_root." });
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    res.status(400).json({ error: "railId required." });
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      res.status(404).json({ error: "Rail not found." });
      return;
    }
    if (rail.archetype !== "analysis-chat") {
      res.status(400).json({ error: "Only analysis-chat rails can be executed." });
      return;
    }
    const codeTasks = (rail.tasks ?? []).filter((t) => t.kind === "code_change");
    if (codeTasks.length === 0) {
      res.status(400).json({ error: "Rail has no code_change tasks to run." });
      return;
    }
    if (!["PRE_PLANNING", "PLANNING", "AWAITING_APPROVAL"].includes(rail.state)) {
      res.status(400).json({ error: `Rail must be in PRE_PLANNING, PLANNING, or AWAITING_APPROVAL. Current: ${rail.state}` });
      return;
    }
    const bgTask = createTask();
    res.status(202).json({
      taskId: bgTask.taskId,
      status: "pending",
      railId: rail.id,
      kind: "analysis-execute",
    });
    setTaskRunning(bgTask.taskId);
    const sandboxPath = ensureSandbox(root, rail.id);
    const paths = (rail.logicPath ?? []).map((s) => (typeof s === "object" && s && "filePath" in s && typeof (s as { filePath?: string }).filePath === "string" ? (s as { filePath: string }).filePath : String(s))).filter(Boolean) as string[];
    const syncPaths = paths.length > 0 ? paths : ["src"];
    syncSandboxFromRoot(root, rail.id, syncPaths);
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
    const goal = rail.outcome ?? rail.trigger?.source === "chat" ? (rail.trigger as { userMessage?: string }).userMessage ?? "" : "Analysis rail";
    const plan: { goal: string; tasks: Array<{ id: string; module: string; layer: string; action: string; expectedOutput: string }>; dependencies: [string, string][] } = {
      goal,
      tasks: codeTasks.map((t, i) => ({
        id: t.id,
        module: (rail.logicPath?.[i] as { filePath?: string })?.filePath ?? `step-${i + 1}`,
        layer: (rail.logicPath?.[i] as { layer?: string })?.layer ?? "Service",
        action: "modify" as const,
        expectedOutput: t.description ?? `Step ${i + 1}`,
      })),
      dependencies: [],
    };
    for (let i = 0; i < plan.tasks.length - 1; i++) {
      plan.dependencies.push([plan.tasks[i].id, plan.tasks[i + 1].id]);
    }
    Promise.resolve()
      .then(async () => {
        if (isTaskCancelled(bgTask.taskId)) return;
        const current = getRail(root, railId);
        if (current && (current.state === "PRE_PLANNING" || current.state === "PLANNING")) {
          transitionRail(root, railId, "AWAITING_APPROVAL" as any);
        }
        const tr = transitionRail(root, railId, "EXECUTING" as any, { planApproved: true });
        if (!tr.ok) {
          setTaskFailed(bgTask.taskId, tr.error ?? "Invalid transition.");
          return;
        }
        for (let idx = 0; idx < plan.tasks.length && !isTaskCancelled(bgTask.taskId); idx++) {
          const railTask = codeTasks[idx];
          if (railTask) updateRailTaskStatus(railTask.id, "executing");
          await runTaskAtIndex(plan as any, idx, sandboxPath, { apiKey });
          if (railTask) updateRailTaskStatus(railTask.id, "completed");
        }
        const lint = runLint(root, undefined, sandboxPath);
        const vitest = runVitest(root, undefined, sandboxPath);
        const passed = lint.passed && vitest.passed;
        const errorOutput = [
          !lint.passed ? `Lint: ${JSON.stringify(lint.errors.slice(0, 5))}` : "",
          !vitest.passed ? `Vitest: ${JSON.stringify(vitest.failures.slice(0, 3))}` : "",
        ].filter(Boolean).join("\n");
        const verificationTaskId = `verify-${Date.now()}`;
        createRailTask({
          id: verificationTaskId,
          railId: rail.id,
          kind: "verification",
          description: "Lint + Vitest in sandbox",
          files: [],
          autoCapable: true,
          status: passed ? "completed" : "rejected",
          agent: "reviewer",
          logicStep: 0,
          createdAt: Date.now(),
          resolvedAt: Date.now(),
        });
        updateRailTaskEvidence(verificationTaskId, JSON.stringify({ lint, vitest }));
        updateRailPartial(root, railId, {
          lastCritique: {
            source: passed ? "test" : "lint",
            message: passed ? "Lint and Vitest passed." : errorOutput,
            createdAt: Date.now(),
          },
        } as any);
        const toState = passed ? "VERIFYING" : "SELF_CORRECTING";
        transitionRail(root, railId, toState as any);
        setTaskCompleted(bgTask.taskId, {
          message: passed ? "Verification passed. You can approve materialization." : "Verification failed. Review failures in rail detail.",
          railId: rail.id,
          verificationPassed: passed,
          lint: { passed: lint.passed, errors: lint.errors.length },
          vitest: { passed: vitest.passed, failures: vitest.failures.length },
        });
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setTaskFailed(bgTask.taskId, msg);
        updateRailPartial(root, railId, {
          lastCritique: { source: "unknown", message: msg, createdAt: Date.now() },
        } as any);
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get("/rails/:railId/sandbox/files", requireUser, async (req, res) => {
  const workspaceId = (req.query.workspaceId as string)?.trim();
  if (!workspaceId || !req.user?.id) {
    res.status(401).json({ error: "workspaceId and auth required." });
    return;
  }
  const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
  if (!root) {
    res.status(400).json({ error: "Workspace has no project_root." });
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    res.status(400).json({ error: "railId required." });
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      res.status(404).json({ error: "Rail not found." });
      return;
    }
    const sandboxPath = getSandboxPath(root, railId);
    if (!fs.existsSync(sandboxPath)) {
      res.json({ paths: [] });
      return;
    }
    const paths = walkDir(sandboxPath, sandboxPath, 4);
    res.json({ paths });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export { router as railsRoutes };
