import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { assertWorkspaceAccess } from "./workspaceAccess.js";
import { maybePruneWorkspaceMemories } from "./memoryHygiene.js";
import { logWorkspaceActivity } from "./activityLog.js";
import { isValidProjectKey } from "./utils/deriveProjectKey.js";
import { deleteWorkspaceClone } from "./cloneRepo.js";
import { buildNodeFileMappingArray } from "./nodeFileMapping.js";
import type { ArchGraph } from "../../../src/types.js";

const router = Router();

router.get("/workspaces", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const userId = req.user!.id;
  const { data: owned } = await supabaseAdmin
    .from("workspaces")
    .select("id,name,created_at,thumbnail_base64")
    .eq("owner_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  const { data: memberRows } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .neq("role", "owner");
  const memberWsIds = [...new Set((memberRows ?? []).map((r: { workspace_id: string }) => r.workspace_id))];
  const { data: shared } =
    memberWsIds.length > 0
      ? await supabaseAdmin
          .from("workspaces")
          .select("id,name,created_at,thumbnail_base64")
          .in("id", memberWsIds)
          .is("archived_at", null)
          .order("created_at", { ascending: false })
      : { data: [] };
  const seen = new Set<string>();
  const rows = [
    ...(owned ?? []),
    ...(shared ?? []).filter((w: { id: string }) => {
      if (seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    }),
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50) as Array<{
      id: string;
      name: string;
      created_at: string;
      thumbnail_base64?: string | null;
    }>;
  if (rows.length === 0) {
    res.json({ workspaces: [] });
    return;
  }

  const workspaceIds = rows.map((w) => w.id);

  // Latest graph + node count per workspace.
  const { data: graphRows } = await supabaseAdmin
    .from("graphs")
    .select("workspace_id, updated_at, graph_json")
    .in("workspace_id", workspaceIds)
    .not("graph_json", "is", null)
    .order("updated_at", { ascending: false });

  const latestByWorkspace = new Map<
    string,
    { updated_at: string | null; nodeCount: number }
  >();
  for (const row of (graphRows ?? []) as Array<{
    workspace_id: string;
    updated_at: string | null;
    graph_json: { nodes?: unknown[] } | null;
  }>) {
    if (latestByWorkspace.has(row.workspace_id)) continue;
    const nodes = Array.isArray(row.graph_json?.nodes)
      ? (row.graph_json!.nodes as unknown[])
      : [];
    latestByWorkspace.set(row.workspace_id, {
      updated_at: row.updated_at,
      nodeCount: nodes.length,
    });
  }

  // Violation count per workspace.
  const { data: violationRows } = await supabaseAdmin
    .from("violations")
    .select("workspace_id")
    .in("workspace_id", workspaceIds);

  const violationsByWorkspace = new Map<string, number>();
  for (const row of (violationRows ?? []) as Array<{ workspace_id: string }>) {
    const key = row.workspace_id;
    const prev = violationsByWorkspace.get(key) ?? 0;
    violationsByWorkspace.set(key, prev + 1);
  }

  const enriched = rows.map((w) => {
    const latest = latestByWorkspace.get(w.id);
    const violationCount = violationsByWorkspace.get(w.id) ?? 0;
    // Health score 0-100 (higher = better): penalize violations, reward having a graph
    const hasGraph = (latest?.nodeCount ?? 0) > 0;
    const healthScore = Math.max(
      0,
      Math.min(100, (hasGraph ? 80 : 20) - violationCount * 8)
    );
    return {
      ...w,
      last_scan_at: latest?.updated_at ?? null,
      node_count: latest?.nodeCount ?? 0,
      violation_count: violationCount,
      health_score: healthScore,
    };
  });

  res.json({ workspaces: enriched });
});

/** List archived workspaces for management UI. */
router.get("/workspaces/archived", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .select("id,name,created_at,thumbnail_base64,archived_at")
    .eq("owner_id", ownerId)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });

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

  await supabaseAdmin.from("workspace_members").upsert(
    { workspace_id: (data as { id: string }).id, user_id: ownerId, role: "owner" },
    { onConflict: "workspace_id,user_id" }
  );

  res.json({ workspace: data });
});

