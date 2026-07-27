/**
 * Greenfield session and draft node APIs.
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireUser } from "./middleware/requireUser.js";
import {
  loadDraft,
  saveDraft,
  deleteDraft,
  appendDraftNode,
  removeDraftNode,
  updateDraftNode,
  appendDraftEdge,
  type DraftNode,
  type DraftEdge,
} from "./greenfieldDraft.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

/** Topological order: dependencies first. Edge source→target means source depends on target, so target before source. */
function computeTopologicalOrder(
  nodes: DraftNode[],
  edges: DraftEdge[]
): DraftNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outEdges = new Map<string, string[]>();
  for (const e of edges) {
    const list = outEdges.get(e.target) ?? [];
    list.push(e.source);
    outEdges.set(e.target, list);
  }
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const e of edges)
    inDegree.set(e.source, (inDegree.get(e.source) ?? 0) + 1);
  const queue = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const to of outEdges.get(id) ?? []) {
      const d = (inDegree.get(to) ?? 1) - 1;
      inDegree.set(to, d);
      if (d === 0) queue.push(to);
    }
  }
  const ordered: DraftNode[] = [];
  for (const id of order) {
    const n = byId.get(id);
    if (n) ordered.push(n);
  }
  for (const n of nodes) {
    if (!ordered.some((o) => o.id === n.id)) ordered.push(n);
  }
  return ordered;
}
import { todoToRailCore } from "./todos.js";
import { triggerRailExecution } from "./railExecute.js";
import { bootstrapProjectRoot } from "./cloneRepo.js";

const router = Router();

/** Resolve project root for greenfield implement: workspace.project_root or targetRoot. */
async function resolveImplementRoot(
  workspaceId: string,
  targetRoot: string | undefined,
  userId: string
): Promise<{ rootPath: string; error?: string }> {
  if (!supabaseAdmin) return { rootPath: "", error: "Auth service not configured." };
  // Try workspace.project_root first
  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("project_root")
    .eq("id", workspaceId)
    .eq("owner_id", userId)
    .maybeSingle();
  const stored = (ws as { project_root?: string | null } | null)?.project_root;
  if (typeof stored === "string" && stored.trim()) {
    const root = stored.trim();
    return { rootPath: root };
  }
  if (typeof targetRoot === "string" && targetRoot.trim()) {
    return { rootPath: targetRoot.trim() };
  }
  return {
    rootPath: "",
    error:
      "Workspace has no project root and no targetRoot provided. " +
      "Scan a repository or provide targetRoot (path to project directory) for Implement.",
  };
}

router.post("/greenfield/session", requireUser, (req, res) => {
  const sessionId = randomUUID();
  const { workspaceId } = (req.body ?? {}) as { workspaceId?: string };
  saveDraft(sessionId, { nodes: [], edges: [], workspaceId });
  res.status(201).json({ sessionId, mode: "greenfield" });
});

router.get("/greenfield/draft/:sessionId", requireUser, (req, res) => {
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const draft = loadDraft(sessionId);
  if (!draft) {
    res.status(404).json({ error: "Draft not found." });
    return;
  }
  res.json(draft);
});

/** Preview folder structure for a draft — returns tree of paths for implement. */
router.get("/greenfield/draft/:sessionId/preview", requireUser, (req, res) => {
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const draft = loadDraft(sessionId);
  if (!draft) {
    res.status(404).json({ error: "Draft not found." });
    return;
  }
  const ordered = computeTopologicalOrder(draft.nodes, draft.edges);
  const tree: Array<{ path: string; label: string; layer?: string; hasSkeleton: boolean }> = ordered.map((n) => ({
    path: n.id,
    label: n.label || n.id,
    layer: n.layer,
    hasSkeleton: !!(n.skeletonCode && n.skeletonCode.trim()),
  }));
  res.json({ nodes: ordered, folderTree: tree });
});

router.put("/greenfield/draft/:sessionId", requireUser, (req, res) => {
  const sessionId = req.params.sessionId;
  const body = req.body as { nodes?: DraftNode[]; edges?: DraftEdge[]; workspaceId?: string };
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const draft = saveDraft(sessionId, {
    nodes: Array.isArray(body.nodes) ? body.nodes : [],
    edges: Array.isArray(body.edges) ? body.edges : [],
    workspaceId: body.workspaceId,
  });
  res.json(draft);
});

router.delete("/greenfield/draft/:sessionId", requireUser, (req, res) => {
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const deleted = deleteDraft(sessionId);
  res.json({ deleted });
});

router.post("/greenfield/nodes", requireUser, (req, res) => {
  const { sessionId, node } = req.body as { sessionId?: string; node?: DraftNode };
  if (!sessionId || !node?.id) {
    res.status(400).json({ error: "sessionId and node (with id) are required." });
    return;
  }
  const draft = appendDraftNode(sessionId, node);
  res.status(201).json({ draftNodeId: node.id, draft });
});

