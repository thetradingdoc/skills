import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
const router = Router();

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
router.post("/workspaces/:workspaceId/annotations/:annotationId/comments", requireUser, requireWorkspaceAccess, async (req, res) => {
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

  res.status(201).json({ comment: data });
});

/** Delete a comment (author only). */
router.delete("/workspaces/:workspaceId/annotations/:annotationId/comments/:commentId", requireUser, requireWorkspaceAccess, async (req, res) => {
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
