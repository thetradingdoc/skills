import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { ensureProjectRoot } from "./cloneRepo.js";
import { createRail, createTask as createRailTask, getRail, loadRails } from "../../../src/agent/rail/manager.js";
import type { Rail, Task as RailTask } from "../../../src/agent/types.js";
import { triggerRailExecution } from "./railExecute.js";
import {
  getMemoriesForContext,
  buildMemoryContextBlock,
} from "./memoryRetrieval.js";
import { appendTodoSessionLog } from "./taskSessionLog.js";
import { debugLog } from "./debugLog.js";
import { materializeAnalysisRail } from "./railMaterializeCore.js";
import {
  canTransitionTodo,
  normalizeTodoStatus,
  isDependencyDone,
  buildTaskAgentPrompt,
} from "./todoPhase1.js";

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
      .update({ status: "done", updated_at: now })
      .eq("rail_id", railId);
    for (const row of rows ?? []) {
      await appendTodoSessionLog(row.id as string, "done", { railId });
    }
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
  const agentFile = typeof req.query.agentFile === "string" ? req.query.agentFile.trim() : "";
  let query = supabaseAdmin
    .from("todos")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (!includeArchived) {
    query = query.is("archived_at", null);
  }
  // Exact match only — paths contain `/` and break PostgREST `.or()` filters.
  if (agentFile) {
    query = query.eq("agent_file", agentFile);
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

  const agentFile =
    typeof req.body?.agentFile === "string" ? req.body.agentFile.trim() || null : null;
  const layerId =
    typeof req.body?.layerId === "string" ? req.body.layerId.trim() || null : null;
  const assigneeLabel =
    typeof req.body?.assigneeLabel === "string"
      ? req.body.assigneeLabel.trim() || "Cursor"
      : "Cursor";
  const kindRaw = typeof req.body?.kind === "string" ? req.body.kind.trim() : "task";
  const kind = kindRaw === "issue" ? "issue" : "task";

  const { data, error } = await supabaseAdmin
    .from("todos")
    .insert({
      workspace_id: workspaceId,
      title,
      description,
      phase,
      depends_on: dependsOn.length ? dependsOn : null,
      status: "todo",
      context: typeof req.body?.context === "string" ? req.body.context.trim() : null,
      constraints: typeof req.body?.constraints === "string" ? req.body.constraints.trim() : null,
      acceptance_criteria:
        req.body?.acceptanceCriteria && typeof req.body.acceptanceCriteria === "object"
          ? req.body.acceptanceCriteria
          : null,
      file_scope: Array.isArray(req.body?.fileScope)
        ? (req.body.fileScope as string[]).filter((x) => typeof x === "string" && x.trim())
        : null,
      session_log: [],
      source: req.body?.source ?? null,
      source_path: req.body?.sourcePath ?? null,
      agent_file: agentFile,
      layer_id: layerId,
      assignee_label: assigneeLabel,
      kind,
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
        return dep && isDependencyDone(dep.status);
      })
    ) {
      ready.push(row.id);
    }
  }

  res.json({ ready });
});

async function resolveWorkspaceRoot(
  workspaceId: string,
  userId: string
): Promise<{ root: string; repoUrl: string | null } | { error: string }> {
  const { data: graphRow } = await supabaseAdmin!
    .from("graphs")
    .select("graph_json, repo_url")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const graph = (graphRow?.graph_json ?? null) as any;
  const repoUrl = (graphRow?.repo_url as string | null) ?? null;
  const { rootPath, error } = await ensureProjectRoot(
    workspaceId,
    graph ?? { nodes: [], edges: [] },
    repoUrl
  );
  if (rootPath) return { root: rootPath, repoUrl };
  return { error: error || "Workspace has no project_root; scan a repo first." };
}

