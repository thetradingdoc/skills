/**
 * Clear dot-grid for blanko AI design canvas surfaces.
 * Decorative only — fills positioned parent, no pointer events.
 */
import type { CSSProperties } from "react";

/** Visible but calm — darker than LINE so dots read on white/paper. */
const DOT_FILL = "#C4C8D0";

type DotGridProps = {
  /** Grid spacing in px (pattern tile is size × size). */
  size?: number;
  /** Dot radius in px. */
  dotRadius?: number;
  opacity?: number;
  /** Radial mask so the grid fades out toward the edges. Prefer false for readable canvas. */
  fade?: boolean;
  style?: CSSProperties;
};

export function DotGrid({
  size = 28,
  dotRadius = 1.35,
  opacity = 1,
  fade = false,
  style,
}: DotGridProps) {
  const mask = fade
    ? "radial-gradient(ellipse 85% 70% at 50% 40%, #000 55%, transparent 100%)"
    : undefined;
  const patternId = `blanko-dot-grid-${size}-${String(dotRadius).replace(".", "_")}`;

  return (
    <svg
      data-testid="dot-grid"
      aria-hidden="true"
      focusable="false"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        opacity,
        WebkitMaskImage: mask,
        maskImage: mask,
        ...style,
      }}
    >
      <defs>
        <pattern id={patternId} width={size} height={size} patternUnits="userSpaceOnUse">
          <circle cx={size / 2} cy={size / 2} r={dotRadius} fill={DOT_FILL} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}

export default DotGrid;
