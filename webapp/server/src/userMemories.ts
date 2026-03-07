/**
 * User-level memories — preferences and patterns that apply across workspaces.
 */

import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();
const CONTENT_MAX = 2000;

router.get("/user/memories", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const userId = req.user!.id;
  const limit = Math.min(parseInt(String(req.query.limit ?? 50), 10) || 50, 100);

  const { data, error } = await supabaseAdmin
    .from("user_memories")
    .select("id, content, memory_type, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ memories: data ?? [] });
});

router.post("/user/memories", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const userId = req.user!.id;
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : undefined;
  const memoryType =
    typeof req.body?.memory_type === "string" && req.body.memory_type.trim()
      ? req.body.memory_type.trim()
      : "user_preference";

  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  if (content.length > CONTENT_MAX) {
    res.status(400).json({ error: `content must be at most ${CONTENT_MAX} characters` });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("user_memories")
    .insert({
      user_id: userId,
      content: content.slice(0, CONTENT_MAX),
      memory_type: memoryType,
    })
    .select("id, content, memory_type, created_at")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

router.delete("/user/memories/:memoryId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const userId = req.user!.id;
  const memoryId = req.params.memoryId;
  if (!memoryId) {
    res.status(400).json({ error: "memoryId required" });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("user_memories")
    .delete()
    .eq("id", memoryId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Memory not found" });
    return;
  }
  res.status(204).send();
});

export const userMemoriesRoutes = router;
