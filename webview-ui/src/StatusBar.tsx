/**
 * StatusBar — replaces the unlabelled top-right badge in ArchCanvas.
 * Shows key metrics with icons and labels. Clicking a stat triggers a filter.
 */

import type { EdgeFilter } from "./analysis/graphAnalyser";

interface StatusBarProps {
  moduleCount: number;
  connectionCount: number;
  driftCount: number;
  violationCount: number;
  criticalFindingsCount: number;
  currentFilter: EdgeFilter;
  onFilterChange: (f: EdgeFilter) => void;
}

const pill = (
  value: number,
  label: string,
  icon: string,
  activeColor: string,
  isActive: boolean,
  isWarning: boolean,
  onClick?: () => void
): React.ReactElement => (
  <button
    onClick={onClick}
    title={label}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 5,
      padding: "4px 10px",
      background: isActive ? activeColor + "22" : "#0d1117",
      border: `1px solid ${isActive ? activeColor : "#30363d"}`,
      borderRadius: 6,
      cursor: onClick ? "pointer" : "default",
      color: isWarning && value > 0 ? activeColor : "#e6edf3",
      fontSize: 12,
      fontWeight: 600,
      transition: "all 0.15s",
      outline: "none",
    }}
  >
    <span style={{ fontSize: 13 }}>{icon}</span>
    <span style={{ color: isWarning && value > 0 ? activeColor : "#e6edf3" }}>{value}</span>
    <span style={{ fontSize: 10, color: "#c9d1d9", fontWeight: 400 }}>{label}</span>
  </button>
);

export function StatusBar({
  moduleCount,
  connectionCount,
  driftCount,
  violationCount,
  criticalFindingsCount,
  currentFilter,
  onFilterChange,
}: StatusBarProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        display: "flex",
        gap: 6,
        zIndex: 10,
        backdropFilter: "blur(8px)",
      }}
    >
      {pill(moduleCount, "modules", "⬡", "#58a6ff", false, false)}
      {pill(connectionCount, "connections", "→", "#58a6ff", false, false)}
      {pill(
        driftCount,
        "drift",
        "⚡",
        "#f85149",
        currentFilter === "drift",
        true,
        driftCount > 0 ? () => onFilterChange(currentFilter === "drift" ? "architectural" : "drift") : undefined
      )}
      {pill(
        violationCount,
        "violations",
        "⚠",
        "#f0883e",
        currentFilter === "violations",
        true,
        violationCount > 0
          ? () => onFilterChange(currentFilter === "violations" ? "architectural" : "violations")
          : undefined
      )}
      {criticalFindingsCount > 0 &&
        pill(criticalFindingsCount, "critical", "🔴", "#f85149", false, true)}
    </div>
  );
}
