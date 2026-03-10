import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { getActiveViolations, runViolationScan } from "./violationStore.js";
import { ARCH_RULESET_VERSION } from "../../../src/ai/critic.js";

const router = Router();

/** 60s cooldown per workspace to prevent abuse of POST /violations/scan */
const scanCooldowns = new Map<string, number>();

router.get("/violations", requireUser, async (req, res) => {
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
        railId: v.rail_id ?? undefined,
        recurrenceCount: v.recurrence_count,
        firstSeenAt: v.first_seen_at,
        lastSeenAt: v.last_seen_at,
        policyState: v.policy_state,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Secret for cron/webhook triggers; if set, POST /violations/scan-trigger is enabled. */
const TRIGGER_SECRET = process.env.VIOLATION_SCAN_TRIGGER_SECRET?.trim() || null;

function runScanForWorkspace(
  workspaceId: string
): Promise<{ success: boolean; error?: string }> {
  return (async () => {
    if (!supabaseAdmin) return { success: false, error: "Auth not configured" };
    const { data: graphRow, error: gErr } = await supabaseAdmin
      .from("graphs")
      .select("graph_json")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (gErr || !graphRow?.graph_json) {
      return { success: false, error: gErr?.message ?? "No graph for workspace" };
    }
    const graph = graphRow.graph_json as {
      nodes?: Array<{ id?: string; layer?: string }>;
      edges?: Array<{ source?: string; target?: string; isLayerViolation?: boolean; isDrift?: boolean; driftReason?: string }>;
    };
    await runViolationScan(supabaseAdmin, workspaceId, graph, ARCH_RULESET_VERSION);
    return { success: true };
  })();
}

/** Trigger re-scan via cron/webhook. Requires VIOLATION_SCAN_TRIGGER_SECRET. */
router.post("/violations/scan-trigger", async (req, res) => {
  const secret =
    req.headers["x-scan-trigger-secret"] as string | undefined ?? 
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : undefined);
  if (!TRIGGER_SECRET || secret !== TRIGGER_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const workspaceId = (req.body?.workspaceId as string | undefined)?.trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const last = scanCooldowns.get(workspaceId) ?? 0;
  if (Date.now() - last < 60_000) {
    res.status(429).json({ error: "Scan cooldown: wait 60s" });
    return;
  }
  scanCooldowns.set(workspaceId, Date.now());
  try {
    const out = await runScanForWorkspace(workspaceId);
    if (!out.success) {
      res.status(400).json({ error: out.error });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Scan failed" });
  }
});

/** Trigger a violation re-scan for a workspace (loads latest graph, extracts layer + drift, upserts with markAbsent). */
router.post("/violations/scan", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const workspaceId = (req.body?.workspaceId as string | undefined)?.trim();
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

  const last = scanCooldowns.get(workspaceId) ?? 0;
  if (Date.now() - last < 60_000) {
    res.status(429).json({ error: "Scan cooldown: wait 60s between scans." });
    return;
  }
  scanCooldowns.set(workspaceId, Date.now());

  try {
    const out = await runScanForWorkspace(workspaceId);
    if (!out.success) {
      res.status(404).json({ error: out.error ?? "No graph saved for this workspace." });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Violation scan failed",
    });
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
    .eq("owner_id", req.user!.id)
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
        actor_id: req.user!.id,
        previous_state: row.policy_state ?? null,
        new_state: "waived",
        reason: "dismissed from UI",
      });
  } catch {
    // non-fatal; continue to update main row
  }

  await supabaseAdmin
    .from("violations")
    .update({ policy_state: "waived" })
    .eq("id", violationId);

  res.json({ success: true });
});

export { router as violationsRoutes };

