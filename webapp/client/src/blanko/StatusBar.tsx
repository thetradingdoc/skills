import { ACCENT, CANVAS, FONT_MONO, FONT_UI, INK, LINE, SLATE } from "../theme/tokens";

type Props = {
  dirty: boolean;
  nodeCount: number;
  planLabel?: string;
  modeHint?: string;
  showHealth?: boolean;
  onToggleHealth?: () => void;
};

export function StatusBar({
  dirty,
  nodeCount,
  planLabel,
  modeHint,
  showHealth,
  onToggleHealth,
}: Props) {
  return (
    <div
      data-testid="blanko-status-bar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "5px 14px",
            borderTop: `1px solid ${LINE}`,
            background: CANVAS,
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: SLATE,
            flexShrink: 0,
          }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          data-testid="blanko-status-saved"
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: dirty ? ACCENT : "#22C55E",
          }}
        />
        <span style={{ color: INK, fontFamily: FONT_UI, fontSize: 12 }}>{dirty ? "Unsaved" : "Saved"}</span>
      </span>
      <span data-testid="blanko-status-nodes">{nodeCount} nodes</span>
      {planLabel && <span data-testid="blanko-status-plan">{planLabel}</span>}
      {onToggleHealth && (
        <button
          type="button"
          data-testid="blanko-health-toggle"
          onClick={onToggleHealth}
          style={{
            marginLeft: "auto",
            padding: "4px 8px",
            borderRadius: 6,
            border: `1px solid ${showHealth ? ACCENT : LINE}`,
            background: showHealth ? `${ACCENT}14` : CANVAS,
            color: showHealth ? ACCENT : SLATE,
            fontFamily: FONT_UI,
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showHealth ? "Health on" : "Health off"}
        </button>
      )}
      {modeHint && (
        <span style={{ marginLeft: onToggleHealth ? 0 : "auto" }}>{modeHint}</span>
      )}
    </div>
  );
}
