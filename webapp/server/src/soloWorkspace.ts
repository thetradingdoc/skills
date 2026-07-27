import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();

/** Get or create the solo workspace for the current user. */
router.get("/solo/workspace", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const { data: existing } = await supabaseAdmin
    .from("workspaces")
    .select("id, name, created_at, project_root")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    res.json({ workspace: existing, created: false });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .insert({ owner_id: ownerId, name: "Solo" })
    .select("id, name, created_at, project_root")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  await supabaseAdmin.from("workspace_members").upsert(
    { workspace_id: (data as { id: string }).id, user_id: ownerId, role: "owner" },
    { onConflict: "workspace_id,user_id" }
  );

  res.json({ workspace: data, created: true });
});

export { router as soloWorkspaceRoutes };
