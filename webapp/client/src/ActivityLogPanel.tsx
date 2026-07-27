import { useState, useEffect, useCallback } from "react";

const API_BASE = "/api";

interface Activity {
  id: string;
  actor_id?: string | null;
  actor_name?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

interface Props {
  workspaceId: string | null;
  accessToken: string | null;
  onClose: () => void;
}

function formatAction(action: string, entityType: string): string {
  const parts: string[] = [];
  if (entityType) parts.push(entityType);
  switch (action) {
    case "scene_saved":
      return "Saved scene";
    case "view_saved":
      return "Saved view";
    case "annotation_created":
      return "Added annotation";
    case "annotation_updated":
      return "Updated annotation";
    case "annotation_deleted":
      return "Deleted annotation";
    default:
      parts.push(action.replace(/_/g, " "));
      return parts.join(" ");
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export function ActivityLogPanel({
  workspaceId,
  accessToken,
  onClose,
}: Props) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActivities = useCallback(async () => {
    if (!accessToken || !workspaceId) {
      setActivities([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/activity?limit=50`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load activity");
      setActivities(data.activities ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activity");
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, workspaceId]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }}
        onClick={onClose}
      />
      <div
        style={{
          position: "relative",
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 12,
          width: "min(420px, 94vw)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid #30363d",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14 }}>Activity log</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#8b949e",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {error && (
            <div
              style={{
                padding: 8,
                background: "rgba(248,81,73,0.15)",
                border: "1px solid #f85149",
                borderRadius: 6,
                color: "#f85149",
                fontSize: 12,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ color: "#8b949e", fontSize: 12 }}>Loading…</div>
          ) : activities.length === 0 ? (
            <div style={{ color: "#8b949e", fontSize: 12 }}>
              No activity yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activities.map((a) => (
                <div
                  key={a.id}
                  style={{
                    padding: "10px 12px",
                    background: "#0d1117",
                    borderRadius: 6,
                    border: "1px solid #21262d",
                  }}
                >
                  <div style={{ fontSize: 12, color: "#e6edf3" }}>
                    {formatAction(a.action, a.entity_type)}
                    {a.actor_name && (
                      <span style={{ color: "#8b949e" }}>
                        {" "}
                        by {a.actor_name}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 10,
                      color: "#8b949e",
                    }}
                  >
                    {formatTime(a.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
