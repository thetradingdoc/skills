import type { CSSProperties } from "react";
import { DESIGN_DND_MIME, DESIGN_PALETTE, type DesignPaletteGroup } from "./greenfieldDesign";

type Props = {
  onPlaceAtCenter?: (paletteId: string) => void;
};

const GROUP_ORDER: DesignPaletteGroup[] = [
  "Agent",
  "Brain",
  "Memory & RAG",
  "Tools",
  "Strategies",
  "Channels",
  "Data",
  "Eval",
  "Ops",
];

const chipStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "8px 10px",
  marginBottom: 6,
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  color: "#e6edf3",
  fontSize: 12,
  cursor: "grab",
  textAlign: "left",
  fontFamily: "monospace",
};

export function DesignPalette({ onPlaceAtCenter }: Props) {
  return (
    <div data-testid="design-palette" style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          color: "#8b949e",
          textTransform: "uppercase",
          letterSpacing: 0.08,
          marginBottom: 8,
          fontFamily: "monospace",
        }}
      >
        Components
      </div>
      <div style={{ fontSize: 11, color: "#6e7681", marginBottom: 8, lineHeight: 1.4 }}>
        Drag onto the canvas, or click to place. Hover a piece for what it does.
      </div>
      {GROUP_ORDER.map((group) => {
        const items = DESIGN_PALETTE.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} style={{ marginBottom: 10 }} data-testid={`design-palette-group-${group}`}>
            <div
              style={{
                fontSize: 9,
                color: "#6e7681",
                textTransform: "uppercase",
                letterSpacing: 0.08,
                marginBottom: 5,
                fontFamily: "monospace",
              }}
            >
              {group}
            </div>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`palette-${item.id}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DESIGN_DND_MIME, item.id);
                  e.dataTransfer.setData("text/plain", item.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onPlaceAtCenter?.(item.id)}
                style={chipStyle}
                title={item.description}
              >
                <span style={{ color: "#ef32a6", fontSize: 10 }}>{item.layer.slice(0, 3)}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
