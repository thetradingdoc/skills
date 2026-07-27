import { useState, useEffect, useCallback } from "react";

const API_BASE = "/api";

interface SnapshotSummary {
  id: string;
  workspaceId: string;
  scanId?: string;
  nodeCount: number;
  edgeCount: number;
  recordedAt: string;
}

interface Props {
  workspaceId: string | null;
  accessToken: string | null;
  onClose: () => void;
  onLoadSnapshot: (graph: unknown) => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function SnapshotSelectorPanel({
  workspaceId,
  accessToken,
  onClose,
  onLoadSnapshot,
}: Props) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshots = useCallback(async () => {
    if (!accessToken || !workspaceId) {
      setSnapshots([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${workspaceId}/graph-snapshots?limit=30`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load snapshots");
      setSnapshots(data.snapshots ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load snapshots");
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, workspaceId]);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const loadSnapshot = useCallback(
    async (graphId: string) => {
      if (!accessToken || !workspaceId) return;
      setLoadingId(graphId);
      try {
        const res = await fetch(
          `${API_BASE}/workspaces/${workspaceId}/graphs/${graphId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load snapshot");
        if (data.graph) {
          onLoadSnapshot(data.graph);
          onClose();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load snapshot");
      } finally {
        setLoadingId(null);
      }
    },
    [accessToken, workspaceId, onLoadSnapshot, onClose]
  );

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
          <span style={{ fontWeight: 600, fontSize: 14 }}>Snapshot timeline</span>
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
          ) : snapshots.length === 0 ? (
            <div style={{ color: "#8b949e", fontSize: 12 }}>
              No snapshots yet — run a scan to create one.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {snapshots.map((s) => (
                <div
                  key={s.id}
                  style={{
                    padding: "10px 12px",
                    background: "#0d1117",
                    borderRadius: 6,
                    border: "1px solid #21262d",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, color: "#8b949e" }}>
                      {formatTime(s.recordedAt)}
                    </div>
                    <div style={{ fontSize: 10, color: "#6e7681", marginTop: 2 }}>
                      {s.nodeCount} nodes · {s.edgeCount} edges
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadSnapshot(s.id)}
                    disabled={loadingId !== null}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      background: "#238636",
                      border: "none",
                      borderRadius: 4,
                      color: "#fff",
                      cursor: loadingId !== null ? "not-allowed" : "pointer",
                      opacity: loadingId === s.id ? 0.7 : 1,
                    }}
                  >
                    {loadingId === s.id ? "Loading…" : "Load"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
