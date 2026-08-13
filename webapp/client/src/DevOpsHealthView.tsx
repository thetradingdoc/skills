/**
 * Post-V1 — DevOps / env / deploy health surface.
 *
 * Answers "what's not going to deploy cleanly" — missing env vars and CI
 * status per node, aggregated into hotspots. Mirrors ManagementRollupView /
 * UsageView: local compute from the current graph, refined by a server
 * round-trip that can also run the live env scanner against projectRoot.
 */
import { useEffect, useMemo, useState } from "react";
import type { ArchGraph } from "./types";
import { buildDeployHealth, type DeployHealth, type DeployHealthStatus } from "./deployHealth";

const MONO = "JetBrains Mono, ui-monospace, monospace";

type Props = {
  graph: ArchGraph | null;
  workspaceId: string | null;
  apiBase: string;
  accessToken: string | null;
  onSelectNode?: (nodeId: string) => void;
};

type Filter = "all" | "hotspots" | "missing-env";

type HealthResult = {
  nodes: Array<{ nodeId: string; deployHealth: DeployHealth }>;
  hotspots: string[];
  scanError?: string | null;
};

const STATUS_COLOR: Record<DeployHealthStatus, string> = {
  healthy: "#3fb950",
  degraded: "#d29922",
  failed: "#f85149",
  unknown: "#6e7681",
};

const STATUS_LABEL: Record<DeployHealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  failed: "Failed",
  unknown: "Unknown",
};

function chip(active: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    padding: "3px 8px",
    borderRadius: 999,
    border: active ? "1px solid #ef32a6" : "1px solid #30363d",
    background: active ? "rgba(239, 50, 166, 0.2)" : "transparent",
    color: active ? "#ef32a6" : "#8b949e",
    cursor: "pointer",
    fontFamily: MONO,
  };
}

