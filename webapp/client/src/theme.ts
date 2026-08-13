export type CanvasThemeName = "dark" | "light";
export type CanvasDensity = "standard" | "compact";

export const canvasTheme: Record<
  CanvasThemeName,
  {
    canvasBg: string;
    panelBg: string;
    panelBorder: string;
    panelText: string;
    subtleText: string;
    legendHeaderText: string;
    legendSectionTitleText: string;
    legendDivider: string;
    /** Imports (ok) edge/legend accent */
    legendImport: string;
    /** Layer violation accent */
    legendViolation: string;
    /** Drift accent */
    legendDrift: string;
    /** Focus button accent */
    legendFocus: string;
    /** Badge colors */
    badgeViolation: string;
    badgeTrace: string;
    badgeJira: string;
    badgeDrift: string;
  }
> = {
  dark: {
    canvasBg: "#020617",
    panelBg: "rgba(6,12,26,0.92)",
    panelBorder: "#1e2d45",
    panelText: "#e2e8f0",
    subtleText: "#94a3b8",
    legendHeaderText: "#94a3b8",
    legendSectionTitleText: "#64748b",
    legendDivider: "#1e293b",
    legendImport: "#ef32a6",
    legendViolation: "#f59e0b",
    legendDrift: "#ef4444",
    legendFocus: "#f472b6",
    badgeViolation: "#fecaca",
    badgeTrace: "#22c55e",
    badgeJira: "#f472b6",
    badgeDrift: "#ef4444",
  },
  light: {
    canvasBg: "#FFFFFF",
    panelBg: "rgba(255,255,255,0.96)",
    panelBorder: "#E5E7EB",
    panelText: "#12131A",
    subtleText: "#6B7280",
    legendHeaderText: "#6B7280",
    legendSectionTitleText: "#9CA3AF",
    legendDivider: "#E5E7EB",
    legendImport: "#ef32a6",
    legendViolation: "#d97706",
    legendDrift: "#dc2626",
    legendFocus: "#ef32a6",
    badgeViolation: "#fecaca",
    badgeTrace: "#22c55e",
    badgeJira: "#ef32a6",
    badgeDrift: "#ef4444",
  },
};

export const densityScale: Record<CanvasDensity, number> = {
  standard: 1,
  compact: 0.9,
};

