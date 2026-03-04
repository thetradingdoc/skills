/**
 * Jira Sync panel — AGENT_ROADMAP v4 §8
 * Shows stale Jira mismatches (fingerprint changed) with Retag/Archive/Keep.
 */

import { styles } from "./styles";

export interface JiraSyncMismatch {
  key: string;
  summary: string;
  storedFingerprint: string | null;
  storedModule: string | null;
  currentFingerprint: string | null;
  reason: "changed" | "orphaned" | "missing_stored";
}

interface Props {
  mismatches: JiraSyncMismatch[];
  baseUrl?: string;
  onRetag?: (key: string) => void;
  onArchive?: (key: string) => void;
  onKeep?: (key: string) => void;
}

export function JiraSyncPanel({
  mismatches,
  baseUrl,
  onRetag,
  onArchive,
  onKeep,
}: Props) {
  if (mismatches.length === 0) return null;

  return (
    <div style={styles.panel}>
      <div style={{ ...styles.sectionHeader, marginBottom: 8 }}>Jira Sync — fingerprint mismatches</div>
      <div style={{ maxHeight: 140, overflowY: "auto", fontSize: 11 }}>
        {mismatches.map((m) => (
          <div
            key={m.key}
            style={{
              padding: "8px 0",
              borderBottom: "1px solid #21262d",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {baseUrl ? (
                <a
                  href={`${baseUrl}/browse/${m.key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#58a6ff", textDecoration: "none" }}
                >
                  {m.key}
                </a>
              ) : (
                <span style={{ color: "#8b949e" }}>{m.key}</span>
              )}
              <span style={{ color: "#f0883e", fontSize: 10 }}>{m.reason}</span>
            </div>
            <div style={{ color: "#e6edf3", marginTop: 2 }}>{m.summary}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              {onRetag && m.reason === "changed" && (
                <button
                  onClick={() => onRetag(m.key)}
                  style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "4px 8px", fontSize: 10 }}
                >
                  Retag
                </button>
              )}
              {onArchive && (
                <button
                  onClick={() => onArchive(m.key)}
                  style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "4px 8px", fontSize: 10 }}
                >
                  Archive
                </button>
              )}
              {onKeep && (
                <button
                  onClick={() => onKeep(m.key)}
                  style={{ ...styles.buttonBase, ...styles.buttonSecondary, padding: "4px 8px", fontSize: 10 }}
                >
                  Keep
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
