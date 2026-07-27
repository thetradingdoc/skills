import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();

/** List scan history for a workspace. */
router.get(
  "/workspaces/:workspaceId/scan-history",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId!;
    const limit = Math.min(parseInt(String(req.query.limit ?? 30), 10) || 30, 100);
    const { data, error } = await supabaseAdmin
      .from("scan_history")
      .select(
        "id, status, branch, commit_sha, ref, trigger, error_message, node_count, edge_count, started_at, completed_at"
      )
      .eq("workspace_id", workspaceId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ scans: data ?? [] });
  }
);

export { router as scanHistoryRoutes };

export type ScanHistoryTrigger = "manual" | "webhook" | "cron";

export interface InsertScanHistoryParams {
  workspaceId: string;
  status: "started" | "completed" | "failed";
  branch?: string | null;
  commitSha?: string | null;
  ref?: string | null;
  trigger?: ScanHistoryTrigger | null;
  errorMessage?: string | null;
  nodeCount?: number | null;
  edgeCount?: number | null;
  completedAt?: string | null;
  graphId?: string | null;
}

export async function insertScanHistory(
  params: InsertScanHistoryParams
): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const row: Record<string, unknown> = {
    workspace_id: params.workspaceId,
    status: params.status,
    branch: params.branch ?? null,
    commit_sha: params.commitSha ?? null,
    ref: params.ref ?? null,
    trigger: params.trigger ?? "manual",
    error_message: params.errorMessage ?? null,
    node_count: params.nodeCount ?? null,
    edge_count: params.edgeCount ?? null,
    completed_at: params.completedAt ?? null,
    graph_id: params.graphId ?? null,
  };
  const { data, error } = await supabaseAdmin
    .from("scan_history")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    console.warn("[scanHistory] insert failed:", error.message);
    return null;
  }
  return (data as { id: string })?.id ?? null;
}

export async function updateScanHistory(
  id: string,
  updates: Partial<{
    status: "started" | "completed" | "failed";
    error_message: string | null;
    node_count: number | null;
    edge_count: number | null;
    completed_at: string | null;
    graph_id: string | null;
  }>
): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from("scan_history").update(updates).eq("id", id);
}
