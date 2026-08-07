/**
 * Flow → Tasks Kanban (brighter blanko accents — no grey columns).
 * Status map: todo | in_progress | needs_review | done; Issues = kind issue.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentInventoryResult } from "./types";
import {
  ACCENT,
  ACCENT_WASH,
  BAD,
  CANVAS,
  FONT_MONO,
  FONT_UI,
  GOOD,
  INK,
  LINE,
  PAPER,
  WARN,
} from "./theme/tokens";
import { TRADING_PIPELINE_SEED } from "./flowTradingSeed";

const INFO = "#2563EB";

type TodoRow = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  kind?: string | null;
  agent_file?: string | null;
  layer_id?: string | null;
  assignee_label?: string | null;
  source_path?: string | null;
  archived_at?: string | null;
};

type GithubEvent = {
  event_type?: string;
  author_login?: string | null;
  message?: string | null;
  github_url?: string | null;
  created_at?: string;
};

type Props = {
  workspaceId?: string | null;
  accessToken?: string | null;
  apiBase?: string;
  agentFile?: string | null;
  agents?: AgentInventoryResult;
  onSelectAgent?: (file: string) => void;
};

const COLUMNS: Array<{
  id: string;
  title: string;
  tip: string;
  match: (t: TodoRow) => boolean;
}> = [
  {
    id: "todo",
    title: "To do",
    tip: INFO,
    match: (t) => t.kind !== "issue" && (t.status === "todo" || t.status === "pending"),
  },
  {
    id: "doing",
    title: "Doing",
    tip: ACCENT,
    match: (t) => t.kind !== "issue" && t.status === "in_progress",
  },
  {
    id: "tested",
    title: "Tested",
    tip: WARN,
    match: (t) => t.kind !== "issue" && t.status === "needs_review",
  },
  {
    id: "done",
    title: "Completed",
    tip: GOOD,
    match: (t) => t.kind !== "issue" && (t.status === "done" || t.status === "completed"),
  },
  {
    id: "issues",
    title: "Issues",
    tip: BAD,
    match: (t) => t.kind === "issue",
  },
];

const NEXT_STATUS: Record<string, string | null> = {
  todo: "in_progress",
  pending: "in_progress",
  in_progress: "needs_review",
  needs_review: "done",
  done: null,
};

const fileName = (f: string) => f.split(/[/\\]/).pop() || f;

export function FlowTasksBoard({
  workspaceId,
  accessToken,
  apiBase = "",
  agentFile,
  agents,
  onSelectAgent,
}: Props) {
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [events, setEvents] = useState<GithubEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localAgent, setLocalAgent] = useState<string>("");

  const surfaces = useMemo(
    () => (agents?.agents ?? []).filter((a) => a.kind === "agent"),
    [agents]
  );
  const picked = agentFile || localAgent || surfaces[0]?.file || "";

  const base = apiBase.replace(/\/$/, "");
  const authed = !!(workspaceId && accessToken);

  const load = useCallback(async () => {
    if (!authed) return;
    setError(null);
    try {
      const q = new URLSearchParams({ workspaceId: workspaceId! });
      const r = await fetch(`${base}/api/todos?${q}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      const all = ((d.todos ?? []) as TodoRow[]).filter((t) => !t.archived_at);
      // Show workspace spine (null agent) + cards for selected agent file.
      setTodos(
        all.filter((t) => !t.agent_file || !picked || t.agent_file === picked)
      );

      const er = await fetch(
        `${base}/api/workspaces/${encodeURIComponent(workspaceId!)}/github-events?limit=12`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (er.ok) {
        const ed = await er.json();
        setEvents((ed.events ?? []) as GithubEvent[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [authed, workspaceId, accessToken, base, picked]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchStatus(id: string, status: string) {
    if (!authed) return;
    setBusy(true);
    try {
      const r = await fetch(`${base}/api/todos/${id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error(await r.text());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function seedPipeline() {
    if (!authed) return;
    setBusy(true);
    setError(null);
    try {
      const existing = new Set(todos.map((t) => t.source_path).filter(Boolean));
      for (const card of TRADING_PIPELINE_SEED) {
        if (existing.has(card.sourcePath)) continue;
        const r = await fetch(`${base}/api/todos`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId,
            title: card.title,
            description: card.description,
            agentFile: picked || null,
            layerId: card.layerId,
            assigneeLabel: "Cursor",
            kind: card.kind,
            source: "trading-spine",
            sourcePath: card.sourcePath,
          }),
        });
        if (!r.ok) throw new Error(await r.text());
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importPathIssues() {
    if (!authed || !picked) return;
    setBusy(true);
    try {
      const sourcePath = `flow-issue:auth:${picked}`;
      if (todos.some((t) => t.source_path === sourcePath)) {
        setBusy(false);
        return;
      }
      const r = await fetch(`${base}/api/todos`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId,
          title: `Auth gap on path: ${fileName(picked)}`,
          description:
            "Seeded from Flow Path — no auth detected on agent files that reach money/patient resources.",
          agentFile: picked,
          layerId: "ingress",
          assigneeLabel: "Cursor",
          kind: "issue",
          source: "flow-path",
          sourcePath,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!authed) {
    return (
      <div data-testid="flow-tasks-board" style={{ padding: 24, fontFamily: FONT_UI, color: INK }}>
        <p style={{ fontSize: 14, lineHeight: 1.5 }}>
          Tasks need a signed-in workspace. Sign in and open a saved workspace to track Payment →
          Broker → Policy on this board.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="flow-tasks-board"
      style={{
        height: "100%",
        overflow: "auto",
        padding: "12px 16px 40px",
        fontFamily: FONT_UI,
        background: PAPER,
        color: INK,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Agent</span>
        <select
          data-testid="flow-tasks-agent"
          value={picked}
          onChange={(e) => {
            setLocalAgent(e.target.value);
            onSelectAgent?.(e.target.value);
          }}
          style={{
            background: CANVAS,
            border: `1px solid ${LINE}`,
            borderRadius: 8,
            padding: "6px 10px",
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: INK,
          }}
        >
          {surfaces.length === 0 ? <option value="">(no agents — still seed workspace pack)</option> : null}
          {surfaces.map((a) => (
            <option key={a.file} value={a.file}>
              {fileName(a.file)}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="flow-seed-pipeline"
          disabled={busy}
          onClick={() => void seedPipeline()}
          style={btn(ACCENT)}
        >
          Seed trading spine
        </button>
        <button
          type="button"
          data-testid="flow-import-path-issues"
          disabled={busy || !picked}
          onClick={() => void importPathIssues()}
          style={btn(BAD)}
        >
          Import from Path
        </button>
        <span style={{ fontSize: 12, color: ACCENT, fontWeight: 600 }}>
          Assignee default: Cursor · blanko tracks code here
        </span>
      </div>

      <div
        data-testid="flow-tasks-activity"
        style={{
          marginBottom: 14,
          padding: "10px 12px",
          borderRadius: 10,
          border: `1px solid ${ACCENT}`,
          background: ACCENT_WASH,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 800, color: ACCENT, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Activity · GitHub
        </div>
        <div style={{ fontSize: 12, marginTop: 4, color: INK }}>
          Primary pusher today: Cursor (local agent) until a human claims work. blanko surfaces pushes —
          it does not replace branch protection.
        </div>
        {events.length === 0 ? (
          <div style={{ fontSize: 12, marginTop: 6, color: INK, opacity: 0.7 }}>No recent events yet.</div>
        ) : (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>
            {events.slice(0, 6).map((ev, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <strong style={{ color: INFO }}>{ev.author_login || "unknown"}</strong>
                {" — "}
                {ev.message || ev.event_type || "event"}
                {ev.github_url ? (
                  <>
                    {" "}
                    <a href={ev.github_url} target="_blank" rel="noreferrer" style={{ color: ACCENT }}>
                      link
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <div style={{ color: BAD, fontSize: 12, marginBottom: 10, fontWeight: 600 }}>{error}</div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(160px, 1fr))",
          gap: 12,
          alignItems: "start",
        }}
      >
        {COLUMNS.map((col) => {
          const cards = todos.filter(col.match);
          return (
            <div key={col.id} data-testid={`flow-kanban-${col.id}`}>
              <div
                style={{
                  borderBottom: `3px solid ${col.tip}`,
                  paddingBottom: 8,
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: col.tip,
                  }}
                >
                  {col.title}
                </div>
                <div style={{ fontSize: 12, color: INK, marginTop: 2 }}>{cards.length}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {cards.length === 0 ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: `1px dashed ${col.tip}`,
                      background: CANVAS,
                      fontSize: 12,
                      color: INK,
                    }}
                  >
                    Empty — seed trading spine or add a card.
                  </div>
                ) : (
                  cards.map((t) => {
                    const next = t.kind === "issue" ? null : NEXT_STATUS[t.status] ?? null;
                    return (
                      <div
                        key={t.id}
                        data-testid={`flow-task-card-${t.id}`}
                        style={{
                          background: CANVAS,
                          border: `1px solid ${LINE}`,
                          borderLeft: `4px solid ${col.tip}`,
                          borderRadius: 10,
                          padding: "10px 12px",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{t.title}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                          {t.layer_id ? (
                            <Chip color={INFO}>{t.layer_id}</Chip>
                          ) : null}
                          <Chip color={ACCENT}>{t.assignee_label || "Cursor"}</Chip>
                        </div>
                        {next ? (
                          <button
                            type="button"
                            disabled={busy}
                            data-testid={`flow-task-advance-${t.id}`}
                            onClick={() => void patchStatus(t.id, next)}
                            style={{
                              ...btn(col.tip),
                              marginTop: 8,
                              fontSize: 11,
                              padding: "4px 8px",
                            }}
                          >
                            Move →
                          </button>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color,
        border: `1px solid ${color}`,
        borderRadius: 6,
        padding: "2px 6px",
        background: CANVAS,
        fontFamily: FONT_MONO,
      }}
    >
      {children}
    </span>
  );
}

function btn(color: string): React.CSSProperties {
  return {
    padding: "7px 12px",
    borderRadius: 8,
    border: `2px solid ${color}`,
    background: CANVAS,
    color,
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: FONT_UI,
  };
}
