/**
 * SystemModel API: persist and retrieve workspace_system_models.
 */

import { Router } from "express";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { buildSystemModel } from "./systemModel.js";
import type { ArchGraph, SystemModel } from "../../../src/types.js";
import { assertWorkspaceAccess } from "./workspaceAccess.js";
import { requireUser } from "./middleware/requireUser.js";

const router = Router();

/** GET /workspaces/:id/system-model - latest SystemModel for workspace. */
router.get("/workspaces/:id/system-model", requireUser, async (req, res) => {
  const workspaceId = req.params.id as string;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("workspace_system_models")
    .select("id, system_model_json, graph_id, updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data?.system_model_json) {
    res.status(404).json({ error: "No SystemModel found. Run a scan to build one." });
    return;
  }

  const model = data.system_model_json as SystemModel;
  model.snapshotId = (data as { id?: string }).id;
  res.json(model);
});

/** POST /workspaces/:id/system-model/refresh - rebuild SystemModel from latest graph. */
router.post("/workspaces/:id/system-model/refresh", requireUser, async (req, res) => {
  const workspaceId = req.params.id as string;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }
  const { data: graphRow } = await supabaseAdmin
    .from("graphs")
    .select("id, graph_json")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!graphRow?.graph_json) {
    res.status(404).json({ error: "No graph found. Run a scan first." });
    return;
  }
  const graph = graphRow.graph_json as ArchGraph;
  const graphId = (graphRow as { id?: string }).id;
  await upsertSystemModel(workspaceId, graph, graphId);
  res.json({ ok: true, message: "SystemModel refreshed." });
});

/** Upsert SystemModel from graph. Called internally after scan; also exposed for manual refresh. */
export async function upsertSystemModel(
  workspaceId: string,
  graph: ArchGraph,
  graphId?: string | null
): Promise<void> {
  const systemModel = buildSystemModel(graph, { graphId: graphId ?? undefined });
  const payload = {
    workspace_id: workspaceId,
    graph_id: graphId ?? null,
    system_model_json: systemModel,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("workspace_system_models").upsert(payload, {
    onConflict: "workspace_id",
  });

  if (error) console.error("[systemModel] upsert error:", error.message);
}

export { router as systemModelRoutes };
