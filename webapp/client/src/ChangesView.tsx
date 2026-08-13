/**
 * What changed since the last scan (scan vs previous scan — not the tool write ledger).
 */
import { useCallback, useEffect, useState } from "react";
import { diffScans, type ScanDiff, type Change } from "./scanDiff";
import { ACCENT, BAD, CANVAS, FONT_MONO, GOOD, INK, LINE, PAPER, SLATE, WARN } from "./theme/tokens";

type Props = {
  graph: any;
  apiBase: string;
  accessToken: string | null;
  workspaceId: string | null;
};

function changeColor(c: Change): string {
  switch (c.kind) {
    case "auth-lost":
    case "reach-gained":
    case "layer-emptied":
      return BAD;
    case "tool-added":
      return c.weight >= 90 ? BAD : WARN;
    case "agent-added":
      return c.weight >= 90 ? BAD : ACCENT;
    case "auth-gained":
    case "layer-filled":
      return GOOD;
    case "reach-lost":
    case "tool-removed":
    case "agent-removed":
      return SLATE;
    case "agent-renamed":
    case "coverage-changed":
      return WARN;
    default:
      return SLATE;
  }
}

function Delta({
  label,
  before,
  after,
  worseWhenUp = true,
}: {
  label: string;
  before: number;
  after: number;
  worseWhenUp?: boolean;
}) {
  const moved = after - before;
  const colour =
    moved === 0 ? SLATE : (moved > 0) === worseWhenUp ? BAD : GOOD;
  return (
    <div style={{ minWidth: 108 }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 17, color: INK }}>
        {after}
        {moved !== 0 && (
          <span style={{ fontSize: 11.5, color: colour, marginLeft: 6 }}>
            {moved > 0 ? "+" : ""}
            {moved}
          </span>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: SLATE, marginTop: 2 }}>{label}</div>
    </div>
  );
}

export function ChangesView({ graph, apiBase, accessToken, workspaceId }: Props) {
  const [diff, setDiff] = useState<ScanDiff | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken || !workspaceId || !graph) return;
    setLoading(true);
    setReason(null);
    try {
      const r = await fetch(
        apiBase + "/scans/previous?workspaceId=" + encodeURIComponent(workspaceId),
        { headers: { Authorization: "Bearer " + accessToken } }
      );
      const d = await r.json();
      if (!r.ok) {
        setReason(d.error ?? "Could not load the previous scan.");
        setDiff(null);
        return;
      }
      if (!d.previous) {
        setReason(d.reason ?? "No earlier scan to compare against.");
        setDiff(null);
        return;
      }
      setDiff(diffScans(d.previous, graph, d.previousDate, d.currentDate));
    } catch (e) {
      setReason(e instanceof Error ? e.message : "Request failed.");
      setDiff(null);
    } finally {
      setLoading(false);
    }
  }, [apiBase, accessToken, workspaceId, graph]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!accessToken || !workspaceId) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: SLATE, background: CANVAS }}>
        Sign in and save a workspace to track changes between scans.
      </div>
    );
  }

  if (loading && !diff) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: SLATE, background: CANVAS }}>
        Comparing scans…
      </div>
    );
  }

  if (reason || !diff) {
    return (
      <div style={{ padding: "24px 26px", maxWidth: 620, background: CANVAS }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 13.5, color: INK, marginBottom: 8, fontWeight: 600 }}>
            Scan vs previous scan
          </div>
          <button
            type="button"
            data-testid="changes-refresh"
            onClick={() => void load()}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 8,
              border: `1px solid ${LINE}`,
              background: PAPER,
              color: INK,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: SLATE, lineHeight: 1.65 }}>
          {reason ?? "No earlier scan is stored for this workspace."} Scan again after the code
          changes and this view will show what moved. This is not the tool write ledger under
          .agent/changes.json.
        </div>
      </div>
    );
  }

  const t = diff.totals;

  return (
    <div
      style={{ height: "100%", overflowY: "auto", padding: "18px 26px 60px", background: CANVAS }}
      data-testid="changes-view"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Scan vs previous scan</div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: SLATE, marginTop: 4 }}>
            {diff.fromDate?.slice(0, 10)} → {diff.toDate?.slice(0, 10)}
          </div>
        </div>
        <button
          type="button"
          data-testid="changes-refresh"
          onClick={() => void load()}
          disabled={loading}
          style={{
            fontSize: 11,
            padding: "4px 10px",
            borderRadius: 8,
            border: `1px solid ${LINE}`,
            background: PAPER,
            color: INK,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 26,
          flexWrap: "wrap",
          paddingBottom: 18,
          borderBottom: `1px solid ${LINE}`,
          marginBottom: 18,
        }}
      >
        <Delta label="agents" before={t.agentsBefore} after={t.agentsAfter} />
        <Delta label="tools" before={t.toolsBefore} after={t.toolsAfter} />
        <Delta label="reach patient data" before={t.patientBefore} after={t.patientAfter} />
        <Delta label="reach money" before={t.moneyBefore} after={t.moneyAfter} />
        <Delta label="% untraced" before={t.untracedPctBefore} after={t.untracedPctAfter} />
      </div>

      {diff.changes.length === 0 ? (
        <div style={{ fontSize: 13, color: SLATE, lineHeight: 1.65, maxWidth: "70ch" }}>
          Nothing moved between these two scans. No agents or tools were added or removed, no reach
          changed, and no agent started or stopped authenticating.
        </div>
      ) : (
        <>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: "0.09em",
              color: SLATE,
              marginBottom: 12,
            }}
          >
            {diff.changes.length} CHANGE{diff.changes.length === 1 ? "" : "S"}
          </div>

          {diff.changes.map((c, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "3px 1fr",
                gap: 12,
                padding: "10px 0",
                borderBottom: `1px solid ${LINE}`,
              }}
            >
              <span
                style={{
                  background: changeColor(c),
                  borderRadius: 2,
                  alignSelf: "stretch",
                }}
              />
              <span>
                <span style={{ fontSize: 13, color: INK, display: "block" }}>{c.summary}</span>
                {c.detail && (
                  <span
                    style={{
                      fontSize: 12,
                      color: SLATE,
                      display: "block",
                      marginTop: 3,
                      lineHeight: 1.55,
                    }}
                  >
                    {c.detail}
                  </span>
                )}
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    color: SLATE,
                    display: "block",
                    marginTop: 5,
                  }}
                >
                  {c.kind}
                  {c.agent ? " · " + c.agent.split("/").pop() : ""}
                </span>
              </span>
            </div>
          ))}
        </>
      )}

      <p style={{ marginTop: 26, fontSize: 11.5, color: SLATE, maxWidth: "74ch", lineHeight: 1.6 }}>
        Agents are matched between scans on file path. This view is scan↔scan only — not the tool
        write ledger. A rename+edit in one change may still read as one agent removed and another
        added.
      </p>
    </div>
  );
}
