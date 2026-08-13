/**
 * Record + roll up workspace AI usage for P5 attribution.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateCostCents, providerFromModel } from "./pricing.js";

export type UsageSource =
  | "chat"
  | "scan"
  | "greenfield"
  | "provider_api"
  | "app_credit"
  | "manual"
  | "broker_api"
  | "market_data_api"
  | "fda_api"
  | "agent_run";

export const TRADING_FUEL_SOURCES: UsageSource[] = [
  "broker_api",
  "market_data_api",
  "fda_api",
];

export function isTradingFuelSource(source: string): boolean {
  return TRADING_FUEL_SOURCES.includes(source as UsageSource);
}

export type FuelBySubsystem = {
  subsystem: string;
  callCount: number;
  costCents: number;
  eventCount: number;
  bySource: Record<string, { callCount: number; costCents: number; eventCount: number }>;
};

/** Roll trading fuel events by ArchNode.subsystem (via nodeId → subsystem map). */
export function rollupFuelBySubsystem(
  events: Array<{
    source: string;
    node_id: string | null;
    cost_cents: number;
    metadata?: { call_count?: number } | null;
  }>,
  subsystemByNodeId: Record<string, string>
): FuelBySubsystem[] {
  const by = new Map<string, FuelBySubsystem>();
  for (const e of events) {
    if (!isTradingFuelSource(e.source)) continue;
    const subsystem =
      (e.node_id && subsystemByNodeId[e.node_id]) || "unclassified";
    let row = by.get(subsystem);
    if (!row) {
      row = {
        subsystem,
        callCount: 0,
        costCents: 0,
        eventCount: 0,
        bySource: {},
      };
      by.set(subsystem, row);
    }
    const calls = Number(e.metadata?.call_count ?? 1) || 1;
    row.callCount += calls;
    row.costCents += e.cost_cents ?? 0;
    row.eventCount += 1;
    const src = row.bySource[e.source] ?? { callCount: 0, costCents: 0, eventCount: 0 };
    src.callCount += calls;
    src.costCents += e.cost_cents ?? 0;
    src.eventCount += 1;
    row.bySource[e.source] = src;
  }
  return [...by.values()].sort((a, b) => b.costCents - a.costCents || b.callCount - a.callCount);
}

export type RecordUsageParams = {
  workspaceId: string;
  userId?: string | null;
  nodeId?: string | null;
  source: UsageSource;
  providerId?: string | null;
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  costCents?: number;
  modelTraceId?: string | null;
  metadata?: Record<string, unknown>;
};

export type UsageEventRow = {
  id: string;
  workspace_id: string;
  node_id: string | null;
  user_id: string | null;
  source: string;
  provider_id: string | null;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_cents: number;
  created_at: string;
};

export type NodeUsageRollup = {
  nodeId: string;
  promptTokens: number;
  completionTokens: number;
  costCents: number;
  eventCount: number;
  claimerId: string | null;
  claimerNickname: string | null;
};

export type NickUsageRollup = {
  userId: string | null;
  nickname: string | null;
  promptTokens: number;
  completionTokens: number;
  costCents: number;
  eventCount: number;
  nodeIds: string[];
};

/** Pure rollup helpers (unit-tested without DB). */
export function rollupByNode(
  events: Array<{
    node_id: string | null;
    prompt_tokens: number;
    completion_tokens: number;
    cost_cents: number;
  }>,
  claims: Array<{ target_id: string; claimer_id: string; nickname?: string | null }>
): NodeUsageRollup[] {
  const claimByNode = new Map(claims.map((c) => [c.target_id, c]));
  const byNode = new Map<string, NodeUsageRollup>();
  for (const e of events) {
    if (!e.node_id) continue;
    let row = byNode.get(e.node_id);
    if (!row) {
      const claim = claimByNode.get(e.node_id);
      row = {
        nodeId: e.node_id,
        promptTokens: 0,
        completionTokens: 0,
        costCents: 0,
        eventCount: 0,
        claimerId: claim?.claimer_id ?? null,
        claimerNickname: claim?.nickname ?? null,
      };
      byNode.set(e.node_id, row);
    }
    row.promptTokens += e.prompt_tokens || 0;
    row.completionTokens += e.completion_tokens || 0;
    row.costCents += e.cost_cents || 0;
    row.eventCount += 1;
  }
  return [...byNode.values()].sort((a, b) => b.costCents - a.costCents);
}

export function rollupByNick(nodeRollups: NodeUsageRollup[]): NickUsageRollup[] {
  const byNick = new Map<string, NickUsageRollup>();
  for (const n of nodeRollups) {
    const key = n.claimerId ?? "__unclaimed__";
    let row = byNick.get(key);
    if (!row) {
      row = {
        userId: n.claimerId,
        nickname: n.claimerNickname,
        promptTokens: 0,
        completionTokens: 0,
        costCents: 0,
        eventCount: 0,
        nodeIds: [],
      };
      byNick.set(key, row);
    }
    row.promptTokens += n.promptTokens;
    row.completionTokens += n.completionTokens;
    row.costCents += n.costCents;
    row.eventCount += n.eventCount;
    if (!row.nodeIds.includes(n.nodeId)) row.nodeIds.push(n.nodeId);
  }
  return [...byNick.values()].sort((a, b) => b.costCents - a.costCents);
}

export function periodStart(period: "monthly" | "weekly", now = new Date()): Date {
  const d = new Date(now);
  if (period === "weekly") {
    const day = d.getUTCDay();
    const diff = (day + 6) % 7; // Monday start
    d.setUTCDate(d.getUTCDate() - diff);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Best-effort insert. Never throws to callers — usage recording must not break chat.
 */
export async function recordUsageEvent(
  supabase: SupabaseClient | null | undefined,
  params: RecordUsageParams
): Promise<string | null> {
  if (!supabase || !params.workspaceId) return null;
  const prompt = Math.max(0, params.promptTokens ?? 0);
  const completion = Math.max(0, params.completionTokens ?? 0);
  const cost =
    params.costCents ??
    estimateCostCents(prompt, completion, params.model);
  const providerId = params.providerId ?? providerFromModel(params.model);
  try {
    const { data, error } = await supabase
      .from("usage_events")
      .insert({
        workspace_id: params.workspaceId,
        node_id: params.nodeId ?? null,
        user_id: params.userId ?? null,
        source: params.source,
        provider_id: providerId,
        model: params.model ?? null,
        prompt_tokens: prompt,
        completion_tokens: completion,
        cost_cents: cost,
        model_trace_id: params.modelTraceId ?? null,
        metadata: params.metadata ?? null,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      console.warn("[usage] recordUsageEvent failed:", error.message);
      return null;
    }
    // Soft debit of ai_credits_cents when user-scoped balances exist
    if (params.userId && cost > 0) {
      try {
        const { data: bal } = await supabase
          .from("usage_balances")
          .select("ai_credits_cents")
          .eq("user_id", params.userId)
          .maybeSingle();
        if (bal && typeof (bal as { ai_credits_cents?: number }).ai_credits_cents === "number") {
          const next = Math.max(0, ((bal as { ai_credits_cents: number }).ai_credits_cents ?? 0) - cost);
          await supabase
            .from("usage_balances")
            .update({ ai_credits_cents: next })
            .eq("user_id", params.userId);
        }
      } catch {
        /* non-fatal */
      }
    }
    return (data as { id?: string } | null)?.id ?? null;
  } catch (e) {
    console.warn("[usage] recordUsageEvent exception:", e instanceof Error ? e.message : e);
    return null;
  }
}
