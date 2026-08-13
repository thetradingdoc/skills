/**
 * GitHub → architecture PM bridge.
 *
 * A push or PR touches files; those files map to nodes on the architecture
 * graph. Recording that mapping is what turns "someone pushed to main" into
 * "someone pushed to the Auth service" — the difference between a commit feed
 * and something a node's owner can actually use.
 *
 * Matching is heuristic and best-effort: a changed path is considered a hit
 * on a node when it falls under one of the node's known files/path, or when
 * the node's label/id appears as a path segment. False negatives (a push
 * that should have matched but didn't) are expected and harmless — the event
 * is still recorded, just with no matched nodes.
 */
import type { Router } from "express";
import { Router as createRouter } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import type { ArchGraph, ArchNode } from "../../../src/types.js";

export type GithubArchEventType = "push" | "pull_request" | "scan";

export interface RecordGithubArchitectureEventParams {
  workspaceId: string;
  eventType: GithubArchEventType;
  sha?: string | null;
  branch?: string | null;
  prNumber?: number | null;
  authorLogin?: string | null;
  message?: string | null;
  changedPaths?: string[];
  githubUrl?: string | null;
}

export interface GithubArchEventRow {
  id: string;
  workspace_id: string;
  event_type: GithubArchEventType;
  sha: string | null;
  branch: string | null;
  pr_number: number | null;
  author_login: string | null;
  message: string | null;
  changed_paths: string[];
  matched_node_ids: string[];
  github_url: string | null;
  created_at: string;
}

