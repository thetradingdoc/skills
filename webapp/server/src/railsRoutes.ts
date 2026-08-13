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
import { sendError } from "./apiError.js";
import { getAllRails, getRail, loadRails, updateRailState, createRail } from "../../../src/agent/rail/manager.js";
import {
  createTask as createRailTask,
  updateTaskStatus as updateRailTaskStatus,
  updateTaskEvidence as updateRailTaskEvidence,
  updateRailPartial,
} from "../../../src/agent/rail/manager.js";
import { transitionRail } from "../../../src/agent/rail/orchestrator.js";
import { ensureSandbox, getSandboxPath, cleanupOrphanSandboxes, removeSandbox } from "../../../src/agent/rail/sandbox.js";
import { buildNodeFileMap } from "./nodeFileMapping.js";
import { syncSandboxFromRoot } from "../../../src/agent/rail/executor.js";
import { runTaskAtIndex } from "../../../src/agent/taskRunner.js";
import { classifyTaskAutoCapable, partitionTasksByCapability } from "../../../src/agent/taskClassifier.js";
import {
  runVerificationPipeline,
  type VerificationResult,
} from "../../../src/agent/verificationPipeline.js";
import { createTask, setTaskRunning, setTaskCompleted, setTaskFailed, isTaskCancelled } from "./tasks.js";
import { ensureProjectRoot } from "./cloneRepo.js";
import { completeTodosForRail } from "./todos.js";
import * as fs from "fs";
import type { Rail, Task } from "../../../src/agent/types.js";

/** Best-effort: write rail completion summary to workspace memories for context retrieval. */
async function writeRailCompletionMemory(
  workspaceId: string,
  rail: Rail
): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    const taskCount = rail.tasks?.length ?? 0;
    const completedCount = rail.tasks?.filter((t) => t.status === "completed").length ?? 0;
    const parts = [
      `Rail ${rail.id.slice(0, 8)} archived: ${rail.outcome}`,
      rail.archetype ? `archetype: ${rail.archetype}` : null,
      `tasks: ${completedCount}/${taskCount} completed`,
    ].filter(Boolean);
    const content = parts.join(". ").slice(0, 2000);
    await supabaseAdmin.from("workspace_memories").insert({
      workspace_id: workspaceId,
      node_id: rail.logicPath?.[0]?.nodeId ?? null,
      content,
      memory_type: "rail_completion",
    });
  } catch {
    // non-fatal; do not block rail state transition
  }
}

const router = Router();

type RailEventClient = {
  workspaceId: string;
  res: import("express").Response;
};

const railEventClients: RailEventClient[] = [];

function broadcastRailEvent(workspaceId: string, payload: unknown) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of railEventClients.slice()) {
    if (client.workspaceId !== workspaceId) continue;
    try {
      client.res.write(data);
    } catch {
      // drop broken client
      const idx = railEventClients.indexOf(client);
      if (idx >= 0) railEventClients.splice(idx, 1);
    }
  }
}

const workspaceExecutionCounts = new Map<string, number>();
const MAX_CONCURRENT_PER_WORKSPACE =
  typeof process.env.RAIL_MAX_CONCURRENT === "string" &&
  !Number.isNaN(Number(process.env.RAIL_MAX_CONCURRENT))
    ? Math.max(1, Number(process.env.RAIL_MAX_CONCURRENT))
    : 1;

const STALE_RAIL_MAX_AGE_MS =
  typeof process.env.RAIL_STALE_MAX_AGE_MS === "string" &&
  !Number.isNaN(Number(process.env.RAIL_STALE_MAX_AGE_MS))
    ? Math.max(5 * 60_000, Number(process.env.RAIL_STALE_MAX_AGE_MS))
    : 60 * 60_000;

/** Stale recovery behavior: runs on every GET /rails (board load/poll). On server startup, rails are
 * loaded from disk on first GET /rails per workspace; recoverStaleRails then transitions EXECUTING/
 * VERIFYING rails older than STALE_RAIL_MAX_AGE_MS to FAILED and removes their sandboxes. Long-lived
 * processes: GET /rails is typically polled every 8s when board is open, so recovery is continuous. */

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