router.patch("/greenfield/nodes/:nodeId", requireUser, (req, res) => {
  const nodeId = req.params.nodeId;
  const { sessionId, ...updates } = req.body as { sessionId?: string } & Partial<DraftNode>;
  if (!sessionId || !nodeId) {
    res.status(400).json({ error: "sessionId (body) and nodeId (path) are required." });
    return;
  }
  const draft = updateDraftNode(sessionId, nodeId, updates);
  if (!draft) {
    res.status(404).json({ error: "Draft or node not found." });
    return;
  }
  res.json(draft);
});

router.delete("/greenfield/nodes/:nodeId", requireUser, (req, res) => {
  const nodeId = req.params.nodeId;
  const sessionId = (req.query.sessionId as string)?.trim();
  if (!sessionId || !nodeId) {
    res.status(400).json({ error: "sessionId (query) and nodeId (path) are required." });
    return;
  }
  const draft = removeDraftNode(sessionId, nodeId);
  if (!draft) {
    res.status(404).json({ error: "Draft or node not found." });
    return;
  }
  res.json(draft);
});

router.post("/greenfield/edges", requireUser, (req, res) => {
  const { sessionId, edge } = req.body as { sessionId?: string; edge?: DraftEdge };
  if (!sessionId || !edge?.source || !edge?.target) {
    res.status(400).json({ error: "sessionId and edge (source, target) are required." });
    return;
  }
  const draft = appendDraftEdge(sessionId, edge);
  res.status(201).json({ draft });
});

router.post("/greenfield/nodes/:nodeId/to-todo", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const nodeId = req.params.nodeId;
  const { sessionId, workspaceId } = req.body as {
    sessionId?: string;
    workspaceId?: string;
  };
  if (!sessionId || !nodeId || !workspaceId) {
    res.status(400).json({ error: "sessionId, workspaceId, and nodeId are required." });
    return;
  }

  const draft = loadDraft(sessionId);
  if (!draft) {
    res.status(404).json({ error: "Draft not found." });
    return;
  }

  const node = draft.nodes.find((n) => n.id === nodeId);
  if (!node) {
    res.status(404).json({ error: "Node not found in draft." });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", req.user!.id)
    .maybeSingle();

  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const title = node.label || node.id;
  const description = node.description ?? null;

  const { data, error } = await supabaseAdmin
    .from("todos")
    .insert({
      workspace_id: workspaceId,
      title,
      description,
      phase: null,
      depends_on: null,
      status: "pending",
      source: "greenfield",
      source_path: node.archNodeId ?? node.id,
    })
    .select("*")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json({ todo: data });
});

