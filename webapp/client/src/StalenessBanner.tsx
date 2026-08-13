/**
 * Scan-only: repo changed since this picture of the graph.
 * Hidden when there is no projectRoot (pure AI design canvas).
 * Primary control is Rescan; file list expands from that row.
 */
import { useCallback, useEffect, useState } from "react";
import { ACCENT, CANVAS, FONT_UI, INK, LINE, PAPER, SLATE } from "./theme/tokens";

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
  generatedAt?: number | null;
  apiBase: string;
  accessToken: string | null;
  onRescan: () => void;
  scanning?: boolean;
  /** When true (pure design graph), never show — scan UX only. */
  hideForDesign?: boolean;
};

export function StalenessBanner({
  projectRoot,
  generatedAt,
  apiBase,
  accessToken,
  onRescan,
  scanning,
  hideForDesign,
}: Props) {
  const [state, setState] = useState<Staleness | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    if (hideForDesign || !projectRoot || !generatedAt || !accessToken) return;
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
      /* best-effort */
    }
  }, [apiBase, accessToken, projectRoot, generatedAt, hideForDesign]);

  useEffect(() => {
    if (hideForDesign) {
      setState(null);
      return;
    }
    check();
    const t = setInterval(check, 120000);
    return () => clearInterval(t);
  }, [check, hideForDesign]);

  useEffect(() => {
    setDismissed(false);
    setExpanded(false);
  }, [generatedAt]);

  if (hideForDesign) return null;
  if (!projectRoot) return null;
  if (!state || dismissed) return null;
  if (state.available && state.changed === 0) return null;

  const gone = !state.available;
  const label = gone
    ? state.reason ?? "Scan unavailable"
    : `${state.changed} file${state.changed === 1 ? "" : "s"} changed since this scan`;

  return (
    <div
      data-testid="blanko-staleness"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        flexShrink: 0,
        borderBottom: `1px solid ${LINE}`,
        background: gone ? "rgba(248,81,73,0.08)" : `${ACCENT}0c`,
        fontFamily: FONT_UI,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: gone ? "#ef4444" : ACCENT,
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: INK, lineHeight: 1.4 }}>
          {label}
        </span>
        {!gone && state.files && state.files.length > 0 && (
          <button
            type="button"
            data-testid="blanko-staleness-files"
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: PAPER,
              border: `1px solid ${LINE}`,
              borderRadius: 999,
              padding: "4px 10px",
              fontFamily: FONT_UI,
              fontSize: 11,
              fontWeight: 600,
              color: SLATE,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {expanded ? "Hide files" : "Which files"}
          </button>
        )}
        <button
          type="button"
          data-testid="blanko-staleness-rescan"
          onClick={onRescan}
          disabled={scanning}
          style={{
            fontFamily: FONT_UI,
            fontSize: 12,
            fontWeight: 600,
            padding: "5px 12px",
            borderRadius: 999,
            border: `1px solid ${ACCENT}`,
            background: ACCENT,
            color: "#fff",
            cursor: scanning ? "default" : "pointer",
            opacity: scanning ? 0.7 : 1,
            whiteSpace: "nowrap",
            flexShrink: 0,
            boxShadow: `0 0 0 3px ${ACCENT}22`,
          }}
        >
          {scanning ? "Scanning…" : "Rescan"}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          title="Hide until the next scan"
          aria-label="Dismiss"
          style={{
            background: "none",
            border: 0,
            padding: "2px 6px",
            fontFamily: FONT_UI,
            fontSize: 16,
            color: SLATE,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
      {expanded && state.files && state.files.length > 0 && (
        <div
          style={{
            padding: "0 14px 10px 31px",
            maxHeight: 140,
            overflowY: "auto",
          }}
        >
          {state.files.map((f) => (
            <div
              key={f.path}
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11,
                color: f.isNew ? "#16a34a" : SLATE,
                lineHeight: 1.6,
              }}
            >
              {f.isNew ? "new  " : "     "}
              {f.path}
            </div>
          ))}
          {state.truncated && (
            <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>
              … and {state.changed - state.files.length} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