/** Load latest graph + repo URL for a workspace. Requires owner or member access. */
router.get("/workspaces/:workspaceId/load", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const userId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, userId);
  } catch {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id, owner_id, jira_project_key, auto_execute_enabled, archived_at")
    .eq("id", workspaceId)
    .single();

  if (!ws || ws.archived_at) {
    res.status(404).json({ error: "Workspace archived." });
    return;
  }

  // Only consider graph snapshots that actually have a stored graph_json.
  const { data: graphRow, error: gErr } = await supabaseAdmin
    .from("graphs")
    .select("graph_json, repo_url")
    .eq("workspace_id", workspaceId)
    .not("graph_json", "is", null)
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

  const { data: sysModel } = await supabaseAdmin
    .from("workspace_system_models")
    .select("system_model_json")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const sysModelNodes = (sysModel?.system_model_json as { nodes?: Array<{ id: string; domain?: string; runtimeRoles?: string[]; tier?: string }> })?.nodes;
  if (sysModelNodes && graph?.nodes && Array.isArray(graph.nodes)) {
    const byId = new Map(sysModelNodes.map((m) => [m.id, m]));
    for (const n of graph.nodes) {
      const sm = n?.id ? byId.get(n.id) : undefined;
      if (sm) {
        (n as Record<string, unknown>).domain = sm.domain;
        (n as Record<string, unknown>).runtimeRoles = sm.runtimeRoles;
        (n as Record<string, unknown>).tier = sm.tier;
      }
    }
  }

  const { data: viewsData } = await supabaseAdmin
    .from("workspace_views")
    .select("slot,preset")
    .eq("workspace_id", workspaceId)
    .order("slot", { ascending: true });

  const { data: annotationsData } = await supabaseAdmin
    .from("workspace_annotations")
    .select("id,type,content,author_name,node_id,layer,canvas_x,canvas_y,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  const workspaceOwnerId = (ws as { owner_id?: string }).owner_id ?? null;
  res.json({
    graph: graph as Record<string, unknown>,
    repoUrl: graphRow.repo_url ?? "",
    jiraProjectKey: (ws as { jira_project_key?: string | null }).jira_project_key ?? null,
    autoExecuteEnabled: (ws as { auto_execute_enabled?: boolean | null }).auto_execute_enabled ?? false,
    views: viewsData ?? [],
    annotations: annotationsData ?? [],
    ownerId: workspaceOwnerId,
    isOwner: workspaceOwnerId === userId,
  });
});

/** Node→file mapping for workspace graph. Reusable for rails impact, violation resolution, etc. */
router.get("/workspaces/:workspaceId/node-file-mapping", requireUser, async (req, res) => {
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
  const { data: graphRow, error: gErr } = await supabaseAdmin
    .from("graphs")
    .select("graph_json")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (gErr || !graphRow?.graph_json) {
    res.status(404).json({ error: "No graph saved for this workspace." });
    return;
  }
  const graph = graphRow.graph_json as ArchGraph;
  const mapping = buildNodeFileMappingArray(graph);
  res.json({ mapping });
});

/** List saved camera views for a workspace (slots 1–5). */
router.get("/workspaces/:workspaceId/views", requireUser, async (req, res) => {
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

  const { data, error } = await supabaseAdmin
    .from("workspace_views")
    .select("slot,preset")
    .eq("workspace_id", workspaceId)
    .order("slot", { ascending: true });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ views: data ?? [] });
});

/** Save or update a camera view preset for a workspace slot. */
router.post("/workspaces/:workspaceId/views", requireUser, async (req, res) => {
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

  const { slot, preset } = req.body ?? {};
  if (typeof slot !== "number" || slot < 1 || slot > 5) {
    res.status(400).json({ error: "slot (1-5) is required" });
    return;
  }
  if (typeof preset !== "string" || !["top", "front", "side", "iso"].includes(preset)) {
    res.status(400).json({ error: "preset must be one of: top, front, side, iso" });
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

  const { error } = await supabaseAdmin
    .from("workspace_views")
    .upsert(
      { workspace_id: workspaceId, slot, preset },
      { onConflict: "workspace_id,slot" }
    );

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  logWorkspaceActivity(supabaseAdmin, {
    workspaceId: req.params.workspaceId!,
    actorId: req.user?.id ?? null,
    actorName: (req as { user?: { email?: string } }).user?.email ?? null,
    action: "view_saved",
    entityType: "view",
    metadata: { slot, preset },
  });

  res.json({ success: true });
});

/** List annotations for a workspace. */
router.get("/workspaces/:workspaceId/annotations", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin || !workspaceId) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("workspace_annotations")
    .select("id,type,content,author_name,node_id,layer,canvas_x,canvas_y,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ annotations: data ?? [] });
});

