import { useEffect, useState, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
} from "reactflow";
import "reactflow/dist/style.css";
import type { ArchGraph } from "./types";
import { NodePopup } from "./NodePopup";
import { StatusBar } from "./StatusBar";
import { computeLayerLayout, sortLayerByConnectivity } from "./analysis/layerLayout";
import { filterEdges, type EdgeFilter } from "./analysis/graphAnalyser";

interface Props {
  graph: ArchGraph;
  selectedNode: string | null;
  selectedNodeData?: import("./types").ArchNode | null;
  onNodeSelect: (id: string | null) => void;
  onSaveContext?: (layer: string, description: string) => void;
  writeStatus?: "idle" | "success" | "error";
  writeError?: string | null;
  fileContentMap?: Record<string, { content: string | null; error?: string }>;
  onClearFileContent?: () => void;
  edgeFilter?: EdgeFilter;
  onFilterChange?: (f: EdgeFilter) => void;
  highlightedNodeIds?: string[];
  layerFilter?: string | null;
  proposedNodes?: Array<{
    id: string;
    label: string;
    layer: string;
    description?: string;
    connectsTo?: string[];
  }>;
}

/** Primary display label: suggestedLabel > role > label */
function getDisplayLabel(node: { label: string; suggestedLabel?: string; role?: string }): string {
  return node.suggestedLabel || node.role || node.label;
}

