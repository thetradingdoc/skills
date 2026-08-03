/**
 * "This picture is out of date."
 *
 * Every view here is a picture of a scan, and a scan is a moment. Work on the
 * repository afterwards and the picture quietly stops matching — the dashboard
 * shows agents that have moved, the assessment cites lines that have shifted,
 * and nothing says so.
 *
 * That is what happened over a week of building: thirty new files went into the
 * clone and the dashboard kept showing the scan from before they existed. Not a
 * rendering fault — the tool faithfully displayed a stale graph, which is the
 * worst kind of wrong because it looks right.
 *
 * A webhook would only cover pushed commits. The case that actually bites is
 * local editing, so this compares file times against the scan and says what
 * moved.
 */
import { useCallback, useEffect, useState } from "react";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type Staleness = {
  available: boolean;
  reason?: string;
  changed: number;
  added?: number;
  edited?: number;
  scanned?: number;
  since?: string;
  files?: { path: string; modified: string; isNew: boolean }[];
  truncated?: boolean;
  summary?: string;
};

type Props = {
  projectRoot?: string | null;
  /** The scan's timestamp — what everything on screen is a picture of. */
  generatedAt?: number | null;
  apiBase: string;
  accessToken: string | null;
  onRescan: () => void;
  scanning?: boolean;
};

export function StalenessBanner({
  projectRoot,
  generatedAt,
  apiBase,
  accessToken,
  onRescan,
  scanning,
}: Props) {
  const [state, setState] = useState<Staleness | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    if (!projectRoot || !generatedAt || !accessToken) return;
    try {
      const r = await fetch(
        apiBase +
          "/scan-staleness?projectRoot=" +
          encodeURIComponent(projectRoot) +
          "&since=" +
          generatedAt,
        { headers: { Authorization: "Bearer " + accessToken } }
      );
      if (!r.ok) return;
      setState(await r.json());
    } catch {
      // A staleness check that fails should never break the view it sits above.
    }
  }, [apiBase, accessToken, projectRoot, generatedAt]);

  useEffect(() => {
    check();
    // Re-check periodically, so a long session notices work done in another
    // window rather than only on reload.
    const t = setInterval(check, 120000);
    return () => clearInterval(t);
  }, [check]);

  // A new scan clears the dismissal — the next staleness is a new fact.
  useEffect(() => {
    setDismissed(false);
    setExpanded(false);
  }, [generatedAt]);

  if (!state || dismissed) return null;
  if (state.available && state.changed === 0) return null;

  const gone = !state.available;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 12px",
        background: gone ? "rgba(248,81,73,0.10)" : "rgba(210,153,34,0.10)",
        borderBottom: "1px solid " + (gone ? "rgba(248,81,73,0.3)" : "rgba(210,153,34,0.3)"),
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: gone ? "#f85149" : "#d29922",
          marginTop: 6,
          flexShrink: 0,
        }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: "#e6edf3", lineHeight: 1.5 }}>
          {gone ? state.reason : state.summary}
        </div>

        {expanded && state.files && state.files.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {state.files.map((f) => (
              <div
                key={f.path}
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: f.isNew ? "#3fb950" : "#8b949e",
                  lineHeight: 1.6,
                }}
              >
                {f.isNew ? "new  " : "     "}
                {f.path}
              </div>
            ))}
            {state.truncated && (
              <div style={{ fontFamily: MONO, fontSize: 10.5, color: "#6e7681", marginTop: 2 }}>
                … and {state.changed - state.files.length} more
              </div>
            )}
          </div>
        )}

        {!gone && state.files && state.files.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              marginTop: 4,
              background: "none",
              border: 0,
              padding: 0,
              fontFamily: MONO,
              fontSize: 10.5,
              color: "#58a6ff",
              cursor: "pointer",
            }}
          >
            {expanded ? "hide" : "which files"}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onRescan}
        disabled={scanning}
        style={{
          fontFamily: MONO,
          fontSize: 11,
          padding: "4px 12px",
          borderRadius: 6,
          border: "1px solid #58a6ff",
          background: "rgba(88,166,255,0.12)",
          color: "#58a6ff",
          cursor: scanning ? "default" : "pointer",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {scanning ? "scanning…" : "rescan"}
      </button>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        title="Hide until the next scan"
        style={{
          background: "none",
          border: 0,
          padding: "2px 4px",
          fontFamily: MONO,
          fontSize: 12,
          color: "#6e7681",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
