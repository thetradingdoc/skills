import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { getActiveViolations } from "./violationStore.js";
const router = Router();
router.get("/violations", requireUser, async (req, res) => {
    if (!supabaseAdmin) {
        res.status(503).json({ error: "Auth service not configured." });
        return;
    }
    const workspaceId = req.query.workspaceId?.trim();
    if (!workspaceId) {
        res.status(400).json({ error: "workspaceId is required" });
        return;
    }
    const { data: ws } = await supabaseAdmin
        .from("workspaces")
        .select("id")
        .eq("id", workspaceId)
        .eq("owner_id", req.user.id)
        .single();
    if (!ws) {
        res.status(403).json({ error: "Access denied." });
        return;
    }
    try {
        const violations = await getActiveViolations(supabaseAdmin, workspaceId);
        res.json({
            violations: violations.map((v) => ({
                id: v.id,
                type: v.type,
                severity: v.severity,
                sourceNodeId: v.source_node_id,
                targetNodeId: v.target_node_id ?? undefined,
                description: v.description ?? "",
                suggestedFix: v.suggested_fix ?? "",
                jiraKey: v.jira_key ?? undefined,
                jiraStatus: v.jira_status ?? undefined,
                recurrenceCount: v.recurrence_count,
                firstSeenAt: v.first_seen_at,
                lastSeenAt: v.last_seen_at,
                policyState: v.policy_state,
            })),
        });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
router.post("/violations/:id/dismiss", requireUser, async (req, res) => {
    if (!supabaseAdmin) {
        res.status(503).json({ error: "Auth service not configured." });
        return;
    }
    const violationId = req.params.id;
    const { data: row } = await supabaseAdmin
        .from("violations")
        .select("id, workspace_id, policy_state")
        .eq("id", violationId)
        .single();
    if (!row) {
        res.status(404).json({ error: "Violation not found." });
        return;
    }
    const { data: ws } = await supabaseAdmin
        .from("workspaces")
        .select("id")
        .eq("id", row.workspace_id)
        .eq("owner_id", req.user.id)
        .single();
    if (!ws) {
        res.status(403).json({ error: "Access denied." });
        return;
    }
    // Record policy event for audit trail
    try {
        await supabaseAdmin
            .from("violation_policy_events")
            .insert({
            violation_id: violationId,
            workspace_id: row.workspace_id,
            actor_id: req.user.id,
            previous_state: row.policy_state ?? null,
            new_state: "waived",
            reason: "dismissed from UI",
        });
    }
    catch {
        // non-fatal; continue to update main row
    }
    await supabaseAdmin
        .from("violations")
        .update({ policy_state: "waived" })
        .eq("id", violationId);
    res.json({ success: true });
});
export { router as violationsRoutes };
