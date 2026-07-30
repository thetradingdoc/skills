/**
 * What changed since the last scan.
 *
 * A single scan is a photograph. Two scans are the thing a reviewer actually
 * needs — direction. This view answers "did it get better or worse, and what
 * specifically moved" rather than restating the current state.
 *
 * Where a change might be the tracer catching up rather than the code moving,
 * the view says so. A finding that appears because coverage improved is not
 * the same as a finding that appears because someone shipped something, and
 * conflating them would make every improvement in the scanner look like a
 * regression in the system.
 */
import { useCallback, useEffect, useState } from "react";
import { diffScans, type ScanDiff, type Change } from "./scanDiff";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type Props = {
  graph: any;
  apiBase: string;
  accessToken: string | null;
  workspaceId: string | null;
};

/** Colour by what the change means, not by which kind it is. */
function changeColor(c: Change): string {
  switch (c.kind) {
    case "auth-lost":
    case "reach-gained":
    case "layer-emptied":
      return "#f85149";
    case "tool-added":
      return c.weight >= 90 ? "#f85149" : "#d29922";
    case "agent-added":
      return c.weight >= 90 ? "#f85149" : "#58a6ff";
    case "auth-gained":
    case "layer-filled":
      return "#3fb950";
    case "reach-lost":
    case "tool-removed":
    case "agent-removed":
      return "#8b949e";
    case "agent-renamed":
    case "coverage-changed":
      return "#a371f7";
    default:
      return "#8b949e";
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
    moved === 0
      ? "#6e7681"
      : (moved > 0) === worseWhenUp
        ? "#f85149"
        : "#3fb950";
  return (
    <div style={{ minWidth: 108 }}>
      <div style={{ fontFamily: MONO, fontSize: 17, color: "#e6edf3" }}>
        {after}
        {moved !== 0 && (
          <span style={{ fontSize: 11.5, color: colour, marginLeft: 6 }}>
            {moved > 0 ? "+" : ""}
            {moved}
          </span>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: "#6e7681", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

export function ChangesView({
  graph,
  apiBase,
  accessToken,
  workspaceId,
}: Props) {
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
        return;
      }
      if (!d.previous) {
        setReason(d.reason ?? "No earlier scan to compare against.");
        return;
      }
      setDiff(
        diffScans(d.previous, graph, d.previousDate, d.currentDate)
      );
    } catch (e) {
      setReason(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, accessToken, workspaceId, graph]);

  useEffect(() => {
    load();
  }, [load]);

  if (!accessToken || !workspaceId) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "#8b949e" }}>
        Sign in and save a workspace to track changes between scans.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "#8b949e" }}>
        Comparing scans…
      </div>
    );
  }

  if (reason || !diff) {
    return (
      <div style={{ padding: "24px 26px", maxWidth: 620 }}>
        <div style={{ fontSize: 13.5, color: "#e6edf3", marginBottom: 8 }}>
          Nothing to compare yet
        </div>
        <div style={{ fontSize: 12.5, color: "#8b949e", lineHeight: 1.65 }}>
          {reason ?? "No earlier scan is stored for this workspace."} Scan again
          after the code changes and this view will show what moved — agents and
          tools added or removed, reach gained or lost, and whether any agent
          started or stopped authenticating.
        </div>
      </div>
    );
  }

  const t = diff.totals;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "18px 26px 60px" }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: "#6e7681",
          marginBottom: 14,
        }}
      >
        {diff.fromDate?.slice(0, 10)} → {diff.toDate?.slice(0, 10)}
      </div>

      <div
        style={{
          display: "flex",
          gap: 26,
          flexWrap: "wrap",
          paddingBottom: 18,
          borderBottom: "1px solid #21262d",
          marginBottom: 18,
        }}
      >
        <Delta label="agents" before={t.agentsBefore} after={t.agentsAfter} />
        <Delta label="tools" before={t.toolsBefore} after={t.toolsAfter} />
        <Delta
          label="reach patient data"
          before={t.patientBefore}
          after={t.patientAfter}
        />
        <Delta label="reach money" before={t.moneyBefore} after={t.moneyAfter} />
        <Delta
          label="% untraced"
          before={t.untracedPctBefore}
          after={t.untracedPctAfter}
        />
      </div>

      {diff.changes.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8b949e", lineHeight: 1.65, maxWidth: "70ch" }}>
          Nothing moved between these two scans. No agents or tools were added
          or removed, no reach changed, and no agent started or stopped
          authenticating.
        </div>
      ) : (
        <>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.09em",
              color: "#6e7681",
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
                borderBottom: "1px solid #21262d",
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
                <span
                  style={{ fontSize: 13, color: "#e6edf3", display: "block" }}
                >
                  {c.summary}
                </span>
                {c.detail && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "#8b949e",
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
                    fontFamily: MONO,
                    fontSize: 10,
                    color: "#484f58",
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

      <p
        style={{
          marginTop: 26,
          fontSize: 11.5,
          color: "#484f58",
          maxWidth: "74ch",
          lineHeight: 1.6,
        }}
      >
        Agents are matched between scans on file path. A move is detected by
        comparing tool catalogs, but a file that is renamed and edited in the
        same change may still read as one agent removed and another added.
      </p>
    </div>
  );
}
