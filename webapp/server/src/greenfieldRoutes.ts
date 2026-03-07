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

export { router as greenfieldRoutes };
