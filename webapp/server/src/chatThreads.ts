/**
 * Chat threads and messages — persist chat history per workspace.
 */

import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();
const MESSAGES_LIMIT = 100;

async function verifyWorkspace(workspaceId: string, ownerId: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const { data } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", ownerId)
    .single();
  return !!data;
}

router.get("/workspaces/:workspaceId/threads", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId required" });
    return;
  }
  const ok = await verifyWorkspace(workspaceId, ownerId);
  if (!ok) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const q = (typeof req.query.q === "string" ? req.query.q.trim() : "") || null;
  let query = supabaseAdmin
    .from("chat_threads")
    .select("id, title, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (q && q.length > 0) {
    query = query.ilike("title", `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  }
  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ threads: data ?? [] });
});

router.post("/workspaces/:workspaceId/threads", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  const title = typeof req.body?.title === "string" ? req.body.title.trim() || "New chat" : "New chat";
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId required" });
    return;
  }
  const ok = await verifyWorkspace(workspaceId, ownerId);
  if (!ok) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("chat_threads")
    .insert({ workspace_id: workspaceId, title })
    .select("id, title, created_at, updated_at")
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

router.get("/workspaces/:workspaceId/threads/:threadId/messages", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  const threadId = req.params.threadId;
  if (!workspaceId || !threadId) {
    res.status(400).json({ error: "workspaceId and threadId required" });
    return;
  }
  const ok = await verifyWorkspace(workspaceId, ownerId);
  if (!ok) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? MESSAGES_LIMIT), 10) || MESSAGES_LIMIT, 200);
  const { data: thread } = await supabaseAdmin
    .from("chat_threads")
    .select("id")
    .eq("id", threadId)
    .eq("workspace_id", workspaceId)
    .single();
  if (!thread) {
    res.status(404).json({ error: "Thread not found." });
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ messages: data ?? [] });
});

router.post("/workspaces/:workspaceId/threads/:threadId/messages", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  const threadId = req.params.threadId;
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!workspaceId || !threadId) {
    res.status(400).json({ error: "workspaceId and threadId required" });
    return;
  }
  if (messages.length === 0) {
    res.status(400).json({ error: "messages array required (at least one {role, content})" });
    return;
  }
  const ok = await verifyWorkspace(workspaceId, ownerId);
  if (!ok) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data: thread } = await supabaseAdmin
    .from("chat_threads")
    .select("id")
    .eq("id", threadId)
    .eq("workspace_id", workspaceId)
    .single();
  if (!thread) {
    res.status(404).json({ error: "Thread not found." });
    return;
  }
  const rows = messages
    .filter((m: unknown) => m && typeof m === "object" && "role" in m && "content" in m)
    .slice(0, 10)
    .map((m: { role: string; content: string }) => ({
      thread_id: threadId,
      role: ["user", "assistant"].includes(String(m.role)) ? m.role : "user",
      content: String(m.content).slice(0, 10000),
    }));
  if (rows.length === 0) {
    res.status(400).json({ error: "No valid messages" });
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .insert(rows)
    .select("id, role, content, created_at");
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  await supabaseAdmin
    .from("chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId);
  res.status(201).json({ messages: data ?? [] });
});

router.patch("/workspaces/:workspaceId/threads/:threadId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  const threadId = req.params.threadId;
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : undefined;
  if (!workspaceId || !threadId || !title) {
    res.status(400).json({ error: "workspaceId, threadId, and title required" });
    return;
  }
  const ok = await verifyWorkspace(workspaceId, ownerId);
  if (!ok) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("chat_threads")
    .update({ title: title.slice(0, 200), updated_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("workspace_id", workspaceId)
    .select("id, title, updated_at")
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

export const chatThreadRoutes = router;
