import type { GraphInsight } from "./analysis/graphInsights";

interface SystemInsightsPanelProps {
  insights: GraphInsight[];
  onHighlight: (nodeIds: string[]) => void;
  onClose?: () => void;
}

export function SystemInsightsPanel({
  insights,
  onHighlight,
  onClose,
}: SystemInsightsPanelProps) {
  if (insights.length === 0) {
    return (
      <div
        style={{
          padding: 16,
          color: "#64748b",
          fontSize: 12,
          fontFamily: "monospace",
        }}
      >
        No insights detected.
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 12, color: "#e2e8f0" }}>
          System insights
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            ×
          </button>
        )}
      </div>
      {insights.map((i) => (
        <button
          key={i.id}
          type="button"
          onClick={() => onHighlight(i.nodeIds)}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "10px 12px",
            background: "rgba(30,41,59,0.8)",
            border: `1px solid ${
              i.severity === "high" ? "#ef4444" : i.severity === "medium" ? "#f59e0b" : "#334155"
            }`,
            borderRadius: 6,
            color: "#e2e8f0",
            cursor: "pointer",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}>{i.title}</div>
          <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.3 }}>{i.description}</div>
        </button>
      ))}
    </div>
  );
}
