/**
 * Agent Plan panel — AGENT_ROADMAP v4 §2 Plan Review gate
 * Shows plan, task list, dependency graph, Approve/Reject/Edit.
 */

import { useState } from "react";
import { vscode } from "./vscode";
import { styles } from "./styles";

export interface AgentPlanData {
  goal: string;
  tasks: Array<{
    id: string;
    module: string;
    layer: string;
    action: string;
    expectedOutput: string;
  }>;
  dependencies: Array<[string, string]>;
  /** Section 10.4: Anti-pattern warnings from failed rails of same archetype. */
  warnings?: string[];
}

interface Props {
  plan: AgentPlanData;
  currentTaskIndex?: number;
  onDismiss?: () => void;
}

export function AgentPlanPanel({ plan, currentTaskIndex, onDismiss }: Props) {
  const [editMode, setEditMode] = useState(false);
  const [feedback, setFeedback] = useState("");

  const taskIds = new Set(plan.tasks.map((t) => t.id));
  const depsByBlocked = new Map<string, string[]>();
  for (const [blocker, blocked] of plan.dependencies) {
    if (taskIds.has(blocker) && taskIds.has(blocked)) {
      if (!depsByBlocked.has(blocked)) depsByBlocked.set(blocked, []);
      depsByBlocked.get(blocked)!.push(blocker);
    }
  }

  const handleApprove = () => {
    vscode.postMessage({ type: "agentPlanAction", action: "approve" });
  };

  const handleReject = () => {
    vscode.postMessage({ type: "agentPlanAction", action: "reject", editFeedback: feedback || undefined });
    onDismiss?.();
  };

  return (
    <div
      style={{
        ...styles.panel,
        borderLeft: "3px solid #238636",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          ...styles.sectionHeader,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        Agent Plan — Review
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: "none",
              border: "none",
              color: "#7d8590",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ✕
          </button>
        )}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#e6edf3" }}>
        {plan.goal}
      </div>
      {plan.warnings && plan.warnings.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: 8,
            background: "rgba(210, 153, 34, 0.15)",
            border: "1px solid #d29922",
            borderRadius: 6,
            fontSize: 12,
            color: "#d29922",
          }}
        >
          <strong>Anti-pattern warnings (avoid these):</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {plan.warnings.map((w, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 12 }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#7d8590", textAlign: "left", borderBottom: "1px solid #30363d" }}>
              <th style={{ padding: "6px 8px" }}>Status</th>
              <th style={{ padding: "6px 8px" }}>Task</th>
              <th style={{ padding: "6px 8px" }}>Module</th>
              <th style={{ padding: "6px 8px" }}>Layer</th>
              <th style={{ padding: "6px 8px" }}>Action</th>
              <th style={{ padding: "6px 8px" }}>Depends on</th>
            </tr>
          </thead>
          <tbody>
            {plan.tasks.map((t, idx) => {
              const status =
                typeof currentTaskIndex === "number"
                  ? idx < currentTaskIndex
                    ? "done"
                    : idx === currentTaskIndex
                      ? "running"
                      : "pending"
                  : "pending";
              const statusStyle =
                status === "done"
                  ? { border: "1px solid #238636", color: "#3fb950" }
                  : status === "running"
                    ? { border: "1px solid #58a6ff", color: "#58a6ff" }
                    : { border: "1px solid #30363d", color: "#7d8590" };
              return (
              <tr key={t.id} style={{ borderBottom: "1px solid #21262d" }}>
                <td style={{ padding: "6px 8px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "1px 6px",
                      borderRadius: 999,
                      fontSize: 10,
                      ...statusStyle,
                    }}
                  >
                    {status}
                  </span>
                </td>
                <td style={{ padding: "6px 8px", color: "#58a6ff" }}>{t.id}</td>
                <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: 11 }}>{t.module}</td>
                <td style={{ padding: "6px 8px" }}>{t.layer}</td>
                <td style={{ padding: "6px 8px" }}>{t.action}</td>
                <td style={{ padding: "6px 8px", color: "#8b949e" }}>
                  {(depsByBlocked.get(t.id) ?? []).join(", ") || "—"}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {plan.tasks.length > 0 && (
        <div style={{ fontSize: 11, color: "#7d8590", marginBottom: 12 }}>
          Expected: {plan.tasks.map((t) => t.expectedOutput).join("; ")}
        </div>
      )}
      {editMode ? (
        <div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Feedback for model (e.g. split task T2, change layer)..."
            rows={2}
            style={{
              width: "100%",
              padding: 8,
              background: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: 6,
              color: "#e6edf3",
              fontSize: 12,
              resize: "vertical",
              outline: "none",
              marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleReject}
              style={{ flex: 1, ...styles.buttonBase, ...styles.buttonSecondary }}
            >
              Reject with feedback
            </button>
            <button onClick={() => setEditMode(false)} style={{ ...styles.buttonBase, ...styles.buttonSecondary }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleApprove} style={{ flex: 1, ...styles.buttonBase, ...styles.buttonPrimary }}>
            Approve
          </button>
          <button onClick={() => setEditMode(true)} style={{ ...styles.buttonBase, ...styles.buttonSecondary }}>
            Reject / Edit
          </button>
        </div>
      )}
    </div>
  );
}
