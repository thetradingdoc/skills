import type { ReactNode } from "react";
import type { DockMode } from "./types";
import { DOCK_MODES } from "./types";
import { canMaximizeDockMode } from "./dockLayout";
import { CANVAS, FONT_UI, INK, LINE, SLATE } from "../theme/tokens";

type Props = {
  mode: DockMode;
  width: number;
  onClose: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
  children: ReactNode;
  /** Overlay floats over the canvas (default). Embedded used only in legacy layouts. */
  variant?: "overlay" | "embedded";
  maximized?: boolean;
  onToggleMaximize?: () => void;
  /**
   * When true (Components palette HTML5 drag in progress), let dragover/drop
   * pass through to the React Flow pane under the overlay dock.
   */
  passThroughPointerEvents?: boolean;
};

export function DockFrame({
  mode,
  width,
  onClose,
  onResizeStart,
  children,
  variant = "overlay",
  maximized = false,
  onToggleMaximize,
  passThroughPointerEvents = false,
}: Props) {
  const label =
    DOCK_MODES.find((m) => m.id === mode)?.label ??
    (mode === "inspect" ? "Inspect" : mode === "evidence" ? "Evidence" : mode);

  const overlay = variant === "overlay";
  const showMaximize = canMaximizeDockMode(mode) && !!onToggleMaximize;

  return (
    <aside
      data-testid="blanko-dock"
      data-dock-mode={mode}
      data-dock-width={width}
      data-dock-maximized={maximized ? "true" : "false"}
      data-palette-pass-through={passThroughPointerEvents ? "true" : "false"}
      style={{
        ...(maximized && overlay
          ? {
              position: "absolute",
              left: 12,
              right: 84,
              top: 56,
              bottom: 88,
              width: "auto",
              zIndex: 26,
              borderRadius: 16,
              border: `1px solid ${LINE}`,
              boxShadow: "0 16px 48px rgba(18,19,26,0.12), 0 2px 8px rgba(18,19,26,0.04)",
            }
          : {
              width,
              flexShrink: 0,
              position: overlay ? "absolute" : "relative",
              ...(overlay
                ? {
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
            }),
        background: CANVAS,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        fontFamily: FONT_UI,
        overflow: "hidden",
        // Palette drag only — not system-wide. Restored on dragend/drop.
        pointerEvents: passThroughPointerEvents ? "none" : undefined,
      }}
    >
      {!maximized && (
        <div
          data-testid="blanko-dock-resize"
          onMouseDown={onResizeStart}
          title="Drag to resize"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 6,
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
          gap: 8,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>{label}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {showMaximize ? (
            <button
              type="button"
              data-testid="blanko-dock-maximize"
              onClick={onToggleMaximize}
              title={maximized ? "Restore panel size" : "Expand panel"}
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: `1px solid ${LINE}`,
                background: CANVAS,
                color: SLATE,
                cursor: "pointer",
                fontSize: 12,
                lineHeight: 1,
              }}
            >
              {maximized ? "⧉" : "▢"}
            </button>
          ) : null}
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
        </div>
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
        {maximized ? "Expanded — Esc restores, Esc again closes" : "Canvas stays full — Esc closes"}
      </div>
    </aside>
  );
}
