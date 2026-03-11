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
    legendImport: "#60a5fa",
    legendViolation: "#f59e0b",
    legendDrift: "#ef4444",
    legendFocus: "#38bdf8",
    badgeViolation: "#fecaca",
    badgeTrace: "#22c55e",
    badgeJira: "#38bdf8",
    badgeDrift: "#ef4444",
  },
  light: {
    canvasBg: "#f3f4f6",
    panelBg: "rgba(248,250,252,0.96)",
    panelBorder: "#cbd5f5",
    panelText: "#020617",
    subtleText: "#64748b",
    legendHeaderText: "#64748b",
    legendSectionTitleText: "#94a3b8",
    legendDivider: "#e2e8f0",
    legendImport: "#2563eb",
    legendViolation: "#d97706",
    legendDrift: "#dc2626",
    legendFocus: "#0284c7",
    badgeViolation: "#fecaca",
    badgeTrace: "#22c55e",
    badgeJira: "#0ea5e9",
    badgeDrift: "#ef4444",
  },
};

export const densityScale: Record<CanvasDensity, number> = {
  standard: 1,
  compact: 0.9,
};