/** Create annotation. */
router.post("/workspaces/:workspaceId/annotations", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin || !workspaceId) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const { type, content, node_id, layer, canvas_x, canvas_y } = req.body ?? {};
  if (typeof type !== "string" || !["note", "highlight", "question"].includes(type)) {
    res.status(400).json({ error: "type must be one of: note, highlight, question" });
    return;
  }
  const payload: Record<string, unknown> = {
    workspace_id: workspaceId,
    type,
    content: typeof content === "string" ? content : "",
    author_id: req.user?.id ?? null,
  };
  if (typeof node_id === "string" && node_id.trim()) payload.node_id = node_id.trim();
  else if (typeof layer === "string" && layer.trim()) payload.layer = layer.trim();
  else if (typeof canvas_x === "number" && typeof canvas_y === "number") {
    payload.canvas_x = canvas_x;
    payload.canvas_y = canvas_y;
  }
  const { data, error } = await supabaseAdmin
    .from("workspace_annotations")
    .insert(payload)
    .select("id,type,content,author_name,node_id,layer,canvas_x,canvas_y,created_at,updated_at")
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const ann = data as { id: string };
  logWorkspaceActivity(supabaseAdmin, {
    workspaceId,
    actorId: req.user?.id ?? null,
    actorName: (req as { user?: { email?: string } }).user?.email ?? null,
    action: "annotation_created",
    entityType: "annotation",
    entityId: ann.id,
    metadata: { type: payload.type },
  });
  res.json({ annotation: data });
});

/** Update annotation. */
router.patch("/workspaces/:workspaceId/annotations/:annotationId", requireUser, async (req, res) => {
  const { workspaceId, annotationId } = req.params;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin || !workspaceId || !annotationId) {
    res.status(400).json({ error: "workspaceId and annotationId are required" });
    return;
  }
  const { type, content } = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (typeof type === "string" && ["note", "highlight", "question"].includes(type)) updates.type = type;
  if (typeof content === "string") updates.content = content;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Provide type and/or content to update" });
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("workspace_annotations")
    .update(updates)
    .eq("id", annotationId)
    .eq("workspace_id", workspaceId)
    .select("id,type,content,author_name,node_id,layer,canvas_x,canvas_y,created_at,updated_at")
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  logWorkspaceActivity(supabaseAdmin, {
    workspaceId,
    actorId: req.user?.id ?? null,
    actorName: (req as { user?: { email?: string } }).user?.email ?? null,
    action: "annotation_updated",
    entityType: "annotation",
    entityId: annotationId,
    metadata: updates,
  });
  res.json({ annotation: data });
});

