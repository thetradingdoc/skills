/**
 * Memory hygiene — retention caps, TTL, pruning for workspace_memories.
 * Prevents unbounded growth; call after insert or via scheduled job.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const PRUNE_EVERY_N_INSERTS = 10;

const insertCountByWorkspace = new Map<string, number>();

/** Max memories per workspace before pruning oldest. */
export const WORKSPACE_MEMORIES_MAX = 200;

/** Max age in ms (default 1 year). Memories older than this are pruned. */
export const WORKSPACE_MEMORIES_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export interface PruneResult {
  pruned: number;
  reason: "cap" | "ttl" | "both" | "none";
}

/**
 * Prune workspace_memories for a workspace. Keeps newest up to maxCount;
 * optionally deletes older than maxAgeMs.
 */
export async function pruneWorkspaceMemories(
  supabase: SupabaseClient,
  workspaceId: string,
  options: {
    maxCount?: number;
    maxAgeMs?: number;
  } = {}
): Promise<PruneResult> {
  const maxCount = options.maxCount ?? WORKSPACE_MEMORIES_MAX;
  const maxAgeMs = options.maxAgeMs ?? WORKSPACE_MEMORIES_MAX_AGE_MS;

  const cutoff = maxAgeMs > 0 ? new Date(Date.now() - maxAgeMs).toISOString() : null;

  // 1. Delete by TTL if configured (memories older than maxAgeMs)
  let ttlDeleted = 0;
  if (cutoff) {
    const { data: ttlRows, error: ttlErr } = await supabase
      .from("workspace_memories")
      .delete()
      .eq("workspace_id", workspaceId)
      .lt("created_at", cutoff)
      .select("id");

    if (!ttlErr && Array.isArray(ttlRows)) ttlDeleted = ttlRows.length;
  }

  // 2. Prune by cap: if over maxCount, delete oldest
  const { count, error: countErr } = await supabase
    .from("workspace_memories")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (countErr) return { pruned: ttlDeleted, reason: ttlDeleted ? "ttl" : "none" };

  const currentCount = count ?? 0;
  let capDeleted = 0;

  if (currentCount > maxCount) {
    const toRemove = currentCount - maxCount;
    const { data: oldRows } = await supabase
      .from("workspace_memories")
      .select("id")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .limit(toRemove);

    if (Array.isArray(oldRows) && oldRows.length > 0) {
      const ids = oldRows.map((r: { id?: string }) => r.id).filter((id): id is string => Boolean(id));
      if (ids.length > 0) {
        const { data: delRows } = await supabase
          .from("workspace_memories")
          .delete()
          .in("id", ids)
          .select("id");
        capDeleted = Array.isArray(delRows) ? delRows.length : ids.length;
      }
    }
  }

  const total = ttlDeleted + capDeleted;
  let reason: PruneResult["reason"] = "none";
  if (total > 0) {
    if (ttlDeleted > 0 && capDeleted > 0) reason = "both";
    else if (ttlDeleted > 0) reason = "ttl";
    else reason = "cap";
  }

  return { pruned: total, reason };
}

/**
 * Debounced prune: run full prune only every N inserts per workspace.
 * Call after each workspace_memories insert to avoid running prune on every insert.
 */
export async function maybePruneWorkspaceMemories(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<PruneResult | null> {
  const count = (insertCountByWorkspace.get(workspaceId) ?? 0) + 1;
  insertCountByWorkspace.set(workspaceId, count);

  if (count % PRUNE_EVERY_N_INSERTS !== 0) {
    return null;
  }

  return pruneWorkspaceMemories(supabase, workspaceId);
}