function recoverStaleRails(rootPath: string, workspaceId?: string) {
  try {
    const now = Date.now();
    const rails = getAllRails();
    for (const rail of rails) {
      if (!rail.updatedAt) continue;
      if (!["EXECUTING", "VERIFYING"].includes(rail.state as string)) continue;
      if (now - rail.updatedAt < STALE_RAIL_MAX_AGE_MS) continue;
      updateRailState(rootPath, rail.id, "FAILED" as any);
      removeSandbox(rootPath, rail.id);
      if (workspaceId) {
        broadcastRailEvent(workspaceId, {
          type: "rail_stale_recovered",
          railId: rail.id,
          from: rail.state,
          to: "FAILED",
        });
      }
    }
  } catch {
    // best-effort
  }
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
    if (!error && data) {
      const pr = (data as { project_root?: string | null }).project_root;
      if (typeof pr === "string" && pr.trim()) return path.resolve(pr.trim());
    }
    // Fix G fallback: latest graph_json.projectRoot when workspace column empty.
    const { data: graphRow } = await supabaseAdmin
      .from("graphs")
      .select("graph_json")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const g = (graphRow as { graph_json?: { projectRoot?: string } } | null)?.graph_json;
    const fromGraph = typeof g?.projectRoot === "string" ? g.projectRoot.trim() : "";
    return fromGraph ? path.resolve(fromGraph) : null;
  } catch {
    return null;
  }
}

async function resolveRootAndWorkspace(
  req: import("express").Request
): Promise<{ root: string; workspaceId: string } | { error: string; status: number }> {
  const workspaceId = (req.query.workspaceId as string | undefined)?.trim();
  if (!workspaceId || !req.user?.id) {
    return { error: "workspaceId and auth required.", status: 400 };
  }
  const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
  if (!root) {
    return { error: "Workspace has no project_root.", status: 400 };
  }
  return { root, workspaceId };
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
    sendError(res, 400, resolved.error);
    return;
  }
  try {
    loadRails(resolved.root);
    cleanupOrphanSandboxes(resolved.root, workspaceId);
    recoverStaleRails(resolved.root, workspaceId);
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
        attemptHistory: r.attemptHistory ?? null,
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

/** Create a rail from an architecture violation (governance → execution bridge). */
router.post("/rails/from-violation", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    sendError(res, 503, "Auth service not configured.");
    return;
  }

  const workspaceIdBody = (req.body?.workspaceId as string | undefined)?.trim() || null;
  const violation = req.body?.violation as
    | {
        id?: string;
        type?: string;
        severity?: string;
        sourceNodeId?: string;
        targetNodeId?: string | null;
        description?: string;
        suggestedFix?: string;
      }
    | undefined;

  if (!violation) {
    sendError(res, 400, "violation is required in request body.", "VIOLATION_REQUIRED");
    return;
  }

  const violationId = typeof violation.id === "string" && violation.id.trim() ? violation.id.trim() : null;

  try {
    let workspaceId: string | null = workspaceIdBody;
    // If we have an id, prefer authoritative workspace from DB.
    if (violationId) {
      const { data: row } = await supabaseAdmin
        .from("violations")
        .select("id, workspace_id")
        .eq("id", violationId)
        .maybeSingle();
      if (!row) {
        sendError(res, 404, "Violation not found.", "VIOLATION_NOT_FOUND");
        return;
      }
      workspaceId = (row.workspace_id as string | null) ?? workspaceId;
    }

    if (!workspaceId) {
      sendError(res, 400, "workspaceId is required (in body or via violation record).", "WORKSPACE_REQUIRED");
      return;
    }

    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("id")
      .eq("id", workspaceId)
      .eq("owner_id", req.user!.id)
      .single();
    if (!ws) {
      sendError(res, 403, "Access denied.", "WORKSPACE_FORBIDDEN");
      return;
    }

    const root = await resolveRootFromWorkspace(workspaceId, req.user!.id);
    if (!root) {
      sendError(res, 400, "Workspace has no project_root.", "WORKSPACE_NO_PROJECT_ROOT");
      return;
    }

    // Optional: repoUrl for telemetry/rails metadata.
    let repoUrl: string | null = null;
    try {
      const { data: graphRow } = await supabaseAdmin
        .from("graphs")
        .select("repo_url")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      repoUrl = (graphRow?.repo_url as string | null) ?? null;
    } catch {
      // non-fatal
    }

    const now = Date.now();
    const railId =
      violationId != null
        ? `rail-violation-${violationId}-${now}`
        : `rail-violation-${now.toString(16)}`;

    const trigger: Rail["trigger"] = violationId
      ? { source: "governance", violationId }
      : {
          source: "chat",
          userMessage:
            (violation.description ?? violation.suggestedFix ?? "Fix architecture violation").slice(0, 200),
          sessionId: req.user!.id,
        };

    const sourceNodeId =
      typeof violation.sourceNodeId === "string" && violation.sourceNodeId.trim()
        ? violation.sourceNodeId.trim()
        : "unknown-node";

    const logicPath: Rail["logicPath"] = [
      {
        step: 1,
        layer: "Service",
        nodeId: sourceNodeId,
        filePath: sourceNodeId,
        action:
          (typeof violation.suggestedFix === "string" && violation.suggestedFix.trim().slice(0, 120)) ||
          "Fix architecture violation",
      },
    ];

    const outcomeParts: string[] = [];
    if (violation.type) outcomeParts.push(String(violation.type));
    if (violation.severity) outcomeParts.push(String(violation.severity));
    outcomeParts.push(violation.description ?? "Architecture violation");

    const rail: Rail = {
      id: railId,
      version: 1,
      outcome: outcomeParts.join(" · ").slice(0, 200),
      trigger,
      workspaceId,
      repoUrl,
      violationId: violationId ?? undefined,
      archetype: "analysis-chat",
      logicPath,
      state: "PRE_PLANNING",
      activeAgent: null,
      tasks: [],
      jiraKeys: [],
      traceIds: [],
      overlaps: [],
      createdAt: now,
      updatedAt: now,
      createdBy: "human",
      sessionId: req.user!.id,
      originSummary:
        (violation.description ?? violation.suggestedFix ?? "Fix architecture violation").slice(0, 200),
    };

    // Seed with a single code_change task derived from the violation.
    const task: Task = {
      id: `task-code-${now.toString(16)}`,
      railId,
      kind: "code_change",
      description:
        (violation.suggestedFix && violation.suggestedFix.trim()) ||
        `Fix ${violation.type ?? "violation"} at ${sourceNodeId}`,
      files: [],
      autoCapable: true,
      status: "pending",
      agent: "executor",
      logicStep: 1,
      createdAt: now,
    };

    createRail(root, rail);
    createRailTask(task);

    if (violationId) {
      try {
        await supabaseAdmin
          .from("violations")
          .update({ rail_id: railId })
          .eq("id", violationId);
      } catch {
        // non-fatal; linkage may fail if column/index differs
      }
    }

    res.status(201).json({ railId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, "RAIL_FROM_VIOLATION_ERROR");
  }
});

