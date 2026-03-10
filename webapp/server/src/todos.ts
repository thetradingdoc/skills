import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { ensureProjectRoot } from "./cloneRepo.js";
import { createRail, createTask as createRailTask } from "../../../src/agent/rail/manager.js";
import type { Rail, RailTrigger, Task as RailTask } from "../../../src/agent/types.js";
import { triggerRailExecution } from "./railExecute.js";

const router = Router();

const AUTO_EXEC_WINDOW_MS = 10 * 60_000; // 10 minutes
const AUTO_EXEC_MAX_PER_WINDOW = 10;
const autoExecCounters = new Map<string, { count: number; windowStart: number }>();

export async function completeTodosForRail(railId: string): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    const now = new Date().toISOString();
    const { data: rows } = await supabaseAdmin
      .from("todos")
      .select("id, workspace_id")
      .eq("rail_id", railId);
    await supabaseAdmin
      .from("todos")
      .update({ status: "completed", updated_at: now })
      .eq("rail_id", railId);
    if (rows && rows.length > 0) {
      const workspaceId = rows[0]!.workspace_id as string | null;
      if (workspaceId) {
        await supabaseAdmin.rpc("unlock_todos_for_workspace", {
          p_workspace_id: workspaceId,
        });
      }
    }
  } catch {
    // best-effort; do not throw from rail executor paths
  }
}

router.get("/todos", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const workspaceId = (req.query.workspaceId as string | undefined)?.trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", req.user!.id)
    .single();

  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const includeArchived = (req.query.includeArchived as string) === "true" || (req.query.includeArchived as string) === "1";
  let query = supabaseAdmin
    .from("todos")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (!includeArchived) {
    query = query.is("archived_at", null);
  }
  const { data, error } = await query;

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ todos: data ?? [] });
});

router.post("/todos", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const workspaceId = (req.body?.workspaceId as string | undefined)?.trim();
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const description =
    typeof req.body?.description === "string" ? req.body.description.trim() : null;
  const phase =
    typeof req.body?.phase === "number"
      ? req.body.phase
      : typeof req.body?.phase === "string"
        ? parseInt(req.body.phase, 10) || null
        : null;
  const dependsOn = Array.isArray(req.body?.dependsOn)
    ? (req.body.dependsOn as string[]).filter((x) => typeof x === "string" && x.trim())
    : [];

  if (!workspaceId || !title) {
    res.status(400).json({ error: "workspaceId and title are required" });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", req.user!.id)
    .single();

  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  if (dependsOn.length) {
    const { data: deps, error: depsErr } = await supabaseAdmin
      .from("todos")
      .select("id, status, depends_on")
      .in("id", dependsOn)
      .eq("workspace_id", workspaceId);
    if (depsErr) {
      res.status(500).json({ error: depsErr.message });
      return;
    }
    if (!deps || deps.length !== dependsOn.length) {
      res.status(400).json({ error: "One or more dependency todos do not exist in this workspace." });
      return;
    }
    const { data: allRows } = await supabaseAdmin
      .from("todos")
      .select("id, depends_on")
      .eq("workspace_id", workspaceId);
    const byId = new Map((allRows ?? []).map((r: any) => [r.id, { depends_on: r.depends_on ?? null }]));
    if (hasDependsOnCycle("_new_", dependsOn, byId)) {
      res.status(400).json({ error: "Circular dependency in dependsOn." });
      return;
    }
  }

  const { data, error } = await supabaseAdmin
    .from("todos")
    .insert({
      workspace_id: workspaceId,
      title,
      description,
      phase,
      depends_on: dependsOn.length ? dependsOn : null,
      status: "pending",
      source: req.body?.source ?? null,
      source_path: req.body?.sourcePath ?? null,
    })
    .select("*")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json({ todo: data });
});