function statusBadge(status: DeployHealthStatus) {
  const color = STATUS_COLOR[status];
  return (
    <span
      data-testid="devops-status-chip"
      data-status={status}
      style={{
        fontSize: 10,
        fontFamily: MONO,
        color,
        border: `1px solid ${color}55`,
        borderRadius: 999,
        padding: "1px 8px",
        textTransform: "uppercase",
        letterSpacing: 0.04,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function NodeRow({
  nodeId,
  label,
  health,
  onSelectNode,
}: {
  nodeId: string;
  label: string;
  health: DeployHealth;
  onSelectNode?: (id: string) => void;
}) {
  return (
    <div
      data-testid="devops-node-row"
      data-node-id={nodeId}
      data-status={health.status}
      style={{
        padding: "12px 16px",
        borderBottom: "1px solid #21262d",
        background: health.status === "failed" ? "rgba(248,81,73,0.05)" : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => onSelectNode?.(nodeId)}
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#e6edf3",
            background: "none",
            border: "none",
            padding: 0,
            cursor: onSelectNode ? "pointer" : "default",
            fontFamily: MONO,
          }}
        >
          {label}
        </button>
        {statusBadge(health.status)}
        {health.ciStatus && health.ciStatus !== "unknown" && (
          <span
            style={{
              fontSize: 10,
              fontFamily: MONO,
              color: health.ciStatus === "success" ? "#3fb950" : health.ciStatus === "failure" ? "#f85149" : "#d29922",
            }}
          >
            CI: {health.ciStatus}
          </span>
        )}
        {health.checkedAt && (
          <span style={{ fontSize: 10, color: "#6e7681", marginLeft: "auto", fontFamily: MONO }}>
            checked {new Date(health.checkedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: "#8b949e", fontFamily: MONO }}>
        {health.summary ?? "No signal yet"}
      </div>
      {(health.missingEnv?.length ?? 0) > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {health.missingEnv!.map((v) => (
            <span
              key={v}
              data-testid="devops-missing-env-chip"
              style={{
                fontSize: 10,
                fontFamily: MONO,
                color: "#d29922",
                background: "rgba(210,153,34,0.1)",
                border: "1px solid #d2992255",
                borderRadius: 4,
                padding: "2px 6px",
              }}
            >
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function DevOpsHealthView({ graph, workspaceId, apiBase, accessToken, onSelectNode }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [remote, setRemote] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(false);

  const nodeInputs = useMemo(
    () =>
      (graph?.nodes ?? []).map((n) => ({
        id: n.id,
        label: n.label,
        path: n.path,
        files: n.files,
        requiredEnv: n.requiredEnv,
      })),
    [graph]
  );

  const local = useMemo<HealthResult | null>(() => {
    if (nodeInputs.length === 0) return null;
    return buildDeployHealth({ nodes: nodeInputs });
  }, [nodeInputs]);

  useEffect(() => {
    if (!workspaceId || !accessToken || nodeInputs.length === 0) {
      setRemote(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(
          `${apiBase}/workspaces/${encodeURIComponent(workspaceId)}/deploy-health`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              nodes: nodeInputs,
              projectRoot: graph?.projectRoot ?? null,
            }),
          }
        );
        if (!r.ok) return;
        const d = (await r.json()) as HealthResult;
        if (!cancelled) setRemote(d);
      } catch {
        /* keep local */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, accessToken, apiBase, nodeInputs, graph?.projectRoot]);

  const data = remote ?? local;

  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph?.nodes ?? []) m.set(n.id, n.label || n.id);
    return m;
  }, [graph]);

  const visible = useMemo(() => {
    if (!data) return [];
    if (filter === "hotspots") return data.nodes.filter((n) => data.hotspots.includes(n.nodeId));
    if (filter === "missing-env")
      return data.nodes.filter((n) => (n.deployHealth.missingEnv?.length ?? 0) > 0);
    return data.nodes;
  }, [data, filter]);

  const failedCount = data?.nodes.filter((n) => n.deployHealth.status === "failed").length ?? 0;
  const degradedCount = data?.nodes.filter((n) => n.deployHealth.status === "degraded").length ?? 0;

  return (
    <div
      data-testid="devops-health"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0d1117",
        color: "#e6edf3",
        fontFamily: MONO,
      }}
    >
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #30363d" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#ef32a6", marginBottom: 4 }}>
          DevOps health
        </div>
        <div style={{ fontSize: 11, color: "#8b949e", lineHeight: 1.45 }}>
          Missing env vars and CI status per node — what won&apos;t deploy cleanly, before it ships.
        </div>
        {data && (
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, flexWrap: "wrap" }}>
            <span>{data.nodes.length} nodes</span>
            <span style={{ color: data.hotspots.length ? "#f85149" : "#3fb950" }}>
              {data.hotspots.length} hotspots
            </span>
            <span style={{ color: failedCount ? "#f85149" : "#8b949e" }}>{failedCount} failed</span>
            <span style={{ color: degradedCount ? "#d29922" : "#8b949e" }}>
              {degradedCount} degraded
            </span>
            {loading && <span style={{ color: "#6e7681" }}>refreshing…</span>}
          </div>
        )}
        {remote?.scanError && (
          <div style={{ marginTop: 8, fontSize: 10.5, color: "#d29922" }}>{remote.scanError}</div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {(
            [
              ["all", "All"],
              ["hotspots", "Hotspots"],
              ["missing-env", "Missing env"],
            ] as Array<[Filter, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`devops-filter-${id}`}
              onClick={() => setFilter(id)}
              style={chip(filter === id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {!data || data.nodes.length === 0 ? (
          <div style={{ padding: 24, color: "#8b949e", fontSize: 12 }}>
            No nodes yet. Design or scan a graph to see deploy health.
          </div>
        ) : visible.length === 0 ? (
          <div style={{ padding: 24, color: "#8b949e", fontSize: 12 }}>
            Nothing matches this filter.
          </div>
        ) : (
          visible.map((n) => (
            <NodeRow
              key={n.nodeId}
              nodeId={n.nodeId}
              label={labelById.get(n.nodeId) ?? n.nodeId}
              health={n.deployHealth}
              onSelectNode={onSelectNode}
            />
          ))
        )}
      </div>
    </div>
  );
}
