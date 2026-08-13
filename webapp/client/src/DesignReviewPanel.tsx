import { useEffect, useState, type CSSProperties } from "react";
import type { DesignFinding } from "./designRules";
import { designScore } from "./designRules";

type GithubArchEvent = {
  event_type: "push" | "pull_request" | "scan";
  author_login: string | null;
  message: string | null;
  github_url: string | null;
  matched_node_ids: string[];
  created_at: string;
};

type Props = {
  findings: DesignFinding[];
  onHighlight: (finding: DesignFinding) => void;
  onFix: (finding: DesignFinding) => void;
  /** Optional — when provided, findings tied to a node show its last related push. */
  workspaceId?: string | null;
  apiBase?: string;
  accessToken?: string | null;
};

/** finding.nodeIds -> the most recent matching event's headline, if any. */
function useLastPushByNode(
  workspaceId: string | null | undefined,
  apiBase: string | undefined,
  accessToken: string | null | undefined
): Record<string, GithubArchEvent> {
  const [byNode, setByNode] = useState<Record<string, GithubArchEvent>>({});

  useEffect(() => {
    if (!workspaceId || !apiBase || !accessToken) {
      setByNode({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/github-events?limit=50`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!r.ok) return;
        const d = await r.json();
        const events = (d.events ?? []) as GithubArchEvent[];
        // Events arrive newest-first; keep the first (most recent) seen per node.
        const map: Record<string, GithubArchEvent> = {};
        for (const ev of events) {
          for (const nodeId of ev.matched_node_ids ?? []) {
            if (!map[nodeId]) map[nodeId] = ev;
          }
        }
        if (!cancelled) setByNode(map);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, apiBase, accessToken]);

  return byNode;
}

const severityOrder = { blocker: 0, risk: 1, suggestion: 2 } as const;

const sevColor: Record<string, string> = {
  blocker: "#f85149",
  risk: "#d29922",
  suggestion: "#8b949e",
};

const card: CSSProperties = {
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 10,
  marginBottom: 8,
  background: "#0d1117",
  cursor: "pointer",
};

export function DesignReviewPanel({ findings, onHighlight, onFix, workspaceId, apiBase, accessToken }: Props) {
  const score = designScore(findings);
  const sorted = [...findings].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );
  const lastPushByNode = useLastPushByNode(workspaceId, apiBase, accessToken);

  return (
    <div data-testid="design-review-panel" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e6edf3", fontFamily: "monospace" }}>
          Design review
        </div>
        <div
          data-testid="design-score"
          style={{
            fontSize: 18,
            fontWeight: 700,
            fontFamily: "monospace",
            color: score >= 80 ? "#3fb950" : score >= 50 ? "#d29922" : "#f85149",
          }}
        >
          {score}
          <span style={{ fontSize: 10, color: "#8b949e", fontWeight: 400 }}> / 100</span>
        </div>
      </div>
      {sorted.length === 0 ? (
        <div style={{ fontSize: 12, color: "#8b949e", lineHeight: 1.5 }}>
          No issues found. Keep adding pieces — the review updates live.
        </div>
      ) : (
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
          {sorted.map((f) => (
            <div
              key={f.id}
              data-testid={`design-finding-${f.ruleId}`}
              style={card}
              onClick={() => onHighlight(f)}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 9,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                    color: sevColor[f.severity],
                    fontFamily: "monospace",
                    border: `1px solid ${sevColor[f.severity]}55`,
                    borderRadius: 4,
                    padding: "1px 5px",
                  }}
                >
                  {f.severity}
                </span>
                <span style={{ fontSize: 12, color: "#e6edf3", fontWeight: 600 }}>{f.title}</span>
              </div>
              <div style={{ fontSize: 11, color: "#8b949e", lineHeight: 1.45, marginBottom: 8 }}>
                {f.whyItMatters}
              </div>
              {(() => {
                const lastPush = f.nodeIds.map((id) => lastPushByNode[id]).find(Boolean);
                if (!lastPush) return null;
                return (
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "#6e7681",
                      fontFamily: "monospace",
                      marginBottom: 8,
                    }}
                  >
                    last {lastPush.event_type === "pull_request" ? "PR" : lastPush.event_type}
                    {lastPush.author_login ? ` by ${lastPush.author_login}` : ""}
                    {lastPush.message ? `: ${lastPush.message.slice(0, 60)}` : ""}
                  </div>
                );
              })()}
              {f.fix && f.fix.length > 0 && (
                <button
                  type="button"
                  data-testid={`design-fix-${f.ruleId}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFix(f);
                  }}
                  style={{
                    padding: "6px 10px",
                    fontSize: 11,
                    background: "rgba(88,166,255,0.15)",
                    border: "1px solid #ef32a666",
                    borderRadius: 6,
                    color: "#ef32a6",
                    cursor: "pointer",
                    fontFamily: "monospace",
                  }}
                >
                  Fix it
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
