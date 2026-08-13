import type { CSSProperties } from "react";
import type { ArchGraph } from "./types";
import type { PlanStep } from "./buildPlan";
import { nextStep } from "./buildPlan";

type BuildStatus = "planned" | "building" | "built";

type Props = {
  plan: PlanStep[];
  graph: ArchGraph;
  onSetBuildStatus: (nodeId: string, status: BuildStatus) => void;
  onHighlight?: (step: PlanStep) => void;
};

const statusColor: Record<BuildStatus, string> = {
  planned: "#8b949e",
  building: "#ef32a6",
  built: "#3fb950",
};

const row: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: "8px 10px",
  marginBottom: 6,
  background: "#0d1117",
  cursor: "pointer",
};

export function DesignBuildPlanPanel({ plan, graph, onSetBuildStatus, onHighlight }: Props) {
  const statusByNode = new Map(graph.nodes.map((n) => [n.id, (n.buildStatus ?? "planned") as BuildStatus]));
  const current = nextStep(plan, graph);
  const builtCount = plan.filter((s) => statusByNode.get(s.nodeId) === "built").length;

  return (
    <div data-testid="design-build-plan-panel" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e6edf3", fontFamily: "monospace" }}>
          Build plan
        </div>
        <div style={{ fontSize: 11, color: "#8b949e", fontFamily: "monospace" }}>
          {builtCount} / {plan.length} built
        </div>
      </div>

      {plan.length === 0 ? (
        <div style={{ fontSize: 12, color: "#8b949e", lineHeight: 1.5 }}>
          Nothing to build yet — add components on the canvas to generate a plan.
        </div>
      ) : (
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
          {plan.map((step) => {
            const status = statusByNode.get(step.nodeId) ?? "planned";
            const isCurrent = current?.id === step.id;
            return (
              <div
                key={step.id}
                data-testid={`design-plan-step-${step.nodeId}`}
                style={{
                  ...row,
                  border: isCurrent ? "1px solid #ef32a6" : row.border,
                  background: isCurrent ? "rgba(88,166,255,0.08)" : row.background,
                }}
                onClick={() => onHighlight?.(step)}
              >
                <input
                  type="checkbox"
                  data-testid={`design-plan-checkbox-${step.nodeId}`}
                  checked={status === "built"}
                  onChange={(e) => {
                    e.stopPropagation();
                    onSetBuildStatus(step.nodeId, e.target.checked ? "built" : "planned");
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginTop: 3, cursor: "pointer" }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span
                      style={{
                        fontSize: 9,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        color: statusColor[status],
                        fontFamily: "monospace",
                        border: `1px solid ${statusColor[status]}55`,
                        borderRadius: 4,
                        padding: "1px 5px",
                      }}
                    >
                      {status}
                    </span>
                    <span style={{ fontSize: 12, color: "#e6edf3", fontWeight: 600 }}>{step.label}</span>
                    {isCurrent && (
                      <span style={{ fontSize: 9, color: "#ef32a6", fontFamily: "monospace" }}>← next</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#8b949e", lineHeight: 1.4, marginBottom: status === "planned" ? 6 : 0 }}>
                    {step.reason}
                  </div>
                  {status === "planned" && (
                    <button
                      type="button"
                      data-testid={`design-plan-start-${step.nodeId}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetBuildStatus(step.nodeId, "building");
                      }}
                      style={{
                        padding: "4px 8px",
                        fontSize: 10,
                        background: "rgba(88,166,255,0.12)",
                        border: "1px solid #ef32a655",
                        borderRadius: 6,
                        color: "#ef32a6",
                        cursor: "pointer",
                        fontFamily: "monospace",
                      }}
                    >
                      Start building
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
