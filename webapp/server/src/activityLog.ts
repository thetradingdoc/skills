import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();

export async function logWorkspaceActivity(
  supabase: SupabaseClient | null,
  params: {
    workspaceId: string;
    actorId: string | null;
    actorName?: string | null;
    action: string;
    entityType: "scene" | "view" | "annotation";
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("workspace_activity_log").insert({
      workspace_id: params.workspaceId,
      actor_id: params.actorId,
      actor_name: params.actorName ?? null,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      metadata: params.metadata ?? null,
    });
  } catch {
    // best-effort; don't fail the main operation
  }
}

/** Get recent activity for a workspace. */
router.get("/workspaces/:workspaceId/activity", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = req.params.workspaceId!;
  const limit = Math.min(parseInt(String(req.query.limit ?? 50), 10) || 50, 100);
  const { data, error } = await supabaseAdmin
    .from("workspace_activity_log")
    .select("id, actor_id, actor_name, action, entity_type, entity_id, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ activities: data ?? [] });
});

export { router as activityRoutes };
