/**
 * Right-rail only — no Config popover. Diagnosis-first DOCK_MODES.
 * Ops/Code are tabs inside System/Agents (not rail destinations).
 */
import type { CSSProperties } from "react";
import { DOCK_MODES, type DockMode } from "./types";
import { ACCENT, ACCENT_WASH, CANVAS, FONT_UI, INK, LINE, SLATE } from "../theme/tokens";

type Props = {
  active: DockMode | null;
  dockOpen: boolean;
  onSelect: (mode: DockMode) => void;
  /** When away from 2d canvas, show a Canvas chip to return. */
  awayFromCanvas?: boolean;
  onBackToCanvas?: () => void;
};

const RAIL_GLYPH: Partial<Record<DockMode, string>> = {
  insights: "✦",
  build: "+",
  agents: "A",
  workspace: "S",
  work: "✓",
  view: "◎",
};

export function DockRail({
  active,
  dockOpen,
  onSelect,
  awayFromCanvas = false,
  onBackToCanvas,
}: Props) {
  return (
    <div
      data-testid="blanko-dock-rail"
      style={{
        position: "absolute",
        right: 12,
        top: "50%",
        transform: "translateY(-50%)",
        width: 64,
        flexShrink: 0,
        background: "transparent",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: 0,
        gap: 6,
        zIndex: 28,
        fontFamily: FONT_UI,
        pointerEvents: "none",
      }}
    >
      {awayFromCanvas && onBackToCanvas ? (
        <button
          type="button"
          title="Back to canvas"
          data-testid="blanko-rail-back-canvas"
          onClick={onBackToCanvas}
          style={{
            ...railBtn,
            pointerEvents: "auto",
            color: ACCENT,
            borderColor: ACCENT,
            background: ACCENT_WASH,
            boxShadow: "0 8px 24px rgba(18,19,26,0.08)",
          }}
        >
          <span style={{ fontSize: 13 }}>◎</span>
          <span style={{ fontSize: 9, fontWeight: 600, color: ACCENT }}>Canvas</span>
        </button>
      ) : null}
      {DOCK_MODES.map((m) => {
        const isActive = dockOpen && active === m.id;
        return (
          <button
            key={m.id}
            type="button"
            title={m.title}
            data-testid={`blanko-rail-${m.id}`}
            onClick={() => onSelect(m.id)}
            style={{
              ...railBtn,
              pointerEvents: "auto",
              background: isActive ? ACCENT_WASH : CANVAS,
              borderColor: isActive ? ACCENT : LINE,
              color: isActive ? ACCENT : INK,
              boxShadow: "0 8px 24px rgba(18,19,26,0.08)",
            }}
          >
            <span style={{ fontSize: 13, lineHeight: 1, opacity: isActive ? 1 : 0.75 }}>
              {RAIL_GLYPH[m.id] ?? "·"}
            </span>
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: isActive ? ACCENT : SLATE,
                lineHeight: 1.15,
                textAlign: "center",
                maxWidth: 56,
              }}
            >
              {m.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const railBtn: CSSProperties = {
  width: 56,
  minHeight: 52,
  borderRadius: 14,
  border: `1px solid ${LINE}`,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  padding: "8px 4px",
  cursor: "pointer",
  fontFamily: FONT_UI,
};
