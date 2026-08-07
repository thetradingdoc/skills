import type { CSSProperties, ReactNode } from "react";
import { CONFIG_SECTIONS, DOCK_MODES, type DockMode, type OverflowView } from "./types";
import { ACCENT, ACCENT_WASH, CANVAS, FONT_UI, INK, LINE, SLATE } from "../theme/tokens";
import { useEffect, useState } from "react";

type Props = {
  active: DockMode | null;
  dockOpen: boolean;
  onSelect: (mode: DockMode) => void;
  onOverflow: (view: OverflowView) => void;
  /**
   * Config button. Parent should return to canvas when away from 2d,
   * otherwise toggle the menu (pass `configOpen` / `onConfigOpenChange`).
   */
  onConfig: () => void;
  configOpen: boolean;
  onConfigOpenChange: (open: boolean) => void;
  /** True when not on the 2d design canvas — Config chip shows “Canvas”. */
  awayFromCanvas?: boolean;
};

const RAIL_GLYPH: Partial<Record<DockMode, string>> = {
  build: "+",
  insights: "✦",
  terminal: ">_",
};

export function DockRail({
  active,
  dockOpen,
  onSelect,
  onOverflow,
  onConfig,
  configOpen,
  onConfigOpenChange,
  awayFromCanvas = false,
}: Props) {
  useEffect(() => {
    if (!configOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-testid='blanko-dock-rail']")) return;
      onConfigOpenChange(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [configOpen, onConfigOpenChange]);

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
        gap: 8,
        zIndex: 28,
        fontFamily: FONT_UI,
        pointerEvents: "none",
      }}
    >
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
                letterSpacing: "-0.01em",
                color: isActive ? ACCENT : SLATE,
                lineHeight: 1.1,
                textAlign: "center",
              }}
            >
              {m.label}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        title={awayFromCanvas ? "Back to canvas" : "Config"}
        data-testid="blanko-rail-config"
        onClick={onConfig}
        style={{
          ...railBtn,
          pointerEvents: "auto",
          minHeight: 48,
          color: configOpen || awayFromCanvas ? ACCENT : SLATE,
          borderColor: configOpen || awayFromCanvas ? ACCENT : LINE,
          background: configOpen || awayFromCanvas ? ACCENT_WASH : CANVAS,
          boxShadow: "0 8px 24px rgba(18,19,26,0.08)",
        }}
      >
        <ConfigIcon />
        <span style={{ fontSize: 9, fontWeight: 600, color: configOpen || awayFromCanvas ? ACCENT : SLATE }}>
          {awayFromCanvas ? "Canvas" : "Config"}
        </span>
      </button>
      {configOpen && (
        <div
          data-testid="blanko-overflow-menu"
          style={{
            position: "absolute",
            right: 72,
            bottom: 0,
            width: 200,
            maxHeight: "min(70vh, 520px)",
            overflowY: "auto",
            background: CANVAS,
            border: `1px solid ${LINE}`,
            borderRadius: 14,
            boxShadow: "0 16px 40px rgba(18,19,26,0.14)",
            padding: "8px 6px",
            zIndex: 30,
            pointerEvents: "auto",
          }}
        >
          {CONFIG_SECTIONS.map((section) => (
            <div key={section.title} style={{ marginBottom: 6 }}>
              <div
                style={{
                  fontSize: 10,
                  color: SLATE,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "6px 8px 4px",
                  fontWeight: 600,
                }}
              >
                {section.title}
              </div>
              {section.items.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  data-testid={`blanko-overflow-${v.id}`}
                  onClick={() => {
                    onOverflow(v.id);
                    onConfigOpenChange(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    border: "none",
                    background: "transparent",
                    borderRadius: 8,
                    fontFamily: FONT_UI,
                    fontSize: 13,
                    color: INK,
                    cursor: "pointer",
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        title="More views"
        data-testid="blanko-rail-overflow"
        onClick={() => onConfigOpenChange(!configOpen)}
        style={{ display: "none" }}
        aria-hidden
      />
    </div>
  );
}

function ConfigIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 8h4M12 8h8M8 6v4M4 16h10M18 16h2M14 14v4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

const railBtn: CSSProperties = {
  width: 56,
  minHeight: 52,
  borderRadius: 14,
  border: `1px solid ${LINE}`,
  background: CANVAS,
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 3,
  padding: "6px 4px",
};
