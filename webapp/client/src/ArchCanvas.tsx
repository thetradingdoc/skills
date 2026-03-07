import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  EdgeProps,
  getBezierPath,
  Position,
  Handle,
  NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type {
  ArchGraph,
  ArchNode,
  NodeLayer,
  ArchNodeViolationState,
} from "./types";
import { NodePopup } from "./NodePopup";
import { computeDepthLayout } from "./layout/depthLayout";
import { computeLayerLayout } from "./layout/layerLayout";
import { filterEdges, type EdgeFilter } from "./analysis/graphAnalyser";

const DEFAULT_EDGE_FILTER = new Set<EdgeFilter>(["all"]);
import type { GraphCommand } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────
const NODE_W = 168;

const LAYER_COLORS: Record<
  string,
  { top: string; accent: string; dim: string; glow: string }
> = {
  Presentation: {
    top: "#22d3ee",
    accent: "#0891b2",
    dim: "#071e24",
    glow: "rgba(34,211,238,0.18)",
  },
  Orchestration: {
    top: "#c084fc",
    accent: "#9333ea",
    dim: "#1a0d24",
    glow: "rgba(192,132,252,0.18)",
  },
  Reasoning: {
    top: "#f472b6",
    accent: "#db2777",
    dim: "#1f0d18",
    glow: "rgba(244,114,182,0.18)",
  },
  "Business Logic": {
    top: "#a78bfa",
    accent: "#7c3aed",
    dim: "#130d1f",
    glow: "rgba(167,139,250,0.18)",
  },
  Memory: {
    top: "#67e8f9",
    accent: "#0891b2",
    dim: "#042f2e",
    glow: "rgba(103,232,249,0.18)",
  },
  Safety: {
    top: "#fbbf24",
    accent: "#d97706",
    dim: "#1c1917",
    glow: "rgba(251,191,36,0.18)",
  },
  "Data Access": {
    top: "#34d399",
    accent: "#059669",
    dim: "#071a12",
    glow: "rgba(52,211,153,0.18)",
  },
  "External Services": {
    top: "#fb923c",
    accent: "#c2410c",
    dim: "#1f0d06",
    glow: "rgba(251,146,60,0.18)",
  },
  Infrastructure: {
    top: "#60a5fa",
    accent: "#1d4ed8",
    dim: "#071020",
    glow: "rgba(96,165,250,0.18)",
  },
  Utilities: {
    top: "#94a3b8",
    accent: "#475569",
    dim: "#0d1117",
    glow: "rgba(148,163,184,0.12)",
  },
  Configuration: {
    top: "#fbbf24",
    accent: "#b45309",
    dim: "#1a1200",
    glow: "rgba(251,191,36,0.18)",
  },
  Uncategorized: {
    top: "#4b5563",
    accent: "#374151",
    dim: "#0d1117",
    glow: "rgba(75,85,99,0.10)",
  },
};

const STATUS_COLOR: Record<string, string> = {
  stable: "#22c55e",
  new: "#60a5fa",
  warning: "#f59e0b",
  error: "#ef4444",
  deprecated: "#6b7280",
  unknown: "#1e293b",
};