/** Detect cycles in depends_on graph. nodeId + proposedDependsOn is the updated node; byId has all others. */
function hasDependsOnCycle(
  nodeId: string,
  proposedDependsOn: string[],
  byId: Map<string, { depends_on: string[] | null }>
): boolean {
  const graph = new Map(byId);
  graph.set(nodeId, { depends_on: proposedDependsOn });
  const visited = new Set<string>();
  const stack = new Set<string>();
  function visit(n: string): boolean {
    if (stack.has(n)) return true;
    if (visited.has(n)) return false;
    visited.add(n);
    stack.add(n);
    const deps = graph.get(n)?.depends_on ?? [];
    for (const d of deps) {
      if (d === nodeId || visit(d)) return true;
    }
    stack.delete(n);
    return false;
  }
  return visit(nodeId);
}

router.get("/todos/dependencies/ready", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const workspaceId = (req.query.workspaceId as string | undefined)?.trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", req.user!.id)
    .single();

  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("todos")
    .select("id, depends_on, status")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const rows = (data ?? []) as Array<{
    id: string;
    depends_on: string[] | null;
    status: string;
  }>;

  const byId = new Map(rows.map((r) => [r.id, r]));
  const ready: string[] = [];

  for (const row of rows) {
    if (row.status !== "pending") continue;
    const deps = row.depends_on ?? [];
    if (
      deps.every((id) => {
        const dep = byId.get(id);
        return dep && dep.status === "completed";
      })
    ) {
      ready.push(row.id);
    }
  }

  res.json({ ready });
});

/** Single todo by ID. Must be after /todos/dependencies/ready so that path is not matched as :id. */
router.get("/todos/:id", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const todoId = req.params.id;
  if (!todoId) {
    res.status(400).json({ error: "Todo id is required" });
    return;
  }
  const { data: row, error } = await supabaseAdmin
    .from("todos")
    .select("*")
    .eq("id", todoId)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!row) {
    res.status(404).json({ error: "Todo not found" });
    return;
  }
  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", row.workspace_id)
    .eq("owner_id", req.user!.id)
    .single();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  res.json({ todo: row });
});

router.patch("/todos/:id", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const todoId = req.params.id;
  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("todos")
    .select("id, workspace_id")
    .eq("id", todoId)
    .maybeSingle();

  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message });
    return;
  }
  if (!row) {
    res.status(404).json({ error: "Todo not found" });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", row.workspace_id)
    .eq("owner_id", req.user!.id)
    .single();

  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const updates: Record<string, unknown> = {};

  if (typeof req.body?.title === "string") {
    updates.title = req.body.title.trim();
  }
  if (typeof req.body?.description === "string") {
    updates.description = req.body.description.trim();
  }
  if (req.body?.phase !== undefined) {
    updates.phase =
      typeof req.body.phase === "number"
        ? req.body.phase
        : typeof req.body.phase === "string"
          ? parseInt(req.body.phase, 10) || null
          : null;
  }
  if (Array.isArray(req.body?.dependsOn)) {
    const dependsOn = (req.body.dependsOn as string[]).filter(
      (x) => typeof x === "string" && x.trim()
    );
    if (dependsOn.length) {
      const { data: allRows } = await supabaseAdmin
        .from("todos")
        .select("id, depends_on")
        .eq("workspace_id", (row as { workspace_id?: string }).workspace_id);
      const byId = new Map((allRows ?? []).map((r: any) => [r.id, { depends_on: r.depends_on ?? null }]));
      byId.set(todoId, { depends_on: dependsOn });
      if (hasDependsOnCycle(todoId, dependsOn, byId)) {
        res.status(400).json({ error: "Circular dependency in dependsOn." });
        return;
      }
    }
    updates.depends_on = dependsOn.length ? dependsOn : null;
  }
  if (typeof req.body?.status === "string") {
    updates.status = req.body.status;
  }
  if (req.body?.archived === false || req.body?.archived === null) {
    updates.archived_at = null;
  }
  if (req.body?.archived === true) {
    updates.archived_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from("todos")
    .update(updates)
    .eq("id", todoId)
    .select("*")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ todo: data });
});

