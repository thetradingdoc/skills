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
import { todoToRailCore } from "./todos.js";

const router = Router();

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

export { router as greenfieldRoutes };