// ── Custom Node ───────────────────────────────────────────────────────────────
function ArchNodeComponent({
  data,
}: NodeProps<ArchNode & { isSelected: boolean }>) {
  const node = data;
  const isVirtual = (node as any).isVirtual === true;
  const isVirtualError = (node as any).isVirtualError === true;
  const colors =
    LAYER_COLORS[(node.layer ?? "Uncategorized") as string] ??
    LAYER_COLORS["Uncategorized"];
  const statusColor =
    STATUS_COLOR[node.status ?? "unknown"] ?? STATUS_COLOR["unknown"];
  const label = node.suggestedLabel ?? node.role ?? node.label;
  const isPulsing = ["new", "warning", "error"].includes(node.status ?? "");
  const traceLayers = ["Reasoning", "Orchestration", "Memory"];
  const isMissingTraces =
    traceLayers.includes(node.layer ?? "") && node.hasTraces !== true;
  const isEntry = node.isEntryPoint ?? false;
  const depth = node.depth ?? -1;

  const vs = (node as any).violationState as ArchNodeViolationState | undefined;
  const hasCritical = vs?.highestSeverity === "critical";
  const hasHigh = vs?.highestSeverity === "high";
  const hasMedium = vs?.highestSeverity === "medium";
  const hasViolation = !!vs?.violations?.length;
  const primaryJiraKey = vs?.violations.find((v) => v.jiraKey)?.jiraKey;

  return (
    <div style={{ width: NODE_W, position: "relative" }}>
      {node.isSelected && (
        <div
          style={{
            position: "absolute",
            inset: -12,
            borderRadius: 16,
            background: colors.glow,
            pointerEvents: "none",
            zIndex: 0,
            filter: "blur(8px)",
          }}
        />
      )}

      {isEntry && (
        <div
          style={{
            position: "absolute",
            top: -22,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 14,
            zIndex: 3,
          }}
          title="Entry point"
        >
          👑
        </div>
      )}
      {isMissingTraces && (
        <div
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#f59e0b",
            boxShadow: "0 0 8px 2px rgba(245,158,11,0.6)",
            animation: "nodePulse 2s ease infinite",
            zIndex: 2,
          }}
          title="No traces yet — run chat to populate"
        />
      )}
      <div
        style={{
          position: "absolute",
          top: -12,
          left: "50%",
          transform: "translateX(-50%) rotate(45deg)",
          width: 14,
          height: 14,
          background: statusColor,
          borderRadius: 2,
          zIndex: 2,
          boxShadow: `0 0 ${isPulsing ? "10px 3px" : "5px 1px"} ${statusColor}`,
          animation: isPulsing ? "nodePulse 2s ease infinite" : undefined,
        }}
      />

      <div
        style={{
          height: 4,
          position: "relative",
          zIndex: 1,
          background: isVirtual
            ? isVirtualError
              ? `repeating-linear-gradient(90deg,#f8514966 0,#f8514966 8px,transparent 8px,transparent 16px)`
              : `repeating-linear-gradient(90deg,#a78bfa66 0,#a78bfa66 8px,transparent 8px,transparent 16px)`
            : `linear-gradient(90deg, ${colors.accent}88, ${colors.top}, ${colors.accent}88)`,
          borderRadius: "8px 8px 0 0",
        }}
      />

      <div
        style={{
          background: node.isDrift
            ? "linear-gradient(150deg,#1a0606,#150c0c)"
            : `linear-gradient(150deg,${colors.dim},#0c1220)`,
          border: hasCritical
            ? "2px solid #f85149"
            : hasHigh
              ? "2px solid #f97316"
              : hasMedium
                ? "1px dashed #eab308"
                : `1px solid ${
                    node.isSelected
                      ? colors.top
                      : node.isDrift
                        ? "#ef4444"
                        : `${colors.accent}88`
                  }`,
          borderTop: "none",
          borderRadius: "0 0 8px 8px",
          padding: "8px 12px 12px",
          position: "relative",
          zIndex: 1,
          boxShadow: [
            `0 3px 0 ${colors.accent}44`,
            `0 6px 0 ${colors.accent}22`,
            `0 12px 20px rgba(0,0,0,0.55)`,
            node.isDrift ? `0 0 0 1px #ef4444` : "",
            hasCritical ? "0 0 16px rgba(248,81,73,0.45)" : "",
          ]
            .filter(Boolean)
            .join(", "),
          animation: node.isDrift ? "driftGlow 2s ease infinite" : undefined,
        }}
      >
        <div
          style={{
            fontSize: 7,
            color: colors.top,
            fontFamily: "monospace",
            letterSpacing: "0.08em",
            opacity: 0.85,
            marginBottom: 4,
            textTransform: "uppercase",
          }}
        >
          {node.layer ?? "Uncategorized"}
        </div>

        {(node.llmProvider || node.modelVersion) && (
          <div
            style={{
              fontSize: 8,
              color: "#94a3b8",
              marginBottom: 4,
              fontFamily: "monospace",
            }}
            title={`${node.llmProvider ?? ""} ${node.modelVersion ?? ""}`.trim()}
          >
            {[node.llmProvider, node.modelVersion].filter(Boolean).join(" · ")}
          </div>
        )}

        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#e2e8f0",
            fontFamily: "'JetBrains Mono','Fira Code',monospace",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: 1.3,
            marginBottom: 3,
          }}
          title={label}
        >
          {label}
        </div>

        {node.description && (
          <div
            style={{
              fontSize: 9,
              color: "#475569",
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
            title={node.description}
          >
            {node.description}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
          <span style={{ fontSize: 8, color: "#334155" }}>
            {node.files?.length ?? 0} files
          </span>
          {depth >= 0 && (
            <span
              style={{
                fontSize: 8,
                color: colors.top,
                opacity: 0.8,
              }}
              title={`Depth: ${depth} hops from entry point`}
            >
              d{depth}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
          {[
            { label: "docs", ok: node.health?.hasDocs },
            { label: "tests", ok: node.health?.hasTests },
            { label: "context", ok: node.health?.hasContext },
          ].map(({ label: l, ok }) => (
            <div
              key={l}
              title={l}
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: ok ? "#22c55e" : "#1e2d45",
                boxShadow: ok ? "0 0 4px #22c55e88" : "none",
              }}
            />
          ))}
        </div>

        {isVirtual && (
          <div
            style={{
              fontSize: 8,
              color: isVirtualError ? "#f85149" : "#a78bfa",
              marginTop: 5,
              fontFamily: "monospace",
              letterSpacing: "0.05em",
            }}
          >
            {isVirtualError ? "⚠ materialize failed" : "◈ proposed"}
          </div>
        )}

        {node.isDrift && (
          <div
            style={{
              fontSize: 8,
              color: "#ef4444",
              marginTop: 5,
              fontFamily: "monospace",
            }}
          >
            ⚠ {node.driftReason ?? "architecture drift"}
          </div>
        )}

        {hasViolation && (
          <div
            style={{
              position: "absolute",
              top: -10,
              right: -10,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: hasCritical
                ? "#f85149"
                : hasHigh
                  ? "#f97316"
                  : "#eab308",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0b1120",
              fontSize: 10,
              fontWeight: 700,
            }}
            title={`${vs!.violations.length} active violation${
              vs!.violations.length === 1 ? "" : "s"
            }`}
          >
            {vs!.violations.length}
          </div>
        )}

        {primaryJiraKey && (
          <div
            style={{
              position: "absolute",
              bottom: -12,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#1f6feb",
              color: "#f9fafb",
              fontSize: 9,
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: 4,
              whiteSpace: "nowrap",
            }}
            title={`Tracked in Jira as ${primaryJiraKey}`}
          >
            {primaryJiraKey}
          </div>
        )}

        <div
          style={{
            position: "absolute",
            right: -5,
            top: 3,
            bottom: -7,
            width: 5,
            background: `linear-gradient(180deg,${colors.accent}55,transparent)`,
            transform: "skewY(1.5deg)",
            borderRadius: "0 2px 2px 0",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 4,
            right: 4,
            bottom: -7,
            height: 7,
            background: `linear-gradient(180deg,${colors.accent}33,transparent)`,
            borderRadius: "0 0 4px 4px",
            transform: "scaleX(0.96)",
          }}
        />
      </div>

      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: colors.top,
          width: 8,
          height: 8,
          border: `2px solid ${colors.dim}`,
          top: 0,
          zIndex: 3,
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: colors.top,
          width: 8,
          height: 8,
          border: `2px solid ${colors.dim}`,
          bottom: -14,
          zIndex: 3,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: colors.top,
          width: 6,
          height: 6,
          border: `2px solid ${colors.dim}`,
          right: -3,
          zIndex: 3,
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: colors.top,
          width: 6,
          height: 6,
          border: `2px solid ${colors.dim}`,
          left: -3,
          zIndex: 3,
        }}
      />
    </div>
  );
}

