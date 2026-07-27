/**
 * Memory retrieval — recency- and node-scoped injection for chat context.
 * Avoids unbounded context fill.
 * Excludes superseded memories; freshness hints help model weight newer info.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SystemModel } from "../../../src/types.js";

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

export interface GraphEvolutionEntry {
  completed_at: string;
  node_count: number;
  edge_count: number;
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
 * Load scan_history for graph evolution context (time-based architecture questions).
 */
export async function getGraphEvolutionForContext(
  db: SupabaseClient,
  workspaceId: string,
  options: { limit?: number; maxAgeDays?: number } = {}
): Promise<GraphEvolutionEntry[]> {
  const limit = options.limit ?? 10;
  const maxAgeDays = options.maxAgeDays ?? 30;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from("scan_history")
    .select("completed_at, node_count, edge_count")
    .eq("workspace_id", workspaceId)
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .gte("completed_at", cutoff)
    .order("completed_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as GraphEvolutionEntry[];
}

/**
 * Load SystemModel for AI context. Returns condensed summary for architecture/system questions.
 */
export async function getSystemModelForContext(
  db: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  const { data, error } = await db
    .from("workspace_system_models")
    .select("system_model_json")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !data?.system_model_json) return null;
  const model = data.system_model_json as SystemModel;
  return formatSystemModelSummary(model);
}

/**
 * Produce a concise text summary of SystemModel for AI context.
 */
function formatSystemModelSummary(model: SystemModel): string {
  const domains = model.domains?.slice(0, 12) ?? [];
  const nodes = model.nodes ?? [];
  const byTier = { core: nodes.filter((n) => n.tier === "core"), supporting: nodes.filter((n) => n.tier === "supporting"), peripheral: nodes.filter((n) => n.tier === "peripheral") };
  const coreSample = byTier.core.slice(0, 8).map((n) => `${n.label ?? n.id} (${n.domain}, ${(n.runtimeRoles ?? []).join("/") || "service"})`).join("; ");
  const lines: string[] = [
    `Domains: ${domains.join(", ") || "—"}`,
    `Nodes: ${nodes.length} (${byTier.core.length} core, ${byTier.supporting.length} supporting, ${byTier.peripheral.length} peripheral)`,
  ];
  if (coreSample) lines.push(`Core: ${coreSample}`);
  return lines.join("\n");
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
 * Build injected context string from memories + snapshots + user memories + graph evolution + SystemModel for chat.
 * Freshness hints ([2d ago]) help the model weight newer information over older.
 */
export function buildMemoryContextBlock(
  memories: MemoryForContext[],
  snapshots: SnapshotForContext[],
  userMemories?: UserMemoryForContext[],
  graphEvolution?: GraphEvolutionEntry[],
  systemModelSummary?: string | null
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

  if (graphEvolution && graphEvolution.length > 0) {
    const evoLines = graphEvolution
      .map((e) => {
        const age = relativeAge(e.completed_at);
        const hint = age ? ` [${age}]` : "";
        return `- Scan: ${e.node_count} nodes, ${e.edge_count} edges${hint}`;
      })
      .join("\n");
    parts.push(`## Architecture evolution (scans)\n${evoLines}`);
  }

  if (systemModelSummary) {
    parts.push(`## SystemModel (current architecture)\n${systemModelSummary}`);
  }

  if (parts.length === 0) return "";
  return "\n\n" + parts.join("\n\n") + "\n";
}
