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
  Persona,
  WorkspaceSceneDoc,
  WorkspaceAnnotation,
  WorkspaceRuntimeSnapshot,
} from "./types";
import { NodePopup } from "./NodePopup";
import { NodeIntelPanel } from "./NodeIntelPanel";
import { Arch3DView } from "./Arch3DView";
import { computeDepthLayout } from "./layout/depthLayout";
import { computeDomainLayout, domainFromPath, type DomainRegion } from "./layout/domainLayout";
import { computeElkLayout } from "./layout/elkLayout";
import type { LayoutMode } from "./types";
import { NODE_W } from "./layout/canvasConstants";
import { LAYER_COLORS, LAYER_CFG } from "./layerPalette";
import { canvasTheme, densityScale, type CanvasDensity, type CanvasThemeName } from "./theme";
import { filterEdges, filterNodes, type EdgeFilter, type NodeFilter } from "./analysis/graphAnalyser";
import { computeBlastRadius, computeBlastRadiusWithSeverity } from "./analysis/blastRadius";
import { isFlagEnabled } from "./featureFlags";
import { PresenceCursorsOverlay } from "./PresenceCursorsOverlay";

const DEFAULT_EDGE_FILTER = new Set<EdgeFilter>(["all"]);
const DEFAULT_NODE_FILTER = new Set<NodeFilter>(["all"]);
import type { GraphCommand } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  stable: "#3fb950",
  new: "#58a6ff",
  warning: "#d29922",
  error: "#f85149",
  deprecated: "#7d8590",
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
  database: "DB",
  cache: "C",
  queue: "Q",
  "message-bus": "MB",
  "http-api": "API",
  "web-ui": "UI",
  "mobile-app": "M",
  kubernetes: "K8s",
  "container-service": "CT",
  serverless: "SV",
  "object-storage": "S3",
  "external-saas": "SaaS",
  "generic-service": "SRV",
  cdn: "CDN",
  "api-gateway": "GW",
  redis: "RDS",
  mysql: "SQL",
  user: "USR",
  device: "DEV",
  laptop: "DEV",
  mobile: "MOB",
  unknown: "•",
};

const CLOUD_ICON: Record<string, string> = {
  aws: "🟧",
  gcp: "🟦",
  azure: "🟩",
  other: "☁️",
  unknown: "",
};

const DOMAIN_REGION_COLORS = [
  { fill: "rgba(59, 130, 246, 0.08)", border: "rgba(59, 130, 246, 0.35)" },
  { fill: "rgba(34, 197, 94, 0.08)", border: "rgba(34, 197, 94, 0.35)" },
  { fill: "rgba(168, 85, 247, 0.08)", border: "rgba(168, 85, 247, 0.35)" },
  { fill: "rgba(249, 115, 22, 0.08)", border: "rgba(249, 115, 22, 0.35)" },
  { fill: "rgba(236, 72, 153, 0.08)", border: "rgba(236, 72, 153, 0.35)" },
  { fill: "rgba(14, 165, 233, 0.08)", border: "rgba(14, 165, 233, 0.35)" },
];
function domainRegionColors(domain: string): { fill: string; border: string } {
  let h = 0;
  for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) >>> 0;
  return DOMAIN_REGION_COLORS[h % DOMAIN_REGION_COLORS.length];
}

// Tech family colors (data / edge / compute / external / ui)
const TECH_COLOR: Record<string, string> = {
  // data
  "database": "#3fb950",
  "object-storage": "#3fb950",
  "cache": "#238636",
  "redis": "#f85149",
  "mysql": "#0ea5e9",
  // edge / messaging
  "queue": "#eab308",
  "message-bus": "#eab308",
  "cdn": "#38bdf8",
  "api-gateway": "#38bdf8",
  // compute / orchestration
  "kubernetes": "#1f6feb",
  "container-service": "#a78bfa",
  "serverless": "#f97316",
  // ui / client
  "http-api": "#58a6ff",
  "web-ui": "#38bdf8",
  "mobile-app": "#f472b6",
  "user": "#f97316",
  "device": "#7d8590",
  "laptop": "#7d8590",
  "mobile": "#f472b6",
  // external / generic
  "external-saas": "#f97316",
  "generic-service": "#e6edf3",
  "unknown": "#8b949e",
};

