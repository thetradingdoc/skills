/**
 * P5 — Token usage + budget attribution.
 *
 * Answers "who is burning tokens, on what, and are we near a budget" —
 * the same question the platform inventory answers for providers, but for spend.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  INK,
  SLATE,
  LINE,
  CANVAS,
  PAPER,
  ACCENT,
  GOOD,
  WARN,
  BAD,
  FONT_MONO,
} from "./theme/tokens";


type Totals = {
  promptTokens: number;
  completionTokens: number;
  costCents: number;
  eventCount: number;
};

type ByNodeRow = {
  nodeId: string;
  promptTokens: number;
  completionTokens: number;
  costCents: number;
  eventCount: number;
  claimerId: string | null;
  claimerNickname: string | null;
};

type ByNickRow = {
  userId: string | null;
  nickname: string | null;
  promptTokens: number;
  completionTokens: number;
  costCents: number;
  eventCount: number;
  nodeIds: string[];
};

type RecentEvent = {
  id: string;
  node_id: string | null;
  source: string;
  provider_id: string | null;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_cents: number;
  created_at: string;
  nickname?: string | null;
};

type UsageResponse = {
  totals: Totals;
  byNode: ByNodeRow[];
  byNick: ByNickRow[];
  recent: RecentEvent[];
  fuelBySubsystem?: Array<{
    subsystem: string;
    callCount: number;
    costCents: number;
    eventCount: number;
    bySource: Record<string, { callCount: number; costCents: number; eventCount: number }>;
  }>;
  migrationPending?: boolean;
};

type Budget = {
  id: string;
  workspace_id: string;
  kind: "workspace" | "section" | "node";
  target_id: string | null;
  limit_cents: number;
  period: "monthly" | "weekly";
  created_at?: string;
};

type BudgetsResponse = {
  budgets: Budget[];
  migrationPending?: boolean;
};

type Props = {
  workspaceId: string | null;
  apiBase: string;
  accessToken: string | null;
  onSelectNode?: (nodeId: string) => void;
};

type FilterTab = "all" | "nick" | "node" | "budgets";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function chip(active: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    padding: "3px 8px",
    borderRadius: 999,
    border: active ? `1px solid ${ACCENT}` : `1px solid ${LINE}`,
    background: active ? "rgba(239, 50, 166, 0.2)" : "transparent",
    color: active ? ACCENT : SLATE,
    cursor: "pointer",
    fontFamily: FONT_MONO,
  };
}

export function UsageView({ workspaceId, apiBase, accessToken, onSelectNode }: Props) {
  const [filter, setFilter] = useState<FilterTab>("all");
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetsMigrationPending, setBudgetsMigrationPending] = useState(false);
  const [budgetLimit, setBudgetLimit] = useState("");
  const [budgetPeriod, setBudgetPeriod] = useState<"monthly" | "weekly">("monthly");
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    if (!workspaceId || !accessToken) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/usage?days=30`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "Could not load usage.");
        return;
      }
      setData(d as UsageResponse);
    } catch {
      setError("Could not reach the usage endpoint.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, accessToken, workspaceId]);

  const fetchBudgets = useCallback(async () => {
    if (!workspaceId || !accessToken) {
      setBudgets([]);
      return;
    }
    try {
      const r = await fetch(
        `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/budgets`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!r.ok) return;
      const d = (await r.json()) as BudgetsResponse;
      setBudgets(d.budgets ?? []);
      setBudgetsMigrationPending(!!d.migrationPending);
    } catch {
      /* best-effort */
    }
  }, [apiBase, accessToken, workspaceId]);

  useEffect(() => {
    fetchUsage();
    fetchBudgets();
  }, [fetchUsage, fetchBudgets]);

  const handleCreateBudget = useCallback(async () => {
    if (!workspaceId || !accessToken || budgetBusy) return;
    const dollars = Number(budgetLimit);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setBudgetError("Enter a valid dollar amount.");
      return;
    }
    setBudgetBusy(true);
    setBudgetError(null);
    try {
      const r = await fetch(`${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/budgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          kind: "workspace",
          limitCents: Math.round(dollars * 100),
          period: budgetPeriod,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setBudgetError(d.error ?? "Could not create budget.");
        return;
      }
      setBudgetLimit("");
      await fetchBudgets();
    } finally {
      setBudgetBusy(false);
    }
  }, [apiBase, accessToken, workspaceId, budgetLimit, budgetPeriod, budgetBusy, fetchBudgets]);

  const workspaceBudget = useMemo(
    () => budgets.find((b) => b.kind === "workspace"),
    [budgets]
  );

  if (!workspaceId) {
    return (
      <div
        data-testid="usage-view"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          background: CANVAS,
          color: SLATE,
          fontFamily: FONT_MONO,
          fontSize: 12,
        }}
      >
        Sign in to a workspace to see token usage.
      </div>
    );
  }

  const totals = data?.totals;

  return (
    <div
      data-testid="usage-view"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: CANVAS,
        color: INK,
        fontFamily: FONT_MONO,
      }}
    >
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ACCENT, marginBottom: 4 }}>Usage</div>
        <div style={{ fontSize: 11, color: SLATE, lineHeight: 1.45 }}>
          Token spend attributed to nodes and teammates over the last 30 days.
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 12, color: INK }}>
          <span>
            <span style={{ color: GOOD, fontWeight: 600 }}>
              {totals ? formatCents(totals.costCents) : "$0.00"}
            </span>{" "}
            spent
          </span>
          <span style={{ color: SLATE }}>
            {totals ? formatTokens(totals.promptTokens + totals.completionTokens) : "0"} tok
          </span>
          <span style={{ color: SLATE }}>{totals?.eventCount ?? 0} events</span>
        </div>
        {(data?.fuelBySubsystem?.length ?? 0) > 0 && (
          <div
            data-testid="blanko-fuel-by-subsystem"
            style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${LINE}` }}
          >
            <div style={{ fontSize: 10, color: SLATE, letterSpacing: "0.08em", marginBottom: 6 }}>
              TRADING FUEL (BROKER / MARKET-DATA / FDA)
            </div>
            {(data?.fuelBySubsystem ?? []).map((row) => (
              <div
                key={row.subsystem}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 11,
                  padding: "4px 0",
                  color: INK,
                }}
              >
                <span>{row.subsystem}</span>
                <span style={{ color: SLATE }}>
                  {row.callCount} calls · {formatCents(row.costCents)}
                </span>
              </div>
            ))}
          </div>
        )}
        {data?.migrationPending && (
          <div style={{ marginTop: 8, fontSize: 10.5, color: WARN }}>
            Usage tables aren&apos;t on this Supabase project yet — run{" "}
            <code style={{ fontSize: 10 }}>scripts/apply-usage-events-migration.ts</code> (DB password).
            GitHub link is unrelated.
          </div>
        )}
        {error && <div style={{ marginTop: 8, fontSize: 10.5, color: BAD }}>{error}</div>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          <button type="button" data-testid="usage-filter-all" onClick={() => setFilter("all")} style={chip(filter === "all")}>
            All
          </button>
          <button type="button" data-testid="usage-filter-nick" onClick={() => setFilter("nick")} style={chip(filter === "nick")}>
            By @nick
          </button>
          <button type="button" data-testid="usage-filter-node" onClick={() => setFilter("node")} style={chip(filter === "node")}>
            By node
          </button>
          <button
            type="button"
            data-testid="usage-filter-budgets"
            onClick={() => setFilter("budgets")}
            style={chip(filter === "budgets")}
          >
            Budgets
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {loading && !data && (
          <div style={{ padding: 24, color: SLATE, fontSize: 12 }}>Loading usage…</div>
        )}

        {!loading && data && data.totals.eventCount === 0 && filter !== "budgets" && (
          <div style={{ padding: 24, color: SLATE, fontSize: 12 }}>
            No usage recorded yet in the last 30 days.
          </div>
        )}

        {(filter === "all" || filter === "nick") && data && data.byNick.length > 0 && (
          <div>
            <div
              style={{
                padding: "8px 16px",
                fontSize: 10,
                color: SLATE,
                textTransform: "uppercase",
                letterSpacing: 0.06,
                borderBottom: `1px solid ${LINE}`,
              }}
            >
              By teammate
            </div>
            {data.byNick.map((row) => (
              <div
                key={row.userId ?? "unclaimed"}
                data-testid="usage-nick-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 16px",
                  borderBottom: `1px solid ${LINE}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: INK, fontWeight: 600 }}>
                    {row.nickname ? `@${row.nickname}` : "Unclaimed"}
                  </span>
                  <div style={{ fontSize: 10.5, color: SLATE, marginTop: 2 }}>
                    {row.nodeIds.length} node{row.nodeIds.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12.5, color: GOOD, fontWeight: 600 }}>{formatCents(row.costCents)}</div>
                  <div style={{ fontSize: 10.5, color: SLATE }}>
                    {formatTokens(row.promptTokens + row.completionTokens)} tok
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {(filter === "all" || filter === "node") && data && data.byNode.length > 0 && (
          <div>
            <div
              style={{
                padding: "8px 16px",
                fontSize: 10,
                color: SLATE,
                textTransform: "uppercase",
                letterSpacing: 0.06,
                borderBottom: `1px solid ${LINE}`,
              }}
            >
              By node
            </div>
            {data.byNode.map((row) => (
              <div
                key={row.nodeId}
                data-testid="usage-node-row"
                data-node-id={row.nodeId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 16px",
                  borderBottom: `1px solid ${LINE}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <button
                    type="button"
                    onClick={() => onSelectNode?.(row.nodeId)}
                    style={{
                      fontSize: 12.5,
                      fontFamily: FONT_MONO,
                      color: "#79c0ff",
                      background: "rgba(88,166,255,0.1)",
                      border: `1px solid ${ACCENT}44`,
                      borderRadius: 4,
                      padding: "2px 6px",
                      cursor: onSelectNode ? "pointer" : "default",
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "inline-block",
                    }}
                  >
                    {row.nodeId}
                  </button>
                  <div style={{ fontSize: 10.5, color: SLATE, marginTop: 4 }}>
                    {row.claimerNickname ? `@${row.claimerNickname}` : "unclaimed"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12.5, color: GOOD, fontWeight: 600 }}>{formatCents(row.costCents)}</div>
                  <div style={{ fontSize: 10.5, color: SLATE }}>
                    {formatTokens(row.promptTokens + row.completionTokens)} tok
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {filter === "budgets" && (
          <div style={{ padding: "12px 16px" }}>
            {budgetsMigrationPending && (
              <div style={{ marginBottom: 10, fontSize: 10.5, color: WARN }}>
                Usage tables aren&apos;t on this Supabase project yet — run{" "}
                <code style={{ fontSize: 10 }}>scripts/apply-usage-events-migration.ts</code>.
                GitHub link is unrelated.
              </div>
            )}
            {budgets.length === 0 ? (
              <div style={{ fontSize: 12, color: SLATE, marginBottom: 14 }}>No budgets set yet.</div>
            ) : (
              <div style={{ marginBottom: 14 }}>
                {budgets.map((b) => (
                  <div
                    key={b.id}
                    data-testid="usage-budget-row"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 0",
                      borderBottom: `1px solid ${LINE}`,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: INK }}>
                      {b.kind === "workspace" ? "Workspace" : `${b.kind}: ${b.target_id}`}
                    </span>
                    <span style={{ color: INK }}>
                      {formatCents(b.limit_cents)} / {b.period}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                fontSize: 10,
                color: SLATE,
                textTransform: "uppercase",
                letterSpacing: 0.06,
                marginBottom: 8,
              }}
            >
              {workspaceBudget ? "Update workspace budget" : "Set workspace budget"}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: SLATE }}>$</span>
              <input
                data-testid="usage-budget-limit-input"
                type="number"
                min="0"
                step="1"
                value={budgetLimit}
                onChange={(e) => setBudgetLimit(e.target.value)}
                placeholder="200"
                style={{
                  width: 90,
                  padding: "5px 8px",
                  fontSize: 12,
                  fontFamily: FONT_MONO,
                  background: PAPER,
                  border: `1px solid ${LINE}`,
                  borderRadius: 6,
                  color: INK,
                }}
              />
              <select
                data-testid="usage-budget-period-select"
                value={budgetPeriod}
                onChange={(e) => setBudgetPeriod(e.target.value as "monthly" | "weekly")}
                style={{
                  padding: "5px 8px",
                  fontSize: 12,
                  fontFamily: FONT_MONO,
                  background: PAPER,
                  border: `1px solid ${LINE}`,
                  borderRadius: 6,
                  color: INK,
                }}
              >
                <option value="monthly">monthly</option>
                <option value="weekly">weekly</option>
              </select>
              <button
                type="button"
                data-testid="usage-budget-submit"
                onClick={handleCreateBudget}
                disabled={budgetBusy || !budgetLimit}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  fontFamily: FONT_MONO,
                  border: `1px solid ${GOOD}`,
                  borderRadius: 6,
                  background: "rgba(63,185,80,0.12)",
                  color: GOOD,
                  cursor: budgetBusy || !budgetLimit ? "not-allowed" : "pointer",
                  opacity: budgetBusy || !budgetLimit ? 0.6 : 1,
                }}
              >
                {budgetBusy ? "…" : workspaceBudget ? "Update" : "Save"}
              </button>
            </div>
            {budgetError && <div style={{ marginTop: 8, fontSize: 10.5, color: BAD }}>{budgetError}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
