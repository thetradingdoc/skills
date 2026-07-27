import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();

/** List workspace members. Owner can see all; members see themselves + others. */
router.get("/workspaces/:workspaceId/members", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId!;
  const { data, error } = await supabaseAdmin
    .from("workspace_members")
    .select("id, user_id, role, invited_at, invited_by")
    .eq("workspace_id", workspaceId)
    .order("invited_at", { ascending: true });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const memberIds = [...new Set((data ?? []).map((m: { user_id: string }) => m.user_id))];
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("user_id, nickname")
    .in("user_id", memberIds);

  const profileMap = new Map((profiles ?? []).map((p: { user_id: string; nickname?: string }) => [p.user_id, p.nickname]));

  const members = (data ?? []).map((m: { id: string; user_id: string; role: string; invited_at: string; invited_by?: string }) => ({
    ...m,
    displayName: profileMap.get(m.user_id) ?? m.user_id.slice(0, 8),
  }));

  res.json({ members });
});

/** Invite a member by email (resolve to user_id). Owner only. */
router.post("/workspaces/:workspaceId/members", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId!;
  const ws = (req as { workspace?: { id: string; owner_id: string } }).workspace;
  if (!ws || ws.owner_id !== req.user!.id) {
    res.status(403).json({ error: "Only the owner can invite members." });
    return;
  }

  const { email, userId: bodyUserId, role } = req.body ?? {};
  const roleVal = typeof role === "string" && ["editor", "viewer"].includes(role) ? role : "viewer";

  let targetUserId: string;
  if (typeof bodyUserId === "string" && bodyUserId.trim()) {
    targetUserId = bodyUserId.trim();
  } else if (typeof email === "string" && email.trim()) {
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const target = (listData?.users ?? []).find(
      (u) => u.email?.toLowerCase() === email.trim().toLowerCase()
    );
    if (!target) {
      res.status(404).json({ error: "No user found with that email." });
      return;
    }
    targetUserId = target.id;
  } else {
    res.status(400).json({ error: "email or userId is required." });
    return;
  }

  const { error } = await supabaseAdmin.from("workspace_members").upsert(
    {
      workspace_id: workspaceId,
      user_id: targetUserId,
      role: roleVal,
      invited_by: req.user!.id,
    },
    { onConflict: "workspace_id,user_id" }
  );

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json({ ok: true, userId: targetUserId, role: roleVal });
});

/** Update member role. Owner only. */
router.patch("/workspaces/:workspaceId/members/:memberId", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ws = (req as { workspace?: { id: string; owner_id: string } }).workspace;
  if (!ws || ws.owner_id !== req.user!.id) {
    res.status(403).json({ error: "Only the owner can update roles." });
    return;
  }

  const { workspaceId, memberId } = req.params;
  const { role } = req.body ?? {};
  if (typeof role !== "string" || !["editor", "viewer"].includes(role)) {
    res.status(400).json({ error: "role must be 'editor' or 'viewer'." });
    return;
  }

  const { error } = await supabaseAdmin
    .from("workspace_members")
    .update({ role })
    .eq("id", memberId)
    .eq("workspace_id", workspaceId)
    .neq("role", "owner");

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ ok: true, role });
});

/** Remove member. Owner can remove anyone; members can remove themselves. */
router.delete("/workspaces/:workspaceId/members/:memberId", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId!;
  const memberId = req.params.memberId;
  const ws = (req as { workspace?: { id: string; owner_id: string } }).workspace;

  const { data: member } = await supabaseAdmin
    .from("workspace_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!member) {
    res.status(404).json({ error: "Member not found." });
    return;
  }

  const canRemove =
    ws?.owner_id === req.user!.id ||
    ((member as { user_id: string }).user_id === req.user!.id);
  if (!canRemove) {
    res.status(403).json({ error: "Cannot remove this member." });
    return;
  }

  if ((member as { role: string }).role === "owner") {
    res.status(403).json({ error: "Cannot remove the owner." });
    return;
  }

  const { error } = await supabaseAdmin
    .from("workspace_members")
    .delete()
    .eq("id", memberId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ ok: true });
});

export { router as workspaceMembersRoutes };
