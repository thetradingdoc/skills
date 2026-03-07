/**
 * Memory retrieval — recency- and node-scoped injection for chat context.
 * Avoids unbounded context fill.
 * Excludes superseded memories; freshness hints help model weight newer info.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const MEMORIES_LIMIT = 20;
const MEMORIES_MAX_AGE_DAYS = 30;
const SNAPSHOTS_LIMIT = 10;
const SNAPSHOTS_MAX_AGE_DAYS = 14;
const USER_MEMORIES_LIMIT = 10;
const USER_MEMORIES_MAX_AGE_DAYS = 90;

export interface MemoryForContext {
  content: string;
  memory_type?: string | null;
  created_at?: string | null;
}

export interface UserMemoryForContext {
  content: string;
  memory_type?: string | null;
  created_at?: string | null;
}

export interface SnapshotForContext {
  intent_summary: string;
  outcome_summary: string;
  created_at?: string | null;
}

/**
 * Load workspace_memories for context: recency + optional node scope + cap.
 */
export async function getMemoriesForContext(
  db: SupabaseClient,
  workspaceId: string,
  options: { nodeId?: string | null; limit?: number; maxAgeDays?: number } = {}
): Promise<MemoryForContext[]> {
  const limit = options.limit ?? MEMORIES_LIMIT;
  const maxAgeDays = options.maxAgeDays ?? MEMORIES_MAX_AGE_DAYS;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  let query = db
    .from("workspace_memories")
    .select("content, memory_type, created_at")
    .eq("workspace_id", workspaceId)
    .gte("created_at", cutoff)
    .is("superseded_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.nodeId) {
    query = query.or(`node_id.eq.${options.nodeId},node_id.is.null`);
  }

  const { data, error } = await query;

  if (error) return [];
  return (data ?? []) as MemoryForContext[];
}

/**
 * Load conversation_snapshots for context: recency + optional node scope + cap.
 */
export async function getSnapshotsForContext(
  db: SupabaseClient,
  workspaceId: string,
  options: { nodeId?: string | null; limit?: number; maxAgeDays?: number } = {}
): Promise<SnapshotForContext[]> {
  const limit = options.limit ?? SNAPSHOTS_LIMIT;
  const maxAgeDays = options.maxAgeDays ?? SNAPSHOTS_MAX_AGE_DAYS;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  let query = db
    .from("conversation_snapshots")
    .select("intent_summary, outcome_summary, created_at")
    .eq("workspace_id", workspaceId)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.nodeId) {
    query = query.or(`node_id.eq.${options.nodeId},node_id.is.null`);
  }

  const { data, error } = await query;

  if (error) return [];
  return (data ?? []) as SnapshotForContext[];
}

/**
 * Load user_memories for cross-workspace context (preferences, patterns).
 */
export async function getUserMemoriesForContext(
  db: SupabaseClient,
  userId: string,
  options: { limit?: number; maxAgeDays?: number } = {}
): Promise<UserMemoryForContext[]> {
  const limit = options.limit ?? USER_MEMORIES_LIMIT;
  const maxAgeDays = options.maxAgeDays ?? USER_MEMORIES_MAX_AGE_DAYS;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from("user_memories")
    .select("content, memory_type, created_at")
    .eq("user_id", userId)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as UserMemoryForContext[];
}

/**
 * Format relative age for freshness hint (newer = prefer).
 */
function relativeAge(createdAt: string | null | undefined): string {
  if (!createdAt) return "";
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  return "<1h ago";
}

/**
 * Build injected context string from memories + snapshots + user memories for chat.
 * Freshness hints ([2d ago]) help the model weight newer information over older.
 */
export function buildMemoryContextBlock(
  memories: MemoryForContext[],
  snapshots: SnapshotForContext[],
  userMemories?: UserMemoryForContext[]
): string {
  const parts: string[] = [];

  if (userMemories && userMemories.length > 0) {
    const lines = userMemories
      .map((m) => {
        const age = relativeAge(m.created_at);
        const hint = age ? ` [${age}]` : "";
        return `- ${(m.content ?? "").slice(0, 400)}${(m.content?.length ?? 0) > 400 ? "…" : ""}${hint}`;
      })
      .join("\n");
    parts.push(`## Your preferences (apply across projects)\n${lines}`);
  }

  if (memories.length > 0) {
    const memLines = memories
      .map((m) => {
        const age = relativeAge(m.created_at);
        const hint = age ? ` [${age}]` : "";
        return `- ${(m.content ?? "").slice(0, 500)}${(m.content?.length ?? 0) > 500 ? "…" : ""}${hint}`;
      })
      .join("\n");
    parts.push(`## Saved insights (workspace)\n${memLines}`);
  }

  if (snapshots.length > 0) {
    const snapLines = snapshots
      .map((s) => {
        const age = relativeAge(s.created_at);
        const hint = age ? ` [${age}]` : "";
        return `- Q: ${s.intent_summary.slice(0, 150)} → ${s.outcome_summary.slice(0, 200)}${hint}`;
      })
      .join("\n");
    parts.push(`## Recent exchanges\n${snapLines}`);
  }

  if (parts.length === 0) return "";
  return "\n\n" + parts.join("\n\n") + "\n";
}
