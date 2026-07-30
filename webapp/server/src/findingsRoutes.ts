/**
 * Findings as objects.
 *
 * A finding used to be recomputed on every scan and had nowhere to hold a
 * decision. These routes give it state, an assignee, a rationale and a
 * timeline — which is what makes it something a second person can pick up.
 *
 * Two rules run through all of this:
 *
 *   A scan never overwrites a human decision. upsert_finding_from_scan
 *   refreshes only severity, title and detail; state, assignee, rationale and
 *   log are left alone.
 *
 *   Nothing is deleted. A finding the latest scan no longer reports is marked
 *   absent, because it might be fixed or it might be in code the tracer could
 *   no longer follow, and the decision history matters either way.
 */
import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();

type ScanFinding = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail?: string;
  source?: string;
  agent?: string;
};

/** Confirms the caller owns this workspace. Mirrors the violations routes. */
async function ownsWorkspace(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const { data } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", userId)
    .maybeSingle();
  return !!data;
}

async function appendLog(
  workspaceId: string,
  findingId: string,
  entry: Record<string, unknown>
): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin.rpc("append_finding_log", {
    p_workspace_id: workspaceId,
    p_finding_id: findingId,
    p_entry: entry,
  });
}

/** Everything known about this workspace's findings, newest decisions first. */
router.get("/findings", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = String(req.query.workspaceId ?? "").trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required." });
    return;
  }
  if (!(await ownsWorkspace(workspaceId, req.user!.id))) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("workspace_findings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ findings: data ?? [] });
});

/**
 * Reconcile a scan's findings against what is stored. Called after a scan;
 * safe to call repeatedly.
 */
router.post("/findings/sync", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { workspaceId, findings } = req.body as {
    workspaceId?: string;
    findings?: ScanFinding[];
  };
  if (!workspaceId || !Array.isArray(findings)) {
    res.status(400).json({ error: "workspaceId and findings are required." });
    return;
  }
  if (!(await ownsWorkspace(workspaceId, req.user!.id))) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const errors: string[] = [];
  for (const f of findings) {
    if (!f?.id || !f?.severity || !f?.title) continue;
    const { error } = await supabaseAdmin.rpc("upsert_finding_from_scan", {
      p_workspace_id: workspaceId,
      p_finding_id: f.id,
      p_severity: f.severity,
      p_title: f.title,
      p_detail: f.detail ?? null,
      p_source: f.source ?? null,
      p_agent_file: f.agent ?? null,
    });
    if (error) errors.push(f.id + ": " + error.message);
  }

  // Anything not in this scan is absent, not gone.
  const present = findings.map((f) => f.id).filter(Boolean);
  const { data: absentCount, error: absentErr } = await supabaseAdmin.rpc(
    "mark_findings_absent",
    { p_workspace_id: workspaceId, p_present_ids: present }
  );
  if (absentErr) errors.push("mark_absent: " + absentErr.message);

  res.json({
    synced: present.length,
    markedAbsent: absentCount ?? 0,
    errors: errors.length ? errors : undefined,
  });
});

/**
 * Change state, assignee or rationale. Every change is logged, so the
 * question "who decided this, when, and why" is always answerable.
 */
router.patch("/findings/:findingId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const findingId = decodeURIComponent(req.params.findingId);
  const { workspaceId, state, assigneeId, rationale, actorName } =
    req.body as {
      workspaceId?: string;
      state?: string;
      assigneeId?: string | null;
      rationale?: string;
      actorName?: string;
    };

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required." });
    return;
  }
  if (!(await ownsWorkspace(workspaceId, req.user!.id))) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const { data: row } = await supabaseAdmin
    .from("workspace_findings")
    .select("id, state, assignee_id, rationale")
    .eq("workspace_id", workspaceId)
    .eq("finding_id", findingId)
    .maybeSingle();

  if (!row) {
    res.status(404).json({ error: "Finding not found. Sync a scan first." });
    return;
  }

  const VALID = ["open", "accepted", "waived", "resolved"];
  if (state && !VALID.includes(state)) {
    res.status(400).json({ error: "state must be one of " + VALID.join(", ") });
    return;
  }
  // Waiving without a reason is how a finding disappears quietly. Require one.
  if (state === "waived" && !(rationale ?? row.rationale ?? "").trim()) {
    res
      .status(400)
      .json({ error: "A rationale is required to waive a finding." });
    return;
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (state) {
    patch.state = state;
    patch.decided_by = req.user!.id;
    patch.decided_at = new Date().toISOString();
  }
  if (assigneeId !== undefined) patch.assignee_id = assigneeId;
  if (rationale !== undefined) patch.rationale = rationale;

  const { error } = await supabaseAdmin
    .from("workspace_findings")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("finding_id", findingId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const now = new Date().toISOString();
  const who = actorName || req.user!.email || req.user!.id;

  if (state && state !== row.state) {
    await appendLog(workspaceId, findingId, {
      at: now,
      actor: req.user!.id,
      actor_name: who,
      kind: "state",
      from: row.state,
      to: state,
      text: rationale ?? null,
    });
  }
  if (assigneeId !== undefined && assigneeId !== row.assignee_id) {
    await appendLog(workspaceId, findingId, {
      at: now,
      actor: req.user!.id,
      actor_name: who,
      kind: "assign",
      from: row.assignee_id ?? null,
      to: assigneeId ?? null,
      text: null,
    });
  }
  if (rationale !== undefined && rationale !== row.rationale && !state) {
    await appendLog(workspaceId, findingId, {
      at: now,
      actor: req.user!.id,
      actor_name: who,
      kind: "rationale",
      from: null,
      to: null,
      text: rationale,
    });
  }

  const { data: updated } = await supabaseAdmin
    .from("workspace_findings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("finding_id", findingId)
    .maybeSingle();

  res.json({ finding: updated });
});

/** A comment is a decision with no state change, so it shares the log. */
router.post("/findings/:findingId/comment", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const findingId = decodeURIComponent(req.params.findingId);
  const { workspaceId, text, actorName } = req.body as {
    workspaceId?: string;
    text?: string;
    actorName?: string;
  };

  if (!workspaceId || !text?.trim()) {
    res.status(400).json({ error: "workspaceId and text are required." });
    return;
  }
  if (!(await ownsWorkspace(workspaceId, req.user!.id))) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const { data: row } = await supabaseAdmin
    .from("workspace_findings")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("finding_id", findingId)
    .maybeSingle();

  if (!row) {
    res.status(404).json({ error: "Finding not found. Sync a scan first." });
    return;
  }

  await appendLog(workspaceId, findingId, {
    at: new Date().toISOString(),
    actor: req.user!.id,
    actor_name: actorName || req.user!.email || req.user!.id,
    kind: "comment",
    from: null,
    to: null,
    text: text.trim(),
  });

  const { data: updated } = await supabaseAdmin
    .from("workspace_findings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("finding_id", findingId)
    .maybeSingle();

  res.json({ finding: updated });
});

export { router as findingsRoutes };