router.delete("/todos/:id", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const todoId = req.params.id;
  const hardDelete = (req.query.hard as string) === "true" || (req.query.hard as string) === "1";

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("todos")
    .select("id, workspace_id")
    .eq("id", todoId)
    .maybeSingle();

  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message });
    return;
  }
  if (!row) {
    res.status(404).json({ error: "Todo not found" });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", row.workspace_id)
    .eq("owner_id", req.user!.id)
    .single();

  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  if (hardDelete) {
    const { error } = await supabaseAdmin.from("todos").delete().eq("id", todoId);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(204).send();
    return;
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("todos")
    .update({ archived_at: now })
    .eq("id", todoId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(204).send();
});

/** Core logic: create a rail from a todo. Returns { railId } or throws. Exported for greenfield→rail pipeline. */
export async function todoToRailCore(
  todoId: string,
  userId: string
): Promise<{ railId: string }> {
  if (!supabaseAdmin) throw new Error("Auth service not configured.");
  const { data: todoRow, error: todoErr } = await supabaseAdmin
    .from("todos")
    .select("id, title, description, workspace_id, rail_id, source, source_path")
    .eq("id", todoId)
    .maybeSingle();
  if (todoErr) throw new Error(todoErr.message);
  if (!todoRow) throw new Error("Todo not found");
  const workspaceId = todoRow.workspace_id as string | null;
  if (!workspaceId) throw new Error("Todo has no workspace_id");
  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", userId)
    .single();
  if (!ws) throw new Error("Access denied");
  if (todoRow.rail_id) return { railId: todoRow.rail_id };

  let rootPath: string | null = null;
  let repoUrl: string | null = null;
  const { data: graphRow } = await supabaseAdmin
    .from("graphs")
    .select("graph_json, repo_url")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const graph = (graphRow?.graph_json ?? null) as any;
  repoUrl = (graphRow?.repo_url as string | null) ?? null;
  const { rootPath: resolved, error } = await ensureProjectRoot(
    workspaceId,
    graph ?? { nodes: [], edges: [] },
    repoUrl
  );
  if (resolved !== null) rootPath = resolved;
  else if (error) throw new Error(error);
  if (!rootPath) throw new Error("Workspace has no project_root; scan a repo before creating rails.");

  const now = Date.now();
  const railId = `rail-todo-${todoId}-${now}`;
  const taskDesc =
    (typeof todoRow.description === "string" && todoRow.description.trim()) ||
    String(todoRow.title ?? "").slice(0, 200) ||
    "Implement todo";
  const logicStep = {
    step: 1,
    layer: "Service" as const,
    nodeId: "todo",
    filePath: "src",
    action: taskDesc.slice(0, 120),
  };
  const rail: Rail = {
    id: railId,
    version: 1,
    outcome: String(todoRow.title ?? "").slice(0, 200) || "Todo rail",
    trigger: {
      source: "chat",
      userMessage: `Todo: ${String(todoRow.title ?? "").slice(0, 200)}`,
      sessionId: userId ?? "webapp",
    },
    workspaceId,
    repoUrl,
    archetype: "analysis-chat",
    logicPath: [logicStep],
    state: "PRE_PLANNING",
    activeAgent: null,
    tasks: [],
    jiraKeys: [],
    traceIds: [],
    overlaps: [],
    createdAt: now,
    updatedAt: now,
    createdBy: "human",
    sessionId: userId ?? "webapp",
    originSummary:
      (typeof todoRow.description === "string" && todoRow.description.trim()) ||
      String(todoRow.title ?? "").slice(0, 200),
  };
  createRail(rootPath, rail);
  const codeTask: RailTask = {
    id: `task-todo-${todoId}`,
    railId,
    kind: "code_change",
    description: taskDesc,
    files: [],
    autoCapable: true,
    status: "pending",
    agent: "executor",
    logicStep: 1,
    createdAt: now,
  };
  createRailTask(codeTask);
  const { error: linkErr } = await supabaseAdmin.from("todos").update({ rail_id: railId }).eq("id", todoId);
  if (linkErr) throw new Error(linkErr.message);
  return { railId };
}

/** Run auto-rails-and-execute: pick ready todos, create rails, trigger execution. */
export async function runAutoRailsAndExecute(
  workspaceId: string,
  userId: string,
  limit: number
): Promise<{ startedRails: Array<{ id: string }> }> {
  if (!supabaseAdmin) return { startedRails: [] };
  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id, auto_execute_enabled")
    .eq("id", workspaceId)
    .eq("owner_id", userId)
    .single();
  if (!ws || !(ws as { auto_execute_enabled?: boolean }).auto_execute_enabled) {
    return { startedRails: [] };
  }
  const { data, error } = await supabaseAdmin
    .from("todos")
    .select("id, depends_on, status, archived_at")
    .eq("workspace_id", workspaceId);
  if (error) return { startedRails: [] };
  const rows = (data ?? []) as Array<{ id: string; depends_on: string[] | null; status: string; archived_at?: string | null }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const readyTodoIds: string[] = [];
  for (const row of rows) {
    if (row.archived_at != null || row.status !== "pending") continue;
    const deps = row.depends_on ?? [];
    if (deps.every((id) => (byId.get(id)?.status ?? "") === "completed")) {
      readyTodoIds.push(row.id);
    }
  }
  const picked = readyTodoIds.slice(0, Math.max(1, limit));
  const startedRails: Array<{ id: string }> = [];
  for (const todoId of picked) {
    try {
      const { railId } = await todoToRailCore(todoId, userId);
      await triggerRailExecution(railId, workspaceId, userId);
      startedRails.push({ id: railId });
    } catch (err) {
      console.warn("[auto-rails-and-execute] todo", todoId, err instanceof Error ? err.message : err);
    }
  }
  return { startedRails };
}

router.post("/todos/:id/to-rail", requireUser, async (req, res) => {
  const todoId = req.params.id;
  if (!todoId) {
    res.status(400).json({ error: "todo id is required" });
    return;
  }
  try {
    const { railId } = await todoToRailCore(todoId, req.user!.id);
    res.status(201).json({ railId, todoId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not configured")) res.status(503).json({ error: msg });
    else if (msg.includes("not found") || msg.includes("Todo not found")) res.status(404).json({ error: msg });
    else if (msg.includes("Access denied")) res.status(403).json({ error: msg });
    else if (msg.includes("required") || msg.includes("workspace")) res.status(400).json({ error: msg });
    else res.status(500).json({ error: msg });
  }
});

router.post("/todos/auto-rails-and-execute", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const workspaceId = (req.body?.workspaceId as string | undefined)?.trim();
  const limitRaw = req.body?.limit;
  const limit =
    typeof limitRaw === "number"
      ? limitRaw
      : typeof limitRaw === "string"
        ? parseInt(limitRaw, 10) || 3
        : 3;

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id, auto_execute_enabled")
    .eq("id", workspaceId)
    .eq("owner_id", req.user!.id)
    .single();

  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  if (!(ws as { auto_execute_enabled?: boolean }).auto_execute_enabled) {
    res.status(403).json({
      error: "Auto-execution is disabled for this workspace.",
      code: "AUTO_EXEC_DISABLED",
    });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("todos")
    .select("id, depends_on, status, archived_at")
    .eq("workspace_id", workspaceId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const rows = (data ?? []) as Array<{
    id: string;
    depends_on: string[] | null;
    status: string;
    archived_at?: string | null;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const readyTodoIds: string[] = [];
  for (const row of rows) {
    if (row.archived_at != null || row.status !== "pending") continue;
    const deps = row.depends_on ?? [];
    const allCompleted = deps.every((id) => {
      const dep = byId.get(id);
      return dep && dep.status === "completed";
    });
    if (allCompleted) readyTodoIds.push(row.id);
  }

  const picked = readyTodoIds.slice(0, Math.max(1, limit));

  if (picked.length === 0) {
    res.json({ startedRails: [], message: "No dependency-ready todos to execute." });
    return;
  }

  const { startedRails } = await runAutoRailsAndExecute(workspaceId, req.user!.id, limit);
  res.json({ startedRails, pickedTodoIds: picked });
});

/**
 * Same wiring as POST /todos/auto-rails-and-execute: both call runAutoRailsAndExecute.
 * Differences: rate-limited (AUTO_EXEC_MAX_PER_WINDOW per AUTO_EXEC_WINDOW_MS), returns remainingReady.
 */
router.post("/todos/auto-execute-ready", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const workspaceId = (req.body?.workspaceId as string | undefined)?.trim();
  const limitRaw = req.body?.limit;
  const limit =
    typeof limitRaw === "number"
      ? limitRaw
      : typeof limitRaw === "string"
        ? parseInt(limitRaw, 10) || 3
        : 3;

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  const now = Date.now();
  const counter = autoExecCounters.get(workspaceId) ?? { count: 0, windowStart: now };
  if (now - counter.windowStart > AUTO_EXEC_WINDOW_MS) {
    counter.count = 0;
    counter.windowStart = now;
  }
  if (counter.count >= AUTO_EXEC_MAX_PER_WINDOW) {
    autoExecCounters.set(workspaceId, counter);
    res.status(429).json({
      error: "Auto-execution limit reached for this workspace. Try again later.",
      code: "AUTO_EXEC_LIMIT",
      limit: AUTO_EXEC_MAX_PER_WINDOW,
      windowMs: AUTO_EXEC_WINDOW_MS,
    });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id, auto_execute_enabled")
    .eq("id", workspaceId)
    .eq("owner_id", req.user!.id)
    .single();

  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  if (!(ws as { auto_execute_enabled?: boolean }).auto_execute_enabled) {
    res.status(403).json({
      error: "Auto-execution is disabled for this workspace.",
      code: "AUTO_EXEC_DISABLED",
    });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("todos")
    .select("id, depends_on, status, archived_at")
    .eq("workspace_id", workspaceId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const rows = (data ?? []) as Array<{
    id: string;
    depends_on: string[] | null;
    status: string;
    archived_at?: string | null;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const readyTodoIds: string[] = [];

  for (const row of rows) {
    if (row.archived_at != null || row.status !== "pending") continue;
    const deps = row.depends_on ?? [];
    const allCompleted = deps.every((id) => {
      const dep = byId.get(id);
      return dep && dep.status === "completed";
    });
    if (allCompleted) readyTodoIds.push(row.id);
  }

  const picked = readyTodoIds.slice(0, Math.max(1, limit));

  if (picked.length === 0) {
    res.json({ startedRails: [], message: "No dependency-ready todos to execute." });
    return;
  }

  counter.count += picked.length;
  autoExecCounters.set(workspaceId, counter);

  const { startedRails } = await runAutoRailsAndExecute(workspaceId, req.user!.id, limit);
  res.json({
    startedRails,
    pickedTodoIds: picked,
    remainingReady: readyTodoIds.length - picked.length,
  });
});

router.post("/todos/from-chat", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const workspaceId = (req.body?.workspaceId as string | undefined)?.trim();
  const items = Array.isArray(req.body?.items)
    ? (req.body.items as unknown[]).map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
    : [];

  if (!workspaceId || items.length === 0) {
    res.status(400).json({ error: "workspaceId and at least one todo item are required" });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", req.user!.id)
    .single();

  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  // Best-effort dedupe against existing todos with same title in this workspace.
  const titles = items;
  const { data: existing } = await supabaseAdmin
    .from("todos")
    .select("title")
    .eq("workspace_id", workspaceId)
    .in("title", titles);
  const existingTitles = new Set<string>((existing ?? []).map((r: any) => String(r.title)));

  const rows = items
    .filter((title) => !existingTitles.has(title))
    .map((title) => ({
      workspace_id: workspaceId,
      title,
      description: null,
      phase: null,
      depends_on: null,
      status: "pending",
      source: "chat",
      source_path: null,
    }));

  if (rows.length === 0) {
    res.json({ created: [], skipped: items.length });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("todos")
    .insert(rows)
    .select("*");

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json({
    created: data ?? [],
    skipped: items.length - rows.length,
  });
});

export { router as todosRoutes };

