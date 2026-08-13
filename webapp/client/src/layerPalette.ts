export const LAYER_COLORS: Record<
  string,
  { top: string; accent: string; dim: string; glow: string }
> = {
  Presentation: { top: "#22d3ee", accent: "#0891b2", dim: "#071e24", glow: "rgba(34,211,238,0.18)" },
  Orchestration: { top: "#c084fc", accent: "#9333ea", dim: "#1a0d24", glow: "rgba(192,132,252,0.18)" },
  Reasoning: { top: "#f472b6", accent: "#db2777", dim: "#1f0d18", glow: "rgba(244,114,182,0.18)" },
  "Business Logic": { top: "#a78bfa", accent: "#7c3aed", dim: "#130d1f", glow: "rgba(167,139,250,0.18)" },
  Memory: { top: "#67e8f9", accent: "#0891b2", dim: "#042f2e", glow: "rgba(103,232,249,0.18)" },
  Safety: { top: "#fbbf24", accent: "#d97706", dim: "#1c1917", glow: "rgba(251,191,36,0.18)" },
  "Data Access": { top: "#34d399", accent: "#059669", dim: "#071a12", glow: "rgba(52,211,153,0.18)" },
  "External Services": { top: "#fb923c", accent: "#c2410c", dim: "#1f0d06", glow: "rgba(251,146,60,0.18)" },
  Infrastructure: { top: "#ef32a6", accent: "#ef32a6", dim: "#071020", glow: "rgba(96,165,250,0.18)" },
  Utilities: { top: "#94a3b8", accent: "#475569", dim: "#0d1117", glow: "rgba(148,163,184,0.12)" },
  Configuration: { top: "#fbbf24", accent: "#b45309", dim: "#1a1200", glow: "rgba(251,191,36,0.18)" },
  Uncategorized: { top: "#4b5563", accent: "#374151", dim: "#0d1117", glow: "rgba(75,85,99,0.10)" },
};

export type LayerCfg = { color: string; accent: string; dim: string; glow: string; bg: string };
export const LAYER_CFG: Record<string, LayerCfg> = Object.fromEntries(
  Object.entries(LAYER_COLORS).map(([k, v]) => [
    k,
    { ...v, color: v.top, bg: `${v.top}0c` },
  ])
);
