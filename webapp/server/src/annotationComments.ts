import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { requireCanEdit } from "./middleware/requireCanEdit.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { notifyMention } from "./notifications.js";
const router = Router();

/**
 * Extracts @nickname tokens from comment text, resolves them to workspace
 * members (owner + workspace_members), and notifies each resolved user
 * (except the author). Best-effort: a resolution or notify failure never
 * blocks the comment itself.
 */
async function notifyMentionedMembers(params: {
  workspaceId: string;
  annotationId: string;
  authorId: string;
  authorName: string;
  content: string;
}): Promise<void> {
  if (!supabaseAdmin) return;
  const { workspaceId, annotationId, authorId, authorName, content } = params;

  const handles = [...new Set(Array.from(content.matchAll(/@([\w.-]+)/g), (m) => m[1]!))];
  if (handles.length === 0) return;

  try {
    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("owner_id")
      .eq("id", workspaceId)
      .maybeSingle();
    const { data: members } = await supabaseAdmin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId);

    const memberIds = new Set<string>((members ?? []).map((m: { user_id: string }) => m.user_id));
    const ownerId = (ws as { owner_id?: string } | null)?.owner_id;
    if (ownerId) memberIds.add(ownerId);
    if (memberIds.size === 0) return;

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, nickname")
      .in("user_id", [...memberIds]);

    const byNickname = new Map<string, string>();
    for (const p of (profiles ?? []) as Array<{ user_id: string; nickname?: string | null }>) {
      if (p.nickname) byNickname.set(p.nickname.toLowerCase(), p.user_id);
    }

    const targets = new Set<string>();
    for (const handle of handles) {
      const userId = byNickname.get(handle.toLowerCase());
      if (userId && userId !== authorId) targets.add(userId);
    }

    for (const userId of targets) {
      await notifyMention({
        userId,
        workspaceId,
        kind: "mention",
        title: `${authorName} mentioned you`,
        body: content.slice(0, 240),
        deepLink: { workspaceId, annotationId },
      });
    }
  } catch (e) {
    console.warn("[annotationComments] mention resolution failed:", e instanceof Error ? e.message : e);
  }
}

/** List comments for an annotation (annotation must belong to workspace). */
router.get("/workspaces/:workspaceId/annotations/:annotationId/comments", requireUser, requireWorkspaceAccess, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { annotationId } = req.params;

  const { data: ann } = await supabaseAdmin
    .from("workspace_annotations")
    .select("id, workspace_id")
    .eq("id", annotationId)
    .single();

  if (!ann || (ann as { workspace_id: string }).workspace_id !== req.params.workspaceId) {
    res.status(404).json({ error: "Annotation not found." });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("annotation_comments")
    .select("id, parent_id, author_id, author_name, content, created_at, updated_at")
    .eq("annotation_id", annotationId)
    .order("created_at", { ascending: true });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ comments: data ?? [] });
});

/** Create a comment on an annotation. */
router.post("/workspaces/:workspaceId/annotations/:annotationId/comments", requireUser, requireWorkspaceAccess, requireCanEdit, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { annotationId } = req.params;
  const { content, parent_id } = req.body ?? {};

  const { data: ann } = await supabaseAdmin
    .from("workspace_annotations")
    .select("id, workspace_id")
    .eq("id", annotationId)
    .single();

  if (!ann || (ann as { workspace_id: string }).workspace_id !== req.params.workspaceId) {
    res.status(404).json({ error: "Annotation not found." });
    return;
  }

  const text = typeof content === "string" ? content.trim().slice(0, 5000) : "";
  if (!text) {
    res.status(400).json({ error: "content is required." });
    return;
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("nickname")
    .eq("user_id", req.user!.id)
    .maybeSingle();

  const authorName = (profile as { nickname?: string } | null)?.nickname ?? req.user!.email ?? "User";

  const payload: Record<string, unknown> = {
    annotation_id: annotationId,
    author_id: req.user!.id,
    author_name: authorName,
    content: text,
  };
  if (typeof parent_id === "string" && parent_id.trim()) payload.parent_id = parent_id.trim();

  const { data, error } = await supabaseAdmin
    .from("annotation_comments")
    .insert(payload)
    .select("id, parent_id, author_id, author_name, content, created_at")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  void notifyMentionedMembers({
    workspaceId: req.params.workspaceId!,
    annotationId,
    authorId: req.user!.id,
    authorName,
    content: text,
  });

  res.status(201).json({ comment: data });
});

/** Delete a comment (author only). */
router.delete("/workspaces/:workspaceId/annotations/:annotationId/comments/:commentId", requireUser, requireWorkspaceAccess, requireCanEdit, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { annotationId, commentId } = req.params;

  const { data: comment } = await supabaseAdmin
    .from("annotation_comments")
    .select("id, author_id, annotation_id")
    .eq("id", commentId)
    .eq("annotation_id", annotationId)
    .maybeSingle();

  if (!comment) {
    res.status(404).json({ error: "Comment not found." });
    return;
  }

  if ((comment as { author_id: string }).author_id !== req.user!.id) {
    res.status(403).json({ error: "You can only delete your own comments." });
    return;
  }

  const { error } = await supabaseAdmin
    .from("annotation_comments")
    .delete()
    .eq("id", commentId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ ok: true });
});

export { router as annotationCommentsRoutes };
