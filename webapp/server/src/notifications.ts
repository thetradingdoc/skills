/**
 * @mention and assignment notifications.
 *
 * Notifications are user-scoped, not workspace-scoped — a user reads their
 * own inbox regardless of which workspace they're currently in. `deep_link`
 * carries enough context (workspaceId + whatever else) for the client to
 * navigate straight to the thing that was mentioned.
 */
import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();

export type NotificationKind = "mention" | "assign" | "claim" | "system";

export interface NotifyMentionParams {
  userId: string;
  workspaceId?: string | null;
  kind?: NotificationKind;
  title: string;
  body?: string | null;
  deepLink?: Record<string, unknown> | null;
}

/** Best-effort: a failed notification insert should never break the caller's primary action. */
export async function notifyMention(params: NotifyMentionParams): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from("notifications").insert({
      user_id: params.userId,
      workspace_id: params.workspaceId ?? null,
      kind: params.kind ?? "mention",
      title: params.title,
      body: params.body ?? null,
      deep_link: params.deepLink ?? null,
    });
  } catch (e) {
    console.warn("[notifications] notifyMention failed:", e instanceof Error ? e.message : e);
  }
}

/** The caller's notifications, unread first. */
router.get("/notifications", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? 50), 10) || 50, 200);

  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("id, workspace_id, kind, title, body, deep_link, read_at, created_at")
    .eq("user_id", req.user!.id)
    .order("read_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const notifications = data ?? [];
  const unreadCount = notifications.filter((n: { read_at: string | null }) => !n.read_at).length;
  res.json({ notifications, unreadCount });
});

/** Mark one notification read. */
router.patch("/notifications/:id/read", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", req.user!.id)
    .select("id, read_at")
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Notification not found." });
    return;
  }

  res.json({ ok: true, notification: data });
});

export { router as notificationsRoutes };