router.post("/todos/:id/run", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const todoId = req.params.id;
  try {
    const { data: row } = await supabaseAdmin
      .from("todos")
      .select("*")
      .eq("id", todoId)
      .maybeSingle();
    if (!row) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    const workspaceId = row.workspace_id as string;
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
    const status = normalizeTodoStatus(row.status);
    if (status !== "todo") {
      res.status(400).json({ error: `Task must be todo to run (current: ${status}).` });
      return;
    }
    const memories = await getMemoriesForContext(supabaseAdmin, workspaceId, {});
    const memoryBlock = buildMemoryContextBlock(memories, [], []);
    await supabaseAdmin
      .from("todos")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", todoId);
    await appendTodoSessionLog(todoId, "started", {
      title: row.title,
      context: row.context,
      constraints: row.constraints,
      file_scope: row.file_scope,
      memories_preview: memoryBlock.slice(0, 1500),
    });
    const { railId } = await todoToRailCore(todoId, req.user!.id, memoryBlock);
    const { taskId } = await triggerRailExecution(railId, workspaceId, req.user!.id);
    await appendTodoSessionLog(todoId, "execute_triggered", { railId, taskId });
    const { data: updated } = await supabaseAdmin.from("todos").select("*").eq("id", todoId).single();
    res.json({ todo: updated, railId, taskId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await appendTodoSessionLog(todoId, "error", { message: msg });
    res.status(500).json({ error: msg });
  }
});

router.post("/todos/:id/approve", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const todoId = req.params.id;
  const force = req.body?.force === true;
  try {
    const { data: row } = await supabaseAdmin
      .from("todos")
      .select("*")
      .eq("id", todoId)
      .maybeSingle();
    if (!row) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    const status = normalizeTodoStatus(row.status);
    if (status !== "needs_review") {
      res.status(400).json({ error: `Task must be needs_review to approve (current: ${status}).` });
      return;
    }
    const railId = row.rail_id as string | null;
    if (!railId) {
      res.status(400).json({ error: "Task has no linked rail." });
      return;
    }
    const workspaceId = row.workspace_id as string;
    const resolved = await resolveWorkspaceRoot(workspaceId, req.user!.id);
    if ("error" in resolved) {
      res.status(400).json({ error: resolved.error });
      return;
    }
    void force;
    const result = materializeAnalysisRail(resolved.root, railId);
    if (!result.ok) {
      res.status(result.status ?? 500).json({ error: result.error });
      return;
    }
    await completeTodosForRail(railId);
    await appendTodoSessionLog(todoId, "approved", { railId, copied: true });
    const { data: updated } = await supabaseAdmin.from("todos").select("*").eq("id", todoId).single();
    res.json({ todo: updated, rail: result.rail });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/todos/:id/reject", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const todoId = req.params.id;
  const backTo = req.body?.backTo === "in_progress" ? "in_progress" : "todo";
  try {
    const { data: row } = await supabaseAdmin
      .from("todos")
      .select("*")
      .eq("id", todoId)
      .maybeSingle();
    if (!row) {
      res.status(404).json({ error: "Todo not found" });
      return;
    }
    const status = normalizeTodoStatus(row.status);
    if (status !== "needs_review") {
      res.status(400).json({ error: `Task must be needs_review to reject (current: ${status}).` });
      return;
    }
    if (!canTransitionTodo("needs_review", backTo)) {
      res.status(400).json({ error: "Invalid reject target status." });
      return;
    }
    await supabaseAdmin
      .from("todos")
      .update({
        status: backTo,
        rail_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", todoId);
    // #region agent log
    debugLog({
      hypothesisId: "H1",
      location: "todos.ts:reject",
      message: "reject cleared rail_id",
      data: { todoId, backTo, previousRailId: row.rail_id ?? null },
    });
    // #endregion
    await appendTodoSessionLog(todoId, "rejected", {
      backTo,
      reason: req.body?.reason ?? null,
      cleared_rail_id: row.rail_id ?? null,
    });
    const { data: updated } = await supabaseAdmin.from("todos").select("*").eq("id", todoId).single();
    res.json({ todo: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
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
    const next = normalizeTodoStatus(req.body.status);
    const { data: cur } = await supabaseAdmin
      .from("todos")
      .select("status")
      .eq("id", todoId)
      .single();
    const from = normalizeTodoStatus((cur as { status?: string } | null)?.status);
    if (!canTransitionTodo(from, next)) {
      res.status(400).json({ error: `Invalid status transition: ${from} → ${next}` });
      return;
    }
    updates.status = next;
  }
  if (typeof req.body?.context === "string") updates.context = req.body.context.trim();
  if (typeof req.body?.constraints === "string") updates.constraints = req.body.constraints.trim();
  if (req.body?.acceptanceCriteria !== undefined) {
    updates.acceptance_criteria =
      req.body.acceptanceCriteria && typeof req.body.acceptanceCriteria === "object"
        ? req.body.acceptanceCriteria
        : null;
  }
  if (Array.isArray(req.body?.fileScope)) {
    updates.file_scope = (req.body.fileScope as string[]).filter(
      (x) => typeof x === "string" && x.trim()
    );
  }
  if (req.body?.archived === false || req.body?.archived === null) {
    updates.archived_at = null;
  }
  if (req.body?.archived === true) {
    updates.archived_at = new Date().toISOString();
  }
  if (typeof req.body?.agentFile === "string") {
    updates.agent_file = req.body.agentFile.trim() || null;
  }
  if (typeof req.body?.layerId === "string") {
    updates.layer_id = req.body.layerId.trim() || null;
  }
  if (typeof req.body?.assigneeLabel === "string") {
    updates.assignee_label = req.body.assigneeLabel.trim() || "Cursor";
  }
  if (typeof req.body?.kind === "string") {
    updates.kind = req.body.kind.trim() === "issue" ? "issue" : "task";
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
  userId: string,
  memoryBlock?: string
): Promise<{ railId: string }> {
  if (!supabaseAdmin) throw new Error("Auth service not configured.");
  const { data: todoRow, error: todoErr } = await supabaseAdmin
    .from("todos")
    .select(
      "id, title, description, context, constraints, acceptance_criteria, file_scope, workspace_id, rail_id, source, source_path"
    )
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

  const reusableStates = new Set([
    "PRE_PLANNING",
    "PLANNING",
    "AWAITING_APPROVAL",
    "EXECUTING",
    "VERIFYING",
    "SELF_CORRECTING",
  ]);
  if (todoRow.rail_id) {
    loadRails(rootPath);
    const existing = getRail(rootPath, todoRow.rail_id as string);
    const reuse =
      existing && reusableStates.has(existing.state as string);
    // #region agent log
    debugLog({
      hypothesisId: "H2",
      location: "todos.ts:todoToRailCore",
      message: "rail reuse decision",
      data: {
        todoId,
        existingRailId: todoRow.rail_id,
        railState: existing?.state ?? null,
        reuse,
        newRail: !reuse,
      },
    });
    // #endregion
    if (reuse) return { railId: todoRow.rail_id as string };
    await supabaseAdmin.from("todos").update({ rail_id: null }).eq("id", todoId);
  }

  const now = Date.now();
  const railId = `rail-todo-${todoId}-${now}`;
  const agentPrompt = buildTaskAgentPrompt(todoRow as any);
  const taskDesc = agentPrompt.slice(0, 4000) || String(todoRow.title ?? "").slice(0, 200) || "Implement todo";
  const fileScope = Array.isArray(todoRow.file_scope)
    ? (todoRow.file_scope as string[]).filter((x) => typeof x === "string" && x.trim())
    : [];
  const primaryPath = fileScope[0] ?? "src";
  const logicStep = {
    step: 1,
    layer: "Service" as const,
    nodeId: "todo",
    filePath: primaryPath.replace(/\*\*$/, "").replace(/\/$/, "") || "src",
    action: taskDesc.slice(0, 120),
  };
  const ac = todoRow.acceptance_criteria as
    | { functional?: string[]; visual?: string[]; architectural?: string[]; technical?: string[] }
    | null;
  const acceptanceCriteria =
    ac && typeof ac === "object"
      ? {
          functional: Array.isArray(ac.functional) ? ac.functional : [],
          visual: Array.isArray(ac.visual) ? ac.visual : [],
          architectural: Array.isArray(ac.architectural)
            ? ac.architectural
            : Array.isArray(ac.technical)
              ? ac.technical
              : [],
        }
      : undefined;
  const rail: Rail = {
    id: railId,
    version: 1,
    outcome: `${String(todoRow.title ?? "").slice(0, 200)}\n\n${memoryBlock ? `${memoryBlock.slice(0, 3000)}\n\n` : ""}${taskDesc}`.slice(
      0,
      8000
    ),
    trigger: {
      source: "chat",
      userMessage: `Task: ${String(todoRow.title ?? "").slice(0, 200)}`,
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
    originSummary: taskDesc.slice(0, 500),
    acceptanceCriteria,
  };
  createRail(rootPath, rail);
  const codeTask: RailTask = {
    id: `task-todo-${todoId}`,
    railId,
    kind: "code_change",
    description: taskDesc,
    files: fileScope,
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
    if (row.archived_at != null || normalizeTodoStatus(row.status) !== "todo") continue;
    const deps = row.depends_on ?? [];
    if (deps.every((id) => isDependencyDone(byId.get(id)?.status))) {
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
    if (row.archived_at != null || normalizeTodoStatus(row.status) !== "todo") continue;
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
    if (row.archived_at != null || normalizeTodoStatus(row.status) !== "todo") continue;
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
      status: "todo",
      session_log: [],
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