// ── Custom Edge ───────────────────────────────────────────────────────────────
function ArchEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const isDrift = data?.isDrift;
  const isLayerViolation = data?.isLayerViolation && !isDrift;
  const inTrace = (data as any)?.inTrace as boolean | undefined;
  const importance = data?.importance as "architectural" | "utility" | "config" | undefined;
  const isArchitectural = importance === "architectural" || isDrift || isLayerViolation;
  const stroke = isDrift
    ? "#ef4444"
    : isLayerViolation
      ? "#f59e0b"
      : isArchitectural
        ? "#1e3a5f"
        : "#1e2d45";
  const glow = isDrift
    ? "rgba(239,68,68,0.35)"
    : isLayerViolation
      ? "rgba(245,158,11,0.3)"
      : isArchitectural
        ? "rgba(30,100,200,0.15)"
        : "rgba(30,50,80,0.06)";

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={glow}
        strokeWidth={isDrift ? 9 : isArchitectural ? 6 : 4}
        strokeLinecap="round"
      />
      <path
        id={id}
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={isDrift ? 2 : isArchitectural ? 1.5 : 1}
        strokeOpacity={isArchitectural ? 1 : 0.5}
        strokeDasharray={isDrift || isLayerViolation ? "6 3" : undefined}
        markerEnd={`url(#arrowhead-${isDrift ? "drift" : isLayerViolation ? "violation" : "normal"})`}
      />
      {isDrift && (
        <circle r={3.5} fill="#ef4444" style={{ filter: "blur(0.5px)" }}>
          <animateMotion dur="1.8s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      {isLayerViolation && !isDrift && (
        <circle r={2.5} fill="#f59e0b" opacity={0.9}>
          <animateMotion dur="2.5s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      {!isDrift && !isLayerViolation && inTrace && (
        <circle r={2.5} fill="#a78bfa" opacity={0.9}>
          <animateMotion dur="1.5s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      {!isDrift && !isLayerViolation && !inTrace && (
        <circle r={2} fill="#3b82f6" opacity={0.6}>
          <animateMotion dur="3s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </g>
  );
}

function LayerBandComponent({
  data,
}: NodeProps<{ layer: string; colors: { top: string; dim: string } }>) {
  const { layer, colors } = data;
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: `linear-gradient(180deg, ${colors.top}08, transparent)`,
        borderTop: `1px solid ${colors.top}22`,
        borderRadius: 8,
        pointerEvents: "none",
      }}
      title={layer}
    >
      <div
        style={{
          position: "absolute",
          top: 6,
          left: 10,
          fontSize: 12,
          fontWeight: 600,
          color: colors.top,
          opacity: 0.6,
          textShadow: "0 0 2px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.6)",
          fontFamily: "monospace",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {layer}
      </div>
    </div>
  );
}

const nodeTypes = { arch: ArchNodeComponent, band: LayerBandComponent };
const edgeTypes = { arch: ArchEdgeComponent };

// ── ArchCanvas ────────────────────────────────────────────────────────────────
interface Props {
  graph: ArchGraph;
  selectedNode: string | null;
  selectedNodeData?: ArchNode | null;
  repoUrl?: string;
  onNodeSelect: (id: string | null) => void;
  edgeFilter?: EdgeFilter | Set<EdgeFilter>;
  /** When the agent returns a graphCommand, apply it to highlight/filter the canvas. */
  agentGraphCommand?: GraphCommand | null;
  /** Proposed virtual nodes from the agent (ghost nodes). */
  proposedNodes?: Array<{
    id: string;
    label: string;
    layer?: string;
    description?: string;
    archNodeId?: string;
  }>;
  /** Proposed virtual edges between nodes. */
  proposedEdges?: Array<{ fromId: string; toId: string; edgeType?: string }>;
  /** When materialize task failed, ghost nodes show error state (red border). */
  ghostNodeStatus?: "ghost" | "error";
  /** Called when the user renames the workspace (card title). */
  onRenameWorkspace?: (name: string) => void;
  /** Called when the user clicks Share. Returns share URL or null. */
  onShare?: () => Promise<{ url: string } | null>;
  /** Called when the user clicks Save. Persists the current workspace graph. */
  onSave?: () => Promise<void>;
  /** Called when the user clicks Delete workspace. */
  onDeleteWorkspace?: () => Promise<void>;
  /** Whether a workspace delete is currently in flight (disables destructive UI). */
  isDeletingWorkspace?: boolean;
  /** For NodePopup Traces/Eval tabs. */
  workspaceId?: string | null;
  accessToken?: string | null;
  /** Autosave toggle state + handler (from App). */
  autosaveEnabled: boolean;
  onToggleAutosave: (value: boolean) => void;
}

type LegendHighlight =
  | { type: "layer"; layer: string }
  | { type: "edge"; kind: "import" | "violation" | "drift" }
  | { type: "status"; status: "ok" | "warning" | "error" }
  | { type: "nodes"; nodeIds: string[] }
  | null;