/** Delete annotation. */
router.delete("/workspaces/:workspaceId/annotations/:annotationId", requireUser, async (req, res) => {
  const { workspaceId, annotationId } = req.params;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  if (!supabaseAdmin || !workspaceId || !annotationId) {
    res.status(400).json({ error: "workspaceId and annotationId are required" });
    return;
  }
  const { error } = await supabaseAdmin
    .from("workspace_annotations")
    .delete()
    .eq("id", annotationId)
    .eq("workspace_id", workspaceId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  logWorkspaceActivity(supabaseAdmin, {
    workspaceId,
    actorId: req.user?.id ?? null,
    actorName: (req as { user?: { email?: string } }).user?.email ?? null,
    action: "annotation_deleted",
    entityType: "annotation",
    entityId: annotationId,
  });
  res.json({ success: true });
});

/** Update workspace auto-execute flag. */
router.patch("/workspaces/:workspaceId/auto-execute", requireUser, async (req, res) => {
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

  const { enabled } = req.body ?? {};
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled (boolean) is required" });
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
    .update({ auto_execute_enabled: enabled })
    .eq("id", workspaceId);

  if (uErr) {
    res.status(500).json({ error: uErr.message });
    return;
  }

  res.json({ success: true, autoExecuteEnabled: enabled });
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

  const limitParam = Math.min(parseInt(String(req.query.limit ?? 50), 10) || 50, 200);
  let query = supabaseAdmin
    .from("workspace_memories")
    .select("id, workspace_id, node_id, content, memory_type, created_at")
    .eq("workspace_id", workspaceId)
    .is("superseded_at", null)
    .order("created_at", { ascending: false })
    .limit(limitParam);

  if (nodeId) {
    query = query.eq("node_id", nodeId);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json({ memories: data ?? [] });
});

/** Update a workspace memory (content only). User must own workspace. */
router.patch("/workspaces/:workspaceId/memories/:memoryId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  const memoryId = req.params.memoryId;

  if (!workspaceId || !memoryId) {
    res.status(400).json({ error: "workspaceId and memoryId are required" });
    return;
  }

  const content = typeof req.body?.content === "string" ? req.body.content.trim() : undefined;
  if (content === undefined) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  if (content.length > 5000) {
    res.status(400).json({ error: "content must be at most 5000 characters" });
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

  const { data, error } = await supabaseAdmin
    .from("workspace_memories")
    .update({ content })
    .eq("id", memoryId)
    .eq("workspace_id", workspaceId)
    .select("id, workspace_id, node_id, content, memory_type, created_at")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  if (!data) {
    return res.status(404).json({ error: "Memory not found" });
  }
  return res.json({ memory: data });
});

/** Create a workspace memory (user-explicit "remember this"). */
router.post("/workspaces/:workspaceId/memories", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : undefined;
  const nodeId = (typeof req.body?.nodeId === "string" ? req.body.nodeId.trim() : undefined) || null;
  const supersedesId = (typeof req.body?.supersedesId === "string" ? req.body.supersedesId.trim() : undefined) || null;

  if (!workspaceId || !content) {
    res.status(400).json({ error: "workspaceId and content are required" });
    return;
  }
  if (content.length > 5000) {
    res.status(400).json({ error: "content must be at most 5000 characters" });
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

  if (supersedesId) {
    await supabaseAdmin
      .from("workspace_memories")
      .update({ superseded_at: new Date().toISOString() })
      .eq("id", supersedesId)
      .eq("workspace_id", workspaceId);
  }

  const { data, error } = await supabaseAdmin
    .from("workspace_memories")
    .insert({
      workspace_id: workspaceId,
      node_id: nodeId || null,
      content: content.slice(0, 5000),
      memory_type: "user_saved",
    })
    .select("id, workspace_id, node_id, content, memory_type, created_at")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const client = supabaseAdmin!;
  setImmediate(() => {
    maybePruneWorkspaceMemories(client, workspaceId).catch(() => {});
  });

  return res.status(201).json({ memory: data });
});

/** Delete a workspace memory. User must own workspace. */
router.delete("/workspaces/:workspaceId/memories/:memoryId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  const memoryId = req.params.memoryId;

  if (!workspaceId || !memoryId) {
    res.status(400).json({ error: "workspaceId and memoryId are required" });
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

  const { data: deleted, error: delErr } = await supabaseAdmin
    .from("workspace_memories")
    .delete()
    .eq("id", memoryId)
    .eq("workspace_id", workspaceId)
    .select("id");

  if (delErr) {
    return res.status(500).json({ error: delErr.message });
  }
  if (!deleted || deleted.length === 0) {
    return res.status(404).json({ error: "Memory not found" });
  }
  return res.status(204).send();
});

/** Delete the workspace's cloned repo on disk (frees disk space). Next chat will reclone. */
router.delete("/workspaces/:workspaceId/clone", requireUser, async (req, res) => {
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
  const { data: ws, error } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  deleteWorkspaceClone(workspaceId);
  res.json({ success: true });
});

/** Permanently delete a workspace and all associated data. */
router.delete("/workspaces/:workspaceId", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const ownerId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  const hard = String(req.query.hard ?? "").toLowerCase() === "true";

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

    deleteWorkspaceClone(workspaceId);

    if (hard) {
      // Hard delete: ON DELETE CASCADE should clean up graphs, share_links, violations, etc.
      const { error: delErr } = await supabaseAdmin
        .from("workspaces")
        .delete()
        .eq("id", workspaceId)
        .eq("owner_id", ownerId);

      if (delErr) {
        console.error("[workspaces] delete: hard delete failed", {
          workspaceId,
          ownerId,
          error: delErr.message,
        });
        res.status(500).json({ error: delErr.message });
        return;
      }
      console.log("[workspaces] delete: hard delete success", { workspaceId, ownerId });
      res.json({ success: true, hard: true });
      return;
    }

    // Soft delete: keep workspace data, hide from lists.
    const now = new Date().toISOString();
    const { error: archErr } = await supabaseAdmin
      .from("workspaces")
      .update({ archived_at: now })
      .eq("id", workspaceId)
      .eq("owner_id", ownerId);

    if (archErr) {
      console.error("[workspaces] delete: archive failed", {
        workspaceId,
        ownerId,
        error: archErr.message,
      });
      res.status(500).json({ error: archErr.message });
      return;
    }

    console.log("[workspaces] delete: archived", { workspaceId, ownerId });
    res.json({ success: true, archivedAt: now, hard: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[workspaces] delete: unexpected error", { workspaceId, ownerId, error: msg });
    res.status(500).json({ error: msg });
  }
});

/** Restore a previously archived workspace. */
router.post("/workspaces/:workspaceId/restore", requireUser, async (req, res) => {
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
    .select("id, archived_at")
    .eq("id", workspaceId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (wsErr) {
    res.status(500).json({ error: wsErr.message });
    return;
  }
  if (!ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }

  const { error: updErr } = await supabaseAdmin
    .from("workspaces")
    .update({ archived_at: null })
    .eq("id", workspaceId)
    .eq("owner_id", ownerId);

  if (updErr) {
    res.status(500).json({ error: updErr.message });
    return;
  }

  res.json({ success: true });
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

/** Connect workspace to a GitHub repo (from OAuth repo picker). */
router.patch("/workspaces/:workspaceId/connect-repo", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const userId = req.user!.id;
  const workspaceId = req.params.workspaceId;
  const fullName = typeof req.body?.github_full_name === "string" ? req.body.github_full_name.trim() : null;
  if (!workspaceId || !fullName) {
    res.status(400).json({ error: "workspaceId and github_full_name required." });
    return;
  }
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(fullName)) {
    res.status(400).json({ error: "github_full_name must be owner/repo format." });
    return;
  }
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, userId);
  } catch {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const repoUrl = `https://github.com/${fullName}`;
  const { error } = await supabaseAdmin
    .from("workspaces")
    .update({ repo_url: repoUrl, github_full_name: fullName })
    .eq("id", workspaceId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ success: true, repoUrl, github_full_name: fullName });
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

  if (repoUrl && repoUrl.trim()) {
    await supabaseAdmin
      .from("workspaces")
      .update({ project_root: null, repo_url: repoUrl.trim() })
      .eq("id", workspaceId);
  }

  res.json({ success: true });
});

// ── Workspace scenes (iCraft-style authored scene docs) ───────────────────────

type WorkspaceSceneRow = {
  id: string;
  workspace_id: string;
  name: string;
  scene_version: number;
  scene_json: unknown;
  created_at: string;
  updated_at: string;
};

/** List scenes for a workspace (latest first). */
router.get("/workspaces/:workspaceId/scenes", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }

  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const limitParam = Math.min(parseInt(String(req.query.limit ?? 20), 10) || 20, 50);
  const { data, error } = await supabaseAdmin
    .from("workspace_scenes")
    .select("id, workspace_id, name, scene_version, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("scene_version", { ascending: false })
    .limit(limitParam);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ scenes: (data as WorkspaceSceneRow[] | null) ?? [] });
});

