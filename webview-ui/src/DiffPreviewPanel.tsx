/**
 * Diff Preview panel — AGENT_ROADMAP v4 §6
 * Shows staged changes, Approve/Reject.
 */

import { vscode } from "./vscode";
import { styles } from "./styles";

export interface StagingEntry {
  path: string;
  content: string;
  taskId?: string;
}

interface Props {
  entries: StagingEntry[];
}

export function DiffPreviewPanel({ entries }: Props) {
  if (entries.length === 0) return null;

  const handleApproveAll = () => {
    vscode.postMessage({
      type: "agentDiffApprove",
      paths: entries.map((e) => e.path),
    });
  };

  const handleRejectAll = () => {
    vscode.postMessage({
      type: "agentDiffReject",
      paths: entries.map((e) => e.path),
    });
  };

  return (
    <div
      style={{
        ...styles.panel,
        borderLeft: "3px solid #f0883e",
      }}
    >
      <div style={styles.sectionHeader}>Pending Changes (Diff Preview)</div>
      <div style={{ maxHeight: 120, overflowY: "auto", fontSize: 11, marginBottom: 8 }}>
        {entries.map((e) => (
          <div
            key={e.path}
            style={{
              padding: "4px 0",
              borderBottom: "1px solid #21262d",
              fontFamily: "monospace",
              color: "#8b949e",
            }}
          >
            {e.path}
            {e.taskId && <span style={{ marginLeft: 8, color: "#58a6ff" }}>{e.taskId}</span>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleApproveAll}
          style={{ flex: 1, ...styles.buttonBase, ...styles.buttonPrimary }}
        >
          Approve all
        </button>
        <button onClick={handleRejectAll} style={{ ...styles.buttonBase, ...styles.buttonSecondary }}>
          Reject all
        </button>
      </div>
    </div>
  );
}
