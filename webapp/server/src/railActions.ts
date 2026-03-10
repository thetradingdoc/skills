/**
 * Shared rail actions for use by chat (retry/cancel) and other callers.
 */

import * as path from "path";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { getRail, loadRails, updateRailState } from "../../../src/agent/rail/manager.js";
import { transitionRail } from "../../../src/agent/rail/orchestrator.js";
import { triggerRailExecution } from "./railExecute.js";

async function resolveRoot(workspaceId: string, userId: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("workspaces")
      .select("project_root")
      .eq("id", workspaceId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const pr = (data as { project_root?: string | null }).project_root;
    return typeof pr === "string" && pr.trim() ? path.resolve(pr.trim()) : null;
  } catch {
    return null;
  }
}

export async function cancelRail(
  railId: string,
  workspaceId: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const root = await resolveRoot(workspaceId, userId);
  if (!root) return { ok: false, error: "Workspace has no project_root." };
  try {
    loadRails(root);
    const rail = getRail(root, railId);
    if (!rail) return { ok: false, error: "Rail not found." };
    if (!["EXECUTING", "VERIFYING", "SELF_CORRECTING", "AWAITING_HITL"].includes(rail.state as string)) {
      return { ok: false, error: `Rail is not cancellable from state ${rail.state}.` };
    }
    const result = transitionRail(root, railId, "SUSPENDED" as any);
    if (!result.ok || !result.rail) return { ok: false, error: result.error ?? "Invalid transition." };
    updateRailState(root, railId, result.rail.state);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function retryRail(
  railId: string,
  workspaceId: string,
  userId: string
): Promise<{ ok: boolean; taskId?: string; error?: string }> {
  try {
    const { taskId } = await triggerRailExecution(railId, workspaceId, userId);
    return { ok: true, taskId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
