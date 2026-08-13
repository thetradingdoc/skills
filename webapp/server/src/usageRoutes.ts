/**
 * P5 usage + budget routes.
 */
import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { requireCanEdit } from "./middleware/requireCanEdit.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import {
  periodStart,
  recordUsageEvent,
  rollupByNick,
  rollupByNode,
  rollupFuelBySubsystem,
  type UsageEventRow,
} from "./usage.js";
import { classifySubsystem } from "../../../src/analyzer/subsystemClassify.js";

const router = Router();

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

router.get(
  "/workspaces/:workspaceId/usage",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId;
    const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : null;
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const since = daysAgoIso(days);

    try {
      let q = supabaseAdmin
        .from("usage_events")
        .select(
          "id, workspace_id, node_id, user_id, source, provider_id, model, prompt_tokens, completion_tokens, cost_cents, metadata, created_at"
        )
        .eq("workspace_id", workspaceId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (nodeId) q = q.eq("node_id", nodeId);

      const { data: events, error } = await q;
      if (error) {
        // Table may not be migrated yet — return empty rather than 500
        if (/usage_events|does not exist|schema cache/i.test(error.message)) {
          res.json({
            since,
            days,
            totals: { promptTokens: 0, completionTokens: 0, costCents: 0, eventCount: 0 },
            byNode: [],
            byNick: [],
            recent: [],
            migrationPending: true,
          });
          return;
        }
        res.status(500).json({ error: error.message });
        return;
      }

      const rows = (events ?? []) as UsageEventRow[];

      const { data: claims } = await supabaseAdmin
        .from("section_claims")
        .select("target_id, claimer_id")
        .eq("workspace_id", workspaceId)
        .eq("kind", "node");

      const claimerIds = [...new Set((claims ?? []).map((c: any) => c.claimer_id as string))];
      const nickByClaimer = new Map<string, string>();
      if (claimerIds.length) {
        const { data: claimProfiles } = await supabaseAdmin
          .from("profiles")
          .select("user_id, nickname")
          .in("user_id", claimerIds);
        for (const p of claimProfiles ?? []) {
          if ((p as any).nickname) nickByClaimer.set((p as any).user_id, (p as any).nickname);
        }
      }

      const claimRows = (claims ?? []).map((c: any) => ({
        target_id: c.target_id as string,
        claimer_id: c.claimer_id as string,
        nickname: nickByClaimer.get(c.claimer_id as string) ?? null,
      }));

      // Also attach nicknames for event user_ids that aren't claimers
      const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
      const nickByUser = new Map<string, string>(nickByClaimer);
      if (userIds.length) {
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("user_id, nickname")
          .in("user_id", userIds);
        for (const p of profiles ?? []) {
          if ((p as any).nickname) nickByUser.set((p as any).user_id, (p as any).nickname);
        }
      }

      const byNode = rollupByNode(rows, claimRows).map((n) => ({
        ...n,
        claimerNickname:
          n.claimerNickname ??
          (n.claimerId ? nickByUser.get(n.claimerId) ?? null : null),
      }));
      const byNick = rollupByNick(byNode);

      const totals = rows.reduce(
        (acc, r) => {
          acc.promptTokens += r.prompt_tokens || 0;
          acc.completionTokens += r.completion_tokens || 0;
          acc.costCents += r.cost_cents || 0;
          acc.eventCount += 1;
          return acc;
        },
        { promptTokens: 0, completionTokens: 0, costCents: 0, eventCount: 0 }
      );

      const subsystemByNodeId: Record<string, string> = {};
      try {
        const { data: graphRow } = await supabaseAdmin
          .from("graphs")
          .select("graph_json")
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const gNodes = (graphRow?.graph_json as { nodes?: Array<Record<string, unknown>> })?.nodes ?? [];
        for (const n of gNodes) {
          const id = String(n.id ?? "");
          if (!id) continue;
          const sub =
            (typeof n.subsystem === "string" && n.subsystem) ||
            classifySubsystem({
              id,
              path: String(n.path ?? id),
              label: String(n.label ?? id),
              suggestedLabel: typeof n.suggestedLabel === "string" ? n.suggestedLabel : undefined,
              files: Array.isArray(n.files) ? (n.files as string[]) : [],
              tags: Array.isArray(n.tags) ? (n.tags as string[]) : [],
              subsystem: typeof n.subsystem === "string" ? (n.subsystem as any) : undefined,
            }).subsystem;
          subsystemByNodeId[id] = sub;
        }
      } catch {
        /* graph optional */
      }

      const fuelBySubsystem = rollupFuelBySubsystem(
        rows.map((r) => ({
          source: r.source,
          node_id: r.node_id,
          cost_cents: r.cost_cents,
          metadata: (r as { metadata?: { call_count?: number } }).metadata ?? null,
        })),
        subsystemByNodeId
      );

      res.json({
        since,
        days,
        totals,
        byNode,
        byNick,
        fuelBySubsystem,
        recent: rows.slice(0, 50).map((r) => ({
          ...r,
          nickname: r.user_id ? nickByUser.get(r.user_id) ?? null : null,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.get(
  "/workspaces/:workspaceId/usage/node/:nodeId",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const { workspaceId, nodeId } = req.params;
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const since = daysAgoIso(days);
    try {
      const { data: events, error } = await supabaseAdmin
        .from("usage_events")
        .select("prompt_tokens, completion_tokens, cost_cents, provider_id, model, created_at, user_id")
        .eq("workspace_id", workspaceId)
        .eq("node_id", nodeId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        if (/usage_events|does not exist|schema cache/i.test(error.message)) {
          res.json({
            nodeId,
            since,
            totals: { promptTokens: 0, completionTokens: 0, costCents: 0, eventCount: 0 },
            claimerNickname: null,
            budget: null,
            recent: [],
            migrationPending: true,
          });
          return;
        }
        res.status(500).json({ error: error.message });
        return;
      }

      const rows = events ?? [];
      const totals = rows.reduce(
        (acc, r: any) => {
          acc.promptTokens += r.prompt_tokens || 0;
          acc.completionTokens += r.completion_tokens || 0;
          acc.costCents += r.cost_cents || 0;
          acc.eventCount += 1;
          return acc;
        },
        { promptTokens: 0, completionTokens: 0, costCents: 0, eventCount: 0 }
      );

      const { data: claim } = await supabaseAdmin
        .from("section_claims")
        .select("claimer_id")
        .eq("workspace_id", workspaceId)
        .eq("kind", "node")
        .eq("target_id", nodeId)
        .maybeSingle();

      let claimerNickname: string | null = null;
      const claimerId = (claim as { claimer_id?: string } | null)?.claimer_id ?? null;
      if (claimerId) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("nickname")
          .eq("user_id", claimerId)
          .maybeSingle();
        claimerNickname = (profile as { nickname?: string } | null)?.nickname ?? null;
      }

      const { data: budget } = await supabaseAdmin
        .from("budgets")
        .select("id, limit_cents, period, kind")
        .eq("workspace_id", workspaceId)
        .eq("kind", "node")
        .eq("target_id", nodeId)
        .maybeSingle();

      let budgetView = null;
      if (budget) {
        const start = periodStart((budget as any).period === "weekly" ? "weekly" : "monthly");
        const periodBurn = rows
          .filter((r: any) => new Date(r.created_at) >= start)
          .reduce((s: number, r: any) => s + (r.cost_cents || 0), 0);
        budgetView = {
          limitCents: (budget as any).limit_cents as number,
          period: (budget as any).period as string,
          spentCents: periodBurn,
          remainingCents: Math.max(0, ((budget as any).limit_cents as number) - periodBurn),
        };
      }

      res.json({
        nodeId,
        since,
        totals,
        claimerNickname,
        claimerId,
        budget: budgetView,
        recent: rows.slice(0, 20),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.get(
  "/workspaces/:workspaceId/budgets",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from("budgets")
      .select("*")
      .eq("workspace_id", req.params.workspaceId)
      .order("created_at", { ascending: false });
    if (error) {
      if (/budgets|does not exist|schema cache/i.test(error.message)) {
        res.json({ budgets: [], migrationPending: true });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ budgets: data ?? [] });
  }
);

router.post(
  "/workspaces/:workspaceId/budgets",
  requireUser,
  requireWorkspaceAccess,
  requireCanEdit,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const kind = String(req.body?.kind || "workspace");
    const targetId = req.body?.targetId != null ? String(req.body.targetId) : null;
    const limitCents = Number(req.body?.limitCents);
    const period = req.body?.period === "weekly" ? "weekly" : "monthly";
    if (!["workspace", "section", "node"].includes(kind)) {
      res.status(400).json({ error: "kind must be workspace|section|node" });
      return;
    }
    if (!Number.isFinite(limitCents) || limitCents < 0) {
      res.status(400).json({ error: "limitCents must be a non-negative number" });
      return;
    }
    if (kind !== "workspace" && !targetId) {
      res.status(400).json({ error: "targetId required for section/node budgets" });
      return;
    }
    const userId = (req as any).user?.id as string | undefined;
    const { data, error } = await supabaseAdmin
      .from("budgets")
      .upsert(
        {
          workspace_id: req.params.workspaceId,
          kind,
          target_id: kind === "workspace" ? null : targetId,
          limit_cents: Math.round(limitCents),
          period,
          created_by: userId ?? null,
        },
        { onConflict: "workspace_id,kind,target_id,period" }
      )
      .select("*")
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ budget: data });
  }
);

/** Dev/manual ingest — record a usage event (editor+). Useful before provider API pulls. */
router.post(
  "/workspaces/:workspaceId/usage",
  requireUser,
  requireWorkspaceAccess,
  requireCanEdit,
  async (req, res) => {
    const userId = (req as any).user?.id as string | undefined;
    const id = await recordUsageEvent(supabaseAdmin, {
      workspaceId: req.params.workspaceId,
      userId,
      nodeId: req.body?.nodeId ?? null,
      source: (req.body?.source as any) || "manual",
      providerId: req.body?.providerId ?? null,
      model: req.body?.model ?? null,
      promptTokens: Number(req.body?.promptTokens) || 0,
      completionTokens: Number(req.body?.completionTokens) || 0,
      costCents: req.body?.costCents != null ? Number(req.body.costCents) : undefined,
      metadata: req.body?.metadata,
    });
    if (!id) {
      res.status(503).json({ error: "Could not record usage (DB unavailable or migration pending)." });
      return;
    }
    res.json({ id });
  }
);

export { router as usageRoutes };
