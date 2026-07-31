/**
 * What your change did to what the agent can reach.
 *
 * The context line beside each change says what the file is part of — free,
 * because the scan already knows. This says what the edit actually altered,
 * which needs scanning again and comparing. On a real repository that is
 * fifteen seconds, so it sits behind a button rather than running after every
 * keystroke.
 *
 * This is the part of the tool nobody else has. An editor tells you a file
 * changed. This tells you the change gave an unauthenticated phone line a path
 * to the payments service.
 */
import { useState } from "react";
import { diffScans, type ScanDiff, type Change } from "./scanDiff";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type Props = {
  /** The scan as it stands — the "before". */
  graph: any;
  apiBase: string;
  accessToken: string | null;
  /** Adopt the rescan, so later checks compare against current state. */
  onNewGraph?: (graph: any) => void;
};

/** Colour by what a change means, not by which kind it is. */
function changeColour(c: Change): string {
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
    default:
      return "#8b949e";
  }
}

export function ReachImpact({ graph, apiBase, accessToken, onNewGraph }: Props) {
  const [state, setState] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [diff, setDiff] = useState<ScanDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  const repo = graph?.repoUrl ?? graph?.projectRoot;

  const run = async () => {
    if (!repo || !accessToken) return;
    setState("scanning");
    setError(null);

    try {
      const r = await fetch(apiBase + "/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + accessToken,
        },
        body: JSON.stringify({ repoUrl: repo }),
      });
      const after = await r.json();

      if (!r.ok) {
        setError(after.error ?? "The rescan failed.");
        setState("error");
        return;
      }

      const d = diffScans(graph, after, undefined, new Date().toISOString());
      setDiff(d);
      setState("done");

      // Adopt it, so a second check compares against where you are now rather
      // than where you were before the first edit.
      onNewGraph?.(after);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
      setState("error");
    }
  };

  if (!graph) return null;

  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 12,
        borderTop: "1px solid #21262d",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.09em",
            color: "#6e7681",
          }}
        >
          REACH IMPACT
        </span>
        <button
          type="button"
          disabled={state === "scanning" || !accessToken}
          onClick={run}
          title="Scan again and compare what the agents can reach"
          style={{
            marginLeft: "auto",
            fontFamily: MONO,
            fontSize: 10,
            padding: "3px 10px",
            borderRadius: 5,
            border: "1px solid #30363d",
            background: "transparent",
            color: state === "scanning" ? "#6e7681" : "#58a6ff",
            cursor: state === "scanning" ? "default" : "pointer",
          }}
        >
          {state === "scanning" ? "scanning…" : "rescan and compare"}
        </button>
      </div>

      {state === "idle" && (
        <p
          style={{
            fontSize: 11.5,
            color: "#6e7681",
            lineHeight: 1.6,
            marginTop: 8,
          }}
        >
          The notes above say what each changed file is part of. This scans
          again and says what your changes did to it — tools gained, reach
          gained, authentication lost. It takes about fifteen seconds.
        </p>
      )}

      {state === "error" && (
        <p
          style={{
            fontSize: 11.5,
            color: "#f85149",
            lineHeight: 1.6,
            marginTop: 8,
            fontFamily: MONO,
          }}
        >
          {error}
        </p>
      )}

      {state === "done" && diff && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              fontFamily: MONO,
              fontSize: 11,
              color: "#8b949e",
              marginBottom: 10,
            }}
          >
            <span>
              tools {diff.totals.toolsBefore} → {diff.totals.toolsAfter}
            </span>
            <span
              style={{
                color:
                  diff.totals.patientAfter > diff.totals.patientBefore
                    ? "#f85149"
                    : "#8b949e",
              }}
            >
              patient {diff.totals.patientBefore} → {diff.totals.patientAfter}
            </span>
            <span
              style={{
                color:
                  diff.totals.moneyAfter > diff.totals.moneyBefore
                    ? "#d29922"
                    : "#8b949e",
              }}
            >
              money {diff.totals.moneyBefore} → {diff.totals.moneyAfter}
            </span>
          </div>

          {diff.changes.length === 0 ? (
            <p style={{ fontSize: 12, color: "#8b949e", lineHeight: 1.6 }}>
              Nothing moved. Your changes did not alter what any agent can
              reach, and no agent started or stopped authenticating.
            </p>
          ) : (
            diff.changes.map((c, i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "3px 1fr",
                  gap: 10,
                  padding: "8px 0",
                  borderBottom: "1px solid #21262d",
                }}
              >
                <span
                  style={{
                    background: changeColour(c),
                    borderRadius: 2,
                    alignSelf: "stretch",
                  }}
                />
                <span>
                  <span style={{ fontSize: 12.5, color: "#e6edf3", display: "block" }}>
                    {c.summary}
                  </span>
                  {c.detail && (
                    <span
                      style={{
                        fontSize: 11.5,
                        color: "#8b949e",
                        display: "block",
                        marginTop: 3,
                        lineHeight: 1.55,
                      }}
                    >
                      {c.detail}
                    </span>
                  )}
                </span>
              </div>
            ))
          )}

          <p
            style={{
              marginTop: 10,
              fontSize: 11,
              color: "#484f58",
              lineHeight: 1.6,
            }}
          >
            A change here may be your edit or may be the tracer resolving
            something it could not follow before. Where coverage moved, the
            comparison says so.
          </p>
        </div>
      )}
    </div>
  );
}
