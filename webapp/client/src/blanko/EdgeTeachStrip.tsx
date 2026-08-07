import type { ArchEdge } from "../types";
import { RELATION_KNOWLEDGE } from "../designKnowledge";
import { relationLabel } from "../greenfieldDesign";
import { ACCENT, CANVAS, FONT_MONO, FONT_UI, INK, LINE, PAPER, SLATE } from "../theme/tokens";

type Props = {
  edge: ArchEdge;
  sourceLabel?: string;
  targetLabel?: string;
  onClose: () => void;
  /** When true, surface ArchiMate layer-violation copy; default is agent wiring. */
  architectureLens?: boolean;
};

export function EdgeTeachStrip({
  edge,
  sourceLabel,
  targetLabel,
  onClose,
  architectureLens = false,
}: Props) {
  const rel = edge.relation ?? (edge.isLayerViolation && architectureLens ? "depends_on" : "uses");
  const knowledge = RELATION_KNOWLEDGE[rel] ?? RELATION_KNOWLEDGE.uses;
  const showLayerViolation = architectureLens && !!edge.isLayerViolation && !edge.isDrift;

  return (
    <div
      data-testid="blanko-edge-teach"
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 30,
        background: CANVAS,
        border: `1px solid ${LINE}`,
        borderRadius: 12,
        padding: "12px 14px",
        boxShadow: "0 8px 24px rgba(18,19,26,0.1)",
        fontFamily: FONT_UI,
        maxWidth: 520,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: "0.1em",
              color: ACCENT,
              marginBottom: 4,
              textTransform: "uppercase",
            }}
          >
            {showLayerViolation ? "Architecture · Layer violation" : `Edge · ${relationLabel(rel)}`}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 4 }}>
            {(sourceLabel ?? edge.source) + " → " + (targetLabel ?? edge.target)}
          </div>
          <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45 }}>
            {showLayerViolation
              ? "This dependency goes against the usual layer direction. Turn Architecture ON to study stack rules — on the AI design canvas, focus on how the agent is wired instead."
              : knowledge.meaning}
          </div>
          {!showLayerViolation && knowledge.failureMode && (
            <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45, marginTop: 6 }}>
              <strong style={{ color: INK }}>If wrong: </strong>
              {knowledge.failureMode}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            border: `1px solid ${LINE}`,
            background: PAPER,
            borderRadius: 8,
            width: 28,
            height: 28,
            cursor: "pointer",
            color: SLATE,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
