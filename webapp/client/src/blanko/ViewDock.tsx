/**
 * View dock — canvas vs 3D destination (chrome View/Edit is pan vs edit).
 */
import { ACCENT, CANVAS, FONT_UI, INK, LINE, PAPER, SLATE } from "../theme/tokens";

type Props = {
  is3d: boolean;
  onCanvas: () => void;
  on3d: () => void;
};

export function ViewDock({ is3d, onCanvas, on3d }: Props) {
  return (
    <div data-testid="blanko-view-dock" style={{ padding: 14, fontFamily: FONT_UI, color: INK }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Canvas</div>
      <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.45, marginBottom: 14 }}>
        Choose 2D or 3D. The green <strong>View / Edit</strong> control in the top bar only switches
        pan-vs-edit — it does not open 3D.
      </div>
      <button
        type="button"
        data-testid="blanko-view-canvas"
        onClick={onCanvas}
        style={{
          ...btn,
          borderColor: !is3d ? ACCENT : LINE,
          background: !is3d ? PAPER : CANVAS,
        }}
      >
        <strong>Canvas (2D)</strong>
        <span style={{ display: "block", fontSize: 11, color: SLATE, marginTop: 4 }}>
          Architecture board — pan and inspect
        </span>
      </button>
      <button
        type="button"
        data-testid="blanko-view-3d"
        onClick={on3d}
        style={{
          ...btn,
          marginTop: 8,
          borderColor: is3d ? ACCENT : LINE,
          background: is3d ? PAPER : CANVAS,
        }}
      >
        <strong>3D</strong>
        <span style={{ display: "block", fontSize: 11, color: SLATE, marginTop: 4 }}>
          Spatial layer view
        </span>
      </button>
    </div>
  );
}

const btn = {
  display: "block" as const,
  width: "100%",
  textAlign: "left" as const,
  padding: "12px 14px",
  borderRadius: 12,
  border: `1px solid ${LINE}`,
  cursor: "pointer",
  fontFamily: FONT_UI,
  color: INK,
};
