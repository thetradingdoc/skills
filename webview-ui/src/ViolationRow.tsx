import type { CriticViolation } from "./types";

export interface SharedViolation extends CriticViolation {
  id: string;
  /** How many times this violation has recurred (optional). */
  recurrenceCount?: number;
  /** Policy state from persistence (new/tracked/resolved/waived/accepted/regressed). */
  policyState?: string;
}

interface ViolationRowProps {
  violation: SharedViolation;
  onCreateJira: (v: SharedViolation) => void;
  onDismiss?: (id: string) => void;
}

export function ViolationRow({ violation, onCreateJira, onDismiss }: ViolationRowProps) {
  const v = violation;
  const dotClass =
    { critical: "dot-critical", high: "dot-high", medium: "dot-medium" }[v.severity] ??
    "dot-medium";
  const statusClass =
    {
      "In Progress": "inprog",
      "To Do": "todo",
      Done: "done",
    }[v.jiraStatus ?? ""] ?? "todo";

  const recurrences = v.recurrenceCount ?? v.recurrences ?? 1;

  return (
    <div className="viol-item">
      <div className={`viol-dot ${dotClass}`} />
      <div className="viol-content">
        <div className="viol-type">{v.type.replace(/_/g, " ")}</div>
        <div className="viol-desc" title={v.description}>
          {v.description}
        </div>
        <div className="viol-meta">
          {v.jiraKey ? (
            <a
              className="jira-badge"
              href={`#jira-${v.jiraKey}`}
              onClick={(e) => e.preventDefault()}
              title={`${v.jiraKey}${v.jiraStatus ? ` · ${v.jiraStatus}` : ""}`}
            >
              <span className={`jira-badge-dot ${statusClass}`} />
              {v.jiraKey}
              {v.jiraStatus && (
                <>
                  <span
                    style={{
                      color: "var(--subtle)",
                      fontWeight: 400,
                    }}
                  >
                    {" "}
                    ·
                  </span>
                  <span
                    style={{
                      color: "var(--muted)",
                      fontWeight: 400,
                    }}
                  >
                    {" "}
                    {v.jiraStatus}
                  </span>
                </>
              )}
            </a>
          ) : (
            <button
              className="jira-badge"
              style={{
                cursor: "pointer",
                background: "var(--surface2)",
                color: "var(--muted)",
                borderColor: "var(--border2)",
              }}
              onClick={() => onCreateJira(v)}
              title="Create Jira ticket"
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span className="jira-badge-dot" />
                Create ticket
              </span>
            </button>
          )}
          {recurrences >= 2 && (
            <span className={`tag tag-recur${recurrences >= 5 ? " tag-recur-high" : ""}`}>
              ×{recurrences}
            </span>
          )}
          <span className="tag">{v.sourceNodeId}</span>
        </div>
      </div>
      {onDismiss && (
        <div className="viol-actions">
          <button className="icon-btn" title="Dismiss" onClick={() => onDismiss(v.id)}>
            {/* Simple × icon using currentColor */}
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