/** Load the latest scene for a workspace (or 404 if none). */
router.get("/workspaces/:workspaceId/scenes/latest", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }

  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("workspace_scenes")
    .select("id, workspace_id, name, scene_version, scene_json, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("scene_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "No scene saved for this workspace." });
    return;
  }
  res.json({ scene: data as WorkspaceSceneRow });
});

/**
 * Save a new version of a scene.
 * This creates an append-only version history; consumers typically load /latest.
 */
router.post("/workspaces/:workspaceId/scenes", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "Scene";
  const sceneJson =
    typeof req.body?.scene === "object" && req.body.scene !== null ? req.body.scene : null;
  if (!sceneJson) {
    res.status(400).json({ error: "scene (object) is required" });
    return;
  }

  // Determine next version
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const { data: latest, error: latestErr } = await supabaseAdmin
    .from("workspace_scenes")
    .select("scene_version")
    .eq("workspace_id", workspaceId)
    .order("scene_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) {
    res.status(500).json({ error: latestErr.message });
    return;
  }
  const nextVersion = (latest?.scene_version ?? 0) + 1;

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("workspace_scenes")
    .insert({
      workspace_id: workspaceId,
      name: name || "Scene",
      scene_version: nextVersion,
      scene_json: sceneJson,
    })
    .select("id, workspace_id, name, scene_version, scene_json, created_at, updated_at")
    .single();

  if (insErr) {
    res.status(500).json({ error: insErr.message });
    return;
  }
  const sceneData = inserted as { id: string };
  logWorkspaceActivity(supabaseAdmin, {
    workspaceId,
    actorId: req.user?.id ?? null,
    actorName: (req as { user?: { email?: string } }).user?.email ?? null,
    action: "scene_saved",
    entityType: "scene",
    entityId: sceneData.id,
    metadata: { version: nextVersion },
  });
  res.status(201).json({ scene: inserted as WorkspaceSceneRow });
});