function normalizePath(p: string): string {
  return p.trim().replace(/^\.\//, "").replace(/\\/g, "/").toLowerCase();
}

/** Path segments (lowercased, non-empty) used for loose label/id matching. */
function segmentsOf(p: string): string[] {
  return normalizePath(p)
    .split(/[/._-]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/**
 * Does a changed path hit this node? Tried in order of confidence:
 *   1. Exact/prefix match against the node's known files.
 *   2. Prefix match against the node's `path` (directory node).
 *   3. The node's id, or a normalized version of its label, appears as a
 *      path segment (loose fallback for design-mode nodes with no files).
 */
function pathMatchesNode(changedPath: string, node: ArchNode): boolean {
  const cp = normalizePath(changedPath);
  if (!cp) return false;

  for (const f of node.files ?? []) {
    const nf = normalizePath(f);
    if (!nf) continue;
    if (cp === nf || cp.startsWith(nf + "/") || nf.startsWith(cp + "/")) return true;
  }

  const nodePath = normalizePath(node.path ?? "");
  if (nodePath && (cp === nodePath || cp.startsWith(nodePath + "/"))) return true;

  const segs = segmentsOf(cp);
  const idNorm = normalizePath(node.id ?? "").replace(/[^a-z0-9]/g, "");
  const labelSegs = (node.label ?? "")
    .toLowerCase()
    .split(/[\s/_-]+/)
    .map((s) => s.replace(/[^a-z0-9]/g, ""))
    .filter((s) => s.length > 2);

  if (idNorm.length > 2 && segs.some((s) => s.replace(/[^a-z0-9]/g, "") === idNorm)) return true;
  if (labelSegs.length > 0 && segs.some((s) => labelSegs.includes(s.replace(/[^a-z0-9]/g, "")))) {
    return true;
  }

  return false;
}

/**
 * Pure matcher: which node ids does this set of changed paths touch?
 * Exported for unit testing (scripts/test-path-to-node-match.ts) — no
 * network calls, no Supabase.
 */
export function matchChangedPathsToNodes(nodes: ArchNode[], changedPaths: string[]): string[] {
  if (!Array.isArray(nodes) || nodes.length === 0 || !Array.isArray(changedPaths) || changedPaths.length === 0) {
    return [];
  }
  const matched = new Set<string>();
  for (const node of nodes) {
    for (const cp of changedPaths) {
      if (pathMatchesNode(cp, node)) {
        matched.add(node.id);
        break;
      }
    }
  }
  return Array.from(matched);
}

async function loadLatestGraphNodes(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<ArchNode[]> {
  const { data } = await supabase
    .from("graphs")
    .select("graph_json")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const graph = (data as { graph_json?: ArchGraph } | null)?.graph_json;
  return Array.isArray(graph?.nodes) ? graph!.nodes : [];
}

/**
 * Records one GitHub event against a workspace, matching changed paths to
 * nodes on the latest graph. Best-effort: failures are swallowed by the
 * caller (this is always fired from a webhook/scan path that must not fail
 * the primary operation because PM-bridge bookkeeping failed).
 */
export async function recordGithubArchitectureEvent(
  supabase: SupabaseClient,
  params: RecordGithubArchitectureEventParams
): Promise<GithubArchEventRow | null> {
  const changedPaths = Array.from(new Set((params.changedPaths ?? []).filter((p) => typeof p === "string" && p.trim())));

  let matchedNodeIds: string[] = [];
  if (changedPaths.length > 0) {
    try {
      const nodes = await loadLatestGraphNodes(supabase, params.workspaceId);
      matchedNodeIds = matchChangedPathsToNodes(nodes, changedPaths);
    } catch (e) {
      console.warn("[githubArchEvents] node matching failed:", e instanceof Error ? e.message : e);
    }
  }

  const { data, error } = await supabase
    .from("github_architecture_events")
    .insert({
      workspace_id: params.workspaceId,
      event_type: params.eventType,
      sha: params.sha ?? null,
      branch: params.branch ?? null,
      pr_number: params.prNumber ?? null,
      author_login: params.authorLogin ?? null,
      message: params.message ?? null,
      changed_paths: changedPaths,
      matched_node_ids: matchedNodeIds,
      github_url: params.githubUrl ?? null,
    })
    .select("*")
    .single();

  if (error) {
    console.warn("[githubArchEvents] insert failed:", error.message);
    return null;
  }
  return data as GithubArchEventRow;
}

// ── Routes ──────────────────────────────────────────────────────────────

const router: Router = createRouter();

/** Recent GitHub events for a workspace, optionally filtered to one node. */
router.get(
  "/workspaces/:workspaceId/github-events",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId!;
    const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId.trim() : "";
    const limit = Math.min(parseInt(String(req.query.limit ?? 50), 10) || 50, 200);

    let query = supabaseAdmin
      .from("github_architecture_events")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (nodeId) {
      query = query.contains("matched_node_ids", [nodeId]);
    }

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ events: data ?? [] });
  }
);

/** Aggregated collab metadata for one node: who claimed it, last push. */
router.get(
  "/workspaces/:workspaceId/nodes/:nodeId/collab",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId!;
    const nodeId = req.params.nodeId!;

    let claim: { claimerId: string; claimedAt: string } | null = null;
    try {
      const { data } = await supabaseAdmin
        .from("section_claims")
        .select("claimer_id, claimed_at")
        .eq("workspace_id", workspaceId)
        .eq("kind", "node")
        .eq("target_id", nodeId)
        .maybeSingle();
      if (data) {
        claim = {
          claimerId: (data as { claimer_id: string }).claimer_id,
          claimedAt: (data as { claimed_at: string }).claimed_at,
        };
      }
    } catch (e) {
      // section_claims may not have been migrated in this environment yet.
      console.warn("[githubArchEvents] section_claims lookup failed:", e instanceof Error ? e.message : e);
    }

    let lastPush: GithubArchEventRow | null = null;
    try {
      const { data } = await supabaseAdmin
        .from("github_architecture_events")
        .select("*")
        .eq("workspace_id", workspaceId)
        .contains("matched_node_ids", [nodeId])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      lastPush = (data as GithubArchEventRow | null) ?? null;
    } catch (e) {
      console.warn("[githubArchEvents] last push lookup failed:", e instanceof Error ? e.message : e);
    }

    // Findings don't carry a node id today, so "assignees from findings" is
    // left out here rather than faked — see task note in the plan.
    res.json({ claim, lastPush, assignees: [] });
  }
);

export { router as githubArchEventsRoutes };
