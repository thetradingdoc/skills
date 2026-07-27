import express from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = express.Router();

/** Fetch recent downvotes for feedback-loop context (last 7 days). */
export async function getRecentFeedbackForUser(
  userId: string,
  options?: { limit?: number }
): Promise<{ downvoteCount: number }> {
  if (!supabaseAdmin) return { downvoteCount: 0 };
  const limit = options?.limit ?? 10;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("ai_feedback")
    .select("id")
    .eq("user_id", userId)
    .eq("rating", "down")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { downvoteCount: 0 };
  return { downvoteCount: data?.length ?? 0 };
}

/** AI feedback endpoint: records thumbs-up/down + optional comment. Persists to ai_feedback for feedback loop. */
router.post("/chat-feedback", requireUser, async (req, res) => {
  const { taskId, rating, comment, workspaceId } = req.body as {
    taskId?: string;
    rating?: "up" | "down";
    comment?: string;
    workspaceId?: string;
  };
  if (!taskId || (rating !== "up" && rating !== "down")) {
    res.status(400).json({ error: "taskId and rating ('up' | 'down') are required" });
    return;
  }
  const userId = req.user!.id;
  const commentTrimmed =
    typeof comment === "string" && comment.trim() ? comment.slice(0, 2000) : null;

  if (supabaseAdmin) {
    try {
      await supabaseAdmin.from("ai_feedback").insert({
        user_id: userId,
        task_id: taskId,
        rating,
        comment: commentTrimmed,
        workspace_id: workspaceId ?? null,
      });
    } catch (e) {
      console.warn("[chat-feedback] insert failed:", e instanceof Error ? e.message : e);
    }
  }
  res.json({ ok: true });
});

export { router as feedbackRoutes };

