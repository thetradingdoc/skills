/**
 * Section claims: lightweight "I've got this" markers on a layer, node, or
 * section, so two people don't quietly redesign the same part of the
 * architecture at once. One claim per (workspace, kind, target) — claiming
 * something already claimed just moves it to you.
 */
import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { requireCanEdit } from "./middleware/requireCanEdit.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();

const VALID_KINDS = ["layer", "node", "section"] as const;
type ClaimKind = (typeof VALID_KINDS)[number];

/** Pure rule: only the claimer or the workspace owner may release a claim. Exported for unit testing. */
export function canReleaseClaim(
  claim: { claimer_id: string },
  ws: { owner_id: string },
  userId: string
): boolean {
  return claim.claimer_id === userId || ws.owner_id === userId;
}

type ClaimRow = {
  id: string;
  workspace_id: string;
  kind: ClaimKind;
  target_id: string;
  target_label: string | null;
  claimer_id: string;
  claimed_at: string;
};

/** List claims for a workspace, joined with the claimer's nickname. */
router.get("/workspaces/:workspaceId/claims", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId!;

  const { data, error } = await supabaseAdmin
    .from("section_claims")
    .select("id, workspace_id, kind, target_id, target_label, claimer_id, claimed_at")
    .eq("workspace_id", workspaceId)
    .order("claimed_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const rows = (data ?? []) as ClaimRow[];
  const claimerIds = [...new Set(rows.map((r) => r.claimer_id))];
  const profileMap = new Map<string, string>();
  if (claimerIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, nickname")
      .in("user_id", claimerIds);
    for (const p of (profiles ?? []) as Array<{ user_id: string; nickname?: string | null }>) {
      if (p.nickname) profileMap.set(p.user_id, p.nickname);
    }
  }

  const claims = rows.map((r) => ({
    ...r,
    claimerNickname: profileMap.get(r.claimer_id) ?? r.claimer_id.slice(0, 8),
  }));

  res.json({ claims });
});

/** Claim (or move) a layer/node/section to the current user. */
router.post(
  "/workspaces/:workspaceId/claims",
  requireUser,
  requireWorkspaceAccess,
  requireCanEdit,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId!;
    const { kind, targetId, targetLabel } = req.body as {
      kind?: string;
      targetId?: string;
      targetLabel?: string | null;
    };

    if (typeof kind !== "string" || !VALID_KINDS.includes(kind as ClaimKind)) {
      res.status(400).json({ error: "kind must be one of " + VALID_KINDS.join(", ") });
      return;
    }
    if (typeof targetId !== "string" || !targetId.trim()) {
      res.status(400).json({ error: "targetId is required." });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from("section_claims")
      .upsert(
        {
          workspace_id: workspaceId,
          kind,
          target_id: targetId.trim(),
          target_label: typeof targetLabel === "string" ? targetLabel.slice(0, 200) : null,
          claimer_id: req.user!.id,
          claimed_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,kind,target_id" }
      )
      .select("id, workspace_id, kind, target_id, target_label, claimer_id, claimed_at")
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({ claim: data });
  }
);

/** Release a claim. The claimer or the workspace owner may do this. */
router.delete(
  "/workspaces/:workspaceId/claims/:claimId",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const { workspaceId, claimId } = req.params;
    const ws = (req as typeof req & { workspace?: { owner_id: string } }).workspace;

    const { data: claim } = await supabaseAdmin
      .from("section_claims")
      .select("id, claimer_id")
      .eq("id", claimId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!claim) {
      res.status(404).json({ error: "Claim not found." });
      return;
    }

    const canRemove = canReleaseClaim(claim as { claimer_id: string }, ws ?? { owner_id: "" }, req.user!.id);
    if (!canRemove) {
      res.status(403).json({ error: "Only the claimer or the workspace owner can release this claim." });
      return;
    }

    const { error } = await supabaseAdmin.from("section_claims").delete().eq("id", claimId);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ ok: true });
  }
);

export { router as sectionClaimsRoutes };
