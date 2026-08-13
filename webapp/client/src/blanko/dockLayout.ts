/**
 * Dock overlay widths — Agents/Workspace open wide; other modes stay narrow.
 * Maximize fills the canvas inset beside the rail (not browser Fullscreen API).
 */
import type { DockMode } from "./types";
import { normalizeDockMode } from "./types";

export const DOCK_NARROW_DEFAULT = 360;
export const DOCK_WIDE_DEFAULT = 720;

export const DOCK_NARROW_MIN = 280;
export const DOCK_NARROW_MAX = 560;
export const DOCK_WIDE_MIN = 480;
export const DOCK_WIDE_MAX = 920;

/** Space reserved for rail + margins (right: 84 rail zone + padding). */
export const DOCK_VIEWPORT_RESERVE = 96;

export function isWideDockMode(mode: DockMode | null | undefined): boolean {
  const m = normalizeDockMode(mode ?? null);
  // Agents, System, Tasks — wider overlays (legacy ops/code normalize into these).
  return m === "agents" || m === "workspace" || m === "work";
}

export function canMaximizeDockMode(mode: DockMode | null | undefined): boolean {
  return isWideDockMode(mode);
}

/**
 * Esc while dock open:
 * - maximized → restore (keep open)
 * - restored → close
 */
export function nextDockEscAction(maximized: boolean): "restore" | "close" {
  return maximized ? "restore" : "close";
}

export function maxDockWidthForViewport(viewportWidth?: number): number {
  const vw =
    typeof viewportWidth === "number" && viewportWidth > 0
      ? viewportWidth
      : typeof window !== "undefined"
        ? window.innerWidth
        : 1280;
  return Math.max(DOCK_WIDE_MIN, vw - DOCK_VIEWPORT_RESERVE);
}

export function clampDockWidth(
  width: number,
  mode: DockMode | null | undefined,
  viewportWidth?: number
): number {
  const wide = isWideDockMode(mode);
  const min = wide ? DOCK_WIDE_MIN : DOCK_NARROW_MIN;
  const modeMax = wide ? DOCK_WIDE_MAX : DOCK_NARROW_MAX;
  const max = Math.min(modeMax, maxDockWidthForViewport(viewportWidth));
  const lo = Math.min(min, max);
  return Math.min(max, Math.max(lo, Math.round(width)));
}

/** Default width when opening a dock mode. */
export function defaultDockWidthForMode(
  mode: DockMode | null | undefined,
  viewportWidth?: number
): number {
  const target = isWideDockMode(mode) ? DOCK_WIDE_DEFAULT : DOCK_NARROW_DEFAULT;
  return clampDockWidth(target, mode, viewportWidth);
}