// ── Custom Node ───────────────────────────────────────────────────────────────
function ArchNodeComponent({
  data,
}: NodeProps<
  ArchNode & {
    isSelected: boolean;
    isHighlighted?: boolean;
    searchScore?: number;
    canvasZoom?: number;
    density?: CanvasDensity;
    theme?: CanvasThemeName;
    runtimeMetrics?: { errorRate?: number };
  }
>) {
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
  const techColor = TECH_COLOR[iconKey] ?? "#8b949e";
  const cloudProvider = ((node as any).cloudProvider ?? "unknown") as string;
  const cloudIcon = CLOUD_ICON[cloudProvider] ?? "";
  const toolCount = node.toolCount ?? 0;
  const hasRag = !!node.hasRAG;
  const vsSummary = vs?.highestSeverity ?? null;
  const hasTraces = node.hasTraces === true;
  const runtimeMetrics = (node as any).runtimeMetrics as { errorRate?: number } | undefined;
  const hasHighErrorRate = (runtimeMetrics?.errorRate ?? 0) > 0.05;
  const hasDependencyRisk = (node as any).hasDependencyRisk === true;
  const fanOut = (node as any).fanOut as number | undefined;
  const hasHighFanOut = (fanOut ?? 0) >= 10;
  const miniRoles = (node as any).miniRoles as string[] | undefined;
  const domain = (node as any).domain as string | undefined;
  const domainColor = domain
    ? `hsl(${(domain.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360)}, 55%, 50%)`
    : undefined;
  const densityFactor = densityScale[densityKey];
  const zoomFactor = zoom < 0.5 ? 0.85 : zoom > 1.3 ? 1.15 : 1;
  const sizeFactor = densityFactor * zoomFactor;
  const iconSize = 18 * sizeFactor;
  const labelSize = 11 * sizeFactor;
  const iconMode = zoom < 0.8;
  const showLayer = zoom >= 0.55;
  const showKindTech = !iconMode && zoom >= 0.85;
  const showDescription = !iconMode && zoom >= 0.95 && densityKey === "standard";
  const showProviderModel = !iconMode && zoom >= 0.9;
  const showFileCount = zoom >= 0.75;
  const showHealth = !iconMode && zoom >= 0.9;
  const showTags = !iconMode && zoom >= 0.9;
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

      {data.isHighlighted && (
        <div
          style={{
            position: "absolute",
            inset: -8,
            borderRadius: 14,
            border:
              (data.searchScore ?? 1) <= 0.1
                ? "2px solid rgba(212,165,116,0.9)"
                : (data.searchScore ?? 1) <= 0.3
                ? "2px solid rgba(212,165,116,0.7)"
                : "1px solid rgba(212,165,116,0.45)",
            boxShadow:
              (data.searchScore ?? 1) <= 0.1
                ? "0 0 18px rgba(212,165,116,0.45)"
                : (data.searchScore ?? 1) <= 0.3
                ? "0 0 12px rgba(212,165,116,0.35)"
                : "0 0 8px rgba(212,165,116,0.22)",
            pointerEvents: "none",
            zIndex: 2,
          }}
          title="Search match"
        />
      )}

      {/* Domain halo (domains view) */}
      {domain && domainColor && (
        <div
          style={{
            position: "absolute",
            left: -4,
            top: 2,
            bottom: 2,
            width: 4,
            background: domainColor,
            borderRadius: 2,
            opacity: 0.8,
            pointerEvents: "none",
          }}
          title={`Domain: ${domain}`}
        />
      )}
      {/* Risk indicator: critical / high fan-out / dependency risk */}
      {(hasCritical || hasHighFanOut || hasDependencyRisk) && (
        <div
          style={{
            position: "absolute",
            inset: -2,
            borderRadius: 12,
            border: `2px solid ${
              hasCritical ? "#f85149" : hasHighFanOut ? "#d29922" : "#a78bfa"
            }`,
            pointerEvents: "none",
            zIndex: 1,
            boxShadow: `0 0 12px ${
              hasCritical ? "rgba(239,68,68,0.5)" : hasHighFanOut ? "rgba(245,158,11,0.4)" : "rgba(167,139,250,0.4)"
            }`,
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
            background: "#d29922",
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
            : hasHighErrorRate
              ? "2px solid #f85149"
              : hasDependencyRisk
              ? "2px solid #d29922"
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
                          ? "#f85149"
                          : `${cfg.accent}88`
                    }`,
          borderBottom: isVirtual
            ? isVirtualError
              ? "2px dashed #f85149"
              : "2px dashed #a78bfa88"
            : hasHighErrorRate
              ? "2px solid #f85149"
              : hasDependencyRisk
              ? "2px solid #d29922"
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
                          ? "#f85149"
                          : `${cfg.accent}88`
                    }`,
          borderLeft: isVirtual
            ? isVirtualError
              ? "2px dashed #f85149"
              : "2px dashed #a78bfa88"
            : hasHighErrorRate
              ? "2px solid #f85149"
              : hasDependencyRisk
              ? "2px solid #d29922"
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
                          ? "#f85149"
                          : `${cfg.accent}88`
                    }`,
          borderRadius: "0 0 8px 8px",
          padding: `${8 * densityFactor}px 12px ${12 * densityFactor}px`,
          position: "relative",
          zIndex: 1,
          boxShadow: node.isDrift
            ? "0 4px 0 #f8514933, 0 7px 0 #f8514918, 0 10px 0 #f851490a, 0 16px 28px rgba(0,0,0,0.6), 0 0 0 1px #f85149"
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
                  color: "#8b949e",
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
              color: "#8b949e",
              marginBottom: 4,
              fontFamily: "monospace",
            }}
            title={`${node.llmProvider ?? ""} ${node.modelVersion ?? ""}`.trim()}
          >
            {[node.llmProvider, node.modelVersion].filter(Boolean).join(" · ")}
          </div>
        )}

        {showTags && tags.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              marginBottom: 4,
              maxWidth: NODE_W - 40,
            }}
            title={tags.join(", ")}
          >
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 7 * sizeFactor,
                  padding: "2px 4px",
                  borderRadius: 999,
                  fontFamily: "monospace",
                  textTransform: "lowercase",
                  background: "rgba(15,23,42,0.9)",
                  color: "#8b949e",
                }}
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span
                style={{
                  fontSize: 7 * sizeFactor,
                  padding: "2px 4px",
                  borderRadius: 999,
                  fontFamily: "monospace",
                  background: "rgba(15,23,42,0.6)",
                  color: "#7d8590",
                }}
              >
                +{tags.length - 3}
              </span>
            )}
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
                  background: ok ? "#3fb950" : "#1e2d45",
                  boxShadow: ok ? "0 0 4px #3fb95088" : "none",
                }}
              />
              <span
                style={{
                  fontSize: 7,
                  color: ok ? "#3fb950" : "#475569",
                  fontFamily: "monospace",
                }}
              >
                {l}
              </span>
            </div>
          ))}
        </div>
        )}

        {showKindTech && miniRoles && miniRoles.length > 0 && (
          <div
            style={{
              marginTop: 4,
              display: "flex",
              flexWrap: "wrap",
              gap: 3,
            }}
          >
            {miniRoles.slice(0, 4).map((r) => (
              <span
                key={r}
                style={{
                  fontSize: 7,
                  color: cfg.accent,
                  background: `${cfg.accent}22`,
                  padding: "1px 4px",
                  borderRadius: 3,
                  fontFamily: "monospace",
                  textTransform: " capitalize",
                }}
                title={`Role: ${r}`}
              >
                {r}
              </span>
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
              color: "#f85149",
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
  drift: { stroke: "#f85149", glow: "rgba(239,68,68,0.4)" },
  violation: { stroke: "#d29922", glow: "rgba(245,158,11,0.35)" },
  trace: { stroke: "#c084fc", glow: "rgba(192,132,252,0.25)" },
  architectural: { stroke: "#58a6ff", glow: "rgba(96,165,250,0.2)" },
  utility: { stroke: "#8b949e", glow: "rgba(148,163,184,0.1)" },
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
  const runtimeLatencyMs = (data as any)?.runtimeLatencyMs as number | undefined;
  const runtimeErrorRate = (data as any)?.runtimeErrorRate as number | undefined;
  const importance = data?.importance as "architectural" | "utility" | "config" | undefined;
  const sourceLayer = (data as any)?.sourceLayer as string | undefined;
  const layerCfg = sourceLayer && LAYER_CFG[sourceLayer] ? LAYER_CFG[sourceLayer] : null;
  const isArchitectural = importance === "architectural" || isDrift || isLayerViolation;

  let runtimeStroke: string | null = null;
  const hasHighEdgeErrorRate = (runtimeErrorRate ?? 0) > 0.1;
  if (hasHighEdgeErrorRate) {
    runtimeStroke = "#f85149";
  } else if (typeof runtimeLatencyMs === "number") {
    if (runtimeLatencyMs < 100) runtimeStroke = "#3fb950";
    else if (runtimeLatencyMs < 300) runtimeStroke = "#eab308";
    else runtimeStroke = "#f85149";
  }
  const stroke = isDrift
    ? EDGE_PALETTE.drift.stroke
    : isLayerViolation
      ? EDGE_PALETTE.violation.stroke
      : inTrace
        ? EDGE_PALETTE.trace.stroke
        : runtimeStroke
          ? runtimeStroke
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
  const strokeOpacity = isArchitectural || inTrace || runtimeStroke ? 1 : 0.55;

  const violationStrokeDash = "2 4";
  const driftStrokeDash = "6 3";

  return (
    <g className={isDrift ? "arch-edge-drift" : inTrace ? "arch-edge-trace" : undefined}>
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
      >
        <title>
          {isDrift
            ? (data as any)?.driftReason ?? "Architecture drift"
            : isLayerViolation
              ? "Layer violation"
              : importance === "architectural"
                ? "Architectural import edge"
                : "Import edge"}
        </title>
      </path>
      {isDrift && (
        <circle r={3.5} fill="#f85149" className="arch-edge-drift-dot">
          <animateMotion dur="1.8s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      {isLayerViolation && !isDrift && (
        <circle r={2} fill="#d29922" opacity={0.95} className="arch-edge-violation-dot">
          <animateMotion dur="2.5s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      {!isDrift && !isLayerViolation && inTrace && (
        <circle r={2.5} fill="#c084fc" opacity={0.95} className="arch-edge-trace-dot">
          <animateMotion dur="1.5s" repeatCount="indefinite" path={path} />
        </circle>
      )}
      {!isDrift && !isLayerViolation && !inTrace && (runtimeStroke || (data as any)?.runtimeLive) && (
        <circle
          r={2}
          fill={runtimeStroke ?? "#58a6ff"}
          opacity={0.8}
        >
          <animateMotion dur="2s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </g>
  );
}

function DomainRegionComponent({
  data,
}: NodeProps<{ domain: string; colors: { fill: string; border: string } }>) {
  const { domain, colors } = data;
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: colors.fill,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        pointerEvents: "none",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.03)",
      }}
      title={`Domain: ${domain}`}
    >
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 12,
          fontSize: 10,
          fontWeight: 600,
          color: colors.border,
          opacity: 0.5,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontFamily: "monospace",
        }}
      >
        {domain}
      </div>
    </div>
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
  const ann = data as unknown as WorkspaceAnnotation & {
    onDelete?: (id: string) => void;
    onOpenComments?: (id: string) => void;
  };
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
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {ann.onOpenComments && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                ann.onOpenComments?.(ann.id);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontSize: 11,
                lineHeight: 1,
                opacity: 0.7,
              }}
              title="Comments"
            >
              💬
            </button>
          )}
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
      </div>
      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 2 }}>
        {ann.content || "(empty)"}
      </div>
    </div>
  );
}

const NODE_TYPES = {
  arch: ArchNodeComponent,
  band: LayerBandComponent,
  domainRegion: DomainRegionComponent,
  annotation: AnnotationStickyComponent,
} as const;
const EDGE_TYPES = { arch: ArchEdgeComponent } as const;

function BlastRadiusOverlay({ graph, sourceId }: { graph: ArchGraph; sourceId: string }) {
  const radius = computeBlastRadius(graph, sourceId);
  const withSev = computeBlastRadiusWithSeverity(graph, sourceId);
  const critical = [...withSev].filter(([, s]) => s === "critical").length;
  const high = [...withSev].filter(([, s]) => s === "high").length;
  const medium = [...withSev].filter(([, s]) => s === "medium").length;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        zIndex: 20,
        background: "linear-gradient(150deg, rgba(15,23,42,0.95), rgba(7,13,26,0.98))",
        border: "1px solid rgba(239,68,68,0.5)",
        borderRadius: 10,
        padding: "12px 16px",
        color: "#f1f5f9",
        fontSize: 12,
        fontFamily: "monospace",
        backdropFilter: "blur(12px)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(239,68,68,0.2)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6, color: "#f85149" }}>Blast radius</div>
      <div style={{ fontSize: 14, marginBottom: 4 }}>
        {radius.size} downstream node{radius.size !== 1 ? "s" : ""} impacted
      </div>
      {(critical > 0 || high > 0 || medium > 0) && (
        <div style={{ fontSize: 10, color: "#8b949e", display: "flex", gap: 10 }}>
          {critical > 0 && <span style={{ color: "#f85149" }}>Critical: {critical}</span>}
          {high > 0 && <span style={{ color: "#ea580c" }}>High: {high}</span>}
          {medium > 0 && <span style={{ color: "#ca8a04" }}>Medium: {medium}</span>}
        </div>
      )}
    </div>
  );
}

// ── ArchCanvas ────────────────────────────────────────────────────────────────

interface Props {
  graph: ArchGraph;
  selectedNode: string | null;
  selectedNodeData?: ArchNode | null;
  repoUrl?: string;
  onNodeSelect: (id: string | null) => void;
  edgeFilter?: EdgeFilter | Set<EdgeFilter>;
  /** Filter which node subsets to show (core, databases, queues, utilities, external). */
  nodeFilter?: NodeFilter | Set<NodeFilter>;
  /** Persona preset: overview/learn/deep_dive */
  persona?: Persona;
  /** Search results for highlighting nodes by score (lower is better). */
  searchResults?: Array<{ nodeId: string; score: number }>;
  /** 2D/3D view mode (controlled by App top bar). */
  viewMode?: "2d" | "3d";
  onViewModeChange?: (mode: "2d" | "3d") => void;
  /** Canvas overlay mode (controlled by App top bar). */
  canvasViewMode?: "architecture" | "domains" | "runtime" | "failure";
  onCanvasViewModeChange?: (mode: "architecture" | "domains" | "runtime" | "failure") => void;
  /** Layout mode (controlled by App top bar). */
  layoutMode?: LayoutMode;
  onLayoutModeChange?: (mode: LayoutMode) => void;
  /** When the agent returns a graphCommand, apply it to highlight/filter the canvas. */
  agentGraphCommand?: GraphCommand | null;
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
  /** Called when user opens comments for an annotation. */
  onOpenComments?: (annotationId: string) => void;
  /** When user clicks "Explain this area" in focus mode, called with prompt to pre-fill chat. */
  onExplainArea?: (prompt: string) => void;
  /** Presentation mode: hide most controls, step through scenes. */
  presentationMode?: boolean;
  onPresentationModeChange?: (value: boolean) => void;
  /** Authored scene document (separate from scanned graph) */
  scene?: WorkspaceSceneDoc | null;
  /** Enable scene editing affordances (snap/grid/undo + 3D gizmo + import). */
  sceneEditMode?: boolean;
  /** Persist scene as a new version for this workspace. */
  onSaveScene?: (scene: WorkspaceSceneDoc) => Promise<void>;
  /** Called when editor mutates the scene draft (e.g. moving nodes/importing assets). */
  onSceneChange?: (scene: WorkspaceSceneDoc) => void;
  /** Active scene state id (slides). */
  activeSceneStateId?: string | null;
  /** Optional runtime metrics overlay for nodes/edges. */
  runtimeSnapshot?: WorkspaceRuntimeSnapshot | null;
  /** When true, animates flow on edges with runtime data (live mode). */
  runtimeLive?: boolean;
  /** Node IDs that use vulnerable dependencies (supply-chain risk overlay). */
  vulnerableNodeIds?: Set<string>;
  /** Ref to register capture-view function (viewport2D / camera3D). */
  captureViewRef?: React.MutableRefObject<(() => { viewport2D?: { x: number; y: number; zoom: number }; camera3D?: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } }) | null>;
  /** When set, apply this viewport to 2D canvas (from active scene state). */
  viewportToApply?: { x: number; y: number; zoom: number } | null;
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
  nodeFilter,
  persona,
  searchResults = [],
  viewMode: viewModeProp,
  onViewModeChange,
  canvasViewMode: canvasViewModeProp,
  onCanvasViewModeChange,
  layoutMode: layoutModeProp,
  onLayoutModeChange,
  agentGraphCommand,
  workspaceId,
  accessToken,
  violationBeingFixedKey,
  issuesByNodeId = {},
  theme = "dark",
  density = "standard",
  annotations = [],
  onAnnotationsChange,
  onOpenComments,
  onExplainArea,
  presentationMode = false,
  onPresentationModeChange,
  scene = null,
  sceneEditMode = false,
  onSaveScene,
  onSceneChange,
  activeSceneStateId = null,
  runtimeSnapshot = null,
  runtimeLive = false,
  vulnerableNodeIds,
  captureViewRef,
  viewportToApply,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [building, setBuilding] = useState(true);
  const [legendHighlight, setLegendHighlight] = useState<LegendHighlight>(null);
  const [tracePathNodeIds, setTracePathNodeIds] = useState<string[] | null>(null);
  const [sceneNodeOverrides2D, setSceneNodeOverrides2D] = useState<Record<string, { x: number; y: number }>>({});
  const [undoStack, setUndoStack] = useState<Array<Record<string, { x: number; y: number }>>>([]);
  const [redoStack, setRedoStack] = useState<Array<Record<string, { x: number; y: number }>>>([]);
  const reactFlowInstanceRef = useRef<
    { fitView: (opts?: { padding?: number }) => void; getViewport?: () => { x: number; y: number; zoom: number }; setViewport?: (v: { x: number; y: number; zoom: number }) => void } | null
  >(null);
  const flowContainerRef = useRef<HTMLDivElement | null>(null);
  const flowParentRef = useRef<HTMLDivElement | null>(null);
  // Start at 0: ReactFlow must not mount until ResizeObserver measures real size.
  const [flowDimensions, setFlowDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [canvasDebug, setCanvasDebug] = useState<{
    graphNodes: number;
    filteredNodes: number;
    personaFilteredNodes: number;
    effectiveNodes: number;
    rfNodes: number;
    canvasViewMode: "architecture" | "domains" | "runtime" | "failure";
    persona: Persona | null | undefined;
    focusMode: boolean;
    legendHighlightType: string;
  } | null>(null);
  const prevGraphKeyRef = useRef<string>("");
  const lastNodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const legendHighlightRef = useRef<LegendHighlight>(null);
  legendHighlightRef.current = legendHighlight;
  const [viewModeInternal, setViewModeInternal] = useState<"2d" | "3d">("2d");
  const [canvasViewModeInternal, setCanvasViewModeInternal] =
    useState<"architecture" | "domains" | "runtime" | "failure">("architecture");
  const [showFullNodePopup, setShowFullNodePopup] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [fps2d, setFps2d] = useState(0);
  const layoutMode: LayoutMode =
    layoutModeProp ?? ((scene?.settings?.layoutMode as LayoutMode) ?? "depth");
  const viewMode = viewModeProp ?? viewModeInternal;
  const canvasViewMode = canvasViewModeProp ?? canvasViewModeInternal;
  const effectiveLayoutMode: LayoutMode =
    canvasViewMode === "domains" ? "domain" : layoutMode;
  const [elkPositions, setElkPositions] = useState<Map<string, { x: number; y: number }> | null>(null);

  useEffect(() => {
    if (!captureViewRef) return;
    if (viewMode !== "2d") {
      captureViewRef.current = null;
      return;
    }
    captureViewRef.current = () => {
      const rf = reactFlowInstanceRef.current;
      const vp = (rf as any)?.getViewport?.();
      if (!vp || typeof vp.zoom !== "number") return {};
      return { viewport2D: { x: vp.x, y: vp.y, zoom: vp.zoom } };
    };
    return () => { captureViewRef.current = null; };
  }, [captureViewRef, viewMode]);

  useEffect(() => {
    if (!viewportToApply || viewMode !== "2d") return;
    const rf = reactFlowInstanceRef.current;
    (rf as any)?.setViewport?.({ x: viewportToApply.x, y: viewportToApply.y, zoom: viewportToApply.zoom });
  }, [viewportToApply, viewMode]);

  useEffect(() => {
    if (effectiveLayoutMode !== "elk" || graph.nodes.length === 0) {
      setElkPositions(null);
      return;
    }
    let cancelled = false;
    computeElkLayout(graph).then((r) => {
      if (!cancelled) setElkPositions(r.nodePositions);
    });
    return () => { cancelled = true; };
  }, [effectiveLayoutMode, graph]);

  useEffect(() => {
    if (!scene) return;
    const next: Record<string, { x: number; y: number }> = {};
    for (const obj of scene.objects ?? []) {
      if (obj.kind !== "node") continue;
      const nodeId = (obj.props as any)?.nodeId as string | undefined;
      const p = obj.transform?.position as any;
      if (!nodeId || !p) continue;
      if (typeof p.x === "number" && typeof p.y === "number") next[nodeId] = { x: p.x, y: p.y };
    }
    setSceneNodeOverrides2D(next);
    setUndoStack([]);
    setRedoStack([]);
  }, [scene]);

  // ResizeObserver: ensure React Flow parent has explicit dimensions (fixes error 004)
  useEffect(() => {
    const el = flowParentRef.current;
    if (!el || viewMode !== "2d") return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setFlowDimensions({ width, height });
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) setFlowDimensions({ width: rect.width, height: rect.height });
    return () => ro.disconnect();
  }, [viewMode]);

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
    const total = graph.nodes.length;
    const rf = reactFlowInstanceRef.current;
    if (!rf || total === 0) return;
    const padding = flowDimensions.width > flowDimensions.height ? 0.05 : 0.12;
    rf.fitView({ padding });
  }, [graph.nodes.length, graph.generatedAt, flowDimensions.width, flowDimensions.height]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onNodeSelect(null);
      }
      if (!sceneEditMode) return;
      const isUndo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey;
      const isRedo = (e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey));
      if (isUndo) {
        e.preventDefault();
        setUndoStack((prev) => {
          if (prev.length === 0) return prev;
          const nextPrev = [...prev];
          const last = nextPrev.pop()!;
          setRedoStack((r) => [...r, { ...sceneNodeOverrides2D }]);
          setSceneNodeOverrides2D(last);
          if (onSceneChange && scene) onSceneChange({ ...scene, objects: (scene.objects ?? []).map((o) => o) });
          return nextPrev;
        });
      } else if (isRedo) {
        e.preventDefault();
        setRedoStack((prev) => {
          if (prev.length === 0) return prev;
          const nextPrev = [...prev];
          const last = nextPrev.pop()!;
          setUndoStack((u) => [...u, { ...sceneNodeOverrides2D }]);
          setSceneNodeOverrides2D(last);
          if (onSceneChange && scene) onSceneChange({ ...scene, objects: (scene.objects ?? []).map((o) => o) });
          return nextPrev;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNodeSelect, sceneEditMode, sceneNodeOverrides2D, onSceneChange, scene]);

  // Apply agent graph command to canvas highlight (layer or node set).
  useEffect(() => {
    if (!agentGraphCommand) return;
    if (agentGraphCommand.action === "highlight_nodes" && agentGraphCommand.nodeIds.length > 0) {
      setLegendHighlight({ type: "nodes", nodeIds: agentGraphCommand.nodeIds });
    } else if (agentGraphCommand.action === "filter_layer") {
      setLegendHighlight({ type: "layer", layer: agentGraphCommand.layer });
    } else if (agentGraphCommand.action === "focus_node") {
      setLegendHighlight({ type: "nodes", nodeIds: [agentGraphCommand.nodeId] });
      const rf = reactFlowInstanceRef.current;
      const pos = lastNodePositionsRef.current.get(agentGraphCommand.nodeId);
      if (rf && pos && typeof (rf as any).setViewport === "function") {
        const vp = (rf as any).getViewport?.() ?? { x: 0, y: 0, zoom: 1 };
        const zoom = Math.max(0.75, Math.min(1.25, vp.zoom ?? 1));
        (rf as any).setViewport({ x: -pos.x + 240, y: -pos.y + 200, zoom });
      }
    } else if (agentGraphCommand.action === "trace_path") {
      setLegendHighlight({ type: "nodes", nodeIds: agentGraphCommand.nodeIds });
      setTracePathNodeIds(agentGraphCommand.nodeIds);
    } else if (agentGraphCommand.action === "reset") {
      setLegendHighlight(null);
      setTracePathNodeIds(null);
    }
  }, [agentGraphCommand]);

  // Failure view: when node selected, highlight blast radius (downstream nodes).
  useEffect(() => {
    if (canvasViewMode === "failure" && selectedNode) {
      const radius = computeBlastRadius(graph, selectedNode);
      setLegendHighlight({ type: "nodes", nodeIds: [selectedNode, ...Array.from(radius)] });
    } else if (canvasViewMode === "failure" && !selectedNode) {
      setLegendHighlight(null);
    }
  }, [canvasViewMode, selectedNode, graph]);

  function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
    let t: number | undefined;
    return ((...args: any[]) => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => fn(...args), delay);
    }) as T;
  }

  const activeSceneState = useMemo(() => {
    const s = scene?.states ?? [];
    return activeSceneStateId ? s.find((x) => x.id === activeSceneStateId) ?? null : null;
  }, [scene, activeSceneStateId]);

  const rawBuild = useCallback(() => {
    const nodeIds = graph.nodes.map((n) => n.id).sort().join(",");
    const graphKey = `${graph.generatedAt ?? 0}-${nodeIds}`;
    const isGraphChange = prevGraphKeyRef.current !== graphKey;
    prevGraphKeyRef.current = graphKey;
    if (isGraphChange) setBuilding(true);
    const nodeFilters = nodeFilter instanceof Set ? nodeFilter : nodeFilter ? new Set<NodeFilter>([nodeFilter]) : DEFAULT_NODE_FILTER;
    const graphAfterNodeFilter =
      nodeFilters.has("all") || nodeFilters.size === 0 ? graph : filterNodes(graph, nodeFilters);
    const filtered = filterEdges(graphAfterNodeFilter, edgeFilter);

    const personaFiltered = (() => {
      if (!persona || persona === "deep_dive") return filtered;
      if (persona === "learn") return filtered;
      const keep = new Set<string>();
      for (const n of filtered.nodes) {
        const layer = (n.layer ?? "Uncategorized") as string;
        const isUtility = layer === "Utilities" || layer === "Configuration";
        const isExternal = layer === "External Services";
        const fileCount =
          (n.semanticSignals?.fileCount as number | undefined) ?? (n.files?.length ?? 0);
        const looksHighLevel = (n.kind ?? "unknown") === "module" || fileCount >= 3;
        if (!isUtility && !isExternal && looksHighLevel) keep.add(n.id);
      }
      return {
        ...filtered,
        nodes: filtered.nodes.filter((n) => keep.has(n.id)),
        edges: filtered.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
      };
    })();

    // Safety: if filters would hide everything but the underlying graph has nodes,
    // fall back to the unfiltered graph so the canvas is never completely blank.
    const effectiveGraphForRender =
      personaFiltered.nodes.length > 0 ? personaFiltered : filtered;
    let nodePositions: Map<string, { x: number; y: number }>;
    let layerBands: Array<{ id: string; layer: string; x: number; y: number; width: number; height: number }>;
    let domainRegions: DomainRegion[] = [];
    if (effectiveLayoutMode === "domain") {
      const r = computeDomainLayout(personaFiltered);
      nodePositions = r.nodePositions;
      layerBands = r.layerBands;
      domainRegions = r.domainRegions ?? [];
    } else if (effectiveLayoutMode === "elk" && elkPositions && elkPositions.size > 0) {
      nodePositions = elkPositions;
      layerBands = [];
    } else {
      const r = computeDepthLayout(personaFiltered);
      nodePositions = r.nodePositions;
      layerBands = r.layerBands;
    }

    // Widen layout horizontally so layers use more of the canvas.
    // The core layout functions tend to produce a tall, narrow bounding box;
    // here we stretch X coordinates based on the current viewport aspect ratio
    // so the graph visually occupies more horizontal space.
    if (nodePositions.size > 0 && flowDimensions.width > 0 && flowDimensions.height > 0) {
      const entries = Array.from(nodePositions.entries());
      const xs = entries.map(([, p]) => p.x);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const currentWidth = maxX - minX || 1;
      const aspect = flowDimensions.width / flowDimensions.height;
      const MIN_TARGET_WIDTH = 800;
      if (aspect > 1.1 && currentWidth > 0) {
        const targetWidth = Math.max(currentWidth * Math.min(aspect * 1.4, 2.6), MIN_TARGET_WIDTH);
        const scale = targetWidth / currentWidth;
        const centerX = (minX + maxX) / 2;
        const widened = new Map<string, { x: number; y: number }>();
        for (const [id, pos] of entries) {
          const dx = pos.x - centerX;
          widened.set(id, { x: centerX + dx * scale, y: pos.y });
        }
        nodePositions = widened;
      }
    }

    lastNodePositionsRef.current = nodePositions;
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
        const hasMatchingEdge = personaFiltered.edges.some((e) => {
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
        const e = personaFiltered.edges.find((x) => x.source === edge.source && x.target === edge.target);
        if (!e) return false;
        if (hl.kind === "import") return !e.isDrift && !e.isLayerViolation;
        if (hl.kind === "violation") return !!e.isLayerViolation && !e.isDrift;
        return !!e.isDrift;
      }
      return true;
    };

    const metricsNodes = (runtimeSnapshot?.nodes ?? {}) as Record<string, { errorRate?: number }>;
    const metricsEdges = (runtimeSnapshot?.edges ?? {}) as Record<string, { latencyMs?: number; errorRate?: number }>;

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

    const domainRegionNodes: Node[] = domainRegions.map((dr) => {
      const colors = domainRegionColors(dr.domain);
      return {
        id: dr.id,
        type: "domainRegion",
        position: { x: dr.x, y: dr.y },
        data: { domain: dr.domain, colors },
        style: {
          width: dr.width,
          height: dr.height,
          zIndex: -2,
          pointerEvents: "none",
        },
        draggable: false,
        selectable: false,
        connectable: false,
      };
    });

    const bandNodes: Node[] = !showLayerBands
      ? []
      : layerBands.map((band) => {
      const layerKey = (band as { layerKey?: string }).layerKey ?? band.layer;
      const colors =
        LAYER_COLORS[layerKey] ?? LAYER_COLORS["Uncategorized"];
      const nodeCount = (band as { nodeCount?: number }).nodeCount ?? graph.nodes.filter(
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

    const allowedAnnIds = activeSceneState?.annotationIds
      ? new Set(activeSceneState.annotationIds)
      : null;
    const annotationNodes: Node[] = !isFlagEnabled("annotations")
      ? []
      : (annotations ?? [])
          .filter((ann) => (allowedAnnIds ? allowedAnnIds.has(ann.id) : true))
          .map((ann) => {
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
        data: {
          ...ann,
          onDelete: workspaceId && accessToken ? handleDeleteAnnotation : undefined,
          onOpenComments: workspaceId && accessToken ? onOpenComments : undefined,
        },
        draggable: false,
        selectable: false,
        connectable: false,
      };
      });

    const fanOutByNode = new Map<string, number>();
    for (const e of graph.edges) fanOutByNode.set(e.source, (fanOutByNode.get(e.source) ?? 0) + 1);

    const deriveMiniRoles = (n: ArchNode): string[] => {
      const roles: string[] = [];
      if (n.role && typeof n.role === "string") roles.push(n.role.toLowerCase());
      const label = (n.suggestedLabel ?? n.label ?? "").toLowerCase();
      const tags = (Array.isArray(n.tags) ? n.tags : []).map((t) => String(t).toLowerCase());
      const layer = (n.layer ?? "").toLowerCase();
      const combined = `${label} ${tags.join(" ")} ${layer}`;
      const keywords = ["controller", "service", "repository", "gateway", "handler", "client", "orchestrator"];
      for (const kw of keywords) {
        if (combined.includes(kw) && !roles.includes(kw)) roles.push(kw);
      }
      if (layer.includes("data") && !roles.includes("repository")) roles.push("repository");
      if (layer.includes("orchestration") && !roles.includes("orchestrator")) roles.push("orchestrator");
      return roles.slice(0, 4);
    };

    const hasRuntimeData = Object.keys(metricsNodes).length > 0 || Object.keys(metricsEdges).length > 0;
    const runtimeViewMode = canvasViewMode === "runtime" && hasRuntimeData;

    const searchScoreById = new Map<string, number>(searchResults.map((r: { nodeId: string; score: number }) => [r.nodeId, r.score]));
    const rfNodes: Node[] = [
      ...domainRegionNodes,
      ...bandNodes,
      ...effectiveGraphForRender.nodes.map((node) => {
        const matches = nodeMatches(node);
        const override = sceneNodeOverrides2D[node.id];
        const visible = activeSceneState?.visibility?.[node.id];
        const domain =
          effectiveLayoutMode === "domain"
            ? (node.domain ?? domainFromPath(node.path ?? node.id, node.id))
            : undefined;
        const miniRoles =
          (node.runtimeRoles?.length ? node.runtimeRoles : undefined) ?? deriveMiniRoles(node);
        let opacity = 1;
        if (runtimeViewMode) opacity = metricsNodes[node.id] ? 1 : 0.25;
        else if (hl) opacity = matches ? 1 : 0.2;
        const searchScore = searchScoreById.get(node.id);
        const isHighlighted = typeof searchScore === "number";
        return {
          id: node.id,
          type: "arch",
          position: override ?? nodePositions.get(node.id) ?? { x: 0, y: 0 },
          hidden: visible === false,
          data: {
            ...node,
            domain,
            fanOut: fanOutByNode.get(node.id),
            miniRoles,
            isSelected: selectedNode === node.id,
            isHighlighted,
            searchScore,
            canvasZoom,
            density,
            theme,
            runtimeMetrics: metricsNodes[node.id],
            violationBeingFixedKey: violationBeingFixedKey ?? undefined,
            hasDependencyRisk: vulnerableNodeIds?.has(node.id),
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
            opacity,
            transition: "opacity 0.2s ease",
            pointerEvents: visible === false ? "none" : "auto",
          },
        };
      }),
      ...annotationNodes,
    ];

    const nodeById = new Map(effectiveGraphForRender.nodes.map((n) => [n.id, n]));

    // Basic edge bundling: collapse multiple edges with same source/target into one
    // and store a bundleCount used to subtly increase stroke width.
    const bundleMap = new Map<
      string,
      { edge: (typeof personaFiltered.edges)[0]; count: number }
    >();
    for (const e of personaFiltered.edges) {
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
      const m = metricsEdges[edge.id];
      let edgeOpacity = 1;
      if (runtimeViewMode) edgeOpacity = m ? 1 : 0.25;
      else if (hl) edgeOpacity = matches ? 1 : 0.2;
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
          runtimeLatencyMs: m?.latencyMs,
          runtimeErrorRate: m?.errorRate,
          runtimeLive: runtimeLive && typeof m?.latencyMs === "number",
        },
        style: {
          opacity: edgeOpacity,
          strokeWidth: inTrace ? 3 : count > 3 ? 2.4 : count > 1 ? 1.8 : 1,
          transition: "opacity 0.2s ease, stroke-width 0.2s ease",
        },
      };
    });

    setCanvasDebug({
      graphNodes: graph.nodes.length,
      filteredNodes: filtered.nodes.length,
      personaFilteredNodes: personaFiltered.nodes.length,
      effectiveNodes: effectiveGraphForRender.nodes.length,
      rfNodes: rfNodes.length,
      canvasViewMode,
      persona,
      focusMode,
      legendHighlightType: legendHighlight ? legendHighlight.type : "none",
    });
    setNodes(rfNodes);
    setEdges(baseEdges);
    setBuilding(false);
  }, [
    graph,
    selectedNode,
    violationBeingFixedKey,
    edgeFilter,
    tracePathNodeIds,
    issuesByNodeId,
    annotations,
    density,
    theme,
    handleDeleteAnnotation,
    workspaceId,
    accessToken,
    runtimeSnapshot,
    runtimeLive,
    vulnerableNodeIds,
    setNodes,
    setEdges,
    layoutMode,
    canvasViewMode,
    effectiveLayoutMode,
    elkPositions,
    legendHighlight,
    focusMode,
    nodeFilter,
    sceneNodeOverrides2D,
    activeSceneStateId,
    scene,
    onOpenComments,
    setCanvasDebug,
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

  const [showLayerBands, setShowLayerBands] = useState(true);
  const [legendCollapsed, setLegendCollapsed] = useState(false);

  const legendLayers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const n of graph.nodes) {
      const l = (n.layer ?? "Uncategorized") as string;
      seen.set(l, (seen.get(l) ?? 0) + 1);
    }
    return Array.from(seen.entries());
  }, [graph]);

  const isEmptyWorkspace =
    graph.nodes.length === 0 &&
    !graph.projectRoot;

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [hoveredEdgePos, setHoveredEdgePos] = useState<{ x: number; y: number } | null>(null);
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
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        minWidth: 0,
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
                background: "linear-gradient(90deg, #1d4ed888, #58a6ff, #1d4ed888)",
                borderRadius: "12px 12px 0 0",
              }}
            />
            <div style={{ padding: 24 }}>
            <div
              style={{
                marginBottom: 12,
                color: "#58a6ff",
                fontSize: 16,
                fontWeight: 700,
                fontFamily: "'JetBrains Mono','Fira Code',monospace",
              }}
            >
              Empty workspace
            </div>
            <div
              style={{
                color: "#8b949e",
                fontSize: 13,
                lineHeight: 1.6,
                fontFamily: "monospace",
              }}
            >
              Paste a GitHub repo URL in the sidebar to scan it, or use chat to ask questions about your architecture.
            </div>
            </div>
          </div>
        </div>
      )}

      {isFlagEnabled("perf_hud") &&
        graph.nodes.length > 0 &&
        (flowDimensions.width === 0 ||
          flowDimensions.height === 0 ||
          (canvasDebug?.rfNodes ?? 0) === 0) && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              zIndex: 999,
              pointerEvents: "none",
              padding: "10px 12px",
              background: "rgba(2,6,23,0.9)",
              border: "1px solid rgba(96,165,250,0.35)",
              borderRadius: 10,
              width: 280,
              color: "#cfe8ff",
              fontFamily: "monospace",
              fontSize: 11,
              lineHeight: 1.35,
              boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6, color: "#58a6ff" }}>Canvas Debug</div>
            <div>
              flow: {Math.round(flowDimensions.width)}x{Math.round(flowDimensions.height)}
            </div>
            <div>graph nodes: {canvasDebug?.graphNodes ?? graph.nodes.length}</div>
            <div>filtered nodes: {canvasDebug?.filteredNodes ?? "?"}</div>
            <div>persona nodes: {canvasDebug?.personaFilteredNodes ?? "?"}</div>
            <div>effective nodes: {canvasDebug?.effectiveNodes ?? "?"}</div>
            <div>rf nodes: {canvasDebug?.rfNodes ?? "?"}</div>
            <div style={{ marginTop: 6 }}>
              persona: {typeof persona === "string" ? persona : "none"} | view: {canvasViewMode}
            </div>
            <div>focus: {focusMode ? "on" : "off"}</div>
            <div>highlight: {canvasDebug?.legendHighlightType ?? "none"}</div>
          </div>
        )}

      <style>{`
        @keyframes nodePulse  { 0%,100%{transform:translateX(-50%) rotate(45deg) scale(1);opacity:1} 50%{transform:translateX(-50%) rotate(45deg) scale(1.35);opacity:0.6} }
        @keyframes pip        { 0%,100%{transform:translateX(-50%) rotate(45deg) scale(1);opacity:1} 50%{transform:translateX(-50%) rotate(45deg) scale(1.2);opacity:0.75} }
        @keyframes fixPulse   { 0%,100%{transform:translateX(-50%) rotate(45deg) scale(1);box-shadow:0 0 10px 3px rgba(31,111,235,0.7)} 50%{transform:translateX(-50%) rotate(45deg) scale(1.2);box-shadow:0 0 16px 4px rgba(31,111,235,0.85)} }
        @keyframes driftGlow  { 0%,100%{box-shadow:0 4px 0 #f8514933,0 7px 0 #f8514918,0 10px 0 #f851490a,0 16px 28px rgba(0,0,0,0.6),0 0 0 1px #f85149,0 0 24px transparent} 50%{box-shadow:0 4px 0 #f8514933,0 7px 0 #f8514918,0 10px 0 #f851490a,0 16px 28px rgba(0,0,0,0.6),0 0 0 1px #f85149,0 0 24px #f8514966} }
        @keyframes edgeDriftDot { 0%,100%{opacity:1;filter:drop-shadow(0 0 3px rgba(239,68,68,0.8))} 50%{opacity:0.7;filter:drop-shadow(0 0 6px rgba(239,68,68,0.9))} }
        @keyframes edgeViolationDot { 0%,100%{opacity:0.95} 50%{opacity:0.6} }
        @keyframes edgeTracePulse { 0%,100%{opacity:0.95} 50%{opacity:0.7} }
        @keyframes edgeTraceStroke { 0%,100%{stroke-opacity:1;filter:drop-shadow(0 0 4px rgba(192,132,252,0.5))} 50%{stroke-opacity:0.75;filter:drop-shadow(0 0 8px rgba(192,132,252,0.7))} }
        .react-flow__edge path { pointer-events: visibleStroke !important; }
        .arch-edge-drift-dot { animation: edgeDriftDot 2s ease-in-out infinite; filter: drop-shadow(0 0 3px rgba(239,68,68,0.8)); }
        .arch-edge-violation-dot { animation: edgeViolationDot 2.5s ease-in-out infinite; }
        .arch-edge-trace-dot { animation: edgeTracePulse 1.5s ease-in-out infinite; }
        .arch-edge-trace path:nth-of-type(2) { animation: edgeTraceStroke 1.2s ease-in-out infinite; }
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
            <path d="M 0 1 L 9 5 L 0 9 Z" fill="#58a6ff" />
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
            <path d="M 0 1 L 9 5 L 0 9 Z" fill="#d29922" />
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
            <path d="M 0 1 L 9 5 L 0 9 Z" fill="#f85149" />
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
            color: "#58a6ff",
            fontSize: 11,
            fontFamily: "monospace",
            backdropFilter: "blur(12px)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4), 0 0 0 1px rgba(96,165,250,0.2)",
          }}
        >
          ◌ Mapping connections…
        </div>
      )}

      {canvasViewMode === "failure" && selectedNode && (
        <BlastRadiusOverlay graph={graph} sourceId={selectedNode} />
      )}

      {selectedNodeData && showFullNodePopup && (
        <NodePopup
          node={selectedNodeData}
          graph={graph}
          repoUrl={repoUrl}
          onClose={() => setShowFullNodePopup(false)}
          workspaceId={workspaceId}
          accessToken={accessToken}
        />
      )}

      {viewMode === "3d" ? (
        <div
          data-testid="arch-3d-container"
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
            }}
          >
            <Arch3DView
              graph={graph}
              selectedNode={selectedNode}
              onNodeSelect={onNodeSelect}
              legendHighlight={legendHighlight}
              tracePathNodeIds={tracePathNodeIds}
              workspaceId={workspaceId}
              accessToken={accessToken}
              annotations={annotations}
              scene={scene}
              sceneEditMode={sceneEditMode}
              onSceneChange={onSceneChange}
              activeSceneStateId={activeSceneStateId}
              runtimeSnapshot={runtimeSnapshot}
              captureViewRef={viewMode === "3d" ? captureViewRef : undefined}
            />
          </div>
        </div>
      ) : (
      <div
        ref={flowParentRef}
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          position: "relative",
        }}
      >
        <div
          ref={flowContainerRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        >
      {flowDimensions.width > 0 && flowDimensions.height > 0 && (
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        snapToGrid={sceneEditMode}
        snapGrid={[24, 24]}
        selectionOnDrag={sceneEditMode}
        onNodeClick={(_, n) => {
          if (n.type === "band") return;
          onNodeSelect(n.id);
        }}
        onNodeDragStop={(_, n) => {
          if (!sceneEditMode) return;
          if (n.type === "band" || n.type === "annotation") return;
          setRedoStack([]);
          setUndoStack((prev) => [...prev.slice(-49), { ...sceneNodeOverrides2D }]);
          setSceneNodeOverrides2D((prev) => ({ ...prev, [n.id]: { x: n.position.x, y: n.position.y } }));
          if (onSceneChange) {
            const base: WorkspaceSceneDoc =
              scene && typeof scene === "object"
                ? scene
                : { schemaVersion: 1, objects: [], states: [], cameraPresets: [] };
            const objects = Array.isArray(base.objects) ? [...base.objects] : [];
            const idx = objects.findIndex((o) => o.kind === "node" && ((o.props as any)?.nodeId as string) === n.id);
            const nextObj = {
              id: idx >= 0 ? objects[idx]!.id : `node-${n.id}`,
              kind: "node" as const,
              archNodeId: (n.data as any)?.archNodeId ?? undefined,
              props: { ...(idx >= 0 ? (objects[idx]!.props ?? {}) : {}), nodeId: n.id },
              transform: { ...(idx >= 0 ? (objects[idx]!.transform ?? {}) : {}), position: { x: n.position.x, y: n.position.y } },
            };
            if (idx >= 0) objects[idx] = nextObj as any;
            else objects.push(nextObj as any);
            onSceneChange({ ...base, objects });
          }
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
        onPaneClick={() => {
          onNodeSelect(null);
          setShowFullNodePopup(false);
        }}
        onMove={(_, viewport) => {
          if (typeof viewport.zoom === "number") setCanvasZoom(viewport.zoom);
        }}
        onInit={(instance) => { reactFlowInstanceRef.current = instance; }}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "arch" }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color={theme === "dark" ? "#1e293b" : "#8b949e"}
          gap={24}
          size={1}
        />

        <div
          style={{
            position: "absolute",
            bottom: 16,
            right: 16,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 10,
          }}
        >
          <MiniMap
            style={{
              background: "#070d1a",
              border: "1px solid #1e2d45",
              borderRadius: 8,
              width: 140,
              height: 90,
            }}
            nodeColor={(n) => {
              const d = n.data as { layer?: string; isDrift?: boolean };
              if (d.isDrift) return "#f85149";
              return (
                LAYER_COLORS[d.layer ?? "Uncategorized"]?.top ?? "#30363d"
              );
            }}
            maskColor="rgba(6,12,26,0.75)"
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
        </div>
        {workspaceId && isFlagEnabled("presence") && (
          <PresenceCursorsOverlay workspaceId={workspaceId} containerRef={flowContainerRef} />
        )}
        {canvasViewMode === "domains" && (
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 12,
              zIndex: 10,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              background: "rgba(15,23,42,0.9)",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            <span style={{ fontSize: 9, color: "#7d8590", textTransform: "uppercase", letterSpacing: 1 }}>Domains</span>
            {[...new Set(graph.nodes.map((n) => domainFromPath(n.path ?? n.id, n.id)))].sort().slice(0, 8).map((d) => (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: `hsl(${(d.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360)}, 55%, 50%)`,
                  }}
                />
                <span style={{ fontSize: 10, color: "#e2e8f0", fontFamily: "monospace" }}>{d}</span>
              </div>
            ))}
          </div>
        )}
      </ReactFlow>
      )}
        </div>
        {selectedNodeData && !showFullNodePopup && (
          <NodeIntelPanel
            node={selectedNodeData}
            graph={graph}
            onClose={() => {
              setShowFullNodePopup(false);
              onNodeSelect(null);
            }}
            onOpenFull={workspaceId && accessToken ? () => setShowFullNodePopup(true) : undefined}
          />
        )}
      </div>
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
              color: "#8b949e",
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
                  color: "#d29922",
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
                color: "#8b949e",
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
                <div style={{ color: "#7d8590" }}>+{hoveredNodeData.files.length - 5} more</div>
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
            <span style={{ fontSize: 8, color: "#7d8590", fontFamily: "monospace" }}>
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
                color: "#d29922",
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
                color: "#e6edf3",
              }}
            >
              2D · {graph.nodes.length} nodes · {edges.length} edges · {fps2d} fps
            </div>
          )}
          {isFlagEnabled("ux_review_mode") && (
            <a
              href="/UX_REVIEW_CHECKLIST.md"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 10,
                padding: "4px 8px",
                background: "rgba(30,64,175,0.3)",
                borderRadius: 4,
                border: "1px solid #1f6feb",
                fontFamily: "monospace",
                color: "#58a6ff",
                textDecoration: "none",
              }}
            >
              UX checklist ↗
            </a>
          )}
        </div>
      )}

      {/* Mode controls moved to App top bar */}

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
          padding: legendCollapsed ? "8px 10px" : "12px 14px",
          backdropFilter: "blur(12px)",
          minWidth: legendCollapsed ? undefined : 180,
          maxWidth: 220,
          maxHeight: "calc(100vh - 180px)",
          overflowY: legendCollapsed ? "hidden" : "auto",
          overflowX: "hidden",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: legendCollapsed ? 0 : 10,
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: canvasTheme[theme].subtleText,
              lineHeight: 1.4,
              fontFamily: "monospace",
            }}
            title="Click any item to highlight it on the graph. Click again to clear."
          >
            {legendCollapsed ? "Legend" : "Click to highlight"}
          </div>
          <button
            type="button"
            onClick={() => setLegendCollapsed((v) => !v)}
            style={{
              fontSize: 9,
              padding: "2px 6px",
              borderRadius: 999,
              border: `1px solid ${canvasTheme[theme].legendDivider}`,
              background: "transparent",
              color: canvasTheme[theme].subtleText,
              cursor: "pointer",
              fontFamily: "monospace",
              flexShrink: 0,
            }}
            title={legendCollapsed ? "Expand legend" : "Collapse legend"}
          >
            {legendCollapsed ? "▸" : "▾"}
          </button>
        </div>

        {!legendCollapsed && (
        <>
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: canvasTheme[theme].legendSectionTitleText,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontFamily: "monospace",
              }}
            >
              Layers
            </div>
            <button
              type="button"
              onClick={() => setShowLayerBands((v) => !v)}
              style={{
                fontSize: 9,
                padding: "2px 6px",
                borderRadius: 999,
                border: `1px solid ${canvasTheme[theme].legendDivider}`,
                background: showLayerBands ? "#1e293b" : "transparent",
                color: showLayerBands ? "#e6edf3" : canvasTheme[theme].subtleText,
                cursor: "pointer",
                fontFamily: "monospace",
              }}
              title={showLayerBands ? "Hide layer grouping bands" : "Show layer grouping bands"}
            >
              Layers {showLayerBands ? "ON" : "OFF"}
            </button>
          </div>
          {legendLayers.length === 0 && (
            <div
              style={{
                fontSize: 11,
                color: canvasTheme[theme].subtleText,
                fontFamily: "'JetBrains Mono','Fira Code',monospace",
              }}
            >
              No layers present in this graph.
            </div>
          )}
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
              <span
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 6px",
                  borderRadius: 999,
                  border: `1px solid ${canvasTheme[theme].legendDivider}`,
                  background: "#020617",
                }}
                title={key}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: "#0f172a",
                    fontSize: 9,
                    fontWeight: 600,
                  }}
                >
                  {TECH_ICON[key] ?? "•"}
                </span>
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
            Runtime heatmap
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              fontSize: 9,
              color: canvasTheme[theme].subtleText,
              fontFamily: "monospace",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 20,
                  height: 2,
                  background: "#3fb950",
                  borderRadius: 1,
                }}
              />
              <span>{"< 100ms latency"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 20,
                  height: 2,
                  background: "#eab308",
                  borderRadius: 1,
                }}
              />
              <span>{"100–300ms latency"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 20,
                  height: 2,
                  background: "#f85149",
                  borderRadius: 1,
                }}
              />
              <span>{"> 300ms latency"}</span>
            </div>
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
        {runtimeSnapshot && (Object.keys(runtimeSnapshot.edges).length > 0 || Object.keys(runtimeSnapshot.nodes).length > 0) && (
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
              Runtime latency
            </div>
            {[
              { label: "< 100ms", color: "#3fb950" },
              { label: "< 300ms", color: "#eab308" },
              { label: "≥ 300ms", color: "#f85149" },
            ].map(({ label, color }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 8px",
                  marginBottom: 2,
                }}
              >
                <div style={{ width: 20, height: 2, flexShrink: 0, background: color, borderRadius: 1 }} />
                <span style={{ fontSize: 10, color: canvasTheme[theme].panelText, fontFamily: "monospace" }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        )}
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
                color: "#8b949e",
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
        </>
        )}
      </div>
      )}
    </div>
  );
}
