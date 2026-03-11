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
  WorkspaceAnnotation,
} from "./types";
import { NodePopup } from "./NodePopup";
import { Arch3DView } from "./Arch3DView";
import { computeDepthLayout } from "./layout/depthLayout";
import { computeLayerLayout } from "./layout/layerLayout";
import { NODE_W } from "./layout/canvasConstants";
import { LAYER_COLORS, LAYER_CFG } from "./layerPalette";
import { canvasTheme, densityScale, type CanvasDensity, type CanvasThemeName } from "./theme";
import { filterEdges, type EdgeFilter } from "./analysis/graphAnalyser";
import { isFlagEnabled } from "./featureFlags";

const DEFAULT_EDGE_FILTER = new Set<EdgeFilter>(["all"]);
import type { GraphCommand } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  stable: "#22c55e",
  new: "#60a5fa",
  warning: "#f59e0b",
  error: "#ef4444",
  deprecated: "#6b7280",
  unknown: "#1e293b",
};

const KIND_ICON: Record<string, string> = {
  agent: "🤖",
  orchestrator: "🔀",
  guardrail: "🛡",
  infra: "⚙️",
  module: "📦",
  unknown: "◈",
};

const TECH_ICON: Record<string, string> = {
  "database": "🗄️",
  "cache": "⚡",
  "queue": "📨",
  "message-bus": "📡",
  "http-api": "🌐",
  "web-ui": "🖥️",
  "mobile-app": "📱",
  "kubernetes": "☸️",
  "container-service": "📦",
  "serverless": "⚙️",
  "object-storage": "🗂️",
  "external-saas": "☁️",
  "generic-service": "🔧",
  // additional infra / UI pictograms driven by tags
  "cdn": "🌀",
  "api-gateway": "🧭",
  "redis": "🧱",
  "mysql": "🍚",
  "user": "👤",
  "device": "💻",
  "laptop": "💻",
  "mobile": "📱",
  "unknown": "◻️",
};

const CLOUD_ICON: Record<string, string> = {
  aws: "🟧",
  gcp: "🟦",
  azure: "🟩",
  other: "☁️",
  unknown: "",
};

// Tech family colors (data / edge / compute / external / ui)
const TECH_COLOR: Record<string, string> = {
  // data
  "database": "#22c55e",
  "object-storage": "#22c55e",
  "cache": "#16a34a",
  "redis": "#ef4444",
  "mysql": "#0ea5e9",
  // edge / messaging
  "queue": "#eab308",
  "message-bus": "#eab308",
  "cdn": "#38bdf8",
  "api-gateway": "#38bdf8",
  // compute / orchestration
  "kubernetes": "#3b82f6",
  "container-service": "#a78bfa",
  "serverless": "#f97316",
  // ui / client
  "http-api": "#60a5fa",
  "web-ui": "#38bdf8",
  "mobile-app": "#f472b6",
  "user": "#f97316",
  "device": "#64748b",
  "laptop": "#64748b",
  "mobile": "#f472b6",
  // external / generic
  "external-saas": "#f97316",
  "generic-service": "#e5e7eb",
  "unknown": "#9ca3af",
};

