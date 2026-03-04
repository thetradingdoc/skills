/**
 * Metrics API — expose task and materialize metrics summary.
 * Thin wrapper re-exporting src/ai/metrics.
 */
import { Router } from "express";
import { getTaskMetricsSummary, getMaterializeMetricsSummary, } from "../../../src/ai/metrics.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { requireUser } from "./middleware/requireUser.js";
const router = Router();
router.get("/metrics/agent", requireUser, async (req, res) => {
    const workspaceId = req.query.workspaceId?.trim() || null;
    const nodeId = req.query.nodeId?.trim() || null;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    if (!supabaseAdmin) {
        return res.json({ traces: [], message: "Supabase not configured" });
    }
    const ownerId = req.user?.id;
    if (!ownerId) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    try {
        // Restrict to workspaces owned by the current user
        const { data: workspaces, error: wsErr } = await supabaseAdmin
            .from("workspaces")
            .select("id")
            .eq("owner_id", ownerId);
        if (wsErr) {
            return res.status(500).json({ error: wsErr.message });
        }
        const allowedIds = (workspaces ?? []).map((w) => w.id);
        if (allowedIds.length === 0) {
            return res.json({ traces: [] });
        }
        let query = supabaseAdmin
            .from("model_traces")
            .select("id, workspace_id, node_id, question, agent_answer, agent_model, critic_model, agent_latency_ms, critic_score, langsmith_url, created_at")
            .order("created_at", { ascending: false })
            .limit(limit)
            .in("workspace_id", allowedIds);
        if (workspaceId) {
            if (!allowedIds.includes(workspaceId)) {
                return res.status(404).json({ traces: [], error: "Workspace not found or access denied." });
            }
            query = query.eq("workspace_id", workspaceId);
        }
        if (nodeId) {
            query = query.eq("node_id", nodeId);
        }
        const { data, error } = await query;
        if (error) {
            return res.status(500).json({
                error: "Failed to fetch agent traces",
                details: error.message,
            });
        }
        return res.json({ traces: data ?? [] });
    }
    catch (err) {
        return res.status(500).json({
            error: err instanceof Error ? err.message : "Unknown error",
        });
    }
});
router.get("/metrics", (_req, res) => {
    const tasks = getTaskMetricsSummary();
    const materialize = getMaterializeMetricsSummary();
    res.json({
        tasks: {
            totalTasks: tasks.totalTasks,
            greenfieldCount: tasks.greenfieldCount,
            analysisCount: tasks.analysisCount,
            avgLatencyMs: tasks.avgLatencyMs,
            avgCriticScore: tasks.avgCriticScore,
            errorCount: tasks.errorCount,
        },
        materialize: {
            totalMaterializes: materialize.totalMaterializes,
            successCount: materialize.successCount,
            avgNodesCreated: materialize.avgNodesCreated,
        },
    });
});
export { router as metricsRoutes };