router.get("/rails/events", requireUser, async (req, res) => {
  const workspaceId = (req.query.workspaceId as string | undefined)?.trim();
  if (!workspaceId) {
    sendError(res, 400, "workspaceId is required.", "WORKSPACE_REQUIRED");
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: ping\ndata: "connected"\n\n`);
  const client: RailEventClient = { workspaceId, res };
  railEventClients.push(client);
  req.on("close", () => {
    const idx = railEventClients.indexOf(client);
    if (idx >= 0) railEventClients.splice(idx, 1);
  });
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
    sendError(res, 400, resolved.error);
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId is required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(resolved.root);
    const rail = getRail(resolved.root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    const tasks = rail.tasks ?? [];
    const { autoCapable, hitlRequired } = partitionTasksByCapability(tasks);
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
      tasks,
      taskCapability: {
        autoCapableIds: autoCapable.map((t) => t.id),
        hitlRequiredIds: hitlRequired.map((t) => t.id),
      },
      traces: rail.traces ?? null,
      telemetry: rail.telemetry ?? null,
      attemptHistory: rail.attemptHistory ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, "RAIL_READ_ERROR");
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
    sendError(res, 400, resolved.error);
    return;
  }
  const railId = req.params.railId;
  const to = (req.body?.state as string | undefined)?.trim();
  if (!railId || !to) {
    sendError(res, 400, "railId and state are required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(resolved.root);
    const current = getRail(resolved.root, railId);
    if (!current) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    const result = transitionRail(resolved.root, railId, to as any);
    if (!result.ok || !result.rail) {
      sendError(res, 400, result.error ?? "Invalid transition.", "RAIL_INVALID_TRANSITION");
      return;
    }
    updateRailState(resolved.root, railId, result.rail.state);
    if (workspaceId) {
      broadcastRailEvent(workspaceId, {
        type: "rail_state",
        railId,
        from: current?.state ?? null,
        to: result.rail.state,
      });
      if (result.rail.state === "AWAITING_HITL") {
        broadcastRailEvent(workspaceId, {
          type: "rail_hitl",
          railId,
          reason: "awaiting_human_review",
        });
      }
    }
    if (supabaseAdmin) {
      try {
        await supabaseAdmin.from("rail_state_events").insert({
          rail_id: railId,
          workspace_id: workspaceId ?? null,
          from_state: current?.state ?? null,
          to_state: result.rail.state,
          actor_id: req.user?.id ?? null,
          reason: req.body?.reason ?? null,
        });
      } catch {
        // non-fatal
      }
      if (workspaceId && result.rail.state === "ARCHIVED") {
        writeRailCompletionMemory(workspaceId, result.rail).catch(() => {});
        completeTodosForRail(railId).catch(() => {});
      }
    }
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
    sendError(res, 400, "workspaceId and auth required.", "WORKSPACE_REQUIRED");
    return;
  }
  const currentExec = workspaceExecutionCounts.get(workspaceId) ?? 0;
  if (currentExec >= MAX_CONCURRENT_PER_WORKSPACE) {
    sendError(
      res,
      429,
      "Execution limit reached for this workspace. Try again later.",
      "RAIL_EXECUTION_LIMIT"
    );
    return;
  }

  // Prefer stored project_root; if missing, resolve via latest graph + ensureProjectRoot (cloneRepo).
  let root = await resolveRootFromWorkspace(workspaceId, req.user.id);
  if (!root) {
    if (!supabaseAdmin) {
      sendError(res, 503, "Auth service not configured.", "SERVICE_UNAVAILABLE");
      return;
    }
    try {
      const { data: gr } = await supabaseAdmin
        .from("graphs")
        .select("graph_json, repo_url")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const graph = (gr?.graph_json ?? { nodes: [], edges: [], generatedAt: Date.now(), projectRoot: "" }) as any;
      const repoUrl = (gr?.repo_url as string | null) ?? null;
      const { rootPath, error } = await ensureProjectRoot(workspaceId, graph, repoUrl);
      if (rootPath !== null) {
        root = rootPath;
      } else {
        sendError(
          res,
          400,
          error || "Workspace has no project_root. Please scan the repository first.",
          "WORKSPACE_NO_PROJECT_ROOT"
        );
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(res, 500, msg, "WORKSPACE_NO_PROJECT_ROOT");
      return;
    }
  }
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    if (rail.archetype !== "analysis-chat") {
      sendError(res, 400, "Only analysis-chat rails can be executed.", "RAIL_WRONG_ARCHETYPE");
      return;
    }
    const codeTasks = (rail.tasks ?? []).filter(
      (t) => t.kind === "code_change" && classifyTaskAutoCapable(t)
    );
    if (codeTasks.length === 0) {
      sendError(res, 400, "Rail has no code_change tasks to run.", "RAIL_NO_CODE_TASKS");
      return;
    }
    if (!["PRE_PLANNING", "PLANNING", "AWAITING_APPROVAL"].includes(rail.state)) {
      sendError(
        res,
        400,
        `Rail must be in PRE_PLANNING, PLANNING, or AWAITING_APPROVAL. Current: ${rail.state}`,
        "RAIL_INVALID_STATE"
      );
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
    workspaceExecutionCounts.set(workspaceId, currentExec + 1);
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
        const attemptHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
        const maxSelfCorrect =
          ((rail.telemetry as { retryLimit?: number })?.retryLimit as number | undefined) ??
          (typeof process.env.RAIL_SELF_CORRECT_MAX === "string" &&
          !Number.isNaN(Number(process.env.RAIL_SELF_CORRECT_MAX))
            ? Math.max(0, Math.min(5, Number(process.env.RAIL_SELF_CORRECT_MAX)))
            : 2);
        let lastVerificationFeedback: string | undefined;
        let verification: VerificationResult | null = null;
        let attempt = 0;

        while (attempt <= maxSelfCorrect && !isTaskCancelled(bgTask.taskId)) {
          for (let idx = 0; idx < plan.tasks.length && !isTaskCancelled(bgTask.taskId); idx++) {
            const railTask = codeTasks[idx];
            if (railTask) updateRailTaskStatus(railTask.id, "executing");
            const result = await runTaskAtIndex(plan as any, idx, sandboxPath, {
              apiKey,
              errorOutput: lastVerificationFeedback,
              rail,
              railHistory: attemptHistory,
            });
            if (result.error) {
              attemptHistory.push({
                role: "assistant",
                content: `Task ${railTask?.id ?? idx} error: ${result.error}`,
              });
            }
            if (railTask) updateRailTaskStatus(railTask.id, "completed");
          }

          const nodeIds = (rail.logicPath ?? [])
            .map((s) => (typeof s === "object" && s && "nodeId" in s && typeof (s as { nodeId?: string }).nodeId === "string"
              ? (s as { nodeId: string }).nodeId
              : null))
            .filter((x): x is string => !!x);

          verification = await runVerificationPipeline({
            projectRoot: root,
            sandboxPath,
            railId: rail.id as any,
            baseUrl: process.env.APP_URL || "http://127.0.0.1:4173",
            scope: nodeIds.length > 0 ? { nodeIds } : undefined,
          });

          const passed = verification.passed;
          lastVerificationFeedback = verification.errorFeedback || undefined;

          if (passed) break;
          attempt++;
        }

        const { passed, lint, vitest, playwright: playwrightResult } = verification ?? {
          passed: false,
          lint: { passed: false, errors: [] },
          vitest: { passed: false, summary: { total: 0, passed: 0, failed: 0, skipped: 0 }, failures: [] },
          playwright: null,
        };
        const errorOutput = lastVerificationFeedback ?? "Verification failed.";
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
        updateRailTaskEvidence(verificationTaskId, JSON.stringify({ lint, vitest, playwright: playwrightResult }));
        const attemptNumber =
          (((rail.telemetry as any)?.retryCount as number | undefined) ?? 0) + 1;
        const attemptSummary = passed
          ? "Verification passed."
          : errorOutput || "Verification failed.";
        updateRailPartial(root, railId, {
          lastCritique: {
            source: passed ? "test" : "lint",
            message: passed
              ? "Lint, Vitest, and Playwright passed."
              : errorOutput || "Verification failed.",
            createdAt: Date.now(),
            attempt: attemptNumber,
            totalAttempts: ((rail.telemetry as any)?.retryLimit as number | undefined) ?? 1,
          },
          telemetry: {
            ...(rail.telemetry ?? {}),
            retryCount:
              ((((rail.telemetry as any)?.retryCount as number | undefined) ?? 0) + (passed ? 0 : 1)) as any,
          },
          attemptHistory: [
            ...((rail.attemptHistory as Array<{ timestamp: number; summary: string }> | undefined) ??
              []),
            {
              timestamp: Date.now(),
              summary: attemptSummary.slice(0, 5000),
            },
          ],
        } as any);
        const toState = passed ? "VERIFYING" : "SELF_CORRECTING";
        transitionRail(root, railId, toState as any);
        setTaskCompleted(bgTask.taskId, {
          message: passed ? "Verification passed. You can approve materialization." : "Verification failed. Review failures in rail detail.",
          railId: rail.id,
          verificationPassed: passed,
          lint: { passed: lint.passed, errors: lint.errors.length },
          vitest: { passed: vitest.passed, failures: vitest.failures.length },
          playwright: playwrightResult
            ? { passed: playwrightResult.passed, failures: playwrightResult.failures.length }
            : null,
        });
        if (supabaseAdmin && workspaceId) {
          try {
            await supabaseAdmin.from("workspace_memories").insert({
              workspace_id: workspaceId,
              content: passed
                ? `Rail ${rail.id} verification passed. Outcome: ${rail.outcome ?? ""}`
                : `Rail ${rail.id} verification failed. See lint, vitest, and Playwright results.`,
              memory_type: "rail_result",
              rail_id: rail.id,
            });
          } catch {
            // non-fatal
          }
        }
        if (!passed && workspaceId) {
          broadcastRailEvent(workspaceId, {
            type: "rail_hitl",
            railId: rail.id,
            reason: "verification_failed",
          });
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setTaskFailed(bgTask.taskId, msg);
        updateRailPartial(root, railId, {
          lastCritique: { source: "unknown", message: msg, createdAt: Date.now() },
        } as any);
      })
      .finally(() => {
        const cur = workspaceExecutionCounts.get(workspaceId) ?? 0;
        const next = Math.max(0, cur - 1);
        if (next === 0) workspaceExecutionCounts.delete(workspaceId);
        else workspaceExecutionCounts.set(workspaceId, next);
        broadcastRailEvent(workspaceId, { type: "rail_execute_complete", railId });
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, "RAIL_EXECUTE_ERROR");
  }
});

router.get("/rails/:railId/sandbox/files", requireUser, async (req, res) => {
  const workspaceId = (req.query.workspaceId as string)?.trim();
  if (!workspaceId || !req.user?.id) {
    sendError(res, 401, "workspaceId and auth required.", "WORKSPACE_REQUIRED");
    return;
  }
  const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
  if (!root) {
    sendError(res, 400, "Workspace has no project_root.", "WORKSPACE_NO_PROJECT_ROOT");
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
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
    sendError(res, 500, msg, "RAIL_READ_ERROR");
  }
});

router.get("/rails/:railId/diff", requireUser, async (req, res) => {
  const workspaceId = (req.query.workspaceId as string)?.trim();
  if (!workspaceId || !req.user?.id) {
    sendError(res, 401, "workspaceId and auth required.", "WORKSPACE_REQUIRED");
    return;
  }
  const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
  if (!root) {
    sendError(res, 400, "Workspace has no project_root.", "WORKSPACE_NO_PROJECT_ROOT");
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    const sandboxPath = getSandboxPath(root, railId);
    if (!fs.existsSync(sandboxPath)) {
      res.json({ files: [] });
      return;
    }
    const relFiles = walkDir(sandboxPath, sandboxPath, 6).filter((p) => !p.endsWith("/"));
    const diffs: Array<{ path: string; before?: string; after?: string }> = [];
    for (const rel of relFiles) {
      const sandboxFile = path.join(sandboxPath, rel);
      const rootFile = path.join(root, rel);
      let before: string | undefined;
      let after: string | undefined;
      try {
        if (fs.existsSync(rootFile) && fs.statSync(rootFile).isFile()) {
          before = fs.readFileSync(rootFile, "utf-8");
        }
      } catch {
        /* ignore */
      }
      try {
        after = fs.readFileSync(sandboxFile, "utf-8");
      } catch {
        /* ignore */
      }
      if (before === after) continue;
      diffs.push({ path: rel, before, after });
    }
    res.json({ files: diffs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, "RAIL_READ_ERROR");
  }
});

router.get("/rails/:railId/impact", requireUser, async (req, res) => {
  const workspaceId = (req.query.workspaceId as string)?.trim();
  if (!workspaceId || !req.user?.id) {
    sendError(res, 401, "workspaceId and auth required.", "WORKSPACE_REQUIRED");
    return;
  }
  const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
  if (!root) {
    sendError(res, 400, "Workspace has no project_root.", "WORKSPACE_NO_PROJECT_ROOT");
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    const sandboxPath = getSandboxPath(root, railId);
    const changedFiles: string[] = [];
    if (fs.existsSync(sandboxPath)) {
      const relFiles = walkDir(sandboxPath, sandboxPath, 6).filter((p) => !p.endsWith("/"));
      for (const rel of relFiles) {
        const sandboxFile = path.join(sandboxPath, rel);
        const rootFile = path.join(root, rel);
        let before: string | undefined;
        let after: string | undefined;
        try {
          if (fs.existsSync(rootFile) && fs.statSync(rootFile).isFile()) {
            before = fs.readFileSync(rootFile, "utf-8");
          }
        } catch {
          /* ignore */
        }
        try {
          after = fs.readFileSync(sandboxFile, "utf-8");
        } catch {
          /* ignore */
        }
        if (before !== after) {
          changedFiles.push(rel);
        }
      }
    }

    // Full semantic mapping: node IDs → concrete repo paths
    let nodesToPaths: Record<string, string[]> = {};
    const logicNodeIds = (rail.logicPath ?? [])
      .map((s) => (typeof s === "object" && s && "nodeId" in s ? (s as { nodeId?: string }).nodeId : null))
      .filter((id): id is string => !!id);
    const allNodeIds = [...new Set([...(rail.baselineNodeIds ?? []), ...logicNodeIds])];
    if (supabaseAdmin && allNodeIds.length > 0) {
      const { data: graphRow } = await supabaseAdmin
        .from("graphs")
        .select("graph_json")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (graphRow?.graph_json) {
        const graph = graphRow.graph_json as import("../../../src/types.js").ArchGraph;
        const nodeMap = buildNodeFileMap(graph);
        for (const nodeId of allNodeIds) {
          const entry = nodeMap.get(nodeId);
          if (entry?.files?.length) nodesToPaths[nodeId] = entry.files;
        }
      }
    }

    res.json({
      railId,
      baselineNodeIds: rail.baselineNodeIds ?? null,
      changedFiles,
      nodesToPaths: Object.keys(nodesToPaths).length > 0 ? nodesToPaths : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, "RAIL_READ_ERROR");
  }
});

router.get("/rails/:railId/trace", requireUser, async (req, res) => {
  const workspaceId = (req.query.workspaceId as string | undefined)?.trim();
  if (!workspaceId || !req.user?.id) {
    sendError(res, 401, "workspaceId and auth required.", "WORKSPACE_REQUIRED");
    return;
  }
  const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
  if (!root) {
    sendError(res, 400, "Workspace has no project_root.", "WORKSPACE_NO_PROJECT_ROOT");
    return;
  }
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    let stateEvents: any[] | null = null;
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from("rail_state_events")
        .select("*")
        .eq("rail_id", railId)
        .order("created_at", { ascending: true });
      stateEvents = data ?? [];
    }
    res.json({
      railId,
      rail,
      stateEvents,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg);
  }
});

/** Cancel a rail — mark SUSPENDED and emit events. Execution loop checks task cancellation separately. */
router.post("/rails/:railId/cancel", requireUser, async (req, res) => {
  const resolved = await resolveRootAndWorkspace(req);
  if ("error" in resolved) {
    sendError(res, resolved.status, resolved.error, "WORKSPACE_REQUIRED");
    return;
  }
  const { root, workspaceId } = resolved;
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    if (!["EXECUTING", "VERIFYING", "SELF_CORRECTING", "AWAITING_HITL"].includes(rail.state as string)) {
      sendError(
        res,
        400,
        `Rail is not cancellable from state ${rail.state}.`,
        "RAIL_INVALID_STATE"
      );
      return;
    }
    const result = transitionRail(root, railId, "SUSPENDED" as any);
    if (!result.ok || !result.rail) {
      sendError(res, 400, result.error ?? "Invalid state transition.", "RAIL_INVALID_TRANSITION");
      return;
    }
    updateRailState(root, railId, result.rail.state);
    broadcastRailEvent(workspaceId, {
      type: "rail_state",
      railId,
      from: rail.state,
      to: result.rail.state,
    });
    res.json({ id: railId, state: result.rail.state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, { code: "RAIL_CANCEL_ERROR", railId });
  }
});

/**
 * Materialize non-greenfield rail: copy sandbox to root and archive.
 * For greenfield-materialize archetype, use POST /materialize/approve instead.
 */
router.post("/rails/:railId/materialize", requireUser, async (req, res) => {
  const resolved = await resolveRootAndWorkspace(req);
  if ("error" in resolved) {
    sendError(res, resolved.status, resolved.error, "WORKSPACE_REQUIRED");
    return;
  }
  const { root, workspaceId } = resolved;
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    if (rail.archetype === "greenfield-materialize") {
      sendError(
        res,
        400,
        "Use /materialize/approve for greenfield materialize rails.",
        "RAIL_WRONG_ARCHETYPE"
      );
      return;
    }
    const verifTasks = (rail.tasks ?? []).filter((t) => t.kind === "verification");
    const passed = verifTasks.length > 0 && verifTasks.every((t) => t.status === "completed");
    if (!passed) {
      sendError(
        res,
        409,
        "Verification has not passed yet. Approval is blocked until verification is completed successfully.",
        { code: "RAIL_VERIFICATION_REQUIRED", railId }
      );
      return;
    }
    const sandboxPath = getSandboxPath(root, railId);
    if (!fs.existsSync(sandboxPath)) {
      sendError(res, 400, "Sandbox not found for this rail.", "RAIL_SANDBOX_MISSING");
      return;
    }
    const relFiles = walkDir(sandboxPath, sandboxPath, 6).filter((p) => !p.endsWith("/"));
    for (const rel of relFiles) {
      const srcFile = path.join(sandboxPath, rel);
      const rootFile = path.join(root, rel);
      try {
        const dir = path.dirname(rootFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const content = fs.readFileSync(srcFile, "utf-8");
        fs.writeFileSync(rootFile, content, "utf-8");
      } catch {
        // best-effort per file
      }
    }
    // Respect orchestrator guards: VERIFYING -> MATERIALIZING (reviewerPassed),
    // then MATERIALIZING -> ARCHIVED (materializationApproved).
    const toMat = transitionRail(root, railId, "MATERIALIZING" as any, { reviewerPassed: true } as any);
    if (!toMat.ok || !toMat.rail) {
      sendError(
        res,
        500,
        toMat.error ?? "Failed to enter MATERIALIZING after verification.",
        "RAIL_MATERIALIZE_ERROR"
      );
      return;
    }
    updateRailState(root, railId, toMat.rail.state);

    const tr = transitionRail(root, railId, "ARCHIVED" as any, { materializationApproved: true } as any);
    if (!tr.ok || !tr.rail) {
      sendError(res, 500, tr.error ?? "Failed to archive rail after materialize.", "RAIL_MATERIALIZE_ERROR");
      return;
    }
    updateRailState(root, railId, tr.rail.state);
    broadcastRailEvent(workspaceId, {
      type: "rail_state",
      railId,
      from: rail.state,
      to: tr.rail.state,
    });
    if (supabaseAdmin) {
      writeRailCompletionMemory(workspaceId, tr.rail).catch(() => {});
      completeTodosForRail(railId).catch(() => {});
    }
    res.json({ railId, state: tr.rail.state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, { code: "RAIL_MATERIALIZE_ERROR", railId });
  }
});

router.post("/rails/:railId/rollback", requireUser, async (req, res) => {
  const resolved = await resolveRootAndWorkspace(req);
  if ("error" in resolved) {
    sendError(res, resolved.status, resolved.error, "WORKSPACE_REQUIRED");
    return;
  }
  const { root, workspaceId } = resolved;
  const railId = req.params.railId;
  if (!railId) {
    sendError(res, 400, "railId required.", "RAIL_ID_REQUIRED");
    return;
  }
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) {
      sendError(res, 404, "Rail not found.", "RAIL_NOT_FOUND");
      return;
    }
    const sandboxPath = getSandboxPath(root, railId);
    if (!fs.existsSync(sandboxPath)) {
      sendError(res, 400, "Sandbox not found for this rail.", "RAIL_SANDBOX_MISSING");
      return;
    }
    const relFiles = walkDir(sandboxPath, sandboxPath, 6).filter((p) => !p.endsWith("/"));
    for (const rel of relFiles) {
      const srcFile = path.join(sandboxPath, rel);
      const rootFile = path.join(root, rel);
      try {
        if (fs.existsSync(rootFile) && fs.statSync(rootFile).isFile()) {
          const before = fs.readFileSync(rootFile, "utf-8");
          const after = fs.readFileSync(srcFile, "utf-8");
          if (before !== after) {
            fs.writeFileSync(rootFile, before, "utf-8");
          }
        }
      } catch {
        // best-effort per file
      }
    }
    broadcastRailEvent(workspaceId, {
      type: "rail_rollback",
      railId,
    });
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendError(res, 500, msg, { code: "RAIL_ROLLBACK_ERROR", railId });
  }
});

export { router as railsRoutes };
