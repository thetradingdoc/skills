import type { ReactNode } from "react";
import type { DockMode } from "./types";
import { DOCK_MODES } from "./types";
import { CANVAS, FONT_UI, INK, LINE, SLATE } from "../theme/tokens";

type Props = {
  mode: DockMode;
  width: number;
  onClose: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
  children: ReactNode;
  /** Overlay floats over the canvas (default). Embedded used only in legacy layouts. */
  variant?: "overlay" | "embedded";
};

export function DockFrame({
  mode,
  width,
  onClose,
  onResizeStart,
  children,
  variant = "overlay",
}: Props) {
  const label =
    DOCK_MODES.find((m) => m.id === mode)?.label ??
    (mode === "inspect" ? "Inspect" : mode === "evidence" ? "Evidence" : mode);

  const overlay = variant === "overlay";

  return (
    <aside
      data-testid="blanko-dock"
      data-dock-mode={mode}
      style={{
        width,
        flexShrink: 0,
        ...(overlay
          ? {
              position: "absolute",
              right: 84,
              top: 56,
              bottom: 88,
              zIndex: 26,
              borderRadius: 16,
              border: `1px solid ${LINE}`,
              boxShadow: "0 16px 48px rgba(18,19,26,0.12), 0 2px 8px rgba(18,19,26,0.04)",
            }
          : {
              borderLeft: `1px solid ${LINE}`,
            }),
        background: CANVAS,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        fontFamily: FONT_UI,
        overflow: "hidden",
      }}
    >
      {!overlay && (
        <div
          data-testid="blanko-dock-resize"
          onMouseDown={onResizeStart}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            cursor: "col-resize",
            zIndex: 2,
          }}
        />
      )}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderBottom: `1px solid ${LINE}`,
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>{label}</div>
        <button
          type="button"
          data-testid="blanko-dock-close"
          onClick={onClose}
          title="Close panel"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: `1px solid ${LINE}`,
            background: CANVAS,
            color: SLATE,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          ×
        </button>
      </header>
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>{children}</div>
      <div
        style={{
          padding: "8px 14px",
          borderTop: `1px solid ${LINE}`,
          fontSize: 11,
          color: SLATE,
          flexShrink: 0,
        }}
      >
        Canvas stays full — Esc closes
      </div>
    </aside>
  );
}