export function ArchCanvas({
  graph,
  selectedNode,
  selectedNodeData,
  onNodeSelect,
  onSaveContext,
  writeStatus = "idle",
  writeError = null,
  fileContentMap,
  onClearFileContent,
  edgeFilter = "all",
  onFilterChange,
  highlightedNodeIds = [],
  layerFilter = null,
  proposedNodes = [],
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [layouting, setLayouting] = useState(true);

  const nodePositions = useMemo(() => {
    const sortedNodes = sortLayerByConnectivity(
      graph.nodes,
      graph.edges.map((e) => e.source),
      graph.edges.map((e) => e.target)
    );
    const positions = computeLayerLayout(sortedNodes, 1200);
    const map = new Map<string, { x: number; y: number }>();
    for (const p of positions) {
      map.set(p.id, { x: p.x, y: p.y });
    }
    return map;
  }, [graph.nodes, graph.edges]);

  const findingsByNode = useMemo(() => {
    const byFile = new Map<string, { critical: number; warning: number }>();
    for (const f of graph.findings ?? []) {
      const cur = byFile.get(f.location) ?? { critical: 0, warning: 0 };
      if (f.severity === "critical") cur.critical += 1;
      else if (f.severity === "warning") cur.warning += 1;
      byFile.set(f.location, cur);
    }
    const map = new Map<string, { critical: number; warning: number }>();
    for (const node of graph.nodes) {
      let critical = 0;
      let warning = 0;
      for (const file of node.files) {
        const fc = byFile.get(file);
        if (fc) {
          critical += fc.critical;
          warning += fc.warning;
        }
      }
      map.set(node.id, { critical, warning });
    }
    return map;
  }, [graph.nodes, graph.findings]);

  const rfNodes = useMemo(() => {
    const isHighlighted = (nodeId: string, nodeLayer?: string) => {
      if (highlightedNodeIds.length > 0) return highlightedNodeIds.includes(nodeId);
      if (layerFilter) return nodeLayer === layerFilter;
      return true;
    };

    return graph.nodes.map((node) => {
      const pos = nodePositions.get(node.id) ?? { x: 0, y: 0 };
      const highlighted = isHighlighted(node.id, node.layer);
      const findings = findingsByNode.get(node.id) ?? { critical: 0, warning: 0 };
      const hasFindings = findings.critical > 0 || findings.warning > 0;
      return {
        id: node.id,
        type: "default" as const,
        position: pos,
        data: {
          label: (
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                }}
              >
                {getDisplayLabel(node)}
                {hasFindings && (
                  <span
                    title={
                      findings.critical > 0
                        ? `${findings.critical} critical, ${findings.warning} warning`
                        : `${findings.warning} warning`
                    }
                    style={{
                      background: findings.critical > 0 ? "#f85149" : "#f0883e",
                      color: "white",
                      fontSize: 9,
                      fontWeight: 700,
                      borderRadius: 8,
                      minWidth: 16,
                      padding: "1px 4px",
                    }}
                  >
                    {findings.critical > 0 ? findings.critical : findings.warning}
                  </span>
                )}
              </div>
              {node.description && (
                <div
                  style={{
                    fontSize: 9,
                    color: "#7d8590",
                    marginTop: 2,
                    maxWidth: 150,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={node.description}
                >
                  {node.description}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 3,
                  justifyContent: "center",
                  marginTop: 5,
                }}
              >
                {[
                  node.health.hasDocs,
                  node.health.hasTests,
                  node.health.hasContext,
                ].map((ok, j) => (
                  <span
                    key={j}
                    style={{ color: ok ? "#3fb950" : "#f85149", fontSize: 8 }}
                  >
                    ●
                  </span>
                ))}
              </div>
            </div>
          ),
        },
        style: {
          background: node.isDrift ? "#1a0e0e" : "#1c2128",
          border: `1px solid ${
            selectedNode === node.id
              ? "#58a6ff"
              : node.isDrift
                ? "#f85149"
                : node.status === "error"
                  ? "#f85149"
                  : node.status === "warning"
                    ? "#f0883e"
                    : node.status === "deprecated"
                      ? "#6e7681"
                      : "#30363d"
          }`,
          borderRadius: 8,
          color: "#e6edf3",
          width: 170,
          padding: 10,
          opacity: highlighted ? 1 : 0.35,
        },
      };
    });
  }, [
    graph.nodes,
    nodePositions,
    findingsByNode,
    selectedNode,
    highlightedNodeIds,
    layerFilter,
  ]);

  const rfProposed = useMemo(() => {
    if (!proposedNodes || proposedNodes.length === 0) {
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }

    const proposedIdSet = new Set(proposedNodes.map((n) => n.id));
    const proposedRfId = (id: string) => `proposed:${id}`;
    const resolveTarget = (id: string) => (proposedIdSet.has(id) ? proposedRfId(id) : id);

    const layerBands = new Map<
      string,
      { minY: number; maxY: number; maxX: number; count: number }
    >();
    for (const n of graph.nodes) {
      const layer = n.layer ?? "Uncategorized";
      const pos = nodePositions.get(n.id);
      if (!pos) continue;
      const cur = layerBands.get(layer) ?? {
        minY: pos.y,
        maxY: pos.y,
        maxX: pos.x,
        count: 0,
      };
      cur.minY = Math.min(cur.minY, pos.y);
      cur.maxY = Math.max(cur.maxY, pos.y);
      cur.maxX = Math.max(cur.maxX, pos.x);
      cur.count += 1;
      layerBands.set(layer, cur);
    }

    const layerOrder = Array.from(new Set(graph.nodes.map((n) => n.layer ?? "Uncategorized")));
    const fallbackBand = (layer: string) => {
      const i = Math.max(0, layerOrder.indexOf(layer));
      return { minY: i * 260, maxY: i * 260 + 200, maxX: 900, count: 0 };
    };

    const nodesOut: Node[] = [];
    const edgesOut: Edge[] = [];

    const seenPerLayer = new Map<string, number>();
    for (const pn of proposedNodes) {
      const layer = pn.layer ?? "Uncategorized";
      const band = layerBands.get(layer) ?? fallbackBand(layer);
      const k = (seenPerLayer.get(layer) ?? 0) + 1;
      seenPerLayer.set(layer, k);

      const x = band.maxX + 260;
      const yBase = Number.isFinite(band.minY) ? band.minY : 0;
      const y = yBase + (k - 1) * 120;

      nodesOut.push({
        id: proposedRfId(pn.id),
        type: "default",
        position: { x, y },
        selectable: false,
        draggable: false,
        data: {
          label: (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 650, fontSize: 12 }}>{pn.label}</div>
              <div style={{ fontSize: 9, color: "#7d8590", marginTop: 3 }}>
                proposed · {layer}
              </div>
            </div>
          ),
        },
        style: {
          background: "transparent",
          border: "1px dashed #7d8590",
          borderRadius: 8,
          color: "#e6edf3",
          width: 170,
          padding: 10,
          opacity: 0.95,
        },
      });

      for (const targetId of pn.connectsTo ?? []) {
        edgesOut.push({
          id: `proposed-edge:${pn.id}->${targetId}`,
          source: proposedRfId(pn.id),
          target: resolveTarget(targetId),
          style: { stroke: "#7d8590", strokeWidth: 1, strokeDasharray: "6 4", opacity: 0.8 },
          animated: false,
        });
      }
    }

    return { nodes: nodesOut, edges: edgesOut };
  }, [proposedNodes, graph.nodes, nodePositions]);

  const rfEdges = useMemo(() => {
    const filtered = filterEdges(graph, edgeFilter);
    const importanceToWidth = (imp?: string) => {
      if (imp === "architectural") return 1.5;
      if (imp === "config") return 1;
      return 0.8;
    };
    return filtered.edges.map((edge) => {
      const isArch =
        edge.importance === "architectural" || edge.isDrift || edge.isLayerViolation;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        style: {
          stroke: edge.isDrift
            ? "#f85149"
            : edge.isLayerViolation
              ? "#f59e0b"
              : isArch
                ? "#58a6ff"
                : "#30363d",
          strokeWidth:
            edge.isDrift ? 2 : edge.isLayerViolation ? 1.5 : importanceToWidth(edge.importance),
          opacity: edge.importance === "utility" ? 0.6 : 1,
        },
        animated: edge.isDrift || edge.isLayerViolation,
        label: edge.isDrift ? "⚠" : edge.isLayerViolation ? "↑" : undefined,
      };
    });
  }, [graph, edgeFilter]);

  useEffect(() => {
    setLayouting(true);
    setNodes([...rfNodes, ...rfProposed.nodes]);
    setEdges([...rfEdges, ...rfProposed.edges]);
    setLayouting(false);
  }, [rfNodes, rfEdges, rfProposed, setNodes, setEdges]);

  const driftCount = graph.edges.filter((e) => e.isDrift).length;
  const violationCount = graph.edges.filter((e) => e.isLayerViolation).length;
  const criticalFindingsCount =
    graph.findings?.filter((f) => f.severity === "critical").length ?? 0;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {onFilterChange && (
        <StatusBar
          moduleCount={graph.nodes.length}
          connectionCount={graph.edges.length}
          driftCount={driftCount}
          violationCount={violationCount}
          criticalFindingsCount={criticalFindingsCount}
          currentFilter={edgeFilter}
          onFilterChange={onFilterChange}
        />
      )}
      {layouting && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            color: "#7d8590",
            fontSize: 13,
            zIndex: 10,
          }}
        >
          ⟳ Laying out graph...
        </div>
      )}
      {selectedNodeData && onSaveContext && (
        <NodePopup
          node={selectedNodeData}
          graph={graph}
          onClose={() => onNodeSelect(null)}
          onSaveContext={onSaveContext}
          writeStatus={writeStatus}
          writeError={writeError}
          fileContentMap={fileContentMap}
          onClearFileContent={onClearFileContent}
        />
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onNodeSelect(node.id)}
        onPaneClick={() => onNodeSelect(null)}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} color="#21262d" />
        <div title="Zoom: scroll wheel | Pan: drag background | Buttons: zoom in, zoom out, fit view, lock">
          <Controls
            style={{
              background: "#1c2128",
              border: "1px solid #30363d",
              borderRadius: 6,
            }}
          />
        </div>
        <MiniMap
          style={{ background: "#161b22" }}
          nodeColor={(n) =>
            (typeof n.style?.border === "string" && n.style.border.includes("#f85149")) ? "#f85149" : "#30363d"
          }
        />
      </ReactFlow>
    </div>
  );
}
