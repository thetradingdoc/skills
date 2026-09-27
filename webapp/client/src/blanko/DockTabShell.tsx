/**
 * Shared tab strip for Blanko dock panels.
 */
import type { CSSProperties, ReactNode } from "react";
import { ACCENT, ACCENT_WASH, CANVAS, FONT_UI, INK, LINE, SLATE } from "../theme/tokens";

export type DockTab = { id: string; label: string };

type Props = {
  tabs: DockTab[];
  active: string;
  onChange: (id: string) => void;
  children: ReactNode;
  emptyHint?: string | null;
};

export function DockTabShell({ tabs, active, onChange, children, emptyHint }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        fontFamily: FONT_UI,
      }}
    >
      <div
        role="group"
        aria-label="Panel sections"
        style={{
          display: "flex",
          flexWrap: "nowrap",
          overflowX: "auto",
          gap: 4,
          padding: "8px 10px",
          borderBottom: `1px solid ${LINE}`,
          flexShrink: 0,
          scrollbarWidth: "thin",
        }}
      >
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              data-testid={`blanko-dock-tab-${t.id}`}
              aria-pressed={on}
              onClick={() => onChange(t.id)}
              style={{
                ...tabBtn,
                background: on ? ACCENT_WASH : CANVAS,
                borderColor: on ? ACCENT : LINE,
                color: on ? ACCENT : SLATE,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {emptyHint ? (
        <div style={{ padding: 14, fontSize: 12, color: SLATE, lineHeight: 1.45 }}>{emptyHint}</div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</div>
    </div>
  );
}

const tabBtn: CSSProperties = {
  padding: "5px 9px",
  borderRadius: 8,
  border: `1px solid ${LINE}`,
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: FONT_UI,
  background: CANVAS,
  color: INK,
};