/** Unified pipeline: create todo from greenfield node and immediately create rail. Returns { railId, todoId }. */
router.post("/greenfield/nodes/:nodeId/to-rail", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const nodeId = req.params.nodeId;
  const { sessionId, workspaceId } = req.body as {
    sessionId?: string;
    workspaceId?: string;
  };
  if (!sessionId || !nodeId || !workspaceId) {
    res.status(400).json({ error: "sessionId, workspaceId, and nodeId are required." });
    return;
  }

  const draft = loadDraft(sessionId);
  if (!draft) {
    res.status(404).json({ error: "Draft not found." });
    return;
  }

  const node = draft.nodes.find((n) => n.id === nodeId);
  if (!node) {
    res.status(404).json({ error: "Node not found in draft." });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", req.user!.id)
    .maybeSingle();

  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const title = node.label || node.id;
  const description = node.description ?? null;

  const { data: todoRow, error: todoErr } = await supabaseAdmin
    .from("todos")
    .insert({
      workspace_id: workspaceId,
      title,
      description,
      phase: null,
      depends_on: null,
      status: "pending",
      source: "greenfield",
      source_path: node.archNodeId ?? node.id,
    })
    .select("id")
    .single();

  if (todoErr || !todoRow) {
    res.status(500).json({ error: todoErr?.message ?? "Failed to create todo." });
    return;
  }

  const todoId = String(todoRow.id);
  try {
    const { railId } = await todoToRailCore(todoId, req.user!.id);
    res.status(201).json({ railId, todoId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create rail.";
    res.status(500).json({ error: msg });
  }
});

/**
 * Implement this design — create todos + rails from draft nodes and trigger execution.
 * Each node becomes a todo → rail; the rail executor runs the code writer to implement each module.
 * Requires workspace with project_root or targetRoot in body.
 */
router.post("/greenfield/implement", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { sessionId, workspaceId, targetRoot, nodeIds, acceptanceCriteria } = req.body as {
    sessionId?: string;
    workspaceId?: string;
    targetRoot?: string;
    nodeIds?: string[];
    acceptanceCriteria?: { functional?: string[] };
  };
  if (!sessionId || !workspaceId) {
    res.status(400).json({ error: "sessionId and workspaceId are required." });
    return;
  }

  const draft = loadDraft(sessionId);
  if (!draft) {
    res.status(404).json({ error: "Draft not found." });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id, project_root")
    .eq("id", workspaceId)
    .eq("owner_id", req.user!.id)
    .maybeSingle();
  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  let rootPath: string;
  const resolved = await resolveImplementRoot(workspaceId, targetRoot, req.user!.id);
  if (resolved.error || !resolved.rootPath) {
    if (targetRoot?.trim()) {
      const boot = await bootstrapProjectRoot(targetRoot.trim());
      if (boot.error || !boot.rootPath) {
        res.status(400).json({ error: boot.error ?? "Bootstrap failed." });
        return;
      }
      rootPath = boot.rootPath;
    } else {
      res.status(400).json({ error: resolved.error ?? "Project root required." });
      return;
    }
  } else {
    rootPath = resolved.rootPath;
  }

  // Ensure workspace has project_root for todoToRailCore/ensureProjectRoot
  const currentRoot = (ws as { project_root?: string | null }).project_root;
  if (!currentRoot || currentRoot.trim() !== rootPath) {
    await supabaseAdmin
      .from("workspaces")
      .update({ project_root: rootPath })
      .eq("id", workspaceId);
    const { data: graphRow } = await supabaseAdmin
      .from("graphs")
      .select("id, graph_json")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (graphRow?.graph_json) {
      const graph = graphRow.graph_json as Record<string, unknown>;
      await supabaseAdmin
        .from("graphs")
        .update({ graph_json: { ...graph, projectRoot: rootPath } })
        .eq("id", graphRow.id);
    }
  }

  const rawNodes =
    Array.isArray(nodeIds) && nodeIds.length > 0
      ? draft.nodes.filter((n) => nodeIds.includes(n.id))
      : draft.nodes;
  const nodes = computeTopologicalOrder(rawNodes, draft.edges);
  if (nodes.length === 0) {
    res.status(400).json({ error: "No nodes to implement. Add nodes to the draft first." });
    return;
  }
  if (nodes.length > 20) {
    res.status(400).json({
      error: "Maximum 20 nodes per implement. Select a subset or split into batches.",
    });
    return;
  }

  const acLines =
    (acceptanceCriteria?.functional?.length ?? 0) > 0
      ? "\nAcceptance: " + (acceptanceCriteria?.functional ?? []).slice(0, 5).join("; ")
      : "";
  const nodeIdToTodoId = new Map<string, string>();
  const railIds: string[] = [];
  const todoIds: string[] = [];
  const errors: string[] = [];

  for (const node of nodes) {
    const depIds = draft.edges
      .filter((e) => e.source === node.id)
      .map((e) => e.target)
      .filter((id) => nodeIdToTodoId.has(id));
    const dependsOn = depIds
      .map((id) => nodeIdToTodoId.get(id))
      .filter((id): id is string => !!id);

    const title = node.label || node.id;
    let description = (node.description ?? "").trim() + acLines;
    const designerCtx: string[] = [];
    if (node.layer) designerCtx.push(`layer: ${node.layer}`);
    if (node.archNodeId) designerCtx.push(`archNodeId: ${node.archNodeId}`);
    if (node.skeletonCode?.trim()) designerCtx.push(`skeleton:\n${node.skeletonCode.trim().slice(0, 2000)}`);
    if (designerCtx.length > 0) {
      description += `\n\n--- Designer context ---\n${designerCtx.join("\n")}`;
    }
    const { data: todoRow, error: todoErr } = await supabaseAdmin
      .from("todos")
      .insert({
        workspace_id: workspaceId,
        title,
        description: description || null,
        phase: null,
        depends_on: dependsOn.length > 0 ? dependsOn : null,
        status: "pending",
        source: "greenfield",
        source_path: node.archNodeId ?? node.id,
      })
      .select("id")
      .single();
    if (todoErr || !todoRow) {
      errors.push(`${node.label ?? node.id}: ${todoErr?.message ?? "Failed to create todo"}`);
      continue;
    }
    const todoId = String(todoRow.id);
    todoIds.push(todoId);
    nodeIdToTodoId.set(node.id, todoId);
    try {
      const { railId } = await todoToRailCore(todoId, req.user!.id);
      railIds.push(railId);
      await triggerRailExecution(railId, workspaceId, req.user!.id);
    } catch (err) {
      errors.push(
        `${node.label ?? node.id}: ${err instanceof Error ? err.message : "Failed to create/execute rail"}`
      );
    }
  }

  res.status(201).json({
    ok: true,
    railIds,
    todoIds,
    errors: errors.length > 0 ? errors : undefined,
  });
});

export { router as greenfieldRoutes };
