import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { isValidProjectKey } from "./utils/deriveProjectKey.js";

const router = Router();

router.get("/workspaces", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .select("id,name,created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ workspaces: data ?? [] });
});

router.post("/workspaces", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .insert({ owner_id: ownerId, name })
    .select("id,name,created_at")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ workspace: data });
});

/** Load latest graph + repo URL for a workspace (user must own it). */
router.get("/workspaces/:workspaceId/load", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  const { data: ws, error: wsErr } = await supabaseAdmin
    .from("workspaces")
    .select("id, jira_project_key")
    .eq("id", workspaceId)
    .eq("owner_id", ownerId)
    .single();

  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }

  const { data: graphRow, error: gErr } = await supabaseAdmin
    .from("graphs")
    .select("graph_json, repo_url")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (gErr) {
    res.status(500).json({ error: gErr.message });
    return;
  }

  if (!graphRow?.graph_json) {
    res.status(404).json({ error: "No graph saved for this workspace." });
    return;
  }

  const graph = graphRow.graph_json as { nodes?: Array<{ id?: string }>; edges?: unknown[] };
  const nodeIdsWithTraces = new Set<string>();

  const { data: traceRows } = await supabaseAdmin
    .from("model_traces")
    .select("node_id")
    .eq("workspace_id", workspaceId)
    .not("node_id", "is", null);

  for (const row of traceRows ?? []) {
    const id = (row as { node_id?: string }).node_id;
    if (typeof id === "string" && id.trim()) nodeIdsWithTraces.add(id.trim());
  }

  if (graph?.nodes && Array.isArray(graph.nodes)) {
    for (const n of graph.nodes) {
      if (n?.id) (n as Record<string, unknown>).hasTraces = nodeIdsWithTraces.has(n.id);
    }
  }

  res.json({
    graph: graph as Record<string, unknown>,
    repoUrl: graphRow.repo_url ?? "",
    jiraProjectKey: (ws as { jira_project_key?: string | null }).jira_project_key ?? null,
  });
});

/** Get workspace memories (optionally filtered by node_id). */
router.get("/workspaces/:workspaceId/memories", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  const nodeId = (req.query.nodeId as string | undefined)?.trim() || null;

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  const { data: ws, error: wsErr } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", ownerId)
    .single();

  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }

  let query = supabaseAdmin
    .from("workspace_memories")
    .select("id, workspace_id, node_id, content, memory_type, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (nodeId) {
    query = query.eq("node_id", nodeId);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json({ memories: data ?? [] });
});

/** Permanently delete a workspace and all associated data. */
router.delete("/workspaces/:workspaceId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  try {
    // Verify ownership first.
    const { data: ws, error: wsErr } = await supabaseAdmin
      .from("workspaces")
      .select("id")
      .eq("id", workspaceId)
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (wsErr) {
      console.error("[workspaces] delete: lookup failed", {
        workspaceId,
        ownerId,
        error: wsErr.message,
      });
      res.status(500).json({ error: wsErr.message });
      return;
    }

    if (!ws) {
      res.status(404).json({ error: "Workspace not found or access denied." });
      return;
    }

    // Delete workspace row; ON DELETE CASCADE should clean up graphs, share_links, violations, etc.
    const { error: delErr } = await supabaseAdmin
      .from("workspaces")
      .delete()
      .eq("id", workspaceId)
      .eq("owner_id", ownerId);

    if (delErr) {
      console.error("[workspaces] delete: delete failed", {
        workspaceId,
        ownerId,
        error: delErr.message,
      });
      res.status(500).json({ error: delErr.message });
      return;
    }

    console.log("[workspaces] delete: success", { workspaceId, ownerId });
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[workspaces] delete: unexpected error", { workspaceId, ownerId, error: msg });
    res.status(500).json({ error: msg });
  }
});

/** Update workspace Jira project key. */
router.patch("/workspaces/:workspaceId/jira-project-key", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  const rawKey = req.body?.projectKey;
  const projectKey =
    rawKey === null || rawKey === ""
      ? null
      : typeof rawKey === "string"
        ? rawKey.trim().toUpperCase()
        : null;

  if (projectKey !== null && !isValidProjectKey(projectKey)) {
    res.status(400).json({
      error: "Project key must be 2–10 chars, start with a letter, no trailing hyphen (e.g. PROJ)",
    });
    return;
  }

  const { data: ws, error: wsErr } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", ownerId)
    .single();

  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }

  const { error: uErr } = await supabaseAdmin
    .from("workspaces")
    .update({ jira_project_key: projectKey })
    .eq("id", workspaceId);

  if (uErr) {
    res.status(500).json({ error: uErr.message });
    return;
  }

  res.json({ success: true, projectKey });
});

/** Update workspace metadata (e.g. name). */
router.patch("/workspaces/:workspaceId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  const name =
    typeof req.body?.name === "string" ? req.body.name.trim() : undefined;

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const { data: ws, error: wsErr } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", ownerId)
    .single();

  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }

  const { error: uErr } = await supabaseAdmin
    .from("workspaces")
    .update({ name })
    .eq("id", workspaceId);

  if (uErr) {
    res.status(500).json({ error: uErr.message });
    return;
  }

  res.json({ success: true });
});

/** Manually save the latest graph for a workspace (user must own it). */
router.post("/workspaces/:workspaceId/save", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  const { data: ws, error: wsErr } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", ownerId)
    .single();

  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }

  const graph =
    typeof req.body?.graph === "object" && req.body.graph !== null
      ? (req.body.graph as Record<string, unknown>)
      : null;
  const repoUrl =
    typeof req.body?.repoUrl === "string" ? (req.body.repoUrl as string) : null;

  if (!graph) {
    res.status(400).json({ error: "graph is required" });
    return;
  }

  const { error: gErr } = await supabaseAdmin.from("graphs").insert({
    workspace_id: workspaceId,
    graph_json: graph,
    repo_url: repoUrl,
  });

  if (gErr) {
    res.status(500).json({ error: gErr.message });
    return;
  }

  res.json({ success: true });
});

export { router as workspaceRoutes };

