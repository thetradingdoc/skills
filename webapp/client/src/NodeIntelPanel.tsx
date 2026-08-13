import type { ArchNode, ArchGraph } from "./types";
import { domainFromPath } from "./layout/domainLayout";
import { computeBlastRadius, computeUpstream } from "./analysis/blastRadius";

interface NodeIntelPanelProps {
  node: ArchNode;
  graph: ArchGraph;
  onClose: () => void;
  onOpenFull?: () => void;
}

export function NodeIntelPanel({ node, graph, onClose, onOpenFull }: NodeIntelPanelProps) {
  const domain = node.domain ?? domainFromPath(node.path ?? node.id, node.id);
  const layer = (node.layer ?? "Uncategorized") as string;
  const inbound = graph.edges.filter((e) => e.target === node.id);
  const outbound = graph.edges.filter((e) => e.source === node.id);
  const blastRadius = computeBlastRadius(graph, node.id);
  const upstream = computeUpstream(graph, node.id);

  const SECTION = ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 9,
          color: "#7d8590",
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );

  return (
    <div
      style={{
        width: 260,
        height: "100%",
        background: "#0f172a",
        borderLeft: "1px solid #1e293b",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid #1e293b",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#f1f5f9" }}>
            {node.suggestedLabel ?? node.label}
          </div>
          <div style={{ fontSize: 10, color: "#7d8590", marginTop: 2, wordBreak: "break-all" }}>
            {node.id}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {onOpenFull && (
            <button
              type="button"
              onClick={onOpenFull}
              style={{
                padding: "4px 8px",
                fontSize: 10,
                background: "transparent",
                border: "1px solid #334155",
                borderRadius: 4,
                color: "#8b949e",
                cursor: "pointer",
              }}
            >
              Full details
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "4px 8px",
              fontSize: 10,
              background: "transparent",
              border: "1px solid #334155",
              borderRadius: 4,
              color: "#8b949e",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
      </div>

      <div style={{ padding: "12px 14px", overflow: "auto", flex: 1 }}>
        <SECTION title="Domain">
          <span style={{ fontSize: 11, color: "#e2e8f0" }}>{domain}</span>
        </SECTION>

        <SECTION title="Architecture Layer">
          <span style={{ fontSize: 11, color: "#e2e8f0" }}>{layer}</span>
        </SECTION>

        {node.tier && (
          <SECTION title="Tier">
            <span style={{ fontSize: 11, color: "#e2e8f0" }}>{node.tier}</span>
          </SECTION>
        )}

        <SECTION title="Roles">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(node.runtimeRoles ?? []).map((r) => (
              <span
                key={r}
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "rgba(96,165,250,0.2)",
                  color: "#ef32a6",
                }}
              >
                {r}
              </span>
            ))}
            {node.role && !(node.runtimeRoles ?? []).some((r) => r.toLowerCase() === node.role?.toLowerCase()) && (
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "rgba(96,165,250,0.2)",
                  color: "#ef32a6",
                }}
              >
                {node.role}
              </span>
            )}
            {(node.kind || node.techKind) && (
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "rgba(148,163,184,0.2)",
                  color: "#cbd5e1",
                }}
              >
                {node.techKind ?? node.kind ?? "—"}
              </span>
            )}
          </div>
        </SECTION>

        <SECTION title="Dependencies">
          <div style={{ fontSize: 11, color: "#8b949e" }}>
            ↑ {inbound.length} inbound · ↓ {outbound.length} outbound
          </div>
        </SECTION>

        <SECTION title="Flows">
          <div style={{ fontSize: 11, color: "#8b949e" }}>
            {inbound.length + outbound.length} total edges
          </div>
        </SECTION>

        <SECTION title="Blast radius">
          <div style={{ fontSize: 11, color: blastRadius.size > 0 ? "#d29922" : "#7d8590" }}>
            {blastRadius.size} downstream node{blastRadius.size !== 1 ? "s" : ""} impacted
          </div>
          {upstream.size > 0 && (
            <div style={{ fontSize: 10, color: "#7d8590", marginTop: 2 }}>
              {upstream.size} upstream dependenc{upstream.size !== 1 ? "ies" : "y"}
            </div>
          )}
        </SECTION>

        {node.description && (
          <SECTION title="Description">
            <div style={{ fontSize: 11, color: "#8b949e", lineHeight: 1.4 }}>
              {node.description.slice(0, 120)}
              {node.description.length > 120 ? "…" : ""}
            </div>
          </SECTION>
        )}
      </div>
    </div>
  );
}