export function ArchCanvas({
  graph,
  selectedNode,
  selectedNodeData,
  repoUrl,
  onNodeSelect,
  edgeFilter = DEFAULT_EDGE_FILTER,
  agentGraphCommand,
  proposedNodes,
  proposedEdges,
  ghostNodeStatus,
  onRenameWorkspace,
  onShare,
  onSave,
  onDeleteWorkspace,
  isDeletingWorkspace,
  workspaceId,
  accessToken,
  autosaveEnabled,
  onToggleAutosave,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [building, setBuilding] = useState(true);
  const [legendHighlight, setLegendHighlight] = useState<LegendHighlight>(null);
  const [workspaceTitleEditing, setWorkspaceTitleEditing] = useState(false);
  const [workspaceTitleDraft, setWorkspaceTitleDraft] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const shareCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tracePathNodeIds, setTracePathNodeIds] = useState<string[] | null>(null);
  const reactFlowInstanceRef = useRef<{ fitView: (opts?: { padding?: number }) => void } | null>(null);
  const prevGraphKeyRef = useRef<string>("");
  const legendHighlightRef = useRef<LegendHighlight>(null);
  legendHighlightRef.current = legendHighlight;
  const isAnonymous = !workspaceId && !accessToken;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const total = graph.nodes.length + (proposedNodes?.length ?? 0);
    if (total > 0 && reactFlowInstanceRef.current) {
      reactFlowInstanceRef.current.fitView({ padding: 0.12 });
    }
  }, [graph.nodes.length, graph.generatedAt, proposedNodes?.length]);

  useEffect(() => {
    setShareUrl(null);
  }, [graph.generatedAt]);

  useEffect(
    () => () => {
      if (shareCopiedTimeoutRef.current) clearTimeout(shareCopiedTimeoutRef.current);
      if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
    },
    []
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onNodeSelect(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNodeSelect]);

  // Apply agent graph command to canvas highlight (layer or node set).
  useEffect(() => {
    if (!agentGraphCommand) return;
    if (agentGraphCommand.action === "highlight_nodes" && agentGraphCommand.nodeIds.length > 0) {
      setLegendHighlight({ type: "nodes", nodeIds: agentGraphCommand.nodeIds });
    } else if (agentGraphCommand.action === "filter_layer") {
      setLegendHighlight({ type: "layer", layer: agentGraphCommand.layer });
    } else if (agentGraphCommand.action === "trace_path") {
      setLegendHighlight({ type: "nodes", nodeIds: agentGraphCommand.nodeIds });
      setTracePathNodeIds(agentGraphCommand.nodeIds);
    } else if (agentGraphCommand.action === "reset") {
      setLegendHighlight(null);
      setTracePathNodeIds(null);
    }
  }, [agentGraphCommand]);

  const build = useCallback(() => {
    const nodeIds = graph.nodes.map((n) => n.id).sort().join(",");
    const proposedIds = (proposedNodes ?? []).map((p) => p.id).sort().join(",");
    const graphKey = `${graph.generatedAt ?? 0}-${nodeIds}-${proposedIds}`;
    const isGraphChange = prevGraphKeyRef.current !== graphKey;
    prevGraphKeyRef.current = graphKey;
    if (isGraphChange) setBuilding(true);
    const filtered = filterEdges(graph, edgeFilter);
    const isGreenfieldOnly = graph.nodes.length === 0 && (proposedNodes?.length ?? 0) > 0;
    const { nodePositions, layerBands } = isGreenfieldOnly
      ? computeLayerLayout(proposedNodes ?? [])
      : computeDepthLayout(graph);
    const hl = legendHighlightRef.current;

    const nodeMatches = (node: ArchNode): boolean => {
      if (!hl) return true;
      if (hl.type === "nodes") return hl.nodeIds.includes(node.id);
      if (hl.type === "layer") return (node.layer ?? "Uncategorized") === hl.layer;
      if (hl.type === "status") {
        if (hl.status === "ok") return (node.status ?? "unknown") === "stable";
        if (hl.status === "warning") return (node.status ?? "unknown") === "warning";
        return node.isDrift || (node.status ?? "unknown") === "error";
      }
      if (hl.type === "edge") {
        const hasMatchingEdge = filtered.edges.some((e) => {
          if (e.source !== node.id && e.target !== node.id) return false;
          if (hl.kind === "import") return !e.isDrift && !e.isLayerViolation;
          if (hl.kind === "violation") return e.isLayerViolation && !e.isDrift;
          return e.isDrift;
        });
        return hasMatchingEdge;
      }
      return true;
    };

    const edgeMatches = (edge: { source: string; target: string; isDrift?: boolean; isLayerViolation?: boolean }): boolean => {
      if (!hl) return true;
      if (hl.type === "nodes") {
        const nodeSet = new Set(hl.nodeIds);
        return nodeSet.has(edge.source) || nodeSet.has(edge.target);
      }
      if (hl.type === "layer") {
        const srcMatch = (graph.nodes.find((n) => n.id === edge.source)?.layer ?? "Uncategorized") === hl.layer;
        const tgtMatch = (graph.nodes.find((n) => n.id === edge.target)?.layer ?? "Uncategorized") === hl.layer;
        return srcMatch || tgtMatch;
      }
      if (hl.type === "status") {
        const src = graph.nodes.find((n) => n.id === edge.source);
        const tgt = graph.nodes.find((n) => n.id === edge.target);
        const srcOk = hl.status === "ok" ? (src?.status ?? "unknown") === "stable" : hl.status === "warning" ? (src?.status ?? "unknown") === "warning" : (src?.isDrift ?? false) || (src?.status ?? "unknown") === "error";
        const tgtOk = hl.status === "ok" ? (tgt?.status ?? "unknown") === "stable" : hl.status === "warning" ? (tgt?.status ?? "unknown") === "warning" : (tgt?.isDrift ?? false) || (tgt?.status ?? "unknown") === "error";
        return srcOk || tgtOk;
      }
      if (hl.type === "edge") {
        const e = filtered.edges.find((x) => x.source === edge.source && x.target === edge.target);
        if (!e) return false;
        if (hl.kind === "import") return !e.isDrift && !e.isLayerViolation;
        if (hl.kind === "violation") return !!e.isLayerViolation && !e.isDrift;
        return !!e.isDrift;
      }
      return true;
    };

    const bandNodes: Node[] = layerBands.map((band) => {
      const colors =
        LAYER_COLORS[band.layer] ?? LAYER_COLORS["Uncategorized"];
      return {
        id: band.id,
        type: "band",
        position: { x: band.x, y: band.y },
        data: { layer: band.layer, colors },
        style: {
          width: band.width,
          height: band.height,
          zIndex: -1,
          pointerEvents: "none",
        },
        draggable: false,
        selectable: false,
        connectable: false,
      };
    });

    const baseNodeIds = new Set(graph.nodes.map((n) => n.id));
    const virtualNodesList = [...(proposedNodes ?? [])]
      .filter((v) => !baseNodeIds.has(v.id))
      .sort((a, b) => a.id.localeCompare(b.id));

    const rfNodes: Node[] = [
      ...bandNodes,
      ...graph.nodes.map((node) => {
        const matches = nodeMatches(node);
        return {
          id: node.id,
          type: "arch",
          position: nodePositions.get(node.id) ?? { x: 0, y: 0 },
          data: { ...node, isSelected: selectedNode === node.id },
          style: {
            background: "transparent",
            border: "none",
            padding: 0,
            width: NODE_W,
            opacity: hl ? (matches ? 1 : 0.2) : 1,
            transition: "opacity 0.2s ease",
          },
        };
      }),
      ...virtualNodesList.map((v) => {
        const pos = nodePositions.get(v.id);
        const basePos = !pos && v.archNodeId ? nodePositions.get(v.archNodeId) : null;
        const position = pos
          ? pos
          : basePos
            ? { x: basePos.x + NODE_W + 24, y: basePos.y }
            : { x: 60, y: 80 };
        const isError = ghostNodeStatus === "error";
        return {
          id: v.id,
          type: "arch",
          position,
          data: {
            id: v.id,
            label: v.label,
            path: v.archNodeId ?? v.id,
            layer: (v.layer as NodeLayer | undefined) ?? "Uncategorized",
            description: v.description ?? "Proposed node (virtual)",
            semanticSignals: { exports: [], externalImports: [], fileCount: 0 },
            files: [],
            health: { hasDocs: false, hasTests: false, hasContext: false },
            contextRawContent: undefined,
            status: "new",
            isDrift: false,
            driftReason: undefined,
            isEntryPoint: false,
            depth: undefined,
            isVirtual: true,
            isVirtualError: isError,
            isSelected: false,
          } as unknown as ArchNode & { isSelected: boolean },
          style: {
            background: "transparent",
            border: isError ? "1px dashed #f85149" : "1px dashed #4b5563",
            padding: 0,
            width: NODE_W,
            opacity: 1,
            transition: "opacity 0.2s ease, border-color 0.2s ease",
          },
        };
      }),
    ];

    const baseEdges: Edge[] = filtered.edges.map((edge) => {
      const matches = edgeMatches({
        source: edge.source,
        target: edge.target,
        isDrift: edge.isDrift,
        isLayerViolation: edge.isLayerViolation,
      });
      const inTrace =
        tracePathNodeIds &&
        tracePathNodeIds.includes(edge.source) &&
        tracePathNodeIds.includes(edge.target);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "arch",
        data: {
          isDrift: edge.isDrift,
          importance: edge.importance,
          isLayerViolation: edge.isLayerViolation,
          inTrace: !!inTrace,
        },
        style: {
          opacity: hl ? (matches ? 1 : 0.2) : 1,
          strokeWidth: inTrace ? 3 : 1,
          transition: "opacity 0.2s ease, stroke-width 0.2s ease",
        },
      };
    });

    const allNodeIds = new Set([
      ...graph.nodes.map((n) => n.id),
      ...virtualNodesList.map((v) => v.id),
    ]);

    const virtualEdges: Edge[] = (proposedEdges ?? [])
      .filter((e) => allNodeIds.has(e.fromId) && allNodeIds.has(e.toId))
      .map((e, idx) => ({
        id: `virtual-${idx}-${e.fromId}->${e.toId}`,
        source: e.fromId,
        target: e.toId,
        type: "arch",
        data: {
          isDrift: false,
          importance: undefined,
          isLayerViolation: false,
        },
        style: {
          opacity: 1,
          strokeDasharray: "4 4",
          strokeWidth: 1.5,
          transition: "opacity 0.2s ease, stroke-width 0.2s ease",
        },
      }));

    setNodes(rfNodes);
    setEdges([...baseEdges, ...virtualEdges]);
    setBuilding(false);
  }, [
    graph,
    selectedNode,
    edgeFilter,
    tracePathNodeIds,
    proposedNodes,
    proposedEdges,
    ghostNodeStatus,
    setNodes,
    setEdges,
  ]);

  useEffect(() => {
    build();
  }, [build]);

  // When only legend highlight changes, update opacity without recomputing layout.
  useEffect(() => {
    if (!legendHighlight) {
      setNodes((nds) => nds.map((n) => ({ ...n, style: { ...n.style, opacity: 1 } })));
      setEdges((eds) => eds.map((e) => ({ ...e, style: { ...e.style, opacity: 1 } })));
      return;
    }
    const filtered = filterEdges(graph, edgeFilter);
    const nodeMatches = (node: ArchNode): boolean => {
      if (legendHighlight.type === "nodes") return legendHighlight.nodeIds.includes(node.id);
      if (legendHighlight.type === "layer") return (node.layer ?? "Uncategorized") === legendHighlight.layer;
      if (legendHighlight.type === "status") {
        if (legendHighlight.status === "ok") return (node.status ?? "unknown") === "stable";
        if (legendHighlight.status === "warning") return (node.status ?? "unknown") === "warning";
        return node.isDrift || (node.status ?? "unknown") === "error";
      }
      if (legendHighlight.type === "edge") {
        const has = filtered.edges.some((e) => {
          if (e.source !== node.id && e.target !== node.id) return false;
          if (legendHighlight.kind === "import") return !e.isDrift && !e.isLayerViolation;
          if (legendHighlight.kind === "violation") return e.isLayerViolation && !e.isDrift;
          return e.isDrift;
        });
        return has;
      }
      return true;
    };
    const edgeMatches = (edge: { source: string; target: string; isDrift?: boolean; isLayerViolation?: boolean }): boolean => {
      if (legendHighlight.type === "nodes") {
        const s = new Set(legendHighlight.nodeIds);
        return s.has(edge.source) || s.has(edge.target);
      }
      if (legendHighlight.type === "layer") {
        const srcL = graph.nodes.find((n) => n.id === edge.source)?.layer ?? "Uncategorized";
        const tgtL = graph.nodes.find((n) => n.id === edge.target)?.layer ?? "Uncategorized";
        return srcL === legendHighlight.layer || tgtL === legendHighlight.layer;
      }
      if (legendHighlight.type === "status") {
        const src = graph.nodes.find((n) => n.id === edge.source);
        const tgt = graph.nodes.find((n) => n.id === edge.target);
        const ok = (n: ArchNode | undefined) =>
          legendHighlight.status === "ok"
            ? (n?.status ?? "unknown") === "stable"
            : legendHighlight.status === "warning"
              ? (n?.status ?? "unknown") === "warning"
              : (n?.isDrift ?? false) || (n?.status ?? "unknown") === "error";
        return ok(src) || ok(tgt);
      }
      if (legendHighlight.type === "edge") {
        const e = filtered.edges.find((x) => x.source === edge.source && x.target === edge.target);
        if (!e) return false;
        if (legendHighlight.kind === "import") return !e.isDrift && !e.isLayerViolation;
        if (legendHighlight.kind === "violation") return !!e.isLayerViolation && !e.isDrift;
        return !!e.isDrift;
      }
      return true;
    };
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type === "band") return n;
        const d = n.data as ArchNode & { isSelected?: boolean; isVirtual?: boolean };
        if (d.isVirtual) return n;
        const matches = nodeMatches(d);
        return { ...n, style: { ...n.style, opacity: matches ? 1 : 0.2 } };
      })
    );
    setEdges((eds) =>
      eds.map((e) => {
        const matches = edgeMatches({
          source: e.source,
          target: e.target,
          isDrift: (e.data as { isDrift?: boolean })?.isDrift,
          isLayerViolation: (e.data as { isLayerViolation?: boolean })?.isLayerViolation,
        });
        return { ...e, style: { ...e.style, opacity: matches ? 1 : 0.2 } };
      })
    );
  }, [legendHighlight, graph, edgeFilter, setNodes, setEdges]);

  const legendLayers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const n of graph.nodes) {
      const l = (n.layer ?? "Uncategorized") as string;
      seen.set(l, (seen.get(l) ?? 0) + 1);
    }
    for (const v of proposedNodes ?? []) {
      const l = (v.layer ?? "Uncategorized") as string;
      seen.set(l, (seen.get(l) ?? 0) + 1);
    }
    return Array.from(seen.entries());
  }, [graph, proposedNodes]);

  const isEmptyWorkspace =
    graph.nodes.length === 0 &&
    !graph.projectRoot &&
    (proposedNodes?.length ?? 0) === 0;

  const isGreenfieldOnly = graph.nodes.length === 0 && (proposedNodes?.length ?? 0) > 0;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {isEmptyWorkspace && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 24,
              maxWidth: 400,
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                marginBottom: 12,
                color: "#238636",
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              Empty workspace
            </div>
            <div
              style={{
                color: "#e6edf3",
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              Paste a GitHub repo URL in the sidebar to scan it, or use the chat below to ask the AI to design your architecture.
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes nodePulse  { 0%,100%{transform:translateX(-50%) rotate(45deg) scale(1);opacity:1} 50%{transform:translateX(-50%) rotate(45deg) scale(1.35);opacity:0.6} }
        @keyframes driftGlow  { 0%,100%{box-shadow:0 3px 0 #ef444444,0 6px 0 #ef444422,0 0 0 1px #ef4444} 50%{box-shadow:0 3px 0 #ef444444,0 6px 0 #ef444422,0 0 24px #ef444466,0 0 0 1px #ef4444} }
        .react-flow__edge path { pointer-events: visibleStroke !important; }
      `}</style>

      <svg style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <marker
            id="arrowhead-normal"
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto"
          >
            <path d="M 0 1 L 9 5 L 0 9 Z" fill="#1e3a5f" />
          </marker>
          <marker
            id="arrowhead-violation"
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto"
          >
            <path d="M 0 1 L 9 5 L 0 9 Z" fill="#f59e0b" />
          </marker>
          <marker
            id="arrowhead-drift"
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto"
          >
            <path d="M 0 1 L 9 5 L 0 9 Z" fill="#ef4444" />
          </marker>
        </defs>
      </svg>

      {building && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            background: "rgba(7,13,26,0.85)",
            border: "1px solid #1e3a5f",
            borderRadius: 8,
            padding: "6px 18px",
            color: "#60a5fa",
            fontSize: 11,
            fontFamily: "monospace",
            backdropFilter: "blur(8px)",
          }}
        >
          ◌ Mapping connections…
        </div>
      )}

      {selectedNodeData && (
        <NodePopup
          node={selectedNodeData}
          graph={graph}
          repoUrl={repoUrl}
          onClose={() => onNodeSelect(null)}
          workspaceId={workspaceId}
          accessToken={accessToken}
        />
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => {
          if (n.type === "band") return;
          onNodeSelect(n.id);
        }}
        onPaneClick={() => onNodeSelect(null)}
        onInit={(instance) => { reactFlowInstanceRef.current = instance; }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "arch" }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="#111f3a"
          gap={26}
          size={1.2}
        />

        <div title="Zoom: scroll wheel | Pan: drag background | Buttons: zoom in, zoom out, fit view, lock">
          <Controls
            style={{
              background: "#0a111f",
              border: "1px solid #1e2d45",
              borderRadius: 8,
            }}
          />
        </div>

        <MiniMap
          style={{
            background: "#070d1a",
            border: "1px solid #1e2d45",
            borderRadius: 8,
          }}
          nodeColor={(n) => {
            const d = n.data as { layer?: string; isDrift?: boolean };
            if (d.isDrift) return "#ef4444";
            return (
              LAYER_COLORS[d.layer ?? "Uncategorized"]?.top ?? "#374151"
            );
          }}
          maskColor="rgba(6,12,26,0.75)"
        />
      </ReactFlow>

      <div
        style={{
          position: "absolute",
          bottom: 144,
          left: 16,
          zIndex: 10,
          background: "rgba(7,13,26,0.9)",
          border: "1px solid #1e2d45",
          borderRadius: 10,
          padding: "12px 14px",
          backdropFilter: "blur(12px)",
          minWidth: 180,
          maxHeight: "calc(100vh - 180px)",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            fontSize: 9,
            color: "#94a3b8",
            marginBottom: 10,
            lineHeight: 1.4,
          }}
          title="Click any item to highlight it on the graph. Click again to clear."
        >
          Click to highlight on graph
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 8, color: "#64748b", letterSpacing: "0.1em", marginBottom: 6, textTransform: "uppercase" }}>
            Layers
          </div>
          {legendLayers.map(([name, count]) => {
            const c = LAYER_COLORS[name] ?? LAYER_COLORS["Uncategorized"];
            const active = legendHighlight?.type === "layer" && legendHighlight.layer === name;
            return (
              <div
                key={name}
                onClick={() => setLegendHighlight(active ? null : { type: "layer", layer: name })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 8px",
                  marginBottom: 2,
                  borderRadius: 6,
                  cursor: "pointer",
                  background: active ? `${c.top}22` : "transparent",
                  border: active ? `1px solid ${c.top}66` : "1px solid transparent",
                  transition: "background 0.15s, border 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = "#1e2d4533";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 1,
                    background: c.top,
                    transform: "rotate(45deg)",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 10, color: "#e2e8f0", flex: 1 }}>{name}</span>
                <span style={{ fontSize: 9, color: "#64748b" }}>{count}</span>
              </div>
            );
          })}
        </div>

        <div style={{ borderTop: "1px solid #1e2d45", paddingTop: 8 }}>
          <div style={{ fontSize: 8, color: "#64748b", letterSpacing: "0.1em", marginBottom: 6, textTransform: "uppercase" }}>
            By type
          </div>
          {(
            [
              { id: "ok" as const, label: "Imports", color: "#22c55e" },
              { id: "violation" as const, label: "Layer violation", color: "#f59e0b" },
              { id: "drift" as const, label: "Drift", color: "#ef4444" },
            ] as const
          ).map(({ id, label, color }) => {
            const isActive =
              id === "ok"
                ? legendHighlight?.type === "edge" && legendHighlight.kind === "import"
                : legendHighlight?.type === "edge" && legendHighlight.kind === id;
            return (
              <div
                key={id}
                onClick={() => {
                  if (isActive) {
                    setLegendHighlight(null);
                  } else if (id === "ok") {
                    setLegendHighlight({ type: "edge", kind: "import" });
                  } else {
                    setLegendHighlight({ type: "edge", kind: id });
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 8px",
                  marginBottom: 2,
                  borderRadius: 6,
                  cursor: "pointer",
                  background: isActive ? `${color}22` : "transparent",
                  border: isActive ? `1px solid ${color}66` : "1px solid transparent",
                  transition: "background 0.15s, border 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "#1e2d4533";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <div
                  style={{
                    width: id === "ok" ? 8 : 20,
                    height: id === "ok" ? 8 : 2,
                    background: color,
                    borderRadius: id === "ok" ? 2 : 1,
                    transform: id === "ok" ? "rotate(45deg)" : "none",
                    flexShrink: 0,
                    backgroundImage: id !== "ok" ? `repeating-linear-gradient(90deg,${color} 0,${color} 4px,transparent 4px,transparent 7px)` : undefined,
                  }}
                />
                <span style={{ fontSize: 10, color: "#e2e8f0" }}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 16,
          right: 24,
          zIndex: 10,
          background: "rgba(7,13,26,0.82)",
          border: "1px solid #1e2d45",
          borderRadius: 8,
          padding: "8px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          backdropFilter: "blur(8px)",
          maxWidth: 260,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb" }}>
            {workspaceTitleEditing && onRenameWorkspace ? (
              <input
                autoFocus
                value={workspaceTitleDraft}
                maxLength={80}
                onChange={(e) => setWorkspaceTitleDraft(e.target.value)}
                onBlur={() => {
                  const trimmed = workspaceTitleDraft.trim();
                  if (trimmed) onRenameWorkspace(trimmed);
                  setWorkspaceTitleEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const trimmed = workspaceTitleDraft.trim();
                    if (trimmed) onRenameWorkspace(trimmed);
                    setWorkspaceTitleEditing(false);
                  } else if (e.key === "Escape") {
                    setWorkspaceTitleDraft(
                      graph.projectName ?? (isGreenfieldOnly ? "New Design" : "My workspace")
                    );
                    setWorkspaceTitleEditing(false);
                  }
                }}
                style={{
                  width: "100%",
                  background: "#1e2d45",
                  border: "1px solid #334155",
                  borderRadius: 4,
                  color: "#e5e7eb",
                  padding: "2px 6px",
                  fontSize: 12,
                  outline: "none",
                }}
              />
            ) : (
              <span
                onClick={() => {
                  if (onRenameWorkspace) {
                    const current =
                      graph.projectName ?? (isGreenfieldOnly ? "New Design" : "My workspace");
                    setWorkspaceTitleDraft(current);
                    setWorkspaceTitleEditing(true);
                  }
                }}
                title={onRenameWorkspace ? "Click to rename workspace" : undefined}
                style={{
                  cursor: onRenameWorkspace ? "pointer" : "default",
                }}
              >
                {graph.projectName ?? (isGreenfieldOnly ? "New Design" : "My workspace")}
              </span>
            )}
          </div>
          {!isAnonymous && onDeleteWorkspace && (
            <button
              type="button"
              disabled={isDeletingWorkspace}
              onClick={() => {
                if (!isDeletingWorkspace) setShowDeleteConfirm(true);
              }}
              title="Delete workspace"
              style={{
                border: "none",
                background: "transparent",
                color: "#f87171",
                cursor: isDeletingWorkspace ? "wait" : "pointer",
                padding: 2,
                fontSize: 12,
              }}
            >
              🗑
            </button>
          )}
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8" }}>
          {isGreenfieldOnly
            ? `${proposedNodes?.length ?? 0} proposed nodes`
            : graph.generatedAt
              ? `Last scan: ${new Date(graph.generatedAt).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "short",
                })} · ${graph.nodes.length} nodes`
              : "No scan"}
          {graph.lastSavedAt && (
            <div style={{ marginTop: 2 }}>
              Saved at{" "}
              {new Date(graph.lastSavedAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
          <button
            type="button"
            disabled={!onSave || saveLoading || !workspaceId || graph.nodes.length === 0}
            title={
              onSave
                ? saveStatus === "saved"
                  ? "Workspace saved"
                  : "Save latest graph for this workspace"
                : "Sign in and scan a repo to save"
            }
            style={{
              fontSize: 10,
              padding: "4px 8px",
              background: "#238636",
              color: "white",
              border: "1px solid #238636",
              borderRadius: 6,
              cursor: !onSave || saveLoading || !workspaceId ? "not-allowed" : "pointer",
              opacity: !onSave || saveLoading || !workspaceId ? 0.5 : 1,
            }}
            onClick={async () => {
              if (!onSave || saveLoading || !workspaceId) return;
              setSaveLoading(true);
              setSaveStatus("idle");
              try {
                await onSave();
                setSaveStatus("saved");
                if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
                saveStatusTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 1500);
              } catch (err) {
                console.error("Save workspace failed:", err);
                setSaveStatus("error");
                if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
                saveStatusTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 2500);
              } finally {
                setSaveLoading(false);
              }
            }}
          >
            {saveLoading ? "Saving…" : saveStatus === "saved" ? "Saved" : "Save"}
          </button>
          <button
            type="button"
            disabled={!onShare || shareLoading}
            title={onShare ? "Create share options" : "Sign in and scan a repo to share"}
            onClick={async () => {
              if (!onShare) return;
              // If share options are already visible, a second click hides them.
              if (shareUrl) {
                setShareUrl(null);
                return;
              }
              setShareLoading(true);
              try {
                const result = await onShare();
                if (result?.url) setShareUrl(result.url);
              } finally {
                setShareLoading(false);
              }
            }}
            style={{
              fontSize: 10,
              padding: "4px 8px",
              background: "#0969da",
              color: "white",
              border: "1px solid #0969da",
              borderRadius: 6,
              cursor: onShare ? "pointer" : "not-allowed",
              opacity: onShare ? 1 : 0.5,
            }}
          >
            {shareLoading ? "…" : "Share"}
          </button>
        </div>
        {isAnonymous && (
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: "#f97316",
            }}
          >
            Sign in and scan a repo to save & share this workspace.
          </div>
        )}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "#7d8590",
            cursor: "pointer",
            userSelect: "none",
            marginTop: 6,
          }}
        >
          <input
            type="checkbox"
            checked={autosaveEnabled}
            onChange={(e) => onToggleAutosave(e.target.checked)}
            style={{ accentColor: "#238636", cursor: "pointer" }}
          />
          Remember workspace on this device
        </label>
        {shareUrl && (
          <div
            style={{
              marginTop: 6,
              fontSize: 10,
              color: "#58a6ff",
              border: "1px solid #1e2d45",
              borderRadius: 6,
              padding: "6px 8px",
              background: "#020617",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
              }}
            >
              <span>Share this workspace</span>
              <button
                type="button"
                onClick={() => window.open(shareUrl, "_blank")}
                style={{
                  fontSize: 9,
                  padding: "2px 8px",
                  background: "#111827",
                  border: "1px solid #1e40af",
                  borderRadius: 4,
                  color: "#60a5fa",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Open shared view
              </button>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <input
                readOnly
                value={shareUrl}
                style={{
                  flex: 1,
                  fontSize: 9,
                  background: "#0d1117",
                  border: "1px solid #1e2d45",
                  borderRadius: 4,
                  color: "#94a3b8",
                  padding: "2px 4px",
                  outline: "none",
                }}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={() => {
                  if (shareCopiedTimeoutRef.current) clearTimeout(shareCopiedTimeoutRef.current);
                  navigator.clipboard.writeText(shareUrl).then(() => {
                    setShareCopied(true);
                    shareCopiedTimeoutRef.current = setTimeout(() => setShareCopied(false), 1500);
                  });
                }}
                style={{
                  fontSize: 9,
                  padding: "2px 6px",
                  background: "#1e2d45",
                  border: "none",
                  borderRadius: 4,
                  color: "#58a6ff",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {shareCopied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
        )}
        {showDeleteConfirm && onDeleteWorkspace && (
          <div
            style={{
              marginTop: 8,
              padding: "6px 8px",
              borderRadius: 6,
              background: "#1f2937",
              border: "1px solid #4b5563",
              fontSize: 11,
              color: "#e5e7eb",
            }}
          >
            <div style={{ marginBottom: 4 }}>Delete this workspace and all its saved graphs?</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button
                type="button"
                disabled={isDeletingWorkspace}
                onClick={() => setShowDeleteConfirm(false)}
                style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: "1px solid #4b5563",
                  background: "transparent",
                  color: "#e5e7eb",
                  fontSize: 11,
                  cursor: isDeletingWorkspace ? "default" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingWorkspace}
                onClick={async () => {
                  await onDeleteWorkspace();
                  setShowDeleteConfirm(false);
                }}
                style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: "1px solid #b91c1c",
                  background: isDeletingWorkspace ? "#7f1d1d" : "#b91c1c",
                  color: "#f9fafb",
                  fontSize: 11,
                  cursor: isDeletingWorkspace ? "wait" : "pointer",
                }}
              >
                {isDeletingWorkspace ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