// ── Custom Node ───────────────────────────────────────────────────────────────
function ArchNodeComponent({
  data,
}: NodeProps<ArchNode & { isSelected: boolean; canvasZoom?: number; density?: CanvasDensity; theme?: CanvasThemeName }>) {
  const node = data;
  const densityKey: CanvasDensity = (data as any).density ?? "standard";
  const th: CanvasThemeName = (data as any).theme ?? "dark";
  const zoom = (data as any).canvasZoom ?? 1;
  const isVirtual = (node as any).isVirtual === true;
  const isVirtualError = (node as any).isVirtualError === true;
  const cfg =
    LAYER_CFG[(node.layer ?? "Uncategorized") as string] ??
    LAYER_CFG["Uncategorized"];
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
  const linkedJiraIssues = (node as any).linkedJiraIssues as
    | Array<{ key: string; summary: string; baseUrl: string }>
    | undefined;
  const linkedCount = linkedJiraIssues?.length ?? 0;
  const hasCritical = vs?.highestSeverity === "critical";
  const hasHigh = vs?.highestSeverity === "high";
  const hasMedium = vs?.highestSeverity === "medium";
  const hasViolation = !!vs?.violations?.length;
  const primaryJiraKey = vs?.violations.find((v) => v.jiraKey)?.jiraKey;
  const vKey = (v: { type: string; sourceNodeId: string; targetNodeId?: string }) =>
    `${v.type}:${v.sourceNodeId}:${v.targetNodeId ?? ""}`;
  const violationBeingFixedKey = (node as any).violationBeingFixedKey as string | undefined;
  const isFixing =
    !!violationBeingFixedKey &&
    vs?.violations?.some((v) => vKey(v) === violationBeingFixedKey);

  const kind = (node.kind ?? "unknown") as string;
  const kindIcon = KIND_ICON[kind] ?? KIND_ICON.unknown;
  const techKind = ((node as any).techKind ?? "unknown") as string;
  const tags = Array.isArray(node.tags) ? node.tags : [];
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  let iconKey = techKind as string;
  if (iconKey === "generic-service" || iconKey === "unknown") {
    if (tagSet.has("redis")) iconKey = "redis";
    else if (tagSet.has("mysql")) iconKey = "mysql";
    else if (tagSet.has("cdn")) iconKey = "cdn";
    else if (tagSet.has("gateway") || tagSet.has("api-gateway")) iconKey = "api-gateway";
    else if (tagSet.has("user")) iconKey = "user";
    else if (tagSet.has("mobile")) iconKey = "mobile";
  }
  const techIcon = TECH_ICON[iconKey] ?? TECH_ICON.unknown;
  const techColor = TECH_COLOR[iconKey] ?? "#9ca3af";
  const cloudProvider = ((node as any).cloudProvider ?? "unknown") as string;
  const cloudIcon = CLOUD_ICON[cloudProvider] ?? "";
  const toolCount = node.toolCount ?? 0;
  const hasRag = !!node.hasRAG;
  const vsSummary = vs?.highestSeverity ?? null;
  const hasTraces = node.hasTraces === true;
  const densityFactor = densityScale[densityKey];
  const zoomFactor = zoom < 0.5 ? 0.85 : zoom > 1.3 ? 1.15 : 1;
  const sizeFactor = densityFactor * zoomFactor;
  const iconSize = 18 * sizeFactor;
  const labelSize = 11 * sizeFactor;
  const showLayer = zoom >= 0.55;
  const showKindTech = zoom >= 0.65;
  const showDescription = zoom >= 0.85 && densityKey === "standard";
  const showProviderModel = zoom >= 0.8;
  const showFileCount = zoom >= 0.75;
  const showHealth = zoom >= 0.8;
  const showTags = zoom >= 0.85;
  const fileCount =
    (node.semanticSignals?.fileCount as number | undefined) ??
    (Array.isArray(node.files) ? node.files.length : 0);
  const sizeBucket =
    fileCount === 0
      ? "empty"
      : fileCount <= 2
        ? "tiny"
        : fileCount <= 5
          ? "small"
          : fileCount <= 10
            ? "medium"
            : "large";

  return (
    <div style={{ width: NODE_W, minWidth: 0, position: "relative" }}>
      {node.isSelected && (
        <div
          style={{
            position: "absolute",
            inset: -12,
            borderRadius: 16,
            background: cfg.glow,
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
          background: isFixing ? "#1f6feb" : statusColor,
          borderRadius: 2,
          zIndex: 2,
          boxShadow: isFixing
            ? "0 0 10px 3px rgba(31,111,235,0.7)"
            : isPulsing
              ? `0 0 10px 3px ${statusColor}99`
              : `0 0 5px 1px ${statusColor}66`,
          animation: isFixing ? "fixPulse 2s ease infinite" : isPulsing ? "pip 2s ease infinite" : undefined,
        }}
        title={isFixing ? "Fixing violation…" : undefined}
      />

      <div
        style={{
          height: 3 * densityFactor,
          position: "relative",
          zIndex: 1,
          background: isVirtual
            ? isVirtualError
              ? `repeating-linear-gradient(90deg,#f8514966 0,#f8514966 8px,transparent 8px,transparent 16px)`
              : `repeating-linear-gradient(90deg,#a78bfa66 0,#a78bfa66 8px,transparent 8px,transparent 16px)`
            : `linear-gradient(90deg, ${cfg.accent}88, ${cfg.color}, ${cfg.accent}88)`,
          borderRadius: "8px 8px 0 0",
        }}
      />

      <div
        style={{
          background: node.isDrift
            ? "linear-gradient(150deg,#1a0606,#150c0c)"
            : `linear-gradient(150deg,${cfg.dim},#0c1220)`,
          borderTop: "none",
          borderRight: isVirtual
            ? isVirtualError
              ? "2px dashed #f85149"
              : "2px dashed #a78bfa88"
            : hasCritical
              ? "2px solid #f85149"
              : hasHigh
                ? "2px solid #f97316"
                : hasMedium
                  ? "1px dashed #eab308"
                  : `1px solid ${
                      node.isSelected
                        ? cfg.color
                        : node.isDrift
                          ? "#ef4444"
                          : `${cfg.accent}88`
                    }`,
          borderBottom: isVirtual
            ? isVirtualError
              ? "2px dashed #f85149"
              : "2px dashed #a78bfa88"
            : hasCritical
              ? "2px solid #f85149"
              : hasHigh
                ? "2px solid #f97316"
                : hasMedium
                  ? "1px dashed #eab308"
                  : `1px solid ${
                      node.isSelected
                        ? cfg.color
                        : node.isDrift
                          ? "#ef4444"
                          : `${cfg.accent}88`
                    }`,
          borderLeft: isVirtual
            ? isVirtualError
              ? "2px dashed #f85149"
              : "2px dashed #a78bfa88"
            : hasCritical
              ? "2px solid #f85149"
              : hasHigh
                ? "2px solid #f97316"
                : hasMedium
                  ? "1px dashed #eab308"
                  : `1px solid ${
                      node.isSelected
                        ? cfg.color
                        : node.isDrift
                          ? "#ef4444"
                          : `${cfg.accent}88`
                    }`,
          borderRadius: "0 0 8px 8px",
          padding: `${8 * densityFactor}px 12px ${12 * densityFactor}px`,
          position: "relative",
          zIndex: 1,
          boxShadow: node.isDrift
            ? "0 4px 0 #ef444433, 0 7px 0 #ef444418, 0 10px 0 #ef44440a, 0 16px 28px rgba(0,0,0,0.6), 0 0 0 1px #ef4444"
            : isVirtual
              ? isVirtualError
                ? "0 4px 0 #f8514933, 0 8px 20px rgba(0,0,0,0.4)"
                : "0 4px 0 #a78bfa33, 0 8px 20px rgba(0,0,0,0.4)"
              : [
                `0 4px 0 ${cfg.accent}33`,
                `0 7px 0 ${cfg.accent}18`,
                `0 10px 0 ${cfg.accent}0a`,
                `0 16px 28px rgba(0,0,0,0.6)`,
                hasCritical ? "0 0 16px rgba(248,81,73,0.45)" : "",
              ]
                .filter(Boolean)
                .join(", "),
          animation: node.isDrift ? "driftGlow 2s ease infinite" : undefined,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <div
            style={{
              width: Math.round(28 * sizeFactor),
              height: Math.round(28 * sizeFactor),
              borderRadius: 8,
              background: "#020617",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 0 1px ${techColor}33`,
            }}
          >
            <span
              style={{
                fontSize: iconSize,
                lineHeight: 1,
              }}
              title={techKind}
            >
              {techIcon}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, minWidth: 0 }}>
            <span
              style={{
                fontSize: labelSize,
                fontWeight: 600,
                color: "#e2e8f0",
                fontFamily: "'JetBrains Mono','Fira Code',monospace",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={label}
            >
              {label}
            </span>
            {showLayer && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, maxWidth: NODE_W - 60 }}>
              <span
                style={{
                  fontSize: 7 * sizeFactor,
                  color: cfg.color,
                  fontFamily: "monospace",
                  letterSpacing: "0.08em",
                  opacity: 0.9,
                  textTransform: "uppercase",
                }}
              >
                {node.layer ?? "Uncategorized"}
              </span>
              {cloudIcon && (
                <span style={{ fontSize: 9, lineHeight: 1, opacity: 0.7 }} title={cloudProvider}>
                  {cloudIcon}
                </span>
              )}
            </div>
            )}
            {showKindTech && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: NODE_W - 60 }}>
              <span
                style={{
                  fontSize: 8 * sizeFactor,
                  color: "#94a3b8",
                  fontFamily: "monospace",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={`${kind} · ${techKind}`}
              >
                {kind} · {techKind}
              </span>
            </div>
            )}
          </div>
        </div>

        {showProviderModel && (node.llmProvider || node.modelVersion) && (
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

        {showDescription && node.description && (
          <div
            style={{
              fontSize: 9 * sizeFactor,
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

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            marginTop: 6 * densityFactor,
          }}
        >
          {vs && vs.violations?.length > 0 && (
            <span
              style={{
                fontSize: 7,
                color: canvasTheme[th].badgeViolation,
                background: "rgba(239,68,68,0.22)",
                padding: "2px 4px",
                borderRadius: 3,
                fontFamily: "monospace",
              }}
              title={`Violations: ${vs.violations.length}${
                vsSummary ? ` (highest: ${vsSummary})` : ""
              }`}
            >
              V{vs.violations.length}
            </span>
          )}
          {hasTraces && (
            <span
              style={{
                fontSize: 7,
                color: canvasTheme[th].badgeTrace,
                background: `${canvasTheme[th].badgeTrace}2e`,
                padding: "2px 4px",
                borderRadius: 3,
                fontFamily: "monospace",
              }}
              title="This node has traces recorded"
            >
              TR
            </span>
          )}
          {linkedCount > 0 && (
            <span
              style={{
                fontSize: 7,
                color: canvasTheme[th].badgeJira,
                background: `${canvasTheme[th].badgeJira}29`,
                padding: "2px 4px",
                borderRadius: 3,
                fontFamily: "monospace",
              }}
              title={
                primaryJiraKey
                  ? `Primary Jira: ${primaryJiraKey} (${linkedCount} linked)`
                  : `${linkedCount} linked Jira issue${linkedCount !== 1 ? "s" : ""}`
              }
            >
              J{linkedCount > 1 ? linkedCount : ""}
            </span>
          )}
          {node.isDrift && (
            <span
              style={{
                fontSize: 7,
                color: canvasTheme[th].badgeDrift,
                background: `${canvasTheme[th].badgeDrift}26`,
                padding: "2px 4px",
                borderRadius: 3,
                fontFamily: "monospace",
              }}
              title={node.driftReason ?? "Architecture drift"}
            >
              D
            </span>
          )}
          {depth >= 0 && (
            <span
              style={{
                fontSize: 7,
                color: cfg.color,
                background: cfg.bg,
                padding: "2px 4px",
                borderRadius: 3,
                fontFamily: "monospace",
              }}
              title={`Depth: ${depth} hops from entry point`}
            >
              d{depth}
            </span>
          )}
        </div>

        {showFileCount && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
          <span
            style={{
              fontSize: 8,
              color: "#334155",
              fontFamily: "monospace",
            }}
            title={`Approximate size bucket based on file count`}
          >
            {fileCount} files · {sizeBucket}
          </span>
        </div>
        )}

        {showHealth && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 5,
          }}
        >
          {[
            { label: "docs", ok: node.health?.hasDocs ?? false },
            { label: "tests", ok: node.health?.hasTests ?? false },
            { label: "ctx", ok: node.health?.hasContext ?? false },
          ].map(({ label: l, ok }) => (
            <div
              key={l}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
              }}
              title={l}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: ok ? "#22c55e" : "#1e2d45",
                  boxShadow: ok ? "0 0 4px #22c55e88" : "none",
                }}
              />
              <span
                style={{
                  fontSize: 7,
                  color: ok ? "#22c55e" : "#475569",
                  fontFamily: "monospace",
                }}
              >
                {l}
              </span>
            </div>
          ))}
        </div>
        )}

        {showTags && tags.length > 0 && (
          <div
            style={{
              marginTop: 5,
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              maxHeight: 32,
              overflow: "hidden",
            }}
          >
            {tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 7,
                  color: "#c4d4ff",
                  background: "rgba(15,23,42,0.9)",
                  padding: "2px 4px",
                  borderRadius: 4,
                  fontFamily: "monospace",
                }}
                title={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

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

        {/* Micro-badges only: V, TR, J, D, d — semantics in legend */}

        <div
          style={{
            position: "absolute",
            right: -5,
            top: 3,
            bottom: -7,
            width: 5,
            background: `linear-gradient(180deg,${cfg.accent}55,transparent)`,
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
            background: `linear-gradient(180deg,${cfg.accent}33,transparent)`,
            borderRadius: "0 0 4px 4px",
            transform: "scaleX(0.96)",
          }}
        />
      </div>

      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: cfg.color,
          width: 10,
          height: 10,
          border: `2px solid ${cfg.dim}`,
          top: 0,
          zIndex: 10,
          boxShadow: "0 0 0 2px rgba(0,0,0,0.3)",
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: cfg.color,
          width: 10,
          height: 10,
          border: `2px solid ${cfg.dim}`,
          bottom: -14,
          zIndex: 10,
          boxShadow: "0 0 0 2px rgba(0,0,0,0.3)",
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: cfg.color,
          width: 8,
          height: 8,
          border: `2px solid ${cfg.dim}`,
          right: -4,
          zIndex: 10,
          boxShadow: "0 0 0 2px rgba(0,0,0,0.3)",
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: cfg.color,
          width: 8,
          height: 8,
          border: `2px solid ${cfg.dim}`,
          left: -4,
          zIndex: 10,
          boxShadow: "0 0 0 2px rgba(0,0,0,0.3)",
        }}
      />
    </div>
  );
}

// ── Custom Edge ───────────────────────────────────────────────────────────────
const EDGE_PALETTE = {
  drift: { stroke: "#ef4444", glow: "rgba(239,68,68,0.4)" },
  violation: { stroke: "#f59e0b", glow: "rgba(245,158,11,0.35)" },
  trace: { stroke: "#c084fc", glow: "rgba(192,132,252,0.25)" },
  architectural: { stroke: "#60a5fa", glow: "rgba(96,165,250,0.2)" },
  utility: { stroke: "#94a3b8", glow: "rgba(148,163,184,0.1)" },
};

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
  const sourceLayer = (data as any)?.sourceLayer as string | undefined;
  const layerCfg = sourceLayer && LAYER_CFG[sourceLayer] ? LAYER_CFG[sourceLayer] : null;
  const isArchitectural = importance === "architectural" || isDrift || isLayerViolation;

  const stroke = isDrift
    ? EDGE_PALETTE.drift.stroke
    : isLayerViolation
      ? EDGE_PALETTE.violation.stroke
      : inTrace
        ? EDGE_PALETTE.trace.stroke
        : isArchitectural
          ? layerCfg?.accent ?? EDGE_PALETTE.architectural.stroke
          : EDGE_PALETTE.utility.stroke;
  const glow = isDrift
    ? EDGE_PALETTE.drift.glow
    : isLayerViolation
      ? EDGE_PALETTE.violation.glow
      : inTrace
        ? EDGE_PALETTE.trace.glow
        : isArchitectural
          ? layerCfg ? `${layerCfg.color}33` : EDGE_PALETTE.architectural.glow
          : EDGE_PALETTE.utility.glow;
  const strokeOpacity = isArchitectural || inTrace ? 1 : 0.55;

  const violationStrokeDash = "2 4";
  const driftStrokeDash = "6 3";

  return (
    <g className={isDrift ? "arch-edge-drift" : undefined}>
      <path
        d={path}
        fill="none"
        stroke={glow}
        strokeWidth={isDrift ? 10 : isLayerViolation ? 8 : inTrace ? 7 : isArchitectural ? 6 : 4}
        strokeLinecap="round"
      />
      <path
        id={id}
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={isDrift ? 2.5 : inTrace ? 2 : isArchitectural ? 1.5 : 1}
        strokeOpacity={strokeOpacity}
        strokeDasharray={
          isDrift ? driftStrokeDash : isLayerViolation ? violationStrokeDash : undefined
        }
        strokeLinecap={isLayerViolation ? "round" : "butt"}
        markerEnd={`url(#arrowhead-${isDrift ? "drift" : isLayerViolation ? "violation" : "normal"})`}
      />
      {isDrift && (
        <circle r={3.5} fill="#ef4444" className="arch-edge-drift-dot">
          <animateMotion dur="1.8s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      {isLayerViolation && !isDrift && (
        <circle r={2} fill="#f59e0b" opacity={0.95} className="arch-edge-violation-dot">
          <animateMotion dur="2.5s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      {!isDrift && !isLayerViolation && inTrace && (
        <circle r={2.5} fill="#c084fc" opacity={0.95} className="arch-edge-trace-dot">
          <animateMotion dur="1.5s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      {!isDrift && !isLayerViolation && !inTrace && (
        <circle r={1.5} fill="#60a5fa" opacity={0.5}>
          <animateMotion dur="4s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </g>
  );
}

function LayerBandComponent({
  data,
}: NodeProps<{ layer: string; colors: { top: string; accent: string; dim: string }; nodeCount?: number }>) {
  const { layer, colors, nodeCount = 0 } = data;
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: `linear-gradient(180deg, ${colors.top}0c 0%, ${colors.top}04 40%, transparent 100%)`,
        borderTop: `1px solid ${colors.accent}33`,
        borderBottom: `1px solid ${colors.accent}18`,
        borderLeft: `1px solid ${colors.accent}18`,
        borderRight: `1px solid ${colors.accent}18`,
        borderRadius: 8,
        pointerEvents: "none",
        boxShadow: `inset 4px 0 0 ${colors.accent}55`,
      }}
      title={`${layer} (${nodeCount} node${nodeCount !== 1 ? "s" : ""})`}
    >
      <div
        style={{
          position: "absolute",
          top: 6,
          left: 14,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: colors.top,
            opacity: 0.85,
            textShadow: "0 0 2px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.6)",
            fontFamily: "monospace",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          {layer}
        </span>
        {nodeCount > 0 && (
          <span
            style={{
              fontSize: 10,
              color: colors.top,
              opacity: 0.6,
              fontFamily: "monospace",
            }}
          >
            {nodeCount}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Annotation sticky note (2D) ────────────────────────────────────────────────
function AnnotationStickyComponent({ data }: NodeProps) {
  const ann = data as unknown as WorkspaceAnnotation & { onDelete?: (id: string) => void };
  const typeColor =
    ann.type === "note"
      ? "#fef08a"
      : ann.type === "highlight"
        ? "#bbf7d0"
        : "#bfdbfe";
  return (
    <div
      style={{
        minWidth: 140,
        maxWidth: 220,
        padding: "6px 8px",
        background: typeColor,
        color: "#0f172a",
        borderRadius: 4,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        fontFamily: "monospace",
        fontSize: 10,
        lineHeight: 1.35,
        transform: "rotate(-1deg)",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
        <span style={{ fontWeight: 600, textTransform: "uppercase", fontSize: 9 }}>{ann.type}</span>
        {ann.onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ann.onDelete?.(ann.id);
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontSize: 12,
              lineHeight: 1,
              opacity: 0.6,
            }}
            title="Delete"
          >
            ×
          </button>
        )}
      </div>
      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 2 }}>
        {ann.content || "(empty)"}
      </div>
    </div>
  );
}

const nodeTypes = { arch: ArchNodeComponent, band: LayerBandComponent, annotation: AnnotationStickyComponent };
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
  /** For NodePopup Traces/Eval tabs. */
  workspaceId?: string | null;
  accessToken?: string | null;
  /** Violation key being fixed (Fix Now in progress). Badge shows "fixing" state. */
  violationBeingFixedKey?: string | null;
  /** Jira issues linked to nodes via archNodeId label. Map nodeId -> issues for node badges. */
  issuesByNodeId?: Record<string, Array<{ key: string; summary: string; baseUrl: string }>>;
  /** Visual theme for the canvas. */
  theme?: CanvasThemeName;
  /** Visual density for cards. */
  density?: CanvasDensity;
  /** Annotations pinned to nodes/zones/canvas. */
  annotations?: WorkspaceAnnotation[];
  /** Called after annotation create/update/delete to refetch. */
  onAnnotationsChange?: () => Promise<void>;
  /** When user clicks "Explain this area" in focus mode, called with prompt to pre-fill chat. */
  onExplainArea?: (prompt: string) => void;
  /** Presentation mode: hide most controls, step through scenes. */
  presentationMode?: boolean;
  onPresentationModeChange?: (value: boolean) => void;
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
  workspaceId,
  accessToken,
  violationBeingFixedKey,
  issuesByNodeId = {},
  theme = "dark",
  density = "standard",
  annotations = [],
  onAnnotationsChange,
  onExplainArea,
  presentationMode = false,
  onPresentationModeChange,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [building, setBuilding] = useState(true);
  const [legendHighlight, setLegendHighlight] = useState<LegendHighlight>(null);
  const [tracePathNodeIds, setTracePathNodeIds] = useState<string[] | null>(null);
  const reactFlowInstanceRef = useRef<{ fitView: (opts?: { padding?: number }) => void } | null>(null);
  const prevGraphKeyRef = useRef<string>("");
  const legendHighlightRef = useRef<LegendHighlight>(null);
  legendHighlightRef.current = legendHighlight;
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [focusMode, setFocusMode] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [fps2d, setFps2d] = useState(0);

  useEffect(() => {
    if (!isFlagEnabled("perf_hud")) return;
    let frames = 0;
    let last = performance.now();
    let raf = window.requestAnimationFrame(function loop() {
      const now = performance.now();
      frames += 1;
      if (now - last >= 1000) {
        setFps2d(frames);
        frames = 0;
        last = now;
      }
      raf = window.requestAnimationFrame(loop);
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const handleDeleteAnnotation = useCallback(
    async (id: string) => {
      if (!workspaceId || !accessToken || !onAnnotationsChange) return;
      try {
        const API_BASE = "/api";
        await fetch(`${API_BASE}/workspaces/${workspaceId}/annotations/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        await onAnnotationsChange();
      } catch {
        // ignore
      }
    },
    [workspaceId, accessToken, onAnnotationsChange]
  );

  const handleAddAnnotation = useCallback(
    async (anchor: { nodeId?: string; layer?: string; canvasX?: number; canvasY?: number }, type: "note" | "highlight" | "question") => {
      if (!workspaceId || !accessToken || !onAnnotationsChange) return;
      const content = prompt("Annotation content:");
      if (content == null) return;
      try {
        const API_BASE = "/api";
        const body: Record<string, unknown> = { type, content };
        if (anchor.nodeId) body.node_id = anchor.nodeId;
        else if (anchor.layer) body.layer = anchor.layer;
        else if (typeof anchor.canvasX === "number" && typeof anchor.canvasY === "number") {
          body.canvas_x = anchor.canvasX;
          body.canvas_y = anchor.canvasY;
        } else return;
        await fetch(`${API_BASE}/workspaces/${workspaceId}/annotations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(body),
        });
        await onAnnotationsChange();
      } catch {
        // ignore
      }
    },
    [workspaceId, accessToken, onAnnotationsChange]
  );

  useEffect(() => {
    const total = graph.nodes.length + (proposedNodes?.length ?? 0);
    if (total > 0 && reactFlowInstanceRef.current) {
      reactFlowInstanceRef.current.fitView({ padding: 0.12 });
    }
  }, [graph.nodes.length, graph.generatedAt, proposedNodes?.length]);

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

  function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
    let t: number | undefined;
    return ((...args: any[]) => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => fn(...args), delay);
    }) as T;
  }

  const rawBuild = useCallback(() => {
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
      if (!hl && !focusMode) return true;
      const inFocus =
        focusMode && selectedNode
          ? (() => {
              if (node.id === selectedNode) return true;
              return graph.edges.some(
                (e) => (e.source === selectedNode && e.target === node.id) || (e.target === selectedNode && e.source === node.id)
              );
            })()
          : true;
      if (!hl) return inFocus;
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
      if (!hl && !focusMode) return true;
      const inFocus =
        focusMode && selectedNode
          ? edge.source === selectedNode || edge.target === selectedNode
          : true;
      if (!hl) return inFocus;
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

    // External dependencies lane: shift External Services band and nodes to the far right.
    const externalLayer = "External Services";
    const externalIds = graph.nodes
      .filter((n) => (n.layer ?? "Uncategorized") === externalLayer)
      .map((n) => n.id);
    if (externalIds.length > 0) {
      let maxNonExternalX = -Infinity;
      let minExternalX = Infinity;
      nodePositions.forEach((pos, id) => {
        if (!pos) return;
        if (externalIds.includes(id)) {
          if (pos.x < minExternalX) minExternalX = pos.x;
        } else {
          if (pos.x > maxNonExternalX) maxNonExternalX = pos.x;
        }
      });
      if (maxNonExternalX > -Infinity && minExternalX < Infinity) {
        const offset = maxNonExternalX + 260 - minExternalX;
        externalIds.forEach((id) => {
          const pos = nodePositions.get(id);
          if (pos) nodePositions.set(id, { ...pos, x: pos.x + offset });
        });
        for (const band of layerBands) {
          if (band.layer === externalLayer) {
            band.x += offset;
          }
        }
      }
    }

    const bandNodes: Node[] = layerBands.map((band) => {
      const colors =
        LAYER_COLORS[band.layer] ?? LAYER_COLORS["Uncategorized"];
      const nodeCount = graph.nodes.filter(
        (n) => (n.layer ?? "Uncategorized") === band.layer
      ).length;
      return {
        id: band.id,
        type: "band",
        position: { x: band.x, y: band.y },
        data: { layer: band.layer, colors, nodeCount },
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

    const annotationNodes: Node[] = !isFlagEnabled("annotations")
      ? []
      : (annotations ?? []).map((ann) => {
      let position = { x: 0, y: 0 };
      if (ann.node_id) {
        const pos = nodePositions.get(ann.node_id);
        position = pos ? { x: pos.x + NODE_W + 12, y: pos.y - 16 } : { x: 0, y: 0 };
      } else if (ann.layer) {
        const band = layerBands.find((b) => b.layer === ann.layer);
        position = band ? { x: band.x + band.width / 2 - 70, y: band.y - 40 } : { x: 0, y: 0 };
      } else if (typeof ann.canvas_x === "number" && typeof ann.canvas_y === "number") {
        position = { x: ann.canvas_x, y: ann.canvas_y };
      }
      return {
        id: `annotation-${ann.id}`,
        type: "annotation",
        position,
        data: { ...ann, onDelete: workspaceId && accessToken ? handleDeleteAnnotation : undefined },
        draggable: false,
        selectable: false,
        connectable: false,
      };
      });

    const rfNodes: Node[] = [
      ...bandNodes,
      ...graph.nodes.map((node) => {
        const matches = nodeMatches(node);
        return {
          id: node.id,
          type: "arch",
          position: nodePositions.get(node.id) ?? { x: 0, y: 0 },
          data: {
            ...node,
            isSelected: selectedNode === node.id,
            canvasZoom,
            density,
            theme,
            violationBeingFixedKey: violationBeingFixedKey ?? undefined,
            linkedJiraIssues:
              issuesByNodeId[node.id] ??
              issuesByNodeId[node.path] ??
              issuesByNodeId[(node as { archNodeId?: string }).archNodeId ?? node.id] ??
              [],
          },
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
      ...annotationNodes,
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
            border: "none",
            padding: 0,
            width: NODE_W,
            opacity: 1,
            transition: "opacity 0.2s ease",
          },
        };
      }),
    ];

    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

    // Basic edge bundling: collapse multiple edges with same source/target into one
    // and store a bundleCount used to subtly increase stroke width.
    const bundleMap = new Map<
      string,
      { edge: (typeof filtered.edges)[0]; count: number }
    >();
    for (const e of filtered.edges) {
      const key = `${e.source}->${e.target}`;
      const existing = bundleMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        bundleMap.set(key, { edge: e, count: 1 });
      }
    }

    const baseEdges: Edge[] = Array.from(bundleMap.values()).map(({ edge, count }) => {
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
      const sourceLayer =
        (nodeById.get(edge.source)?.layer ?? "Uncategorized") as string;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "arch",
        data: {
          isDrift: edge.isDrift,
          importance: edge.importance,
          isLayerViolation: edge.isLayerViolation,
          driftReason: edge.driftReason,
          inTrace: !!inTrace,
          sourceLayer,
          bundleCount: count,
        },
        style: {
          opacity: hl ? (matches ? 1 : 0.2) : 1,
          strokeWidth: inTrace ? 3 : count > 3 ? 2.4 : count > 1 ? 1.8 : 1,
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
    violationBeingFixedKey,
    edgeFilter,
    tracePathNodeIds,
    proposedNodes,
    proposedEdges,
    ghostNodeStatus,
    issuesByNodeId,
    annotations,
    density,
    theme,
    handleDeleteAnnotation,
    workspaceId,
    accessToken,
    setNodes,
    setEdges,
  ]);

  const build = useMemo(() => debounce(rawBuild, 50), [rawBuild]);

  useEffect(() => {
    build();
  }, [build]);

  // When only legend highlight changes, update opacity without recomputing layout.
  useEffect(() => {
    if (!legendHighlight && !focusMode) {
      setNodes((nds) => nds.map((n) => ({ ...n, style: { ...n.style, opacity: 1 } })));
      setEdges((eds) => eds.map((e) => ({ ...e, style: { ...e.style, opacity: 1 } })));
      return;
    }
    const filtered = filterEdges(graph, edgeFilter);
    const nodeMatches = (node: ArchNode): boolean => {
      const inFocus =
        focusMode && selectedNode
          ? node.id === selectedNode ||
            graph.edges.some(
              (e) => (e.source === selectedNode && e.target === node.id) || (e.target === selectedNode && e.source === node.id)
            )
          : true;
      if (!legendHighlight) return inFocus;
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
      const inFocus =
        focusMode && selectedNode ? edge.source === selectedNode || edge.target === selectedNode : true;
      if (!legendHighlight) return inFocus;
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
        if (n.type === "band" || n.type === "annotation") return n;
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
  }, [legendHighlight, graph, edgeFilter, setNodes, setEdges, focusMode, selectedNode]);

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

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [hoveredEdgePos, setHoveredEdgePos] = useState<{ x: number; y: number } | null>(null);
  const isGreenfieldOnly = graph.nodes.length === 0 && (proposedNodes?.length ?? 0) > 0;
  const densityFactor = densityScale[density] ?? 1;
  const hoveredNodeData = useMemo(
    () => graph.nodes.find((n) => n.id === hoveredNodeId) ?? null,
    [graph.nodes, hoveredNodeId]
  );
  const hoveredEdgeData = useMemo(() => {
    if (!hoveredEdgeId) return null;
    const e = graph.edges.find((x) => x.id === hoveredEdgeId);
    if (!e) return null;
    const src = graph.nodes.find((n) => n.id === e.source);
    const tgt = graph.nodes.find((n) => n.id === e.target);
    return {
      source: e.source,
      target: e.target,
      sourceLabel: src?.suggestedLabel ?? src?.role ?? src?.label ?? e.source,
      targetLabel: tgt?.suggestedLabel ?? tgt?.role ?? tgt?.label ?? e.target,
      isDrift: e.isDrift,
      isLayerViolation: e.isLayerViolation,
      driftReason: e.driftReason,
    };
  }, [graph.edges, graph.nodes, hoveredEdgeId]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background: canvasTheme[theme].canvasBg,
      }}
    >
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
              background: "linear-gradient(150deg, #0c1220, #070d1a)",
              border: "1px solid #1d4ed866",
              borderRadius: 12,
              padding: 0,
              maxWidth: 420,
              boxShadow: [
                "0 4px 0 #1d4ed833",
                "0 8px 0 #1d4ed818",
                "0 20px 40px rgba(0,0,0,0.5)",
              ].join(", "),
              textAlign: "center",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: 4,
                background: "linear-gradient(90deg, #1d4ed888, #60a5fa, #1d4ed888)",
                borderRadius: "12px 12px 0 0",
              }}
            />
            <div style={{ padding: 24 }}>
            <div
              style={{
                marginBottom: 12,
                color: "#60a5fa",
                fontSize: 16,
                fontWeight: 700,
                fontFamily: "'JetBrains Mono','Fira Code',monospace",
              }}
            >
              Empty workspace
            </div>
            <div
              style={{
                color: "#94a3b8",
                fontSize: 13,
                lineHeight: 1.6,
                fontFamily: "monospace",
              }}
            >
              Paste a GitHub repo URL in the sidebar to scan it, or use the chat below to ask the AI to design your architecture.
            </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes nodePulse  { 0%,100%{transform:translateX(-50%) rotate(45deg) scale(1);opacity:1} 50%{transform:translateX(-50%) rotate(45deg) scale(1.35);opacity:0.6} }
        @keyframes pip        { 0%,100%{transform:translateX(-50%) rotate(45deg) scale(1);opacity:1} 50%{transform:translateX(-50%) rotate(45deg) scale(1.2);opacity:0.75} }
        @keyframes fixPulse   { 0%,100%{transform:translateX(-50%) rotate(45deg) scale(1);box-shadow:0 0 10px 3px rgba(31,111,235,0.7)} 50%{transform:translateX(-50%) rotate(45deg) scale(1.2);box-shadow:0 0 16px 4px rgba(31,111,235,0.85)} }
        @keyframes driftGlow  { 0%,100%{box-shadow:0 4px 0 #ef444433,0 7px 0 #ef444418,0 10px 0 #ef44440a,0 16px 28px rgba(0,0,0,0.6),0 0 0 1px #ef4444,0 0 24px transparent} 50%{box-shadow:0 4px 0 #ef444433,0 7px 0 #ef444418,0 10px 0 #ef44440a,0 16px 28px rgba(0,0,0,0.6),0 0 0 1px #ef4444,0 0 24px #ef444466} }
        @keyframes edgeDriftDot { 0%,100%{opacity:1;filter:drop-shadow(0 0 3px rgba(239,68,68,0.8))} 50%{opacity:0.7;filter:drop-shadow(0 0 6px rgba(239,68,68,0.9))} }
        @keyframes edgeViolationDot { 0%,100%{opacity:0.95} 50%{opacity:0.6} }
        @keyframes edgeTracePulse { 0%,100%{opacity:0.95} 50%{opacity:0.7} }
        .react-flow__edge path { pointer-events: visibleStroke !important; }
        .arch-edge-drift-dot { animation: edgeDriftDot 2s ease-in-out infinite; filter: drop-shadow(0 0 3px rgba(239,68,68,0.8)); }
        .arch-edge-violation-dot { animation: edgeViolationDot 2.5s ease-in-out infinite; }
        .arch-edge-trace-dot { animation: edgeTracePulse 1.5s ease-in-out infinite; }
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
            <path d="M 0 1 L 9 5 L 0 9 Z" fill="#60a5fa" />
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
            background: "linear-gradient(150deg, #0c1220, #070d1a)",
            border: "1px solid #1d4ed866",
            borderRadius: 10,
            padding: "8px 20px",
            color: "#60a5fa",
            fontSize: 11,
            fontFamily: "monospace",
            backdropFilter: "blur(12px)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4), 0 0 0 1px rgba(96,165,250,0.2)",
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

      {viewMode === "3d" ? (
        <Arch3DView
          graph={graph}
          proposedNodes={proposedNodes}
          selectedNode={selectedNode}
          onNodeSelect={onNodeSelect}
          legendHighlight={legendHighlight}
          tracePathNodeIds={tracePathNodeIds}
          workspaceId={workspaceId}
          accessToken={accessToken}
          annotations={annotations}
        />
      ) : (
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => {
          if (n.type === "band") return;
          onNodeSelect(n.id);
        }}
        onNodeMouseEnter={(e, n) => {
          if (n.type === "band") return;
          setHoveredNodeId(n.id);
          setHoverPos({ x: e.clientX, y: e.clientY });
        }}
        onNodeMouseMove={(e, n) => {
          if (n.type === "band") return;
          if (hoveredNodeId === n.id) {
            setHoverPos({ x: e.clientX, y: e.clientY });
          }
        }}
        onNodeMouseLeave={(_, n) => {
          if (n.id === hoveredNodeId) {
            setHoveredNodeId(null);
            setHoverPos(null);
          }
        }}
        onEdgeMouseEnter={(e, edge) => {
          setHoveredEdgeId(edge.id);
          setHoveredEdgePos({ x: e.clientX, y: e.clientY });
        }}
        onEdgeMouseMove={(e, edge) => {
          if (hoveredEdgeId === edge.id) {
            setHoveredEdgePos({ x: e.clientX, y: e.clientY });
          }
        }}
        onEdgeMouseLeave={(_, edge) => {
          if (edge.id === hoveredEdgeId) {
            setHoveredEdgeId(null);
            setHoveredEdgePos(null);
          }
        }}
        onPaneClick={() => onNodeSelect(null)}
        onMove={(_, viewport) => {
          if (typeof viewport.zoom === "number") setCanvasZoom(viewport.zoom);
        }}
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
          color={theme === "dark" ? "#1e293b" : "#94a3b8"}
          gap={24}
          size={1}
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
      )}

      {viewMode === "2d" && hoveredNodeData && hoverPos && (
        <div
          style={{
            position: "fixed",
            left: hoverPos.x + 12,
            top: hoverPos.y + 12,
            zIndex: 30,
            maxWidth: 260,
            background: "rgba(15,23,42,0.98)",
            border: "1px solid #1e293b",
            borderRadius: 8,
            padding: "8px 10px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#e2e8f0",
              fontFamily: "'JetBrains Mono','Fira Code',monospace",
              marginBottom: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {hoveredNodeData.suggestedLabel ?? hoveredNodeData.role ?? hoveredNodeData.label}
          </div>
          <div
            style={{
              fontSize: 9,
              color: "#94a3b8",
              marginBottom: 4,
              fontFamily: "monospace",
            }}
          >
            {(hoveredNodeData.layer ?? "Uncategorized") +
              " · " +
              ((hoveredNodeData as any).techKind ?? "unknown")}
          </div>
          {hoveredNodeData.description && (
            <div
              style={{
                fontSize: 9,
                color: "#cbd5f5",
                marginBottom: 4,
                fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
                lineHeight: 1.4,
              }}
            >
              {hoveredNodeData.description}
            </div>
          )}
          {(() => {
            const issues =
              issuesByNodeId[hoveredNodeData.id] ??
              issuesByNodeId[hoveredNodeData.path] ??
              issuesByNodeId[(hoveredNodeData as { archNodeId?: string }).archNodeId ?? hoveredNodeData.id] ??
              [];
            const primary = issues[0];
            return primary ? (
              <div
                style={{
                  fontSize: 9,
                  color: "#fbbf24",
                  marginBottom: 4,
                  fontFamily: "monospace",
                }}
              >
                {primary.key}: {primary.summary}
              </div>
            ) : null;
          })()}
          {Array.isArray(hoveredNodeData.files) && hoveredNodeData.files.length > 0 && (
            <div
              style={{
                fontSize: 8,
                color: "#94a3b8",
                marginBottom: 4,
                fontFamily: "monospace",
                maxHeight: 48,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {hoveredNodeData.files.slice(0, 5).map((f) => (
                <div key={f} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {f.split("/").pop() ?? f}
                </div>
              ))}
              {hoveredNodeData.files.length > 5 && (
                <div style={{ color: "#64748b" }}>+{hoveredNodeData.files.length - 5} more</div>
              )}
            </div>
          )}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
            }}
          >
            <span style={{ fontSize: 8, color: "#64748b", fontFamily: "monospace" }}>
              {hoveredNodeData.files.length} files
            </span>
            {Array.isArray(hoveredNodeData.tags) &&
              hoveredNodeData.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 8,
                    color: "#c4d4ff",
                    background: "rgba(30,64,175,0.6)",
                    padding: "1px 4px",
                    borderRadius: 4,
                    fontFamily: "monospace",
                  }}
                >
                  {t}
                </span>
              ))}
          </div>
        </div>
      )}

      {viewMode === "2d" && hoveredEdgeData && hoveredEdgePos && (
        <div
          style={{
            position: "fixed",
            left: hoveredEdgePos.x + 12,
            top: hoveredEdgePos.y + 12,
            zIndex: 30,
            maxWidth: 280,
            background: "rgba(15,23,42,0.98)",
            border: "1px solid #1e293b",
            borderRadius: 8,
            padding: "8px 10px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#e2e8f0",
              fontFamily: "'JetBrains Mono','Fira Code',monospace",
              marginBottom: 2,
            }}
          >
            {hoveredEdgeData.sourceLabel} → {hoveredEdgeData.targetLabel}
          </div>
          {hoveredEdgeData.isDrift && (
            <div
              style={{
                fontSize: 9,
                color: "#f87171",
                fontFamily: "monospace",
              }}
            >
              Drift: {hoveredEdgeData.driftReason ?? "architecture drift"}
            </div>
          )}
          {hoveredEdgeData.isLayerViolation && !hoveredEdgeData.isDrift && (
            <div
              style={{
                fontSize: 9,
                color: "#fbbf24",
                fontFamily: "monospace",
              }}
            >
              Layer violation
            </div>
          )}
        </div>
      )}

      {/* Reserved HUD slot (bottom-right) – perf/runtime overlays, disabled by default */}
      {!presentationMode && (
        <div
          data-hud-slot
          style={{
            position: "absolute",
            bottom: 12,
            right: 16,
            minWidth: 60,
            minHeight: 24,
            zIndex: 8,
            pointerEvents: "none",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-end",
          }}
        >
          {isFlagEnabled("perf_hud") && (
            <div
              style={{
                fontSize: 10,
                padding: "4px 6px",
                background: "rgba(15,23,42,0.9)",
                borderRadius: 4,
                border: "1px solid #1e293b",
                fontFamily: "monospace",
                color: "#e5e7eb",
              }}
            >
              2D · {graph.nodes.length} nodes · {edges.length} edges · {fps2d} fps
            </div>
          )}
        </div>
      )}

      {!presentationMode && (
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          zIndex: 20,
          display: "flex",
          gap: 4,
          background: "rgba(6,12,26,0.92)",
          border: "1px solid #1e2d45",
          borderRadius: 8,
          padding: 4,
          backdropFilter: "blur(12px)",
        }}
      >
        <button
          type="button"
          title="2D view"
          onClick={() => setViewMode("2d")}
          style={{
            padding: "6px 12px",
            fontSize: 11,
            fontFamily: "monospace",
            border: viewMode === "2d" ? "1px solid #60a5fa" : "1px solid transparent",
            borderRadius: 6,
            background: viewMode === "2d" ? "#1d4ed833" : "transparent",
            color: viewMode === "2d" ? "#60a5fa" : "#94a3b8",
            cursor: "pointer",
          }}
        >
          2D
        </button>
        <button
          type="button"
          title="3D view"
          onClick={() => setViewMode("3d")}
          style={{
            padding: "6px 12px",
            fontSize: 11,
            fontFamily: "monospace",
            border: viewMode === "3d" ? "1px solid #60a5fa" : "1px solid transparent",
            borderRadius: 6,
            background: viewMode === "3d" ? "#1d4ed833" : "transparent",
            color: viewMode === "3d" ? "#60a5fa" : "#94a3b8",
            cursor: "pointer",
          }}
        >
          3D
        </button>
      </div>
      )}

      {!presentationMode && (
      <div
        style={{
          position: "absolute",
          top: 96,
          left: 16,
          zIndex: 10,
          background: canvasTheme[theme].panelBg,
          border: `1px solid ${canvasTheme[theme].panelBorder}`,
          borderRadius: 10,
          padding: "12px 14px",
          backdropFilter: "blur(12px)",
          minWidth: 180,
          maxWidth: 220,
          maxHeight: "calc(100vh - 180px)",
          overflowY: "auto",
          overflowX: "hidden",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            fontSize: 9,
              color: canvasTheme[theme].subtleText,
            marginBottom: 10,
            lineHeight: 1.4,
            fontFamily: "monospace",
          }}
          title="Click any item to highlight it on the graph. Click again to clear."
        >
          Click to highlight
        </div>

        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              fontSize: 8,
              color: canvasTheme[theme].legendSectionTitleText,
              letterSpacing: "0.1em",
              marginBottom: 6,
              textTransform: "uppercase",
              fontFamily: "monospace",
            }}
          >
            Layers
          </div>
          {legendLayers.map(([name, count]) => {
            const cfg = LAYER_CFG[name] ?? LAYER_CFG["Uncategorized"];
            const active = legendHighlight?.type === "layer" && legendHighlight.layer === name;
            return (
              <div
                key={name}
                onClick={() => setLegendHighlight(active ? null : { type: "layer", layer: name })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  marginBottom: 2,
                  borderRadius: 6,
                  cursor: "pointer",
                  background: active ? `${cfg.accent}28` : "transparent",
                  border: active ? `1px solid ${cfg.accent}66` : "1px solid transparent",
                  transition: "background 0.15s, border 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = `${cfg.accent}14`;
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 1,
                    background: cfg.color,
                    transform: "rotate(45deg)",
                    flexShrink: 0,
                    boxShadow: active ? `0 0 6px ${cfg.glow}` : undefined,
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    color: canvasTheme[theme].panelText,
                    flex: 1,
                    fontFamily: "'JetBrains Mono','Fira Code',monospace",
                  }}
                >
                  {name}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    color: canvasTheme[theme].subtleText,
                    fontFamily: "monospace",
                  }}
                >
                  {count}
                </span>
              </div>
            );
          })}
        </div>

        <div
          style={{
            borderTop: `1px solid ${canvasTheme[theme].legendDivider}`,
            marginTop: 8,
            paddingTop: 8,
          }}
        >
          <div
            style={{
              fontSize: 8,
              color: canvasTheme[theme].legendSectionTitleText,
              letterSpacing: "0.1em",
              marginBottom: 6,
              textTransform: "uppercase",
              fontFamily: "monospace",
            }}
          >
            Tech families
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              fontSize: 9,
              color: canvasTheme[theme].subtleText,
              fontFamily: "monospace",
            }}
          >
            {[
              { key: "database", label: "DB" },
              { key: "cache", label: "Cache" },
              { key: "queue", label: "Queue" },
              { key: "http-api", label: "API" },
              { key: "web-ui", label: "UI" },
              { key: "kubernetes", label: "K8s" },
              { key: "external-saas", label: "SaaS" },
            ].map(({ key, label }) => (
              <span key={key} style={{ display: "flex", alignItems: "center", gap: 3 }} title={key}>
                <span style={{ fontSize: 12, lineHeight: 1 }}>{TECH_ICON[key] ?? "◻"}</span>
                <span>{label}</span>
              </span>
            ))}
          </div>
        </div>

        <div
          style={{
            borderTop: `1px solid ${canvasTheme[theme].legendDivider}`,
            marginTop: 8,
            paddingTop: 8,
          }}
        >
          <div
            style={{
              fontSize: 8,
              color: canvasTheme[theme].legendSectionTitleText,
              letterSpacing: "0.1em",
              marginBottom: 6,
              textTransform: "uppercase",
              fontFamily: "monospace",
            }}
          >
            Node badges
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              fontSize: 9,
              color: canvasTheme[theme].subtleText,
              fontFamily: "monospace",
            }}
          >
            <span style={{ color: canvasTheme[theme].badgeViolation }} title="Violations count">V</span>
            <span style={{ color: canvasTheme[theme].badgeTrace }} title="Traces">TR</span>
            <span style={{ color: canvasTheme[theme].badgeJira }} title="Jira linked">J</span>
            <span style={{ color: canvasTheme[theme].badgeDrift }} title="Drift">D</span>
            <span title="Depth from entry">d</span>
          </div>
        </div>

        <div
          style={{
            borderTop: `1px solid ${canvasTheme[theme].legendDivider}`,
            marginTop: 8,
            paddingTop: 8,
          }}
        >
          <div
            style={{
              fontSize: 8,
              color: canvasTheme[theme].legendSectionTitleText,
              letterSpacing: "0.1em",
              marginBottom: 6,
              textTransform: "uppercase",
              fontFamily: "monospace",
            }}
          >
            By type
          </div>
          {(
            [
              { id: "ok" as const, label: "Imports", color: canvasTheme[theme].legendImport, dashed: false },
              { id: "violation" as const, label: "Layer violation", color: canvasTheme[theme].legendViolation, dashed: true },
              { id: "drift" as const, label: "Drift", color: canvasTheme[theme].legendDrift, dashed: true },
            ] as const
          ).map(({ id, label, color, dashed }) => {
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
                  padding: "6px 8px",
                  marginBottom: 2,
                  borderRadius: 6,
                  cursor: "pointer",
                  background: isActive ? `${color}28` : "transparent",
                  border: isActive ? `1px solid ${color}66` : "1px solid transparent",
                  transition: "background 0.15s, border 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = `${color}14`;
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <div
                  style={{
                    width: 20,
                    height: 2,
                    flexShrink: 0,
                    background: dashed ? `repeating-linear-gradient(90deg, ${color} 0, ${color} 4px, transparent 4px, transparent 8px)` : color,
                    borderRadius: 1,
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    color: canvasTheme[theme].panelText,
                    fontFamily: "'JetBrains Mono','Fira Code',monospace",
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
        <div
          style={{
            borderTop: `1px solid ${canvasTheme[theme].legendDivider}`,
            marginTop: 8,
            paddingTop: 8,
          }}
        >
          <div
            style={{
              fontSize: 8,
              color: canvasTheme[theme].legendSectionTitleText,
              letterSpacing: "0.1em",
              marginBottom: 6,
              textTransform: "uppercase",
              fontFamily: "monospace",
            }}
          >
            Focus
          </div>
          <button
            type="button"
            onClick={() => setFocusMode((prev) => !prev)}
            style={{
              padding: "6px 8px",
              fontSize: 10,
              fontFamily: "monospace",
              borderRadius: 6,
              border: focusMode ? `1px solid ${canvasTheme[theme].legendFocus}` : "1px solid transparent",
              background: focusMode ? `${canvasTheme[theme].legendFocus}28` : "transparent",
              color: focusMode ? canvasTheme[theme].legendFocus : canvasTheme[theme].subtleText,
              cursor: "pointer",
              width: "100%",
              textAlign: "left",
            }}
            title="Focus on selected node and its neighbors"
          >
            {focusMode ? "Focused on selection" : "Focus on selection"}
          </button>
          {focusMode && selectedNode && onExplainArea && (
            <button
              type="button"
              onClick={() =>
                onExplainArea(
                  `Explain the architecture in this area, focusing on the selected node "${selectedNodeData?.suggestedLabel ?? selectedNodeData?.label ?? selectedNode}" and its neighbors.`
                )
              }
              style={{
                padding: "6px 8px",
                fontSize: 10,
                fontFamily: "monospace",
                borderRadius: 6,
                border: `1px solid ${canvasTheme[theme].legendFocus}`,
                background: `${canvasTheme[theme].legendFocus}20`,
                color: canvasTheme[theme].legendFocus,
                cursor: "pointer",
                width: "100%",
                textAlign: "left",
                marginTop: 4,
              }}
              title="Pre-fill chat with explain prompt"
            >
              Explain this area
            </button>
          )}
        </div>
        {workspaceId && accessToken && onAnnotationsChange && (
          <div
            style={{
              borderTop: `1px solid ${canvasTheme[theme].legendDivider}`,
              marginTop: 8,
              paddingTop: 8,
            }}
          >
            <div
              style={{
                fontSize: 8,
                color: canvasTheme[theme].legendSectionTitleText,
                letterSpacing: "0.1em",
                marginBottom: 6,
                textTransform: "uppercase",
                fontFamily: "monospace",
              }}
            >
              Annotations
            </div>
            <button
              type="button"
              onClick={() =>
                selectedNode
                  ? handleAddAnnotation({ nodeId: selectedNode }, "note")
                  : handleAddAnnotation({ layer: "Uncategorized" }, "note")
              }
              style={{
                padding: "6px 8px",
                fontSize: 10,
                fontFamily: "monospace",
                borderRadius: 6,
                border: "1px solid transparent",
                background: "transparent",
                color: "#94a3b8",
                cursor: "pointer",
                width: "100%",
                textAlign: "left",
              }}
              title={selectedNode ? "Add note to selected node" : "Add note to canvas"}
            >
              + Add note
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
