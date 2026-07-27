import { useState, useEffect, useCallback } from "react";

const API_BASE = "/api";

interface ScanRecord {
  id: string;
  status: string;
  branch?: string | null;
  commit_sha?: string | null;
  ref?: string | null;
  trigger?: string | null;
  error_message?: string | null;
  node_count?: number | null;
  edge_count?: number | null;
  started_at: string;
  completed_at?: string | null;
}

interface Props {
  workspaceId: string | null;
  accessToken: string | null;
  onClose: () => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatDuration(start: string, end?: string | null): string {
  if (!end) return "—";
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  const s = Math.round((b - a) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function ScanHistoryPanel({
  workspaceId,
  accessToken,
  onClose,
}: Props) {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScans = useCallback(async () => {
    if (!accessToken || !workspaceId) {
      setScans([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/scan-history?limit=30`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load scan history");
      setScans(data.scans ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scan history");
      setScans([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, workspaceId]);

  useEffect(() => {
    fetchScans();
  }, [fetchScans]);

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
          width: "min(480px, 94vw)",
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
          <span style={{ fontWeight: 600, fontSize: 14 }}>Scan history</span>
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
          ) : scans.length === 0 ? (
            <div style={{ color: "#8b949e", fontSize: 12 }}>
              No scans yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {scans.map((s) => (
                <div
                  key={s.id}
                  style={{
                    padding: "10px 12px",
                    background: "#0d1117",
                    borderRadius: 6,
                    border: "1px solid #21262d",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: s.status === "completed" ? "#3fb950" : s.status === "failed" ? "#f85149" : "#58a6ff",
                      }}
                    >
                      {s.status}
                    </span>
                    <span style={{ fontSize: 10, color: "#8b949e" }}>
                      {s.trigger ?? "manual"}
                      {s.branch ? ` · ${s.branch}` : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#8b949e", marginTop: 4 }}>
                    {formatTime(s.started_at)}
                    {s.completed_at && (
                      <span style={{ marginLeft: 8 }}>
                        ({formatDuration(s.started_at, s.completed_at)})
                      </span>
                    )}
                  </div>
                  {(s.node_count != null || s.edge_count != null) && (
                    <div style={{ fontSize: 10, color: "#8b949e", marginTop: 2 }}>
                      {s.node_count ?? 0} nodes, {s.edge_count ?? 0} edges
                    </div>
                  )}
                  {s.error_message && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 10,
                        color: "#f85149",
                        wordBreak: "break-word",
                      }}
                    >
                      {s.error_message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