/** Ingest a runtime snapshot (OTEL-inspired) for a workspace. */
router.post("/workspaces/:workspaceId/runtime", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }

  const snapshot = req.body as unknown;
  if (!snapshot || typeof snapshot !== "object") {
    res.status(400).json({ error: "snapshot_json (object) is required" });
    return;
  }

  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("workspace_runtime_snapshots")
    .insert({ workspace_id: workspaceId, snapshot_json: snapshot })
    .select("id, workspace_id, recorded_at, snapshot_json")
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ snapshot: data as { id: string; workspace_id: string; recorded_at: string; snapshot_json: unknown } });
});

/** Ingest OTLP spans and persist as runtime snapshot (maps onto graph nodes/edges). */
router.post("/workspaces/:workspaceId/telemetry/otlp", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }

  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const payload = req.body;
  if (!payload || typeof payload !== "object") {
    res.status(400).json({ error: "OTLP JSON body required." });
    return;
  }

  const { extractSpansFromOtlp, extractSpansFromSimple, processSpansToSnapshot } = await import(
    "./runtimeOtelProcessor.js"
  );
  let spans = extractSpansFromOtlp(payload);
  if (spans.length === 0) spans = extractSpansFromSimple(payload);
  if (spans.length === 0) {
    res.status(400).json({ error: "No spans found. Send OTLP resourceSpans or { spans: [...] }." });
    return;
  }

  const { data: graphRow } = await supabaseAdmin
    .from("graphs")
    .select("graph_json")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const graph = graphRow?.graph_json as ArchGraph | null;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    res.status(400).json({
      error: "Workspace has no graph. Scan a repo first to map spans onto nodes/edges.",
    });
    return;
  }

  const { nodes, edges } = processSpansToSnapshot(spans, graph);
  const snapshot = { nodes, edges };

  const { data, error } = await supabaseAdmin
    .from("workspace_runtime_snapshots")
    .insert({ workspace_id: workspaceId, snapshot_json: snapshot })
    .select("id, workspace_id, recorded_at")
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({
    accepted: spans.length,
    snapshot: { id: data.id, workspace_id: data.workspace_id, recorded_at: data.recorded_at },
    metrics: { nodes: Object.keys(nodes).length, edges: Object.keys(edges).length },
  });
});

/** Load latest runtime snapshot for a workspace. */
router.get("/workspaces/:workspaceId/runtime/latest", requireUser, async (req, res) => {
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

  const { data, error } = await supabaseAdmin
    .from("workspace_runtime_snapshots")
    .select("id, workspace_id, recorded_at, snapshot_json")
    .eq("workspace_id", workspaceId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.json({ snapshot: null });
    return;
  }
  res.json({ snapshot: data as { id: string; workspace_id: string; recorded_at: string; snapshot_json: unknown } });
});

export { router as workspaceRoutes };

