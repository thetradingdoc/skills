/**
 * Graph snapshots and drift: versioned SystemModel per scan, diff support.
 */
import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();

export interface GraphSnapshotSummary {
  id: string;
  workspaceId: string;
  scanId?: string;
  nodeCount: number;
  edgeCount: number;
  recordedAt: string;
}

/** List versioned graph snapshots for a workspace (from scan_history + graphs). */
router.get(
  "/workspaces/:workspaceId/graph-snapshots",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId!;
    const limit = Math.min(parseInt(String(req.query.limit ?? 20), 10) || 20, 100);

    const { data: scans, error: scanErr } = await supabaseAdmin
      .from("scan_history")
      .select("id, graph_id, node_count, edge_count, completed_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "completed")
      .not("graph_id", "is", null)
      .order("completed_at", { ascending: false })
      .limit(limit);

    if (scanErr) {
      res.status(500).json({ error: scanErr.message });
      return;
    }

    const summaries: GraphSnapshotSummary[] = (scans ?? []).map((s) => ({
      id: (s as { graph_id: string }).graph_id,
      workspaceId,
      scanId: (s as { id: string }).id,
      nodeCount: (s as { node_count?: number }).node_count ?? 0,
      edgeCount: (s as { edge_count?: number }).edge_count ?? 0,
      recordedAt: (s as { completed_at: string }).completed_at ?? "",
    }));

    res.json({ snapshots: summaries });
  }
);

/** Diff two graph snapshots (by graph id). Returns nodes/edges added/removed. */
router.get(
  "/workspaces/:workspaceId/graph-diff",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId!;
    const { fromId, toId } = req.query as { fromId?: string; toId?: string };
    if (!fromId || !toId) {
      res.status(400).json({ error: "fromId and toId query params required." });
      return;
    }

    const [fromRow, toRow] = await Promise.all([
      supabaseAdmin
        .from("graphs")
        .select("graph_json")
        .eq("id", fromId)
        .eq("workspace_id", workspaceId)
        .single(),
      supabaseAdmin
        .from("graphs")
        .select("graph_json")
        .eq("id", toId)
        .eq("workspace_id", workspaceId)
        .single(),
    ]);

    if (fromRow.error || !fromRow.data) {
      res.status(404).json({ error: "From snapshot not found." });
      return;
    }
    if (toRow.error || !toRow.data) {
      res.status(404).json({ error: "To snapshot not found." });
      return;
    }

    const fromGraph = (fromRow.data as { graph_json?: { nodes?: { id: string }[]; edges?: { id: string }[] } }).graph_json ?? {};
    const toGraph = (toRow.data as { graph_json?: { nodes?: { id: string }[]; edges?: { id: string }[] } }).graph_json ?? {};
    const fromNodes = new Set((fromGraph.nodes ?? []).map((n) => n.id));
    const toNodes = new Set((toGraph.nodes ?? []).map((n) => n.id));
    const fromEdges = new Set((fromGraph.edges ?? []).map((e) => e.id));
    const toEdges = new Set((toGraph.edges ?? []).map((e) => e.id));

    const nodesAdded = [...toNodes].filter((id) => !fromNodes.has(id));
    const nodesRemoved = [...fromNodes].filter((id) => !toNodes.has(id));
    const edgesAdded = [...toEdges].filter((id) => !fromEdges.has(id));
    const edgesRemoved = [...fromEdges].filter((id) => !toEdges.has(id));

    res.json({
      nodesAdded,
      nodesRemoved,
      edgesAdded,
      edgesRemoved,
      fromNodeCount: fromNodes.size,
      toNodeCount: toNodes.size,
      fromEdgeCount: fromEdges.size,
      toEdgeCount: toEdges.size,
    });
  }
);

/** Load a specific graph by id (for timeline/snapshot selector). */
router.get(
  "/workspaces/:workspaceId/graphs/:graphId",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId!;
    const graphId = req.params.graphId!;
    const { data, error } = await supabaseAdmin
      .from("graphs")
      .select("graph_json, repo_url, updated_at")
      .eq("id", graphId)
      .eq("workspace_id", workspaceId)
      .single();

    if (error || !data?.graph_json) {
      res.status(404).json({ error: "Snapshot not found." });
      return;
    }
    res.json({
      graph: (data as { graph_json: unknown }).graph_json,
      repoUrl: (data as { repo_url?: string }).repo_url ?? null,
      updatedAt: (data as { updated_at?: string }).updated_at ?? null,
    });
  }
);

export { router as graphSnapshotsRoutes };
