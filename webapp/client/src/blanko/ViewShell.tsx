/**
 * Light blanko chrome around legacy review / workspace views.
 * Keeps canvas wall visible; provides an explicit back path.
 */
import type { ReactNode } from "react";
import { CANVAS, FONT_UI, INK, LINE, PAPER, SLATE } from "../theme/tokens";

type Props = {
  title: string;
  onBackToCanvas: () => void;
  children: ReactNode;
};

export function ViewShell({ title, onBackToCanvas, children }: Props) {
  return (
    <div
      data-testid="blanko-view-shell"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: PAPER,
        color: INK,
        fontFamily: FONT_UI,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 16px",
          borderBottom: `1px solid ${LINE}`,
          background: CANVAS,
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: INK }}>{title}</div>
        <button
          type="button"
          data-testid="blanko-view-back-canvas"
          onClick={onBackToCanvas}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            border: `1px solid ${LINE}`,
            background: CANVAS,
            color: SLATE,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: FONT_UI,
          }}
        >
          ← Canvas
        </button>
      </header>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: PAPER,
          /* Soft-override legacy dark panels that still hard-code GitHub colors */
          ["--blanko-view-fg" as string]: INK,
        }}
      >
        {children}
      </div>
    </div>
  );
}
