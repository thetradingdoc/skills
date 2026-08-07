import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { chatToMarkdown, chatFilename } from "./chatExport";
import OnboardingChat from "./OnboardingChat";
import ProfileBillingPanel from "./ProfileBillingPanel";
import { ProviderIcon } from "./ProviderIcon";
import { LandingPage } from "./LandingPage";
import { buildAssessment } from "./assessment";
import { AssessmentView } from "./AssessmentView";
import { FlowView } from "./FlowView";
import { ChangesView } from "./ChangesView";
import { TerminalPanel } from "./TerminalPanel";
import { ArchCanvas } from "./ArchCanvas";
import AgentsView from "./AgentsView";
import ReachView from "./ReachView";
import ResourcesView from "./ResourcesView";
import GuardView from "./GuardView";
import LayersView from "./LayersView";
import StandardView from "./StandardView";
import CodeViewerPanel from "./CodeViewerPanel";
import { ChangesPanel } from "./ChangesPanel";
import { StalenessBanner } from "./StalenessBanner";
import { FileViewer } from "./FileViewer";
import { FileBrowser } from "./FileBrowser";
import { FilesView } from "./FilesView";
import { DashboardView } from "./DashboardView";
import { FileIssues } from "./FileIssues";
import type {
  ArchGraph,
  GraphCommand,
  CriticViolation,
  ArchNode,
  BackgroundTask,
  WorkspaceSceneDoc,
  WorkspaceAnnotation,
  WorkspaceRuntimeSnapshot,
  ArchitectureChatMessage,
  Persona,
} from "./types";
import type { CanvasDensity } from "./theme";
import {
  ACCENT,
  ACCENT_WASH,
  BAD,
  CANVAS,
  FONT_BRAND,
  FONT_UI,
  GOOD,
  INK,
  LINE,
  PAPER,
  SLATE,
} from "./theme/tokens";
import { analyseGraph, type EdgeFilter, type NodeFilter } from "./analysis/graphAnalyser";
import { computeGraphInsights } from "./analysis/graphInsights";
import { SystemInsightsPanel } from "./SystemInsightsPanel";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { supabase, getSupabaseConfigError } from "./supabaseClient";
import { logAuthHashErrors, logAuthStateChange } from "./authDebug";
import { WorkspaceMembersPanel } from "./WorkspaceMembersPanel";
import { NotificationsBell } from "./NotificationsBell";
import { ActivityLogPanel } from "./ActivityLogPanel";
import { AnnotationCommentsPanel } from "./AnnotationCommentsPanel";
import { ScanHistoryPanel } from "./ScanHistoryPanel";
import { SnapshotSelectorPanel } from "./SnapshotSelectorPanel";
import { ConnectGitHubModal } from "./ConnectGitHubModal";
import { DesignPalette } from "./DesignPalette";
import { DesignInspectPanel } from "./DesignInspectPanel";
import { useDesignGraphSync, type GraphPatch } from "./useDesignGraphSync";
import { mergeGraphs, type SyncGraph, type SyncNode } from "./graphSync";
import { NodeCollabMeta } from "./NodeCollabMeta";
import { NodeLlmopsPanel } from "./NodeLlmopsPanel";
import { isAgentNode as isAgentLikeNode, computeAgentShapeDrift as computeClientAgentShapeDrift } from "./llmopsDrift";
import { DesignReviewPanel } from "./DesignReviewPanel";
import { DesignBuildPlanPanel } from "./DesignBuildPlanPanel";
import { MaterializeDesignButton } from "./MaterializeDesignButton";
import { PlatformInventoryView } from "./PlatformInventoryView";
import { UsageView } from "./UsageView";
import { ManagementRollupView } from "./ManagementRollupView";
import { DevOpsHealthView } from "./DevOpsHealthView";
import { evaluateDesign, type DesignFinding } from "./designRules";
import {
  applyDesignCommandsToGraph,
  buildItemToNode,
  createBlankDesignGraph,
  createDesignEdge,
  draftEdgesToArchEdges,
  draftNodesToArchNodes,
  deleteDesignEdge,
  deleteDesignNode,
  isDesignGraph,
  paletteItemToNode,
  setDesignNodeBuildStatus,
  setDesignNodePosition,
  applyPositionsToGraph,
  updateDesignEdge,
  updateDesignNode,
  DESIGN_PALETTE,
} from "./greenfieldDesign";
import {
  ScenePanel,
  DockRail,
  DockFrame,
  BuildPanel,
  InsightsPanel,
  EvidencePanel,
  ChatBar,
  ChromeBar,
  EdgeTeachStrip,
  ViewShell,
  getBuildItem,
  type DockMode,
  type OverflowView,
} from "./blanko";
import { buildPlatformInventory } from "./platformInventory";
import { getDesignKnowledge } from "./designKnowledge";
import { planFromGraph, nextStep } from "./buildPlan";
import { DESIGN_BLUEPRINTS, forkBlueprint } from "./designBlueprints";
import { computeLayerLayout } from "./layout/layerLayout";
import type { EdgeRelation } from "./types";

import {
  exportArchitectureSvg,
  exportArchitectureMarkdown,
  exportC4PlantUml,
  exportMermaid,
  exportPlantUml,
  exportSceneBundle,
  exportDesignPng,
  exportDesignReadme,
  exportDesignAdr,
  exportDesignScoreCard,
  importSceneBundle,
} from "./exporters";
import { safeStorageGet, safeStorageSet, safeStorageRemove } from "./utils/safeStorage";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

const API_BASE = "/api";

/* Auth modal (light) — shared field/button/banner styling. */
const authFieldStyle: React.CSSProperties = {
  padding: "12px 14px",
  background: CANVAS,
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  color: INK,
  fontFamily: FONT_UI,
  fontSize: 14,
};

const authPrimaryBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "13px 16px",
  borderRadius: 10,
  border: "1px solid transparent",
  cursor: "pointer",
  background: INK,
  color: CANVAS,
  fontFamily: FONT_UI,
  fontWeight: 600,
  fontSize: 14,
  boxShadow: "0 1px 2px rgba(18,19,26,0.08)",
};

const authGhostBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 10,
  border: `1px solid ${LINE}`,
  cursor: "pointer",
  background: CANVAS,
  color: INK,
  fontFamily: FONT_UI,
  fontWeight: 600,
  fontSize: 14,
};

const authBannerStyle = (tone: "bad" | "good"): React.CSSProperties => ({
  padding: "10px 12px",
  border: `1px solid ${tone === "bad" ? "#FECACA" : "#BBF7D0"}`,
  background: tone === "bad" ? "#FEF2F2" : "#F0FDF4",
  color: tone === "bad" ? BAD : GOOD,
  fontFamily: FONT_UI,
  fontSize: 12,
  borderRadius: 10,
  marginBottom: 14,
});

/** Ensure profile row exists after email confirmation redirect (profile insert may have been skipped). */
async function ensureProfile(accessToken: string): Promise<void> {
  if (!supabase) return;

  const { data: userData } = await supabase.auth.getUser(accessToken);
  const user = userData?.user;
  if (!user) return;

  const { data: existing } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) return;

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const nickname =
    typeof meta.nickname === "string"
      ? meta.nickname
      : user.email?.split("@")[0] ?? "user";
  const firstName = typeof meta.first_name === "string" ? meta.first_name : "";
  const lastName = typeof meta.last_name === "string" ? meta.last_name : "";

  await supabase.from("profiles").insert({
    user_id: user.id,
    first_name: firstName,
    last_name: lastName,
    nickname,
  });
}

function violationKey(v: CriticViolation): string {
  return `${v.type}:${v.sourceNodeId}:${v.targetNodeId ?? ""}`;
}

/** Pure merge of violations into graph nodes, including jiraKey/jiraStatus (p14). */
function mergeViolationsIntoGraph(graph: ArchGraph, violations: CriticViolation[]): ArchGraph {
  if (!violations.length) return graph;
  const storedByKey = new Map(violations.map((v) => [violationKey(v), v]));
  const relevantForNode = (n: ArchNode) =>
    violations.filter((v) => v.sourceNodeId === n.id || v.targetNodeId === n.id);
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const existingVs = node.violationState?.violations ?? [];
      const storedForNode = relevantForNode(node);
      const mergedVs = [
        ...existingVs.map((v) => {
          const s = storedByKey.get(violationKey(v));
          return s?.jiraKey ? { ...v, jiraKey: s.jiraKey, jiraStatus: s.jiraStatus } : v;
        }),
        ...storedForNode.filter(
          (s) => !existingVs.some((ev) => violationKey(ev) === violationKey(s))
        ),
      ];
      if (mergedVs.length === 0) return node;
      const highest = mergedVs
        .map((x) => x.severity)
        .sort(
          (a, b) =>
            (["critical", "high", "medium"] as const).indexOf(a as "critical" | "high" | "medium") -
            (["critical", "high", "medium"] as const).indexOf(b as "critical" | "high" | "medium")
        )[0] ?? null;
      return {
        ...node,
        violationState: { violations: mergedVs, highestSeverity: highest },
      } as ArchNode;
    }),
  };
}

function RememberThisButton({
  content,
  nodeId,
  workspaceId,
  accessToken,
}: {
  content: string;
  nodeId?: string;
  workspaceId: string;
  accessToken: string;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleClick = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/memories`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content, nodeId: nodeId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSaved(true);
    } catch (err) {
      console.error("Remember this failed:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={saving || saved}
      title="Save this to workspace memory"
      style={{
        padding: "2px 8px",
        fontSize: 10,
        borderRadius: 4,
        border: "1px solid #334155",
        background: saved ? "rgba(34,197,94,0.2)" : "transparent",
        color: saved ? "#4ade80" : "#8b949e",
        cursor: saving || saved ? "default" : "pointer",
      }}
    >
      {saved ? "Saved" : saving ? "Saving…" : "Remember this"}
    </button>
  );
}

function BlankoScene() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || webglFailed) return;

    const w = window.innerWidth;
    const h = window.innerHeight;

    let renderer: THREE.WebGLRenderer;
    try {
      const probe = document.createElement("canvas");
      const gl =
        probe.getContext("webgl") || probe.getContext("experimental-webgl");
      if (!gl) {
        setWebglFailed(true);
        return;
      }
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setWebglFailed(true);
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
    camera.position.set(-7, -5, 11);
    camera.lookAt(0, 0, 0);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0xffffff, 1);
    renderer.domElement.style.position = "fixed";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.zIndex = "0";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.pointerEvents = "none";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enableZoom = false;
    controls.minPolarAngle = Math.PI / 3;
    controls.maxPolarAngle = Math.PI / 2.2;

    const vertexShader = `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform float uTime;
      uniform float uCircleSpacing;
      uniform float uLineWidth;
      uniform float uSpeed;
      uniform float uFadeEdge;
      uniform vec3 uCameraPosition;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;

      void main() {
        vec2 center = vec2(0.5, 0.5);
        vec2 uv = vUv;
        float dist = distance(uv, center);

        float animatedDist = dist - uTime * uSpeed;

        float circle = mod(animatedDist, uCircleSpacing);

        float distFromEdge = min(circle, uCircleSpacing - circle);

        float aaWidth = length(vec2(dFdx(animatedDist), dFdy(animatedDist))) * 2.0;
        float lineAlpha = 1.0 - smoothstep(uLineWidth - aaWidth, uLineWidth + aaWidth, distFromEdge);

        vec3 baseColor = mix(vec3(1.0), vec3(0.0), lineAlpha);

        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(uCameraPosition - vPosition);

        vec3 lightDir = normalize(vec3(5.0, 10.0, 5.0));
        float NdotL = max(dot(normal, lightDir), 0.0);

        vec3 diffuse = baseColor * (0.5 + 0.5 * NdotL);

        vec3 reflectDir = reflect(-lightDir, normal);
        float spec = pow(max(dot(viewDir, reflectDir), 0.0), 64.0);
        vec3 specular = vec3(1.0) * spec * 0.8;

        float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
        vec3 fresnelColor = vec3(1.0) * fresnel * 0.3;

        vec3 finalColor = diffuse + specular + fresnelColor;

        float edgeFade = smoothstep(0.5 - uFadeEdge, 0.5, dist);
        float alpha = 1.0 - edgeFade;

        gl_FragColor = vec4(finalColor, alpha);
      }
    `;

    const floorGeometry = new THREE.CircleGeometry(20, 200);
    const floorMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0.0 },
        uCircleSpacing: { value: 0.06 },
        uLineWidth: { value: 0.02 },
        uSpeed: { value: 0.01 },
        uFadeEdge: { value: 0.2 },
        uCameraPosition: { value: new THREE.Vector3() },
      },
      side: THREE.DoubleSide,
      transparent: true,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1;
    floor.receiveShadow = true;
    scene.add(floor);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    let time = 0;
    let frameId: number;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      time += 0.016;
      (floorMaterial.uniforms.uTime as any).value = time;

      const cameraWorldPos = new THREE.Vector3();
      camera.getWorldPosition(cameraWorldPos);
      (floorMaterial.uniforms.uCameraPosition as any).value.copy(cameraWorldPos);

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    const onResize = () => {
      const newW = window.innerWidth;
      const newH = window.innerHeight;
      renderer.setSize(newW, newH);
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
    };

    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [webglFailed]);

  if (webglFailed) {
    return (
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse at 30% 40%, #e8eef7 0%, #f5f7fb 45%, #ffffff 100%)",
        }}
      />
    );
  }

  return <div ref={containerRef} style={{ position: "fixed", inset: 0, zIndex: 0 }} />;
}

function BlankoCursor() {
  const cursorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const cursorEl = cursorRef.current;
    if (!cursorEl) return;

    const handleMove = (e: MouseEvent) => {
      cursorEl.style.left = `${e.clientX}px`;
      cursorEl.style.top = `${e.clientY}px`;
    };

    const handleEnter = () => {
      cursorEl.style.width = "30px";
      cursorEl.style.height = "30px";
    };

    const handleLeave = () => {
      cursorEl.style.width = "8px";
      cursorEl.style.height = "8px";
    };

    document.addEventListener("mousemove", handleMove);

    const interactive = Array.from(
      document.querySelectorAll("a,button,input,textarea,select,[data-ll-interactive='true']")
    );
    interactive.forEach((el) => {
      el.addEventListener("mouseenter", handleEnter);
      el.addEventListener("mouseleave", handleLeave);
    });

    return () => {
      document.removeEventListener("mousemove", handleMove);
      interactive.forEach((el) => {
        el.removeEventListener("mouseenter", handleEnter);
        el.removeEventListener("mouseleave", handleLeave);
      });
    };
  }, []);

  return (
    <div
      ref={cursorRef}
      style={{
        position: "fixed",
        width: 8,
        height: 8,
        background: "#ef32a6",
        borderRadius: "50%",
        pointerEvents: "none",
        zIndex: 9999,
        transform: "translate(-50%, -50%)",
        mixBlendMode: "multiply",
        transition: "width 0.18s ease, height 0.18s ease",
      }}
    />
  );
}

function DesignBlueprintGallery({ onFork }: { onFork: (blueprintId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="design-blueprint-gallery" style={{ marginTop: 8, pointerEvents: "auto" }}>
      <button
        type="button"
        data-testid="design-blueprint-gallery-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          padding: "8px 10px",
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 8,
          color: "#12131A",
          fontSize: 12,
          cursor: "pointer",
          fontWeight: 600,
          textAlign: "left",
        }}
      >
        {open ? "Hide starting points ▴" : "Or start from a blueprint →"}
      </button>
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {DESIGN_BLUEPRINTS.map((bp) => (
            <div
              key={bp.id}
              data-testid={`design-blueprint-${bp.id}`}
              style={{
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                padding: 10,
                background: "#FAFAFA",
                textAlign: "left",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#12131A", marginBottom: 3 }}>{bp.title}</div>
              <div style={{ fontSize: 11, color: "#6B7280", lineHeight: 1.4, marginBottom: 8 }}>{bp.summary}</div>
              <button
                type="button"
                data-testid={`design-blueprint-fork-${bp.id}`}
                onClick={() => onFork(bp.id)}
                style={{
                  padding: "6px 10px",
                  background: "#FDF2F8",
                  border: "1px solid #ef32a655",
                  borderRadius: 6,
                  color: "#ef32a6",
                  fontSize: 11,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Fork this design →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SCAN_ONLY_VIEW_LABEL: Record<string, string> = {
  assessment: "Review",
  agents: "Agents",
  files: "Files",
  reach: "Reach",
  resources: "Resources",
  flow: "Flow",
  layers: "Layers",
  standard: "Standard",
  guard: "Guard",
  changes: "Changes",
  terminal: "Terminal",
};

/** Design mode has no repo on disk yet, so scan-derived tabs have nothing to show. */
function ScanOnlyPlaceholder({ view }: { view: string }) {
  return (
    <div
      data-testid="design-scan-only-placeholder"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: SLATE,
        fontSize: 13,
        textAlign: "center",
        padding: 24,
        background: PAPER,
        fontFamily: FONT_UI,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 6 }}>
          {SCAN_ONLY_VIEW_LABEL[view] ?? view} isn’t available in design mode
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: SLATE }}>
          Available after you import or scan a repo.
        </div>
      </div>
    </div>
  );
}

// ── Dashboard UI helpers ───────────────────────────────────────────────────────

type DashboardCardProps = {
  title: string;
  children: React.ReactNode;
  rightHeaderContent?: React.ReactNode;
  style?: React.CSSProperties;
};

function DashboardCard({ title, children, rightHeaderContent, style }: DashboardCardProps) {
  return (
    <div
      style={{
        background: "#1c2128",
        borderRadius: 8,
        border: "1px solid #30363d",
        padding: 12,
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
          gap: 8,
        }}
      >
        <div
          style={{
            color: "#7d8590",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {title}
        </div>
        {rightHeaderContent}
      </div>
      {children}
    </div>
  );
}

type DashboardMetricProps = {
  value: number | string;
  label: string;
  color?: string;
  subLabel?: string;
  subColor?: string;
};

function DashboardMetric({ value, label, color, subLabel, subColor }: DashboardMetricProps) {
  return (
    <div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: color ?? "#e6edf3",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "#7d8590",
        }}
      >
        {label}
      </div>
      {subLabel && (
        <div
          style={{
            fontSize: 10,
            color: subColor ?? "#7d8590",
            marginTop: 2,
          }}
        >
          {subLabel}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [graph, setGraphRaw] = useState<ArchGraph | null>(null);
  /**
   * Scans ship tool catalogs deduplicated: agents that share an identical tool
   * lcarry a catalogId instead of their own copy. Expand once here so every
   * view can read agent.tools as before.
   */
  const setGraph = useCallback<typeof setGraphRaw>((value) => {
    const expand = (g: ArchGraph | null): ArchGraph | null => {
      const inv = g?.agents as any;
      if (!inv?.toolCatalogs || !Array.isArray(inv.agents)) return g;
      for (const a of inv.agents) {
        if (a.catalogId && inv.toolCatalogs[a.catalogId]) {
          a.tools = inv.toolCatalogs[a.catalogId];
        }
      }
      return g;
    };
    if (typeof value === "function") {
      setGraphRaw((prev) => expand((value as (p: ArchGraph | null) => ArchGraph | null)(prev)));
    } else {
      setGraphRaw(expand(value));
    }
  }, []);
  const [selectedAgentFile, setSelectedAgentFile] = useState<string | null>(null);
  const effectiveGraph = useMemo(() => {
    if (!graph) return null;

    const nodes = graph.nodes.map((n) => {
      const tags = n.tags ?? [];
      const fileCount = (n.semanticSignals?.fileCount as number | undefined) ?? (n.files?.length ?? 0);
      const complexity =
        n.complexity ??
        (fileCount >= 12 ? "complex" : fileCount >= 5 ? "moderate" : "simple");
      return {
        ...n,
        summary: n.summary ?? n.description,
        tags,
        complexity,
      };
    });

    const layers =
      graph.layers && graph.layers.length > 0
        ? graph.layers
        : (() => {
            const byKey = new Map<string, { id: string; name: string; nodeIds: string[] }>();
            for (const n of nodes) {
              const key = (n.domain ?? (n.layer ?? "Uncategorized")) as string;
              const id = `layer:${key}`;
              const existing = byKey.get(id) ?? { id, name: key, nodeIds: [] };
              existing.nodeIds.push(n.id);
              byKey.set(id, existing);
            }
            return Array.from(byKey.values()).sort((a, b) => b.nodeIds.length - a.nodeIds.length);
          })();

    const tour =
      graph.tour && graph.tour.length > 0
        ? graph.tour
        : layers.slice(0, 8).map((l, i) => ({
            order: i + 1,
            title: l.name,
            description: `This step focuses on **${l.name}** and its core modules.\n\nUse the pills below to jump between key components.`,
            nodeIds: l.nodeIds.slice(0, 12),
          }));

    return { ...graph, nodes, layers, tour };
  }, [graph]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [workspaceScene, setWorkspaceScene] = useState<WorkspaceSceneDoc | null>(null);
  const [workspaceAnnotations, setWorkspaceAnnotations] = useState<WorkspaceAnnotation[]>([]);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<EdgeFilter>>(new Set(["all"]));
  const [activeNodeFilters, setActiveNodeFilters] = useState<Set<NodeFilter>>(new Set(["all"]));
  const [persona, setPersona] = useState<Persona>("learn");
  const [graphSearch, setGraphSearch] = useState("");
  const graphSearchResults = useMemo(() => {
    const q = graphSearch.trim().toLowerCase();
    if (!q || !effectiveGraph) return [] as Array<{ nodeId: string; score: number }>;
    const results: Array<{ nodeId: string; score: number }> = [];
    for (const n of effectiveGraph.nodes) {
      const hay = `${n.suggestedLabel ?? ""} ${n.label ?? ""} ${n.path ?? ""} ${n.domain ?? ""} ${(n.tags ?? []).join(" ")}`.toLowerCase();
      const idx = hay.indexOf(q);
      if (idx === -1) continue;
      const score = idx === 0 ? 0.05 : idx < 10 ? 0.15 : idx < 40 ? 0.3 : 0.6;
      results.push({ nodeId: n.id, score });
    }
    results.sort((a, b) => a.score - b.score);
    return results.slice(0, 200);
  }, [graphSearch, effectiveGraph]);
  const [showInsightsPanel, setShowInsightsPanel] = useState(false);
  const [showSupplyChainRisk, setShowSupplyChainRisk] = useState(false);
  const [dependencyRisks, setDependencyRisks] = useState<
    Array<{ id: string; tool: string; report_json: unknown; created_at: string }>
  >([]);
  const [npmAuditRunning, setNpmAuditRunning] = useState(false);
  const toggleFilter = useCallback((f: EdgeFilter) => {
    if (f === "all") {
      setActiveFilters(new Set(["all"]));
      return;
    }
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete("all");
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next.size > 0 ? next : new Set<EdgeFilter>(["all"]);
    });
  }, []);

  const toggleNodeFilter = useCallback((f: NodeFilter) => {
    if (f === "all") {
      setActiveNodeFilters(new Set(["all"]));
      return;
    }
    setActiveNodeFilters((prev) => {
      const next = new Set(prev);
      next.delete("all");
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next.size > 0 ? next : new Set<NodeFilter>(["all"]);
    });
  }, []);
  const [aiQuestion, setAiQuestion] = useState("");
  const [pdfAttachment, setPdfAttachment] = useState<{ name: string; base64: string } | null>(null);
  const [docAttachment, setDocAttachment] = useState<{ name: string; extractedText: string } | null>(null);
  const [pdfDragOver, setPdfDragOver] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const processPdfFile = useCallback((f: File) => {
    if (f.size > 25 * 1024 * 1024) {
      setError("PDF must be under 25MB.");
      return;
    }
    setDocAttachment(null);
    const r = new FileReader();
    r.onload = () => {
      const b64 = typeof r.result === "string" ? r.result.replace(/^data:[^;]+;base64,/, "") : "";
      if (b64) setPdfAttachment({ name: f.name, base64: b64 });
    };
    r.readAsDataURL(f);
  }, []);

  const processDocFile = useCallback(async (f: File) => {
    if (f.size > 10 * 1024 * 1024) {
      setError("Word document must be under 10MB.");
      return;
    }
    setPdfAttachment(null);
    try {
      const mammoth = await import("mammoth");
      const arr = await f.arrayBuffer();
      const { value } = await mammoth.extractRawText({ arrayBuffer: arr });
      const text = (value ?? "").trim();
      if (!text) {
        setError("Could not extract text from that document — it may be empty or corrupted.");
        return;
      }
      setDocAttachment({ name: f.name, extractedText: text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not read that document: ${msg}. Try saving it as .docx.`);
    }
  }, []);

  const processAttachmentFile = useCallback(
    (f: File) => {
      const lower = f.name.toLowerCase();
      const isPdf = f.type === "application/pdf" || lower.endsWith(".pdf");
      const isDoc = f.type === "application/msword" || f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || lower.endsWith(".doc") || lower.endsWith(".docx");
      if (isPdf) processPdfFile(f);
      else if (isDoc) processDocFile(f);
      else setError("Attach a PDF or Word document (.doc, .docx).");
    },
    [processPdfFile, processDocFile]
  );
  const [chatTabs, setChatTabs] = useState([{ id: "1", label: "Chat 1" }]);
  const [activeChatId, setActiveChatId] = useState("1");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  useEffect(() => {
    setActiveThreadId(null);
  }, [activeWorkspaceId]);
  const [chatSessions, setChatSessions] = useState<Record<string, ArchitectureChatMessage[]>>(
    { "1": [] }
  );
  const [chatLoading, setChatLoading] = useState(false);
  const [agentGraphCommand, setAgentGraphCommand] = useState<GraphCommand | null>(null);
  const [activeViolations, setActiveViolations] = useState<CriticViolation[]>([]);
  const [violationsCollapsed, setViolationsCollapsed] = useState(false);
  const [violationsRestoreError, setViolationsRestoreError] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"dashboard" | "chat" | "code">("dashboard");
  /** Right control panel closed by default — canvas full-bleed until wall click. */
  const [dockMode, setDockMode] = useState<DockMode | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  /** Insights Edit details expanded (double-click / place). */
  const [insightsEditOpen, setInsightsEditOpen] = useState(false);
  const [dockWidth, setDockWidth] = useState(360);
  const [sceneCollapsed, setSceneCollapsed] = useState(true);
  /** Collapsed by default (composer pill only). Expand for history / seeds; proposals peek without expand. */
  const [chatExpanded, setChatExpanded] = useState(false);
  const [configMenuOpen, setConfigMenuOpen] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<GraphCommand[] | null>(null);
  const [chatOnlyNotice, setChatOnlyNotice] = useState(false);
  const [importFindings, setImportFindings] = useState<DesignFinding[]>([]);
  const [graphUndoStack, setGraphUndoStack] = useState<ArchGraph[]>([]);
  const [flashNodeIds, setFlashNodeIds] = useState<string[]>([]);
  const [lastAcceptWhy, setLastAcceptWhy] = useState<string | null>(null);
  const [showHealthBadges, setShowHealthBadges] = useState(true);
  const blankoShell = true;
  const [greenfieldSessionId, setGreenfieldSessionId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("greenfieldSessionId");
    } catch {
      return null;
    }
  });
  const [pendingDesignIntent, setPendingDesignIntent] = useState(false);
  const [graphViewMode, setGraphViewMode] = useState<"2d" | "3d" | "agents" | "reach" | "resources" | "guard" | "layers" | "standard" | "assessment" | "flow" | "changes" | "terminal" | "files" | "platforms" | "usage" | "rollup" | "devops">("2d");
  const [layersAgentFile, setLayersAgentFile] = useState<string | null>(null);
  const [graphCanvasViewMode, setGraphCanvasViewMode] =
    useState<"architecture" | "domains" | "runtime" | "failure">("architecture");

  const personaNodeFilters = useMemo(() => {
    if (persona === "overview") {
      return new Set<NodeFilter>(["core"]);
    }
    // learn and deep_dive default to whatever the user has chosen.
    return activeNodeFilters;
  }, [persona, activeNodeFilters]);

  // Persona presets: node filters and sidebar tab.

  useEffect(() => {
    if (persona === "overview") {
      setActiveNodeFilters(new Set<NodeFilter>(["core"]));
      setSidebarTab("dashboard");
    } else if (persona === "learn") {
      setSidebarTab("dashboard");
    } else if (persona === "deep_dive") {
      setActiveNodeFilters(new Set<NodeFilter>(["all"]));
      setSidebarTab("chat");
    }
  }, [persona]);
  const [dashboardLastSeenViolations, setDashboardLastSeenViolations] = useState(0);
  const [showThinkingPanel, setShowThinkingPanel] = useState<boolean>(false);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const backgroundTasksRef = useRef<BackgroundTask[]>([]);
  backgroundTasksRef.current = backgroundTasks;
  const tasksForWorkspace = useMemo(
    () =>
      backgroundTasks.filter(
        (t) => !activeWorkspaceId || t.workspaceId === activeWorkspaceId
      ),
    [backgroundTasks, activeWorkspaceId]
  );
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [lastCriticResult, setLastCriticResult] = useState<{
    score: number;
    report: string;
    violations: CriticViolation[];
  } | null>(null);

  // ── Autosave ──────────────────────────────────────────────────────────────
  const [autosaveEnabled, setAutosaveEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("autosaveLastWorkspace") !== "off";
    } catch {
      return true;
    }
  });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showOnboardingChat, setShowOnboardingChat] = useState(false);
  const [showProfileBilling, setShowProfileBilling] = useState(false);
  const [onboardingIntent, setOnboardingIntent] = useState<string | null>(null);
  /** The picture is free to read; keeping it needs an account. Save, Share and
   *  Export all land here rather than failing silently. */
  const promptSignup = useCallback((what: string) => {
    setOnboardingIntent(`Create an account to ${what}.`);
    setShowOnboardingChat(true);
  }, []);

  // SharedView / deep links: /?get-started=1&intent=... opens the signup chat.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("get-started") !== "1" && params.get("signup") !== "1") return;
      const intent =
        params.get("intent")?.trim() ||
        "Create an account to keep, share, and use AI on designs you view.";
      setOnboardingIntent(intent);
      setShowOnboardingChat(true);
      params.delete("get-started");
      params.delete("signup");
      params.delete("intent");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", next);
    } catch {
      // ignore
    }
  }, []);

  const [authMode, setAuthMode] = useState<"signin" | "signup" | "reset">("signup");
  const [signupPendingConfirmation, setSignupPendingConfirmation] = useState(false);
  const [showNewRepoConfirm, setShowNewRepoConfirm] = useState(false);
  const [showWorkspaceDropUp, setShowWorkspaceDropUp] = useState(false);
  const [savedWorkspaces, setSavedWorkspaces] = useState<
    Array<{
      id: string;
      name: string;
      created_at: string;
      thumbnail_base64?: string | null;
      last_scan_at?: string | null;
      node_count?: number;
      violation_count?: number;
    }>
  >([]);
  const [archivedWorkspaces, setArchivedWorkspaces] = useState<
    Array<{
      id: string;
      name: string;
      created_at: string;
      archived_at?: string | null;
      thumbnail_base64?: string | null;
      last_scan_at?: string | null;
      node_count?: number;
      violation_count?: number;
    }>
  >([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [loadingWorkspaceId, setLoadingWorkspaceId] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<"unknown" | "ok" | "mismatch">("unknown");
  const [authStatusMessage, setAuthStatusMessage] = useState<string | null>(null);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [threadListOpen, setThreadListOpen] = useState(false);
  const [threadList, setThreadList] = useState<Array<{ id: string; title: string; created_at?: string; updated_at?: string }>>([]);
  const [threadSearch, setThreadSearch] = useState("");
  const [threadListLoading, setThreadListLoading] = useState(false);
  const [tokenWarning, setTokenWarning] = useState<{ input: number; output: number; overBudget?: boolean } | null>(null);
  /** Theme, density, presentation, runtime, 2D/3D and the legend only affect the
   *  module canvas. On Layers, Standard, Agents, Reach, Resources and Guard they
   *  are noise, so the bar hides them there. */
  const isCanvasView = graphViewMode === "2d";
  const backToCanvas = useCallback(() => {
    setGraphViewMode("2d");
    setConfigMenuOpen(false);
    setDockOpen(false);
  }, []);
  // Canvas controls sit behind a toggle rather than in the bar. They belong to
  // one view, and a header that grows when you switch tabs reads as unstable.
  const [showCanvasControls, setShowCanvasControls] = useState(false);
  // Default light to match blanko white chrome (Phase 3+). Dark remains a View toggle.
  const [canvasTheme, setCanvasTheme] = useState<"dark" | "light">("light");
  const [canvasDensity, setCanvasDensity] = useState<CanvasDensity>("standard");
  const [presentationMode, setPresentationMode] = useState(false);
  const [sceneEditMode, setSceneEditMode] = useState(false);
  const [activeSceneStateId, setActiveSceneStateId] = useState<string | null>(null);
  const [scenePlaying, setScenePlaying] = useState(false);
  const [scenePlaybackSpeed, setScenePlaybackSpeed] = useState(1);
  const captureViewRef = useRef<(() => { viewport2D?: { x: number; y: number; zoom: number }; camera3D?: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } }) | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const [showActivityPanel, setShowActivityPanel] = useState(false);
  const [showScanHistoryPanel, setShowScanHistoryPanel] = useState(false);
  const [showSnapshotPanel, setShowSnapshotPanel] = useState(false);
  const [showConnectGitHubPanel, setShowConnectGitHubPanel] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get("github-connect") === "1" && !!p.get("workspaceId");
    } catch {
      return false;
    }
  });
  const [selectedAnnotationForComments, setSelectedAnnotationForComments] = useState<string | null>(null);
  const [activeWorkspaceIsOwner, setActiveWorkspaceIsOwner] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  /** The scanner sets projectName from the clone directory, which is
   *  arch-viz-<uuid>. Show the repository instead — that is what the user
   *  typed and what they will recognise. */
  const displayWorkspaceName = (() => {
    const n = graph?.projectName;
    if (n && !/^arch-viz-[0-9a-f-]{8,}/i.test(n) && n !== "My workspace") return n;
    const url = graph?.projectRoot || repoUrl || "";
    const m = String(url).match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    if (m) return m[2];
    return n || "My workspace";
  })();

  const [workspaceTitleEditing, setWorkspaceTitleEditing] = useState(false);
  const [workspaceTitleDraft, setWorkspaceTitleDraft] = useState("");
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panelWidth, setPanelWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  /** What a scan found, as four numbers. Module and connection counts say
   *  nothing about risk; these do. */
  /** Resources still needing a human decision. Shown as a count on the menu
   *  entry, since an unclassified resource is outstanding work rather than a
   *  view someone would browse to. */
  const unclassifiedCount = (() => {
    const inv = graph?.agents;
    const list = inv?.agents ?? [];
    const catalogs = inv?.toolCatalogs ?? {};
    const seen = new Set();
    for (const a of list) {
      const tools = Array.isArray(a.tools) ? a.tools : (a.catalogId ? (catalogs[a.catalogId] ?? []) : []);
      for (const t of tools) {
        for (const r of (t?.reach?.resources ?? [])) {
          if (r?.class === 'unclassified' && r?.name) seen.add(r.kind + ':' + r.name);
        }
      }
    }
    return seen.size;
  })();

  const agentSummaryStats = (() => {
    const inv = graph?.agents;
    const list = inv?.agents ?? [];
    const catalogs = inv?.toolCatalogs ?? {};
    const toolsOf = (a: any) => Array.isArray(a.tools) ? a.tools : (a.catalogId ? (catalogs[a.catalogId] ?? []) : []);
    const agents = list.filter((a: any) => a.kind === 'agent');
    // Five Retell surfaces share one catalog, so a tool must be counted once
    // no matter how many agents hold it. Key on catalog + name.
    const patientSet = new Set(), moneySet = new Set();
    let noAuth = 0;
    for (const a of agents) {
      const sensitive = toolsOf(a).some((t: any) =>
        t?.reach?.cells?.patient?.state === 'reaches' ||
        t?.reach?.cells?.money?.state === 'reaches');
      if (sensitive && !a.auth?.found) noAuth++;
      const key = a.catalogId || a.file;
      for (const t of toolsOf(a)) {
        const id = key + '::' + t?.name;
        if (t?.reach?.cells?.patient?.state === 'reaches') patientSet.add(id);
        if (t?.reach?.cells?.money?.state === 'reaches') moneySet.add(id);
      }
    }
    const patientTools = patientSet.size, moneyTools = moneySet.size;
    return { agents: agents.length, noAuth, patientTools, moneyTools };
  })();

  // Any view that names a file can open it here. Previously the only route to
  // source was clicking a node in the 2D module graph, which is the view least
  // concerned with agents.
  const [openFile, setOpenFile] = useState<{ path: string; line?: number } | null>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const panelWidthBeforeCollapseRef = useRef<number>(320);
  const leftPanelUserToggledRef = useRef(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const graphRef = useRef<typeof graph>(graph);
  const fixPromptRef = useRef<string | null>(null);
  const workspaceDropUpRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const tasksPollAbortRef = useRef<Map<string, boolean>>(new Map());
  const activeChatIdRef = useRef<string>(activeChatId);
  const chatTabsRef = useRef(chatTabs);
  const chatSessionsRef = useRef<Record<string, ArchitectureChatMessage[]>>(chatSessions);
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const chatPersistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<WorkspaceRuntimeSnapshot | null>(null);
  const [runtimeLive, setRuntimeLive] = useState(false);

  const downloadText = useCallback((filename: string, mime: string, text: string) => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // Poll latest runtime snapshot in live mode.
  useEffect(() => {
    if (!runtimeLive || !activeWorkspaceId || !accessToken) return;
    let cancelled = false;
    const API_BASE = "/api";
    const poll = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/workspaces/${encodeURIComponent(activeWorkspaceId)}/runtime/latest`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!res.ok) return;
        const data: { snapshot?: { id: string; workspace_id: string; recorded_at: string; snapshot_json: any } } =
          await res.json().catch(() => ({}));
        if (cancelled || !data.snapshot) return;
        const snapJson = data.snapshot.snapshot_json ?? {};
        setRuntimeSnapshot({
          id: data.snapshot.id,
          workspaceId: data.snapshot.workspace_id,
          recordedAt: data.snapshot.recorded_at,
          edges: (snapJson.edges ?? {}) as WorkspaceRuntimeSnapshot["edges"],
          nodes: (snapJson.nodes ?? {}) as WorkspaceRuntimeSnapshot["nodes"],
        });
      } catch {
        // ignore
      }
    };
    poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [runtimeLive, activeWorkspaceId, accessToken]);

  useEffect(() => {
    if (!showSupplyChainRisk || !activeWorkspaceId || !accessToken) {
      setDependencyRisks([]);
      return;
    }
    let cancelled = false;
    fetch(
      `${API_BASE}/workspaces/${encodeURIComponent(activeWorkspaceId)}/dependency-risks?limit=5`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        setDependencyRisks(data.risks ?? []);
      })
      .catch(() => {
        if (!cancelled) setDependencyRisks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showSupplyChainRisk, activeWorkspaceId, accessToken]);

  const vulnerableNodeIds = useMemo(() => {
    if (!showSupplyChainRisk || !graph || dependencyRisks.length === 0) return undefined;
    const latest = dependencyRisks[0];
    const report = latest?.report_json as {
      vulnerabilities?: Record<
        string,
        { via?: Array<string | { name?: string }>; severity?: string }
      >;
    } | null;
    if (!report?.vulnerabilities) return new Set<string>();
    const vulnPackages = new Set<string>();
    for (const [pkg] of Object.entries(report.vulnerabilities)) {
      vulnPackages.add(pkg);
      vulnPackages.add(pkg.replace(/^@[^/]+\//, "")); // @scope/pkg -> pkg
    }
    const nodeIds = new Set<string>();
    for (const node of graph.nodes) {
      const imports = node.semanticSignals?.externalImports ?? [];
      for (const imp of imports) {
        const base = imp.replace(/^@[^/]+\//, "");
        if (vulnPackages.has(imp) || vulnPackages.has(base)) {
          nodeIds.add(node.id);
          break;
        }
      }
    }
    return nodeIds;
  }, [showSupplyChainRisk, graph, dependencyRisks]);

  const runNpmAudit = useCallback(async () => {
    if (!activeWorkspaceId || !accessToken) return;
    setNpmAuditRunning(true);
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${encodeURIComponent(activeWorkspaceId)}/run-npm-audit`,
        { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setShowSupplyChainRisk(true);
        const refetch = async () => {
          const r = await fetch(
            `${API_BASE}/workspaces/${encodeURIComponent(activeWorkspaceId)}/dependency-risks?limit=5`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const d = await r.json().catch(() => ({}));
          setDependencyRisks(d.risks ?? []);
        };
        refetch();
      } else {
        setError(data.error ?? "Failed to run npm audit.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run npm audit.");
    } finally {
      setNpmAuditRunning(false);
    }
  }, [activeWorkspaceId, accessToken, promptSignup]);

  const handleSignOut = useCallback(async () => {
    if (!supabase || isSigningOut) return;
    setIsSigningOut(true);
    try {
      try {
        localStorage.removeItem("lastWorkspaceId");
      } catch {
        // ignore
      }
      await supabase.auth.signOut();
      setAccessToken(null);
      setActiveWorkspaceId(null);
      setActiveWorkspaceIsOwner(false);
      // Clear workspace so user lands on landing page (landing shows when !graph && !loading)
      setGraph(null);
      setSelectedNode(null);
      setChatTabs([{ id: "1", label: "Chat 1" }]);
      setActiveChatId("1");
      setChatSessions({ "1": [] });
      setAiQuestion("");
      setActiveViolations([]);
      setViolationsRestoreError(null);
      setAgentGraphCommand(null);
    } finally {
      setIsSigningOut(false);
    }
  }, [isSigningOut]);

  const handleNewRepo = useCallback(() => {
    try {
      localStorage.removeItem("lastWorkspaceId");
      localStorage.removeItem("greenfieldSessionId");
    } catch {
      // ignore
    }
    setGreenfieldSessionId(null);
    setGraph({
      nodes: [],
      edges: [],
      generatedAt: Date.now(),
      projectRoot: "",
      projectName: "My workspace",
    });
    setRepoUrl("");
    setActiveWorkspaceId(null);
    setActiveWorkspaceIsOwner(false);
    setSelectedNode(null);
    setChatTabs([{ id: "1", label: "Chat 1" }]);
    setActiveChatId("1");
    setChatSessions({ "1": [] });
    setAiQuestion("");
    setActiveViolations([]);
    setViolationsRestoreError(null);
    setAgentGraphCommand(null);
    setShowNewRepoConfirm(false);
    setShowWorkspaceDropUp(false);
  }, []);

  const isDesignMode = isDesignGraph(graph);

  // Post-V1 multiplayer: broadcast/receive node patches over a realtime
  // channel scoped to this workspace's design graph. Merge is pure (see
  // graphSync.ts) — this callback only ever *upserts* remote nodes into the
  // local graph; it never drops local-only nodes, so it can't clobber work
  // in progress on this tab.
  const handleRemoteGraphPatch = useCallback((patch: GraphPatch) => {
    if (patch.type !== "nodes_upsert" || !patch.nodes.length) return;
    setGraph((prev) => {
      if (!prev) return prev;
      const local: SyncGraph = {
        nodes: prev.nodes as unknown as SyncNode[],
        edges: prev.edges as unknown as SyncGraph["edges"],
        revision: prev.revision,
      };
      // No separate "base" snapshot is tracked client-side yet, so local
      // doubles as base — this degrades the 3-way merge to "remote nodes
      // win only where local didn't already change them more recently",
      // which is exactly the LWW behavior we want for a live patch stream.
      const merged = mergeGraphs(local, local, { nodes: patch.nodes, edges: [], revision: patch.revision });
      return {
        ...prev,
        nodes: merged.nodes as unknown as ArchGraph["nodes"],
        revision: merged.revision,
      };
    });
  }, [setGraph]);

  const { broadcastPatch, currentUserId: graphSyncUserId } = useDesignGraphSync(
    isDesignMode ? activeWorkspaceId : null,
    null,
    handleRemoteGraphPatch
  );

  const llmopsDriftSummary = useMemo(() => {
    if (!isDesignMode || !graph) return null;
    const drifts = computeClientAgentShapeDrift(graph.nodes, graph.edges);
    const needsAttention = drifts.filter((d) => d.severity !== "ok");
    if (needsAttention.length === 0) return null;
    return { count: needsAttention.length, drifts: needsAttention };
  }, [isDesignMode, graph]);
  const [designDashboardTab, setDesignDashboardTab] = useState<"review" | "plan">("review");
  const designFindings = useMemo(
    () => (isDesignMode && graph ? evaluateDesign(graph) : []),
    [isDesignMode, graph]
  );
  const designPlan = useMemo(
    () => (isDesignMode && graph ? planFromGraph(graph) : []),
    [isDesignMode, graph]
  );
  const designNextStep = useMemo(
    () => (isDesignMode && graph ? nextStep(designPlan, graph) : null),
    [isDesignMode, graph, designPlan]
  );
  const handleSetBuildStatus = useCallback(
    (nodeId: string, status: "planned" | "building" | "built") => {
      setGraph((prev) => (prev ? setDesignNodeBuildStatus(prev, nodeId, status) : prev));
    },
    []
  );
  const designAlertNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of designFindings) {
      if (f.severity === "blocker" || f.severity === "risk") {
        for (const id of f.nodeIds) ids.add(id);
      }
    }
    return [...ids];
  }, [designFindings]);
  const designAlertEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of designFindings) {
      if (f.severity === "blocker" || f.severity === "risk") {
        for (const id of f.edgeIds) ids.add(id);
      }
    }
    return [...ids];
  }, [designFindings]);

  const acceptProposal = useCallback(() => {
    if (!pendingProposal?.length || !graph) return;
    const cmds = pendingProposal;
    const snapshot = graph;
    setGraphUndoStack((stack) => [...stack.slice(-9), snapshot]);
    const next = applyDesignCommandsToGraph(graph, cmds);
    setGraph(next);
    const created = cmds.filter((c) => c.action === "create_node") as Array<
      Extract<GraphCommand, { action: "create_node" }>
    >;
    if (created[0]) setSelectedNode(created[0].id);
    setFlashNodeIds(created.map((c) => c.id));
    window.setTimeout(() => setFlashNodeIds([]), 1600);
    setLastAcceptWhy(
      created.length
        ? `Added ${created.map((c) => c.label).join(", ")} — Accept applies only what you approve.`
        : `Applied ${cmds.length} change(s) to the canvas.`
    );
    setPendingProposal(null);
    setChatOnlyNotice(false);
    setChatExpanded(false);
  }, [pendingProposal, graph]);

  const undoLastAccept = useCallback(() => {
    setGraphUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1]!;
      setGraph(prev);
      setLastAcceptWhy(null);
      setFlashNodeIds([]);
      return stack.slice(0, -1);
    });
  }, []);

  const rejectProposal = useCallback(() => {
    setPendingProposal(null);
    setChatOnlyNotice(false);
    setChatExpanded(false);
  }, []);

  const placeBuildItem = useCallback(
    (paletteId: string) => {
      if (!graph) return;
      const buildItem = getBuildItem(paletteId);
      const node = buildItem
        ? buildItemToNode(
            {
              ...buildItem,
              providerId:
                buildItem.providerId ??
                (paletteId === "retell-channel" ? "retell" : undefined),
            },
            graph.nodes.length
          )
        : paletteItemToNode(paletteId, graph.nodes.length);
      if (!node) return;
      setGraph({
        ...graph,
        nodes: [...graph.nodes, node],
        generatedAt: Date.now(),
      });
      setSelectedNode(node.id);
      // Node context lives in Insights (minimize: no separate Inspect overlay).
      setDockMode("insights");
      setDockOpen(true);
      setInsightsEditOpen(true);
    },
    [graph]
  );

  const platformInventory = useMemo(
    () => (graph ? buildPlatformInventory(graph) : []),
    [graph]
  );

  const allInsightsFindings = useMemo(
    () => [...designFindings, ...importFindings],
    [designFindings, importFindings]
  );

  const designFindingCounts = useMemo(() => {
    const map: Record<string, { count: number; severity: "blocker" | "risk" | "suggestion" }> = {};
    const rank = { blocker: 3, risk: 2, suggestion: 1 } as const;
    for (const f of allInsightsFindings) {
      for (const id of f.nodeIds) {
        const cur = map[id];
        if (!cur) {
          map[id] = { count: 1, severity: f.severity };
        } else {
          cur.count += 1;
          if (rank[f.severity] > rank[cur.severity]) cur.severity = f.severity;
        }
      }
    }
    return map;
  }, [allInsightsFindings]);

  useEffect(() => {
    if (importFindings.length > 0 || designFindings.some((f) => f.severity !== "suggestion")) {
      setShowHealthBadges(true);
    }
  }, [importFindings, designFindings]);

  useEffect(() => {
    if (!blankoShell) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDockOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [blankoShell]);

  // Playwright Phase 4 gate: inject proposals without burning AI credits.
  useEffect(() => {
    const w = window as unknown as {
      __BLANKO_E2E__?: boolean;
      __blankoE2E?: {
        setPendingProposal: (cmds: GraphCommand[]) => void;
        setChatOnlyNotice: () => void;
      };
    };
    if (!w.__BLANKO_E2E__) return;
    w.__blankoE2E = {
      setPendingProposal: (cmds) => {
        setPendingProposal(cmds);
        setChatOnlyNotice(false);
        setChatExpanded(true);
      },
      setChatOnlyNotice: () => {
        setPendingProposal(null);
        setChatOnlyNotice(true);
        setChatExpanded(true);
      },
    };
    return () => {
      delete w.__blankoE2E;
    };
  }, []);

  const openComponents = useCallback(() => {
    setDockMode("build");
    setDockOpen(true);
  }, []);

  const handleStartDesignFromScratch = useCallback(() => {
    setGraph(createBlankDesignGraph("New Design"));
    setRepoUrl("");
    setSelectedNode(null);
    setAgentGraphCommand(null);
    setGraphViewMode("2d");
    setSidebarTab("chat");
    setSceneCollapsed(true);
    setDockMode(null);
    setDockOpen(false);
    setChatExpanded(false);
    setPendingProposal(null);
    setChatOnlyNotice(false);
    setImportFindings([]);
    setAiQuestion("");
    setPendingDesignIntent(true);
    try {
      localStorage.removeItem("greenfieldSessionId");
    } catch {
      // ignore
    }
    setGreenfieldSessionId(null);
  }, []);

  const n8nFileInputRef = useRef<HTMLInputElement | null>(null);
  const handleN8nWorkflowFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.name.endsWith(".json"));
    if (list.length === 0) {
      setError("Select one or more n8n workflow JSON exports.");
      return;
    }
    setLoading("Importing n8n workflow…");
    setError(null);
    try {
      const workflows = [];
      for (const f of list) {
        const text = await f.text();
        const raw = JSON.parse(text);
        workflows.push({ raw });
      }
      const res = await fetch(`${API_BASE}/n8n/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      const g = data.graph as ArchGraph;
      if (!g?.nodes) throw new Error("Invalid n8n preview response");
      setGraph(g);
      setRepoUrl("");
      setSelectedNode(null);
      setAgentGraphCommand(null);
      setGraphViewMode("2d");
      setSidebarTab("chat");
      setDockMode(null);
      setDockOpen(false);
      setSceneCollapsed(true);
      setChatExpanded(false);
      const rawFindings = Array.isArray(data.findings) ? data.findings : [];
      setImportFindings(
        rawFindings.map((f: any, i: number) => ({
          id: String(f.id ?? `n8n-${i}`),
          ruleId: String(f.ruleId ?? f.code ?? "n8n_import"),
          severity: (f.severity === "blocker" || f.severity === "risk" || f.severity === "suggestion"
            ? f.severity
            : f.severity === "high"
              ? "blocker"
              : f.severity === "med" || f.severity === "medium"
                ? "risk"
                : "suggestion") as DesignFinding["severity"],
          title: String(f.title ?? f.message ?? "n8n finding"),
          whyItMatters: String(f.whyItMatters ?? f.detail ?? f.message ?? "Imported workflow issue."),
          nodeIds: Array.isArray(f.nodeIds) ? f.nodeIds : f.nodeId ? [f.nodeId] : [],
          edgeIds: Array.isArray(f.edgeIds) ? f.edgeIds : [],
          fix: Array.isArray(f.fix) ? f.fix : undefined,
        }))
      );
      const findingCount = rawFindings.length;
      const variantSummary = Array.isArray(data.variants)
        ? data.variants
            .map(
              (v: { variantKey?: string; materialize?: boolean; nodeCount?: number }) =>
                `${v.variantKey}${v.materialize ? " (canvas)" : " (stored)"}: ${v.nodeCount ?? 0} nodes`
            )
            .join("; ")
        : "";
      setAiQuestion("");
      if (findingCount > 0) {
        setError(
          `Imported n8n estate — ${findingCount} finding(s). ${variantSummary}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading("");
    }
  }, []);

  const handleForkBlueprint = useCallback((blueprintId: string) => {
    const forked = forkBlueprint(blueprintId);
    if (!forked) return;
    setGraph(forked);
    setRepoUrl("");
    setSelectedNode(null);
    setSelectedEdgeId(null);
    setAgentGraphCommand(null);
    setGraphViewMode("2d");
    setSidebarTab("dashboard");
    setDesignDashboardTab("review");
    setSceneCollapsed(true);
    setDockMode(null);
    setDockOpen(false);
    setChatExpanded(false);
    setImportFindings([]);
    try {
      localStorage.removeItem("greenfieldSessionId");
    } catch {
      // ignore
    }
    setGreenfieldSessionId(null);
  }, []);

  // Restore the draft once on load if there's no workspace graph to prefer.
  // This must run (and be declared) before the persist effect below: both
  // fire in the same commit whenever `graph` first becomes an empty design
  // graph (e.g. "Design from scratch"), and effects run in declaration
  // order — if persist ran first it would immediately overwrite a real
  // saved draft with the fresh blank graph before restore ever reads it.
  const draftRestoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (draftRestoreAttemptedRef.current) return;
    if (!isDesignMode || !graph) return;
    draftRestoreAttemptedRef.current = true;
    if (graph.nodes.length > 0 || activeWorkspaceId) return;
    try {
      const raw = localStorage.getItem("designGraph:draft");
      if (!raw) return;
      const draft = JSON.parse(raw) as ArchGraph;
      if (draft && Array.isArray(draft.nodes) && draft.nodes.length > 0 && isDesignGraph(draft)) {
        setGraph(draft);
      }
    } catch {
      // ignore malformed draft
    }
  }, [isDesignMode, graph, activeWorkspaceId]);

  // Workstream E: mirror the in-progress design to localStorage on every
  // mutation so an anonymous/unsaved design survives a refresh.
  useEffect(() => {
    if (!isDesignMode || !graph) return;
    try {
      localStorage.setItem("designGraph:draft", JSON.stringify(graph));
    } catch {
      // ignore storage issues (private browsing, quota, etc.)
    }
  }, [isDesignMode, graph]);

  // Once a design has actually been saved to a workspace, the draft has
  // served its purpose — clear it so it doesn't resurrect a stale design.
  useEffect(() => {
    if (!isDesignMode || !graph?.lastSavedAt) return;
    try {
      localStorage.removeItem("designGraph:draft");
    } catch {
      // ignore
    }
  }, [isDesignMode, graph?.lastSavedAt]);

  const handleAddDesignNeighbours = useCallback(
    (nodeId: string) => {
      setGraph((prev) => {
        if (!prev) return prev;
        const node = prev.nodes.find((n) => n.id === nodeId);
        if (!node) return prev;
        const knowledge = getDesignKnowledge(node);
        if (!knowledge || knowledge.typicalNeighbours.length === 0) return prev;

        let nodes = [...prev.nodes];
        let edges = [...prev.edges];
        let changed = false;

        for (const paletteId of knowledge.typicalNeighbours) {
          const paletteItem = DESIGN_PALETTE.find((p) => p.id === paletteId);
          if (!paletteItem) continue;
          // Reuse an existing node of the same kind if one's already on the canvas
          // instead of piling up duplicate auth/db/etc. nodes.
          const existing = nodes.find(
            (n) => n.id !== nodeId && n.label.toLowerCase() === paletteItem.label.toLowerCase()
          );
          let targetId = existing?.id;
          if (!targetId) {
            const newNode = paletteItemToNode(paletteId, nodes.length, undefined);
            if (!newNode) continue;
            nodes.push(newNode);
            targetId = newNode.id;
            changed = true;
          }
          const alreadyConnected = edges.some(
            (e) =>
              (e.source === nodeId && e.target === targetId) ||
              (e.source === targetId && e.target === nodeId)
          );
          if (!alreadyConnected) {
            edges.push(createDesignEdge({ fromId: nodeId, toId: targetId }));
            changed = true;
          }
        }

        if (!changed) return prev;
        return { ...prev, nodes, edges, generatedAt: Date.now() };
      });
    },
    []
  );

  const handleAutoArrangeDesign = useCallback(() => {
    setGraph((prev) => {
      if (!prev) return prev;
      const { nodePositions } = computeLayerLayout(prev.nodes);
      return applyPositionsToGraph(prev, nodePositions);
    });
  }, []);

  useEffect(() => {
    try {
      if (greenfieldSessionId) localStorage.setItem("greenfieldSessionId", greenfieldSessionId);
      else localStorage.removeItem("greenfieldSessionId");
    } catch {
      // ignore
    }
  }, [greenfieldSessionId]);

  useEffect(() => {
    if (!isDesignMode || !accessToken || greenfieldSessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/greenfield/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ workspaceId: activeWorkspaceId ?? undefined }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const sid = typeof data.sessionId === "string" ? data.sessionId : null;
        if (sid) setGreenfieldSessionId(sid);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDesignMode, accessToken, greenfieldSessionId, activeWorkspaceId]);

  useEffect(() => {
    if (!isDesignMode || !accessToken || !greenfieldSessionId) return;
    if (graph && graph.nodes.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/greenfield/draft/${encodeURIComponent(greenfieldSessionId)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const nodes = draftNodesToArchNodes(Array.isArray(data.nodes) ? data.nodes : []);
        const edges = draftEdgesToArchEdges(Array.isArray(data.edges) ? data.edges : []);
        if (nodes.length === 0 && edges.length === 0) return;
        setGraph((prev) => {
          if (!prev || !isDesignGraph(prev) || prev.nodes.length > 0) return prev;
          return { ...prev, nodes, edges, generatedAt: Date.now() };
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDesignMode, accessToken, greenfieldSessionId, graph?.nodes.length]);

  useEffect(() => {
    if (!pendingDesignIntent || !graph || !isDesignMode) return;
    setPendingDesignIntent(false);
  }, [pendingDesignIntent, graph, isDesignMode]);

  useEffect(() => {
    if (!isDesignMode || !accessToken || !greenfieldSessionId || !graph) return;
    const t = window.setTimeout(() => {
      const nodesPayload = graph.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        layer: typeof n.layer === "string" ? n.layer : "Uncategorized",
        description: n.description,
        archNodeId: n.path,
        buildStatus: n.buildStatus,
        position: n.position,
      }));
      const edgesPayload = graph.edges.map((e) => ({
        source: e.source,
        target: e.target,
        relation: e.relation,
      }));
      void fetch(`${API_BASE}/greenfield/draft/${encodeURIComponent(greenfieldSessionId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          nodes: nodesPayload,
          edges: edgesPayload,
          workspaceId: activeWorkspaceId ?? undefined,
        }),
      }).catch(() => {});
    }, 600);
    return () => window.clearTimeout(t);
  }, [isDesignMode, accessToken, greenfieldSessionId, graph, activeWorkspaceId]);

  useEffect(() => {
    if (!isDesignMode) {
      delete (window as unknown as { __llDesignConnect?: unknown }).__llDesignConnect;
      delete (window as unknown as { __llGetDesignGraph?: unknown }).__llGetDesignGraph;
      delete (window as unknown as { __llApplyDesignCommands?: unknown }).__llApplyDesignCommands;
      delete (window as unknown as { __llForkBlueprint?: unknown }).__llForkBlueprint;
      delete (window as unknown as { __llEvaluateDesign?: unknown }).__llEvaluateDesign;
      delete (window as unknown as { __llApplyFindingFix?: unknown }).__llApplyFindingFix;
      delete (window as unknown as { __llSetBuildStatus?: unknown }).__llSetBuildStatus;
      delete (window as unknown as { __llSetDesignNodePosition?: unknown }).__llSetDesignNodePosition;
      delete (window as unknown as { __llGetReconciliation?: unknown }).__llGetReconciliation;
      delete (window as unknown as { __llSelectNode?: unknown }).__llSelectNode;
      return;
    }
    type DesignGraphNodeInfo = {
      id: string;
      label: string;
      layer?: string;
      position?: { x: number; y: number };
      buildStatus?: "planned" | "building" | "built";
    };
    type DesignGraphEdgeInfo = {
      id: string;
      source: string;
      target: string;
      relation?: EdgeRelation;
    };
    type DesignFindingSummary = {
      id: string;
      ruleId: string;
      severity: DesignFinding["severity"];
      title: string;
      hasFix: boolean;
    };
    const w = window as unknown as {
      __llDesignConnect?: (fromId: string, toId: string, relation?: EdgeRelation) => void;
      __llGetDesignGraph?: () => {
        nodes: number;
        edges: number;
        nodeList: DesignGraphNodeInfo[];
        edgeList: DesignGraphEdgeInfo[];
      };
      __llApplyDesignCommands?: (cmds: GraphCommand[]) => void;
      __llForkBlueprint?: (blueprintId: string) => void;
      __llEvaluateDesign?: () => DesignFindingSummary[];
      __llApplyFindingFix?: (ruleId: string) => void;
      __llSetBuildStatus?: (nodeId: string, status: "planned" | "building" | "built") => void;
      __llSetDesignNodePosition?: (nodeId: string, x: number, y: number) => void;
      __llGetReconciliation?: () => ArchGraph["reconciliation"] | null;
      __llSelectNode?: (nodeId: string | null) => void;
    };
    w.__llSelectNode = (nodeId) => {
      setSelectedNode(nodeId);
      if (nodeId) {
        setSelectedEdgeId(null);
        setDockMode("insights");
        setDockOpen(true);
        setInsightsEditOpen(false);
      }
    };
    w.__llDesignConnect = (fromId, toId, relation?: EdgeRelation) => {
      setGraph((prev) => {
        if (!prev) return prev;
        if (prev.edges.some((e) => e.source === fromId && e.target === toId)) return prev;
        return {
          ...prev,
          edges: [...prev.edges, createDesignEdge({ fromId, toId, relation })],
          generatedAt: Date.now(),
        };
      });
    };
    w.__llApplyDesignCommands = (cmds) => {
      setGraph((prev) => (prev ? applyDesignCommandsToGraph(prev, cmds) : prev));
    };
    w.__llGetDesignGraph = () => {
      const g = graphRef.current;
      return {
        nodes: g?.nodes.length ?? 0,
        edges: g?.edges.length ?? 0,
        nodeList: (g?.nodes ?? []).map((n) => ({
          id: n.id,
          label: n.label,
          layer: typeof n.layer === "string" ? n.layer : undefined,
          position: n.position,
          buildStatus: n.buildStatus,
        })),
        edgeList: (g?.edges ?? []).map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          relation: e.relation,
        })),
      };
    };
    w.__llForkBlueprint = (blueprintId) => {
      handleForkBlueprint(blueprintId);
    };
    w.__llEvaluateDesign = () => {
      const g = graphRef.current;
      if (!g) return [];
      return evaluateDesign(g).map((f) => ({
        id: f.id,
        ruleId: f.ruleId,
        severity: f.severity,
        title: f.title,
        hasFix: !!f.fix?.length,
      }));
    };
    w.__llApplyFindingFix = (ruleId) => {
      setGraph((prev) => {
        if (!prev) return prev;
        const finding = evaluateDesign(prev).find((f) => f.ruleId === ruleId && f.fix?.length);
        if (!finding?.fix) return prev;
        return applyDesignCommandsToGraph(prev, finding.fix);
      });
    };
    w.__llSetBuildStatus = (nodeId, status) => {
      handleSetBuildStatus(nodeId, status);
    };
    w.__llSetDesignNodePosition = (nodeId, x, y) => {
      setGraph((prev) => (prev ? setDesignNodePosition(prev, nodeId, { x, y }) : prev));
    };
    w.__llGetReconciliation = () => graphRef.current?.reconciliation ?? null;
    return () => {
      delete w.__llDesignConnect;
      delete w.__llGetDesignGraph;
      delete w.__llApplyDesignCommands;
      delete w.__llForkBlueprint;
      delete w.__llEvaluateDesign;
      delete w.__llApplyFindingFix;
      delete w.__llSetBuildStatus;
      delete w.__llSetDesignNodePosition;
      delete w.__llGetReconciliation;
      delete w.__llSelectNode;
    };
  }, [isDesignMode, handleForkBlueprint, handleSetBuildStatus]);

  const fetchSavedWorkspaces = useCallback(async () => {
    if (!accessToken) return;
    setLoadingWorkspaces(true);
    try {
      const res = await fetch(`${API_BASE}/workspaces`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setSavedWorkspaces(data.workspaces ?? []);
      else setSavedWorkspaces([]);
    } catch {
      setSavedWorkspaces([]);
    } finally {
      setLoadingWorkspaces(false);
    }
  }, [accessToken]);

  const fetchArchivedWorkspaces = useCallback(async () => {
    if (!accessToken) return;
    setLoadingArchived(true);
    try {
      const res = await fetch(`${API_BASE}/workspaces/archived`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setArchivedWorkspaces(data.workspaces ?? []);
      else setArchivedWorkspaces([]);
    } catch {
      setArchivedWorkspaces([]);
    } finally {
      setLoadingArchived(false);
    }
  }, [accessToken]);


  const handleShare = useCallback(async (): Promise<{ url: string } | null> => {
    if (!accessToken) {
      promptSignup("share this workspace");
      return null;
    }
    if (!activeWorkspaceId) return null;
    try {
      const res = await fetch(`${API_BASE}/workspaces/${activeWorkspaceId}/share`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      return { url: data.url };
    } catch (err) {
      console.error("Share failed:", err);
      return null;
    }
  }, [activeWorkspaceId, accessToken]);

  const handleRenameWorkspaceTitle = useCallback(
    (name: string) => {
      setGraph((prev) => (prev ? { ...prev, projectName: name } : prev));
      if (activeWorkspaceId && accessToken) {
        fetch(`${API_BASE}/workspaces/${activeWorkspaceId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ name }),
        }).catch(() => {
          // non-fatal; UI already updated optimistically
        });
      }
    },
    [activeWorkspaceId, accessToken]
  );

  const handleSaveWorkspace = useCallback(async (): Promise<void> => {
    if (!accessToken) {
      promptSignup("save this workspace");
      return;
    }
    if (!graph || !activeWorkspaceId) {
      return;
    }
    try {
      const now = Date.now();
      const baseRevision = typeof graph.revision === "number" ? graph.revision : 0;
      const graphToSave = { ...graph, lastSavedAt: now } as ArchGraph;
      setGraph(graphToSave);
      try {
        localStorage.setItem(`workspaceGraph:${activeWorkspaceId}`, JSON.stringify(graphToSave));
      } catch {
        // ignore storage issues
      }
      const res = await fetch(`${API_BASE}/workspaces/${activeWorkspaceId}/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          graph: graphToSave,
          repoUrl,
          baseRevision,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        revision?: number;
        currentRevision?: number;
        serverGraph?: ArchGraph;
      };
      if (res.status === 409 && data.code === "REVISION_CONFLICT" && data.serverGraph) {
        // Merge server graph with local and retry once with server revision.
        const { mergeGraphs } = await import("./graphSync");
        const merged = mergeGraphs(
          data.serverGraph as any,
          graphToSave as any,
          data.serverGraph as any
        );
        const retry = await fetch(`${API_BASE}/workspaces/${activeWorkspaceId}/save`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            graph: { ...merged, lastSavedAt: now },
            repoUrl,
            baseRevision: data.currentRevision ?? 0,
          }),
        });
        const retryData = (await retry.json().catch(() => ({}))) as {
          error?: string;
          revision?: number;
        };
        if (!retry.ok) throw new Error(retryData.error || retry.statusText);
        setGraph((prev) =>
          prev
            ? ({ ...prev, ...merged, revision: retryData.revision ?? merged.revision } as ArchGraph)
            : prev
        );
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      if (typeof data.revision === "number") {
        setGraph((prev) => (prev ? { ...prev, revision: data.revision } : prev));
      }
    } catch (err) {
      console.error("Save workspace failed:", err);
      throw err;
    }
  }, [graph, activeWorkspaceId, accessToken, repoUrl]);

  const handleSaveScene = useCallback(
    async (scene: WorkspaceSceneDoc): Promise<void> => {
      if (!activeWorkspaceId || !accessToken) return;
      const res = await fetch(`${API_BASE}/workspaces/${activeWorkspaceId}/scenes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name: "Scene", scene }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setWorkspaceScene(scene);
    },
    [activeWorkspaceId, accessToken]
  );

  const ensureSceneBase = useCallback((): WorkspaceSceneDoc => {
    return workspaceScene && typeof workspaceScene === "object"
      ? workspaceScene
      : { schemaVersion: 1, objects: [], states: [], cameraPresets: [] };
  }, [workspaceScene]);

  const graphLayoutMode = useMemo(() => {
    const lm = (workspaceScene?.settings as any)?.layoutMode;
    return (lm === "domain" || lm === "elk" || lm === "depth") ? lm : "depth";
  }, [workspaceScene?.settings]);

  const setGraphLayoutMode = useCallback(
    (mode: "depth" | "domain" | "elk") => {
      const base = ensureSceneBase();
      setWorkspaceScene({ ...base, settings: { ...(base.settings as any), layoutMode: mode } as any });
    },
    [ensureSceneBase, setWorkspaceScene]
  );

  const upsertSceneState = useCallback(
    (partial: {
      id: string;
      name?: string;
      cameraPresetId?: string;
      viewport2D?: { x: number; y: number; zoom: number };
      camera3D?: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } };
      visibility?: Record<string, boolean>;
      annotationIds?: string[];
    }) => {
      const base = ensureSceneBase();
      const states = Array.isArray(base.states) ? [...base.states] : [];
      const idx = states.findIndex((s) => s.id === partial.id);
      const next = {
        id: partial.id,
        name: partial.name ?? (idx >= 0 ? states[idx]!.name : "State"),
        cameraPresetId: partial.cameraPresetId ?? (idx >= 0 ? states[idx]!.cameraPresetId : undefined),
        viewport2D: partial.viewport2D ?? (idx >= 0 ? (states[idx] as any).viewport2D : undefined),
        camera3D: partial.camera3D ?? (idx >= 0 ? (states[idx] as any).camera3D : undefined),
        visibility: partial.visibility ?? (idx >= 0 ? (states[idx] as any).visibility : undefined),
        annotationIds: partial.annotationIds ?? (idx >= 0 ? (states[idx] as any).annotationIds : undefined),
      } as any;
      if (idx >= 0) states[idx] = { ...(states[idx] as any), ...next };
      else states.push(next);
      setWorkspaceScene({ ...base, states });
    },
    [ensureSceneBase, setWorkspaceScene]
  );

  const activeSceneState = useMemo(() => {
    const s = workspaceScene?.states ?? [];
    return activeSceneStateId ? s.find((x) => x.id === activeSceneStateId) ?? null : null;
  }, [workspaceScene, activeSceneStateId]);

  const sceneStates = useMemo(() => (workspaceScene?.states ?? []) as any[], [workspaceScene]);

  useEffect(() => {
    if (!scenePlaying) return;
    const states = sceneStates;
    if (states.length === 0) return;
    const intervalMs = Math.max(800, 2500 / scenePlaybackSpeed);
    const tick = window.setInterval(() => {
      setActiveSceneStateId((prev) => {
        const idx = states.findIndex((s) => s.id === prev);
        const next = idx < 0 ? states[0].id : states[(idx + 1) % states.length].id;
        return next;
      });
    }, intervalMs);
    return () => window.clearInterval(tick);
  }, [scenePlaying, sceneStates, scenePlaybackSpeed]);

  // Player API (digital twin): allow external control via window.archPlayer and postMessage.
  useEffect(() => {
    const api = {
      setState: (id: string | null) => setActiveSceneStateId(id),
      play: () => setScenePlaying(true),
      pause: () => setScenePlaying(false),
      next: () =>
        setActiveSceneStateId((prev) => {
          const states = sceneStates;
          if (states.length === 0) return prev;
          const idx = states.findIndex((s) => s.id === prev);
          return idx < 0 ? states[0].id : states[(idx + 1) % states.length].id;
        }),
      prev: () =>
        setActiveSceneStateId((prev) => {
          const states = sceneStates;
          if (states.length === 0) return prev;
          const idx = states.findIndex((s) => s.id === prev);
          return idx <= 0 ? states[states.length - 1].id : states[idx - 1].id;
        }),
      setNodeStatus: (nodeId: string, status: string) =>
        setGraph((g) => {
          if (!g) return g;
          return {
            ...g,
            nodes: g.nodes.map((n) => (n.id === nodeId ? ({ ...n, status } as any) : n)),
          };
        }),
      highlightNodes: (nodeIds: string[]) =>
        setAgentGraphCommand(nodeIds.length > 0 ? { action: "highlight_nodes", nodeIds } : null),
    };
    (window as any).archPlayer = api;

    const onMessage = (e: MessageEvent) => {
      const d = e.data as any;
      if (!d || d.type !== "arch_player") return;
      if (d.action === "set_state") api.setState(typeof d.stateId === "string" ? d.stateId : null);
      if (d.action === "play") api.play();
      if (d.action === "pause") api.pause();
      if (d.action === "next") api.next();
      if (d.action === "prev") api.prev();
      if (d.action === "set_node_status" && typeof d.nodeId === "string" && typeof d.status === "string") {
        api.setNodeStatus(d.nodeId, d.status);
      }
      if (d.action === "highlight_nodes" && Array.isArray(d.nodeIds)) {
        api.highlightNodes(d.nodeIds);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sceneStates]);

  const handleDeleteWorkspace = useCallback(async (): Promise<void> => {
    if (!activeWorkspaceId || !accessToken || isDeletingWorkspace) return;
    setIsDeletingWorkspace(true);
    try {
      const res = await fetch(`${API_BASE}/workspaces/${activeWorkspaceId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error || res.statusText || "Failed to delete workspace.";
        setError(msg);
        return;
      }
      // Remove from saved list immediately (server also filters archived).
      setSavedWorkspaces((prev) => prev.filter((w) => w.id !== activeWorkspaceId));
      // Clear local state, chat, and autosave pointer.
      try {
        const last = localStorage.getItem("lastWorkspaceId");
        if (last && last === activeWorkspaceId) {
          localStorage.removeItem("lastWorkspaceId");
        }
        localStorage.removeItem(`workspaceGraph:${activeWorkspaceId}`);
        safeStorageRemove(`chat:${activeWorkspaceId}`);
      } catch {
        // ignore storage issues
      }
      setChatTabs([{ id: "1", label: "Chat 1" }]);
      setActiveChatId("1");
      setChatSessions({ "1": [] });
      setAiQuestion("");
      setPdfAttachment(null);
      setDocAttachment(null);
      setActiveWorkspaceId(null);
      setActiveWorkspaceIsOwner(false);
      setGraph(null);
      setActiveViolations([]);
      setViolationsRestoreError(null);
      setSelectedNode(null);
      setError(null);
    } catch (err) {
      console.error("Delete workspace failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeletingWorkspace(false);
    }
  }, [activeWorkspaceId, accessToken, isDeletingWorkspace]);

  /** Fetches violations from API; no setState. Use mergeViolationsIntoGraph + setGraph/setActiveViolations at call site. */
  const fetchViolationsRaw = useCallback(
    async (
      workspaceId: string,
      tokenOverride?: string
    ): Promise<{ violations: CriticViolation[]; error: string | null }> => {
      const token = tokenOverride ?? accessToken;
      if (!token) return { violations: [], error: null };
      try {
        const res = await fetch(`${API_BASE}/violations?workspaceId=${workspaceId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = data.error ?? `Failed to load violations (${res.status})`;
          console.warn("[violations] Restore failed:", msg);
          return { violations: [], error: msg };
        }
        const stored = (data.violations ?? []) as CriticViolation[];
        return { violations: stored, error: null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[violations] Restore failed:", msg);
        return { violations: [], error: msg };
      }
    },
    [accessToken]
  );

  const fetchLatestScene = useCallback(
    async (workspaceId: string, tokenOverride?: string): Promise<WorkspaceSceneDoc | null> => {
      const token = tokenOverride ?? accessToken;
      if (!token) return null;
      try {
        const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/scenes/latest`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // No scene yet is not an error; just return null.
          if (res.status === 404) return null;
          console.warn("[scene] load latest failed:", data.error ?? res.statusText);
          return null;
        }
        const scene = data.scene?.scene_json as WorkspaceSceneDoc | undefined;
        return scene && typeof scene === "object" ? scene : null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[scene] load latest failed:", msg);
        return null;
      }
    },
    [accessToken]
  );

  const fetchAnnotations = useCallback(async () => {
    const wsId = activeWorkspaceId;
    const token = accessToken;
    if (!wsId || !token) return;
    try {
      const res = await fetch(`${API_BASE}/workspaces/${wsId}/annotations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setWorkspaceAnnotations((data.annotations ?? []) as WorkspaceAnnotation[]);
    } catch {
      // ignore
    }
  }, [activeWorkspaceId, accessToken]);

  const clearChatComposer = useCallback(() => {
    setAiQuestion("");
    setPdfAttachment(null);
    setDocAttachment(null);
  }, []);

  /** Flush in-memory chat to the previous workspace before switching, so drafts/history do not bleed. */
  const flushChatForWorkspace = useCallback((workspaceId: string | null) => {
    if (!workspaceId) return;
    if (chatPersistTimeoutRef.current) {
      clearTimeout(chatPersistTimeoutRef.current);
      chatPersistTimeoutRef.current = null;
    }
    safeStorageSet(
      `chat:${workspaceId}`,
      JSON.stringify({
        chatTabs: chatTabsRef.current,
        chatSessions: chatSessionsRef.current,
        activeChatId: activeChatIdRef.current,
      })
    );
  }, []);

  const restoreChatForWorkspace = useCallback((workspaceId: string) => {
    try {
      const saved = safeStorageGet(`chat:${workspaceId}`);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          chatTabs?: Array<{ id: string; label: string }>;
          chatSessions?: Record<string, Array<{ role: "user" | "assistant"; content: string }>>;
          activeChatId?: string;
        };
        if (parsed.chatTabs?.length && parsed.chatSessions && Object.keys(parsed.chatSessions).length > 0) {
          setChatTabs(parsed.chatTabs);
          setChatSessions(parsed.chatSessions);
          setActiveChatId(parsed.activeChatId ?? parsed.chatTabs[0]?.id ?? "1");
          return;
        }
      }
    } catch {
      // fall through to empty
    }
    setChatTabs([{ id: "1", label: "Chat 1" }]);
    setActiveChatId("1");
    setChatSessions({ "1": [] });
  }, []);

  const loadWorkspace = useCallback(
    async (workspaceId: string, tokenOverride?: string) => {
      const token = tokenOverride ?? accessToken;
      if (!token) return;
      setLoadingWorkspaceId(workspaceId);
      try {
        const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/load`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // If the workspace is gone or access is denied, clear local pointer and fall back to a fresh workspace.
          if (res.status === 404 || res.status === 403) {
            const msg = typeof data.error === "string" ? data.error : "";
            // If the server can't load this workspace but we have a local snapshot, restore from that instead
            // so the user doesn't lose their graph just because persistence failed.
            try {
              const local = localStorage.getItem(`workspaceGraph:${workspaceId}`);
              if (local) {
                const parsed = JSON.parse(local) as ArchGraph;
                const analysed = analyseGraph(parsed);
                const prevId = activeWorkspaceIdRef.current;
                if (prevId && prevId !== workspaceId) flushChatForWorkspace(prevId);
                setGraph(analysed);
                setActiveWorkspaceId(workspaceId);
                restoreChatForWorkspace(workspaceId);
                clearChatComposer();
                setRepoUrl(parsed.projectRoot ?? repoUrl ?? "");
                setError(
                  "Restored workspace from local snapshot because the server copy could not be loaded."
                );
                setLoadingWorkspaceId(null);
                return;
              }
            } catch {
              // ignore malformed local snapshot
            }
            // Special case: workspace exists but has no saved graph yet.
            if (res.status === 404 && msg.includes("No graph saved for this workspace.")) {
              try {
                localStorage.setItem("lastWorkspaceId", workspaceId);
              } catch {
                // ignore storage errors
              }
              const prevId = activeWorkspaceIdRef.current;
              if (prevId && prevId !== workspaceId) flushChatForWorkspace(prevId);
              setActiveWorkspaceId(workspaceId);
              restoreChatForWorkspace(workspaceId);
              clearChatComposer();
              setGraph(null);
              setRepoUrl("");
              setError("This workspace has no saved graph yet. Scan this workspace to create a graph.");
              return;
            }
            try {
              const last = localStorage.getItem("lastWorkspaceId");
              if (last && last === workspaceId) {
                localStorage.removeItem("lastWorkspaceId");
              }
            } catch {
              // ignore storage errors
            }
            // Keep the "Saved" list in sync: if this workspace was deleted or access revoked,
            // optimistically remove it from the in-memory list so the UI doesn't offer a broken entry.
            setSavedWorkspaces((prev) => prev.filter((ws) => ws.id !== workspaceId));

            // Start the user in a clean, empty workspace instead of leaving them in a broken state.
            flushChatForWorkspace(activeWorkspaceIdRef.current);
            setActiveWorkspaceId(null);
            setActiveWorkspaceIsOwner(false);
            setRepoUrl("");
            setActiveViolations([]);
            setViolationsRestoreError(null);
            setChatTabs([{ id: "1", label: "Chat 1" }]);
            setActiveChatId("1");
            setChatSessions({ "1": [] });
            clearChatComposer();
            setGraph({
              nodes: [],
              edges: [],
              generatedAt: Date.now(),
              projectRoot: "",
              projectName: "My workspace",
            });
            setError(
              res.status === 404
                ? "The previous workspace was removed. You’re now in a new empty workspace."
                : "You no longer have access to that workspace. You’re now in a new empty workspace."
            );
            return;
          }
          throw new Error(data.error || res.statusText);
        }
        const loadedGraph = data.graph as ArchGraph;
        const repo = (data.repoUrl ?? "") as string;
        if (loadedGraph && typeof loadedGraph === "object" && Array.isArray(loadedGraph.nodes) && Array.isArray(loadedGraph.edges)) {
          const analysedGraph = analyseGraph(loadedGraph);
          const { violations, error: violationsError } = await fetchViolationsRaw(workspaceId, token);
          setViolationsRestoreError(violationsError);
          const mergedGraph = mergeViolationsIntoGraph(analysedGraph, violations);
          const prevId = activeWorkspaceIdRef.current;
          if (prevId && prevId !== workspaceId) flushChatForWorkspace(prevId);
          setGraph(mergedGraph);
          setActiveViolations(violations);
          setRepoUrl(repo);
          // Restore chat in the same turn as the workspace id change — never across an await —
          // or the persist effect can write the old chat into the new workspace key.
          setActiveWorkspaceId(workspaceId);
          restoreChatForWorkspace(workspaceId);
          clearChatComposer();
          // Best-effort: load authored scene document (if any).
          const scene = await fetchLatestScene(workspaceId, token);
          setWorkspaceScene(scene);
          const annotations = (data.annotations ?? []) as WorkspaceAnnotation[];
          setWorkspaceAnnotations(annotations);
          setActiveWorkspaceIsOwner(Boolean(data.isOwner));
          setShowWorkspaceDropUp(false);
          setError(null);
        } else {
          throw new Error("Invalid graph data");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingWorkspaceId(null);
      }
    },
    [accessToken, fetchViolationsRaw, fetchLatestScene, repoUrl, flushChatForWorkspace, restoreChatForWorkspace, clearChatComposer]
  );

  useEffect(() => {
    if (!activeWorkspaceId) setWorkspaceAnnotations([]);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!showWorkspaceDropUp) return;
    const onMouseDown = (e: MouseEvent) => {
      if (workspaceDropUpRef.current && !workspaceDropUpRef.current.contains(e.target as Node)) {
        setShowWorkspaceDropUp(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showWorkspaceDropUp]);

  useEffect(
    () => () => {
      if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
      if (shareCopiedTimeoutRef.current) clearTimeout(shareCopiedTimeoutRef.current);
    },
    []
  );

  useEffect(() => {
    if (!isResizing) return;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (e: MouseEvent) => {
      const w = Math.min(600, Math.max(240, e.clientX));
      setPanelWidth(w);
    };
    const onUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);
  graphRef.current = graph;
  activeChatIdRef.current = activeChatId;
  chatTabsRef.current = chatTabs;
  chatSessionsRef.current = chatSessions;
  activeWorkspaceIdRef.current = activeWorkspaceId;

  // Persist last active workspace for auto-reopen
  useEffect(() => {
    try {
      if (autosaveEnabled && activeWorkspaceId) {
        localStorage.setItem("lastWorkspaceId", activeWorkspaceId);
      }
    } catch {
      // ignore storage errors
    }
  }, [autosaveEnabled, activeWorkspaceId]);

  // Persist autosave preference
  useEffect(() => {
    try {
      localStorage.setItem("autosaveLastWorkspace", autosaveEnabled ? "on" : "off");
    } catch {
      // ignore
    }
  }, [autosaveEnabled]);

  // Persist chat context per workspace (debounced 1.5s to reduce writes for large histories)
  useEffect(() => {
    if (!activeWorkspaceId) return;
    if (chatPersistTimeoutRef.current) clearTimeout(chatPersistTimeoutRef.current);
    chatPersistTimeoutRef.current = setTimeout(() => {
      const key = `chat:${activeWorkspaceId}`;
      safeStorageSet(key, JSON.stringify({ chatTabs, chatSessions, activeChatId }));
      chatPersistTimeoutRef.current = null;
    }, 1500);
    return () => {
      if (chatPersistTimeoutRef.current) clearTimeout(chatPersistTimeoutRef.current);
    };
  }, [activeWorkspaceId, chatTabs, chatSessions, activeChatId]);

  // Cleanup old dismissed background tasks (older than 5 minutes)
  const BACKGROUND_TASK_CLEANUP_MS = 5 * 60 * 1000;
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - BACKGROUND_TASK_CLEANUP_MS;
      setBackgroundTasks((prev) => {
        const filtered = prev.filter(
          (t) => !(t.dismissed === true && t.createdAt < cutoff)
        );
        return filtered.length < prev.length ? filtered : prev;
      });
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!showAuthModal) setSignupPendingConfirmation(false);
  }, [showAuthModal]);

  useEffect(() => {
    // Validate client/server Supabase config match (prevents "invalid token" from project mismatch)
    fetch(`${API_BASE}/auth/config`)
      .then((r) => r.json())
      .then((cfg) => {
        if (!cfg.supabaseConfigured) return;
        const clientRef = import.meta.env.VITE_SUPABASE_URL?.match(
          /https?:\/\/([^.]+)\.supabase\.co/
        )?.[1];
        if (clientRef && cfg.projectRef && clientRef !== cfg.projectRef) {
          console.error(
            "[Auth] Supabase project mismatch — client and server use different projects. Chat will fail with 401. Fix: VITE_SUPABASE_URL in client .env must match SUPABASE_URL in server .env.",
            { clientProjectRef: clientRef, serverProjectRef: cfg.projectRef }
          );
        }
      })
      .catch(() => {});

    // Run hash error handling first and before any early return — Supabase may consume the hash
    const hashError = logAuthHashErrors();
    if (hashError && (hashError.errorCode === "otp_expired" || hashError.error === "access_denied")) {
      window.history.replaceState(null, "", window.location.pathname);
      sessionStorage.removeItem("ll_post_confirm");
      setAuthError(
        hashError.errorCode === "otp_expired"
          ? "Your confirmation link has expired. Please sign in — you may need to re-register if your account was not activated."
          : (hashError.errorDescription ?? "An authentication error occurred. Please try again.")
      );
      setAuthMode("signin");
      setShowAuthModal(true);
    }

    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    let mounted = true;
    setAuthLoading(true);
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        const session = data.session ?? null;
        const token = session?.access_token ?? null;
        setAccessToken(token);

        // Quick server-side auth sanity check when we think we're signed in.
        if (token) {
          fetch(`${API_BASE}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
            .then(({ ok, body }) => {
              if (!mounted) return;
              if (ok) {
                setAuthStatus("ok");
                setAuthStatusMessage(null);
              } else {
                setAuthStatus("mismatch");
                setAuthStatusMessage(
                  typeof body.error === "string"
                    ? body.error
                    : "Server does not recognize your session token. Check Supabase client/server config."
                );
              }
            })
            .catch(() => {
              if (!mounted) return;
              // Don't hard-fail the app; just leave status unknown.
              setAuthStatus("unknown");
            });

          // Dev-only: detailed token validation to help diagnose auth issues.
          if (import.meta.env.DEV) {
            fetch(`${API_BASE}/auth/debug-validate`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ token }),
            })
              .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
              .then(({ ok, body }) => {
                // eslint-disable-next-line no-console
                console.log("[Auth debug] /auth/debug-validate", { ok, body });
              })
              .catch(() => {
                // swallow; debug-only
              });
          }
        } else {
          setAuthStatus("unknown");
          setAuthStatusMessage(null);
        }

        // On hard refresh, there may already be a valid session but no graph yet.
        // Mirror SIGNED_IN behavior so we auto-reopen the last workspace.
        if (session && graphRef.current === null) {
          let autoOpened = false;
          try {
            const autosave = localStorage.getItem("autosaveLastWorkspace");
            const lastId = localStorage.getItem("lastWorkspaceId");
            if (autosave !== "off" && lastId) {
              setTimeout(() => {
                loadWorkspace(lastId, session.access_token).catch(() => {
                  setGraph({
                    nodes: [],
                    edges: [],
                    generatedAt: Date.now(),
                    projectRoot: "",
                    projectName: "My workspace",
                  });
                });
              }, 0);
              autoOpened = true;
            }
          } catch {
            // ignore storage issues
          }
          if (!autoOpened) {
            // If no previous workspace to restore, try anonymous last graph (if any).
            try {
              const anonRaw = localStorage.getItem("anonGraph");
              if (anonRaw) {
                const parsed = JSON.parse(anonRaw) as ArchGraph;
                setGraph(analyseGraph(parsed));
                setError(null);
                return;
              }
            } catch {
              // ignore malformed anon graph
            }
            setGraph({
              nodes: [],
              edges: [],
              generatedAt: Date.now(),
              projectRoot: "",
              projectName: "My workspace",
            });
            setError(null);
          }
        }

        // No session: try to restore anonymous graph if present.
        if (!session && graphRef.current === null) {
          try {
            const anonRaw = localStorage.getItem("anonGraph");
            if (anonRaw) {
              const parsed = JSON.parse(anonRaw) as ArchGraph;
              setGraph(analyseGraph(parsed));
              setError(null);
            }
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        if (!mounted) return;
        setAccessToken(null);
        setAuthStatus("unknown");
        setAuthStatusMessage(null);
      })
      .finally(() => {
        if (!mounted) return;
        setAuthLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      logAuthStateChange(event, session);
      setAccessToken(session?.access_token ?? null);

      if (event === "PASSWORD_RECOVERY") {
        setAuthMode("reset");
        setShowAuthModal(true);
        setAuthError(null);
        setAuthMessage(null);
      }

      // Post-confirmation redirect: sessionStorage flag set before signUp().
      // Normal sign-in: graph is null, user on landing page — transition to empty workspace.
      if (event === "SIGNED_IN" && session) {
        const isPostConfirmation = sessionStorage.getItem("ll_post_confirm") === "true";
        if (isPostConfirmation) {
          sessionStorage.removeItem("ll_post_confirm");
          ensureProfile(session.access_token).catch(console.error);
        }
        if (graphRef.current === null) {
          let autoOpened = false;
          try {
            const autosave = localStorage.getItem("autosaveLastWorkspace");
            const lastId = localStorage.getItem("lastWorkspaceId");
            if (autosave !== "off" && lastId) {
              setTimeout(() => {
                loadWorkspace(lastId, session.access_token).catch(() => {
                  setGraph({
                    nodes: [],
                    edges: [],
                    generatedAt: Date.now(),
                    projectRoot: "",
                    projectName: "My workspace",
                  });
                });
              }, 0);
              autoOpened = true;
            }
          } catch {
            // ignore storage issues
          }
          if (!autoOpened) {
            setGraph({
              nodes: [],
              edges: [],
              generatedAt: Date.now(),
              projectRoot: "",
              projectName: "My workspace",
            });
            setError(null);
          }
        }
        setShowAuthModal(false);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const supabaseConfigError = getSupabaseConfigError();

  const scanRepo = useCallback(
    async (rawUrl: string) => {
      const url = rawUrl.trim();
      if (!url) return;

      setLoading("Cloning repository...");
      setError(null);

      try {
        // Get a fresh token before scan so the backend can persist a workspace.
        let token = accessToken;
        if (supabase) {
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshData.session?.access_token) {
            token = refreshData.session.access_token;
            setAccessToken(token);
          } else {
            const { data } = await supabase.auth.getSession();
            token = data.session?.access_token ?? accessToken;
          }
        }

        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`${API_BASE}/scan`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            repoUrl: url,
            // Reuse the existing workspace when possible (keeps name stable across refresh).
            workspaceId:
              activeWorkspaceId ??
              (() => {
                try {
                  if (!autosaveEnabled) return undefined;
                  const last = localStorage.getItem("lastWorkspaceId");
                  return last && last.trim() ? last.trim() : undefined;
                } catch {
                  return undefined;
                }
              })(),
          }),
        });

        const data = await res.json().catch(() => ({}));

        // Handle anonymous-limit and other non-200 responses explicitly.
        if (!res.ok) {
          if (data.code === "SIGNUP_REQUIRED") {
            setOnboardingIntent(
              `You've used your free scan${data.limit ? ` (${data.limit} per day)` : ""}. Sign up to continue.`
            );
            setShowOnboardingChat(true);
            setError(null);
            return;
          }
          if (data.code === "UPGRADE_REQUIRED" || data.code === "PAST_DUE") {
            setError(data.error || "Upgrade required to continue scanning.");
            if (accessToken) setShowProfileBilling(true);
            else {
              setOnboardingIntent(data.error || "Upgrade to continue.");
              setShowOnboardingChat(true);
            }
            return;
          }
          const msg = data.error || res.statusText || "Scan failed.";
          setError(msg);
          return;
        }

        // Successful scan: canvas is the picture; control panel stays closed.
        setSelectedAgentFile(null);
        setGraph(analyseGraph(data));
        setGraphViewMode("2d");
        setDockMode(null);
        setDockOpen(false);
        setSceneCollapsed(true);
        setImportFindings([]);
        const firstAgent = (data as ArchGraph).agents?.agents?.find(
          (a) => a.kind === "agent"
        );
        if (firstAgent) setLayersAgentFile(firstAgent.file);

        // Signed-in path MUST return workspaceId (server enforces this).
        if (data.workspaceId) {
          setActiveWorkspaceId(data.workspaceId);
          setActiveWorkspaceIsOwner(true);
          // lastWorkspaceId is also maintained by the autosave effect,
          // but we eagerly set it here for faster restore on refresh.
          try {
            if (autosaveEnabled) {
              localStorage.setItem("lastWorkspaceId", data.workspaceId);
              // New signed-in workspace should clear any anonymous graph snapshot.
              localStorage.removeItem("anonGraph");
              try {
                localStorage.setItem(
                  `workspaceGraph:${data.workspaceId}`,
                  JSON.stringify(data as ArchGraph)
                );
              } catch {
                // ignore
              }
            }
          } catch {
            // ignore storage issues
          }
          setError(null);
        } else if (typeof data.persistError === "string" && data.persistError.trim()) {
          // Anonymous / non-persisted path: surface why persistence is unavailable.
          if (accessToken) setError(`Workspace save failed: ${data.persistError}`);
          // Persist anonymous graph snapshot for refresh-only restore.
          try {
            localStorage.setItem("anonGraph", JSON.stringify(data));
          } catch {
            // ignore
          }
          // An anonymous scan is a success, not a failure. The picture is free to
          // read; keeping it is what needs an account. The signup prompt now fires
          // from Save, Share and Export instead of covering the result on arrival.
        } else {
          setError("Workspace save failed: no workspaceId returned from server.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading("");
      }
    },
    [accessToken, activeWorkspaceId, supabase, autosaveEnabled]
  );

  const handleScan = useCallback(() => {
    if (!repoUrl.trim()) return;
    // Avoid starting a scan while auth state is still being resolved.
    if (authLoading) return;
    scanRepo(repoUrl);
  }, [repoUrl, scanRepo, authLoading]);

  const chatHistory = chatSessions[activeChatId] ?? [];
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chatHistory, chatLoading]);

  const resizeChatInput = useCallback(() => {
    const ta = chatInputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => {
    resizeChatInput();
  }, [aiQuestion, resizeChatInput]);

  const handleAsk = useCallback(
    async (overrideQuestion?: string) => {
      const q = (overrideQuestion ?? fixPromptRef.current ?? aiQuestion.trim()).trim();
      if (!q || !graph) return;

      // Token guardrail: viewing an imported or shared canvas is free, AI chat
      // burns credits and needs an account. Route into the signup chat instead
      // of failing deep in the request path with a dead error string.
      if (!accessToken) {
        const cidAnon = activeChatIdRef.current;
        setChatSessions((s) => ({
          ...s,
          [cidAnon]: [
            ...(s[cidAnon] ?? []),
            { role: "user" as const, content: q },
            {
              role: "assistant" as const,
              content:
                "AI chat uses message credits, so it needs an account — your canvas stays free to view and edit, and nothing here is lost. Free includes a monthly design-chat allowance; I'm opening signup so you can pick up right where you left off.",
            },
          ],
        }));
        if (!overrideQuestion) setAiQuestion("");
        fixPromptRef.current = null;
        promptSignup("use AI chat — viewing your imported canvas stays free");
        return;
      }

      const inFlight = backgroundTasksRef.current.some(
        (t) =>
          t.kind === "chat" &&
          t.status === "running" &&
          (t.prompt ?? t.label ?? "").trim() === q &&
          (t.workspaceId ?? activeWorkspaceId) === activeWorkspaceId
      );
      if (inFlight) return;

      const clientTaskId = crypto.randomUUID?.() ?? `task-${Date.now()}`;
      const mode = isDesignMode ? ("greenfield" as const) : ("analysis" as const);
      const taskSteps = ["Send question", "Run critic review", "Update graph"];
      setBackgroundTasks((prev) => [
        ...prev,
        {
          id: clientTaskId,
          label: q.slice(0, 50) + (q.length > 50 ? "…" : ""),
          mode,
          kind: "chat",
          status: "running" as const,
          steps: taskSteps,
          currentStep: 0,
          totalSteps: taskSteps.length,
          createdAt: Date.now(),
          reviewed: false,
          dismissed: false,
          toastDismissed: false,
          prompt: q,
          workspaceId: activeWorkspaceId ?? undefined,
        },
      ]);
      setActiveTaskId(clientTaskId);

      setChatLoading(true);
      if (!overrideQuestion) setAiQuestion("");
      const pdfToSend = pdfAttachment;
      const docToSend = docAttachment;
      if (pdfToSend) setPdfAttachment(null);
      if (docToSend) setDocAttachment(null);
      const docPrefix = docToSend
        ? `[Attached document: ${docToSend.name}]\n\n${docToSend.extractedText.slice(0, 3000)}${docToSend.extractedText.length > 3000 ? "…" : ""}\n\n---\n\n`
        : "";
      const fullQuestion = docPrefix + q;
      const currentHistory = chatSessionsRef.current[activeChatIdRef.current] ?? [];
      const historyForRequest: ArchitectureChatMessage[] = [
        ...currentHistory,
        { role: "user", content: fullQuestion },
      ];
      const cid = activeChatIdRef.current;
      setChatSessions((s) => ({
        ...s,
        [cid]: [...(s[cid] ?? []), { role: "user", content: fullQuestion }],
      }));

      const history = historyForRequest;

      const applyChatResult = (data: any) => {
        const violations = (data.violations ?? []) as CriticViolation[];
      if (violations.length > 0) {
        // Merge into activeViolations list (dedupe by sourceNodeId + type + targetNodeId)
        setActiveViolations((prev) => {
          const key = (v: CriticViolation) =>
            `${v.type}:${v.sourceNodeId}:${v.targetNodeId ?? ""}`;
          const existingKeys = new Set(prev.map(key));
          const fresh = violations.filter((v) => !existingKeys.has(key(v)));
          return [...prev, ...fresh];
        });

        // Merge violations into graph nodes so ArchCanvas can render badges.
        setGraph((prev) => {
          if (!prev) return prev;
          const severities = ["critical", "high", "medium"] as const;
          return {
            ...prev,
            nodes: prev.nodes.map((node) => {
              const nodeViolations = violations.filter(
                (v) => v.sourceNodeId === node.id || v.targetNodeId === node.id
              );
              if (nodeViolations.length === 0) return node;
              const allViolationsForNode = [
                ...(node.violationState?.violations ?? []),
                ...nodeViolations,
              ];
              const highest = allViolationsForNode
                .map((v) => v.severity)
                .sort(
                  (a, b) =>
                    severities.indexOf(a as (typeof severities)[number]) -
                    severities.indexOf(b as (typeof severities)[number])
                )[0] ?? null;
              return {
                ...node,
                violationState: {
                  violations: allViolationsForNode,
                  highestSeverity: highest,
                },
              } as ArchNode;
            }),
          };
        });

      }

        const answer = data.answer ?? "No response.";
        if (data.showInsightsPanel === true) {
          setShowInsightsPanel(true);
        }
      const criticReport =
        typeof data.criticReport === "string" && data.criticReport
          ? data.criticReport
          : undefined;
      const criticScore =
        typeof data.criticScore === "number" ? data.criticScore : 0;
      setLastCriticResult({
        score: criticScore,
        report: criticReport ?? "",
        violations,
      });
        const needsReview =
          violations.length > 0 || (criticReport && criticScore < 7);
        setBackgroundTasks((prev) =>
          prev.map((t) =>
            t.id === clientTaskId
              ? {
                  ...t,
                  status: needsReview ? "needs_review" : "completed",
                  currentStep: t.totalSteps,
                  result: data,
                  answerPreview: typeof answer === "string" ? answer.slice(0, 200) : "",
                }
              : t
          )
        );
        const graphCommands = (data.graphCommands ?? (data.graphCommand ? [data.graphCommand] : [])) as GraphCommand[];
        const relevantNodeIds = Array.isArray(data.relevantNodeIds)
          ? (data.relevantNodeIds as string[]).filter((id): id is string => typeof id === "string")
          : [];
        if (graphCommands.length > 0) {
        setAgentGraphCommand(graphCommands[0]);
        if (isDesignMode) {
          // Phase 4: propose — never silent-apply. User Accepts/Rejects in ChatBar.
          const mutators = graphCommands.filter(
            (c) => c.action === "create_node" || c.action === "connect" || c.action === "update_node"
          );
          if (mutators.length > 0) {
            setPendingProposal(mutators);
            setChatOnlyNotice(false);
            setChatExpanded(true);
          } else {
            setPendingProposal(null);
          }
        }
        for (const cmd of graphCommands) {
          if (cmd.action === "filter_edge_type") {
            const f = cmd.edgeType === "arch" ? "architectural" : cmd.edgeType;
            setActiveFilters(new Set([f]));
          } else if (cmd.action === "focus_node") {
            setSelectedNode(cmd.nodeId);
          }
        }
      } else if (relevantNodeIds.length > 0) {
        setAgentGraphCommand({ action: "highlight_nodes", nodeIds: relevantNodeIds });
        if (isDesignMode) {
          setPendingProposal(null);
          setChatOnlyNotice(true);
        }
      } else if (isDesignMode) {
        setPendingProposal(null);
        setChatOnlyNotice(true);
      }

      const tu = data.tokenUsage as { input?: number; output?: number } | undefined;
      const inputTokens = tu?.input ?? 0;
      const outputTokens = tu?.output ?? 0;
      const totalTokens = inputTokens + outputTokens;
      const CONTEXT_SAFE = 180_000;
      const WARNING_THRESHOLD = Math.floor(CONTEXT_SAFE * 0.8);
      if (totalTokens >= CONTEXT_SAFE) {
        setTokenWarning({ input: inputTokens, output: outputTokens, overBudget: true });
      } else if (inputTokens >= WARNING_THRESHOLD) {
        setTokenWarning({ input: inputTokens, output: outputTokens, overBudget: false });
      } else if (inputTokens > 0) {
        setTokenWarning(null);
      }

      const rs = Array.isArray((data as any).rails) ? (data as any).rails as Array<{ id?: string }> : [];
      const railIds = rs.filter((r) => typeof r.id === "string").map((r) => ({ id: r.id! }));
      const reasoningSteps =
        Array.isArray((data as any).reasoningTrace) && (data as any).reasoningTrace.every((x: unknown) => typeof x === "string")
          ? ((data as any).reasoningTrace as string[])
          : typeof (data as any).reasoningTrace === "string"
            ? [(data as any).reasoningTrace as string]
            : [];
      const citations =
        Array.isArray((data as any).citations) && (data as any).citations.length > 0
          ? ((data as any).citations as Array<{
              label: string;
              nodeId?: string;
              edgeId?: string;
              filePath?: string;
            }>).filter((c) => typeof c?.label === "string")
          : [];
      const confidenceScore =
        typeof (data as any).confidenceScore === "number" ? ((data as any).confidenceScore as number) : null;
      const suggestedActions =
        Array.isArray((data as any).suggestedActions) && (data as any).suggestedActions.length > 0
          ? ((data as any).suggestedActions as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
      const taskIdFromResult = typeof (data as any).taskId === "string" ? ((data as any).taskId as string) : clientTaskId;
      const cidInner = activeChatIdRef.current;
      setChatSessions((prev) => {
        const currentInner = prev[cidInner] ?? [];
        const assistantMessage: ArchitectureChatMessage = {
          role: "assistant",
          content: answer,
          ...(railIds.length > 0 ? { rails: railIds } : {}),
          reasoningSteps,
          citations,
          confidenceScore,
          suggestedActions,
          graphCommands,
          relevantNodeIds,
          taskId: taskIdFromResult,
        };
        const updated: ArchitectureChatMessage[] = [
          ...currentInner,
          assistantMessage,
          ...(criticReport
            ? [{ role: "assistant" as const, content: `Critic: ${criticReport}` }]
            : []),
        ];
        return {
          ...prev,
          [cidInner]: updated,
        };
      });
      };

      try {
        // Get fresh token (refresh if needed; fallback to getSession)
        let token = accessToken;
        if (supabase) {
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshData.session?.access_token) {
            token = refreshData.session.access_token;
            setAccessToken(token);
          } else {
            const { data } = await supabase.auth.getSession();
            const fallbackToken = data.session?.access_token ?? accessToken;
            if (refreshError && !fallbackToken) {
              const cidInner = activeChatIdRef.current;
              setChatSessions((s) => ({
                ...s,
                [cidInner]: [
                  ...(s[cidInner] ?? []),
                  { role: "assistant" as const, content: "Your session has expired. Please sign in again." },
                ],
              }));
              setAccessToken(null);
              return;
            }
            token = fallbackToken;
          }
        }
        if (!token) {
          throw new Error("Please sign in first.");
        }
        const res = await fetch(`${API_BASE}/chat-async`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            question: fullQuestion,
            graph,
            nodeId: selectedNode ?? undefined,
            history,
            workspaceId: activeWorkspaceId ?? undefined,
            mode,
            ...(isDesignMode && greenfieldSessionId
              ? { greenfieldSessionId }
              : {}),
            ...(activeThreadId ? { threadId: activeThreadId } : {}),
            ...(pdfToSend ? { pdfBase64: pdfToSend.base64, pdfFileName: pdfToSend.name } : {}),
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (res.status === 401) {
            setAccessToken(null);
            if (import.meta.env.DEV) {
              fetch(`${API_BASE}/auth/config`)
                .then((r) => r.json())
                .then((cfg) => {
                  const clientRef = import.meta.env.VITE_SUPABASE_URL?.match(
                    /https?:\/\/([^.]+)\.supabase\.co/
                  )?.[1];
                  console.warn(
                    "[Auth] 401 — token rejected. Debug:",
                    { serverProjectRef: cfg.projectRef, clientProjectRef: clientRef },
                    "→ Project refs must match. Run server with DEBUG_AUTH=true for token logs."
                  );
                })
                .catch(() => {});
            }
            throw new Error("Session expired. Please sign in again.");
          }
          // Credit guardrail: free allowance exhausted or payment past due.
          // Surface the billing panel with the transparent limits instead of
          // burying the reason in an error bubble.
          if (data.code === "UPGRADE_REQUIRED" || data.code === "PAST_DUE") {
            setShowProfileBilling(true);
            throw new Error(
              data.error ||
                "Your plan's AI allowance is used up. Upgrade from the billing panel to continue."
            );
          }
          throw new Error(data.error || res.statusText);
        }

        const remoteTaskId = typeof data.taskId === "string" ? data.taskId : null;
        if (!remoteTaskId) {
          if (res.ok && typeof data.answer === "string") {
            applyChatResult(data);
            return;
          }
          throw new Error("Server did not return a taskId for async chat.");
        }

        setBackgroundTasks((prev) =>
          prev.map((t) => (t.id === clientTaskId ? { ...t, remoteTaskId } : t))
        );

        tasksPollAbortRef.current.set(remoteTaskId, false);

        const poll = async (attempt: number) => {
          if (tasksPollAbortRef.current.get(remoteTaskId)) return;
          try {
            const r = await fetch(`${API_BASE}/tasks/${remoteTaskId}`);
            const payload = await r.json().catch(() => ({}));
            if (!r.ok) {
              throw new Error(payload.error || r.statusText);
            }
            const status = payload.status as "pending" | "running" | "completed" | "failed" | "cancelled";
            if (status === "pending" || status === "running") {
              const delay = Math.min(2000 + attempt * 500, 8000);
              setTimeout(() => poll(attempt + 1), delay);
              return;
            }
            if (status === "failed" || status === "cancelled") {
              const msg = typeof payload.error === "string" ? payload.error : "Task failed.";
              setBackgroundTasks((prev) =>
                prev.map((t) =>
                  t.id === clientTaskId
                    ? {
                        ...t,
                        status: "failed" as const,
                        error: msg,
                        currentStep: t.totalSteps,
                      }
                    : t
                )
              );
              setChatSessions((s) => {
                const cidInner2 = activeChatIdRef.current;
                return {
                  ...s,
                  [cidInner2]: [
                    ...(s[cidInner2] ?? []),
                    { role: "assistant" as const, content: `Error: ${msg}` },
                  ],
                };
              });
              return;
            }

            if (status === "completed") {
              applyChatResult(payload.result ?? {});
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setBackgroundTasks((prev) =>
              prev.map((t) =>
                t.id === clientTaskId
                  ? {
                      ...t,
                      status: "failed" as const,
                      error: msg,
                      currentStep: t.totalSteps,
                    }
                  : t
              )
            );
            setChatSessions((s) => {
              const cidInner3 = activeChatIdRef.current;
              return {
                ...s,
                [cidInner3]: [
                  ...(s[cidInner3] ?? []),
                  { role: "assistant" as const, content: `Error: ${msg}` },
                ],
              };
            });
          }
        };

        poll(0);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const cidErr = activeChatIdRef.current;
        setBackgroundTasks((prev) =>
          prev.map((t) =>
            t.id === clientTaskId
              ? { ...t, status: "failed" as const, error: msg, currentStep: t.totalSteps }
              : t
          )
        );
        setChatSessions((s) => ({
          ...s,
          [cidErr]: [
            ...(s[cidErr] ?? []),
            { role: "assistant", content: `Error: ${msg}` },
          ],
        }));
      } finally {
        fixPromptRef.current = null;
        setChatLoading(false);
      }
    },
    [
      aiQuestion,
      graph,
      selectedNode,
      accessToken,
      activeWorkspaceId,
      activeThreadId,
      pdfAttachment,
      docAttachment,
      isDesignMode,
      greenfieldSessionId,
      promptSignup,
    ]
  );

  const addChatTab = useCallback(async () => {
    const nextId = String(
      Math.max(0, ...chatTabs.map((t) => parseInt(t.id, 10) || 0)) + 1
    );
    let threadId: string | null = null;
    if (accessToken && activeWorkspaceId) {
      try {
        const res = await fetch(
          `${API_BASE}/workspaces/${activeWorkspaceId}/threads`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ title: `Chat ${nextId}` }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          threadId = data.id ?? null;
        }
      } catch {
        /* non-fatal */
      }
    }
    setChatTabs((prev) => [
      ...prev,
      { id: nextId, label: `Chat ${nextId}`, threadId: threadId ?? undefined },
    ]);
    setChatSessions((s) => ({ ...s, [nextId]: [] }));
    setActiveChatId(nextId);
    if (threadId) setActiveThreadId(threadId);
    clearChatComposer();
    setTokenWarning(null);
  }, [chatTabs, accessToken, activeWorkspaceId, clearChatComposer]);

  const fetchThreads = useCallback(async (search?: string) => {
    if (!accessToken || !activeWorkspaceId) {
      setThreadList([]);
      return;
    }
    setThreadListLoading(true);
    try {
      const params = new URLSearchParams();
      if (search && search.trim()) params.set("q", search.trim());
      const res = await fetch(
        `${API_BASE}/workspaces/${activeWorkspaceId}/threads?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load threads");
      setThreadList(data.threads ?? []);
    } catch {
      setThreadList([]);
    } finally {
      setThreadListLoading(false);
    }
  }, [accessToken, activeWorkspaceId]);

  const openThread = useCallback(
    async (thread: { id: string; title: string }) => {
      if (!accessToken || !activeWorkspaceId) return;
      const existingTab = chatTabs.find((t) => (t as { threadId?: string }).threadId === thread.id);
      if (existingTab) {
        setActiveChatId(existingTab.id);
        setActiveThreadId(thread.id);
        clearChatComposer();
        setThreadListOpen(false);
        return;
      }
      try {
        const res = await fetch(
          `${API_BASE}/workspaces/${activeWorkspaceId}/threads/${thread.id}/messages?limit=200`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load messages");
        const messages = (data.messages ?? []).map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
        const nextId = String(Math.max(0, ...chatTabs.map((t) => parseInt(t.id, 10) || 0)) + 1);
        setChatTabs((prev) => [
          ...prev,
          { id: nextId, label: thread.title.slice(0, 40) || "Chat", threadId: thread.id },
        ]);
        setChatSessions((s) => ({ ...s, [nextId]: messages }));
        setActiveChatId(nextId);
        setActiveThreadId(thread.id);
        clearChatComposer();
        setThreadListOpen(false);
      } catch {
        /* non-fatal */
      }
    },
    [accessToken, activeWorkspaceId, chatTabs, clearChatComposer]
  );

  useEffect(() => {
    if (threadListOpen && accessToken && activeWorkspaceId) {
      const q = threadSearch.trim();
      const t = setTimeout(() => fetchThreads(q || undefined), q ? 200 : 0);
      return () => clearTimeout(t);
    }
  }, [threadListOpen, threadSearch, accessToken, activeWorkspaceId, fetchThreads]);

  const closeChatTab = useCallback((tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();
    setChatTabs((prev) => {
      if (prev.length <= 1) return prev;
      const remaining = prev.filter((t) => t.id !== tabId);
      if (activeChatIdRef.current === tabId) {
        const nextTab = remaining[0];
        setActiveChatId(nextTab?.id ?? "1");
        setActiveThreadId((nextTab as { threadId?: string })?.threadId ?? null);
        clearChatComposer();
      }
      setChatSessions((s) => {
        const next = { ...s };
        delete next[tabId];
        return next;
      });
      return remaining;
    });
  }, [clearChatComposer]);

  const handleDismissViolation = useCallback(
    (v: CriticViolation) => {
      const vKey = violationKey(v);
      setActiveViolations((prev) => prev.filter((x) => violationKey(x) !== vKey));
      setGraph((prev) => {
        if (!prev) return prev;
        const affectedIds = new Set([v.sourceNodeId, v.targetNodeId].filter(Boolean));
        return {
          ...prev,
          nodes: prev.nodes.map((node) => {
            if (!affectedIds.has(node.id)) return node;
            const remaining = (node.violationState?.violations ?? []).filter(
              (nv) =>
                !(
                  nv.type === v.type &&
                  nv.sourceNodeId === v.sourceNodeId &&
                  nv.targetNodeId === v.targetNodeId
                )
            );
            return {
              ...node,
              violationState:
                remaining.length === 0
                  ? undefined
                  : {
                      violations: remaining,
                      highestSeverity:
                        remaining
                          .map((x) => x.severity)
                          .sort(
                            (a, b) =>
                              (["critical", "high", "medium"] as const).indexOf(a) -
                              (["critical", "high", "medium"] as const).indexOf(b)
                          )[0] ?? null,
                    },
            } as ArchNode;
          }),
        };
      });
      const anyId = (v as any).id as string | undefined;
      if (anyId && accessToken) {
        fetch(`${API_BASE}/violations/${anyId}/dismiss`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        }).catch(() => {});
      }
    },
    [accessToken]
  );

  const handleFocusViolation = useCallback(
    (v: CriticViolation) => {
      if (!graph) return;
      const ids = [v.sourceNodeId, v.targetNodeId].filter(Boolean) as string[];
      if (ids.length > 0) {
        setAgentGraphCommand({ action: "highlight_nodes", nodeIds: ids });
      } else {
        setAgentGraphCommand(null);
      }
      setSelectedNode(v.sourceNodeId);
    },
    [graph]
  );

  // Responsive: auto-collapse left panel on narrow viewports unless user toggled it.
  useEffect(() => {
    const apply = () => {
      if (leftPanelUserToggledRef.current) return;
      const w = window.innerWidth || 0;
      if (w > 0 && w < 1100) setLeftPanelCollapsed(true);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  const panelStyle: React.CSSProperties = {
    width: leftPanelCollapsed ? 56 : panelWidth,
    minWidth: leftPanelCollapsed ? 56 : 240,
    background: "#161b22",
    borderRight: "1px solid #30363d",
    display: "flex",
    flexDirection: "column",
    padding: leftPanelCollapsed ? 10 : 16,
    gap: leftPanelCollapsed ? 10 : 12,
    overflowY: leftPanelCollapsed ? "hidden" : "auto",
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 13,
    color: "#e6edf3",
  };

  const renderGlobalOverlays = () => (
    <>
        {/* Workspace members / activity / annotation comments panels */}
        {showMembersPanel && activeWorkspaceId && (
          <WorkspaceMembersPanel
            workspaceId={activeWorkspaceId}
            accessToken={accessToken}
            isOwner={activeWorkspaceIsOwner}
            onClose={() => setShowMembersPanel(false)}
          />
        )}
        {showActivityPanel && activeWorkspaceId && (
          <ActivityLogPanel
            workspaceId={activeWorkspaceId}
            accessToken={accessToken}
            onClose={() => setShowActivityPanel(false)}
          />
        )}
        {showScanHistoryPanel && activeWorkspaceId && (
          <ScanHistoryPanel
            workspaceId={activeWorkspaceId}
            accessToken={accessToken}
            onClose={() => setShowScanHistoryPanel(false)}
          />
        )}
        {showSnapshotPanel && activeWorkspaceId && (
          <SnapshotSelectorPanel
            workspaceId={activeWorkspaceId}
            accessToken={accessToken}
            onClose={() => setShowSnapshotPanel(false)}
            onLoadSnapshot={(g) => setGraph(analyseGraph(g as ArchGraph))}
          />
        )}
        {showConnectGitHubPanel && (activeWorkspaceId || (() => {
          try {
            const ws = new URLSearchParams(window.location.search).get("workspaceId");
            return ws ?? null;
          } catch {
            return null;
          }
        })()) && (
          <ConnectGitHubModal
            workspaceId={
              (() => {
                try {
                  const ws = new URLSearchParams(window.location.search).get("workspaceId");
                  if (ws && new URLSearchParams(window.location.search).get("github-connect") === "1") return ws;
                } catch {
                  /* ignore */
                }
                return activeWorkspaceId!;
              })()
            }
            accessToken={accessToken}
            onClose={() => {
              setShowConnectGitHubPanel(false);
              try {
                const u = new URL(window.location.href);
                u.searchParams.delete("github-connect");
                u.searchParams.delete("workspaceId");
                window.history.replaceState({}, "", u.pathname + u.search + u.hash);
              } catch {
                /* ignore */
              }
            }}
            onConnected={(fullName) => {
              setRepoUrl(`https://github.com/${fullName}`);
            }}
            oauthState={(() => {
              const params = new URLSearchParams(window.location.search);
              if (params.get("github-connect") === "1") return params.get("workspaceId");
              return null;
            })()}
          />
        )}
        {selectedAnnotationForComments && activeWorkspaceId && (
          <AnnotationCommentsPanel
            workspaceId={activeWorkspaceId}
            annotationId={selectedAnnotationForComments}
            accessToken={accessToken}
            onClose={() => setSelectedAnnotationForComments(null)}
          />
        )}

        {showOnboardingChat && (
          <OnboardingChat
            intentMessage={onboardingIntent}
            pendingRepoUrl={repoUrl.trim() || null}
            onClose={() => setShowOnboardingChat(false)}
            onSignIn={() => {
              setShowOnboardingChat(false);
              setAuthMode("signin");
              setShowAuthModal(true);
            }}
            onComplete={({ accessToken: token, continueRepo, startDesign }) => {
              setShowOnboardingChat(false);
              setAccessToken(token);
              void supabase?.auth.getSession().then(({ data }) => {
                if (data.session?.access_token) setAccessToken(data.session.access_token);
              });
              if (continueRepo && repoUrl.trim()) {
                void scanRepo(repoUrl.trim());
                return;
              }
              if (startDesign) {
                handleStartDesignFromScratch();
                return;
              }
              // Land in an empty workspace when there is no repo to continue.
              if (!graph) {
                setGraph(
                  analyseGraph({
                    nodes: [],
                    edges: [],
                    generatedAt: Date.now(),
                    projectRoot: "",
                    projectName: "Workspace",
                  })
                );
                setGraphViewMode("layers");
              }
            }}
          />
        )}

        {showProfileBilling && accessToken && (
          <ProfileBillingPanel
            accessToken={accessToken}
            onClose={() => setShowProfileBilling(false)}
            onUpgrade={() => {
              setShowProfileBilling(false);
              setOnboardingIntent("Upgrade your plan.");
              setShowOnboardingChat(true);
            }}
            onSignOut={handleSignOut}
          />
        )}

        {/* Auth modal (signin / password reset — signup is OnboardingChat) */}
        {showAuthModal && (
          <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(18,19,26,0.45)",
                backdropFilter: "blur(6px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 50,
              }}
            onClick={() => setShowAuthModal(false)}
          >
            <div
              data-testid="auth-modal"
              style={{
                width: 460,
                maxWidth: "94vw",
                background: CANVAS,
                borderRadius: 18,
                border: `1px solid ${LINE}`,
                padding: 28,
                boxShadow: "0 30px 80px rgba(18,19,26,0.25)",
                position: "relative",
                fontFamily: FONT_UI,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div
                    style={{
                      fontFamily: FONT_BRAND,
                      fontSize: 16,
                      fontWeight: 400,
                      letterSpacing: "-0.01em",
                      textTransform: "lowercase",
                      color: ACCENT,
                    }}
                  >
                    blanko
                  </div>
                  <div
                    style={{
                      fontFamily: FONT_UI,
                      fontSize: 24,
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: INK,
                    }}
                  >
                    {authMode === "reset"
                      ? "Set new password"
                      : authMode === "signup"
                        ? "Create account"
                        : "Welcome back"}
                  </div>
                  <div
                    style={{
                      fontFamily: FONT_UI,
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: SLATE,
                    }}
                  >
                    {authMode === "reset"
                      ? "Enter your new password below."
                      : authMode === "signup"
                        ? "Scan free. Upgrade in chat when you want to save and collaborate."
                        : "Sign in to your workspace."}
                  </div>
                </div>
                <button
                  onClick={() => setShowAuthModal(false)}
                  style={{
                    background: CANVAS,
                    border: `1px solid ${LINE}`,
                    borderRadius: 999,
                    width: 30,
                    height: 30,
                    lineHeight: 1,
                    flexShrink: 0,
                    color: SLATE,
                    cursor: "pointer",
                    fontSize: 16,
                  }}
                >
                  ×
                </button>
              </div>

              {authMode !== "reset" && (
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  marginBottom: 22,
                  padding: 4,
                  background: PAPER,
                  border: `1px solid ${LINE}`,
                  borderRadius: 12,
                  fontSize: 13,
                }}
              >
                <button
                  onClick={() => {
                    setShowAuthModal(false);
                    setOnboardingIntent("Create your blanko account.");
                    setShowOnboardingChat(true);
                  }}
                  style={{
                    flex: 1,
                    padding: "9px 0",
                    borderRadius: 9,
                    cursor: "pointer",
                    border:
                      authMode === "signup"
                        ? `1px solid ${LINE}`
                        : "1px solid transparent",
                    background: authMode === "signup" ? CANVAS : "transparent",
                    color: authMode === "signup" ? INK : SLATE,
                    fontFamily: FONT_UI,
                    fontWeight: 600,
                    boxShadow:
                      authMode === "signup"
                        ? "0 1px 2px rgba(18,19,26,0.06)"
                        : "none",
                  }}
                >
                  Sign up
                </button>
                <button
                  onClick={() => {
                    setSignupPendingConfirmation(false);
                    setAuthMode("signin");
                  }}
                  style={{
                    flex: 1,
                    padding: "9px 0",
                    borderRadius: 9,
                    cursor: "pointer",
                    border:
                      authMode === "signin"
                        ? `1px solid ${LINE}`
                        : "1px solid transparent",
                    background: authMode === "signin" ? CANVAS : "transparent",
                    color: authMode === "signin" ? INK : SLATE,
                    fontFamily: FONT_UI,
                    fontWeight: 600,
                    boxShadow:
                      authMode === "signin"
                        ? "0 1px 2px rgba(18,19,26,0.06)"
                        : "none",
                  }}
                >
                  Sign in
                </button>
              </div>
              )}

              {supabaseConfigError && (
                <div style={authBannerStyle("bad")}>{supabaseConfigError}</div>
              )}
              {authMessage && (
                <div style={authBannerStyle("good")}>{authMessage}</div>
              )}
              {authError && <div style={authBannerStyle("bad")}>{authError}</div>}

              {authMode === "reset" ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <input
                      type="password"
                      placeholder="New password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      style={authFieldStyle}
                    />
                    <input
                      type="password"
                      placeholder="Confirm new password"
                      value={authConfirmPassword}
                      onChange={(e) => setAuthConfirmPassword(e.target.value)}
                      style={authFieldStyle}
                    />
                  </div>
                  <button
                    onClick={async () => {
                      setAuthError(null);
                      setAuthMessage(null);
                      if (!supabase) {
                        setAuthError("Supabase is not configured.");
                        return;
                      }
                      if (!authPassword) {
                        setAuthError("Password is required.");
                        return;
                      }
                      if (authPassword !== authConfirmPassword) {
                        setAuthError("Passwords do not match.");
                        return;
                      }
                      setAuthBusy(true);
                      try {
                        const { error } = await supabase.auth.updateUser({ password: authPassword });
                        if (error) throw error;
                        setAuthPassword("");
                        setAuthConfirmPassword("");
                        setAuthMode("signin");
                        setShowAuthModal(false);
                      } catch (e: unknown) {
                        setAuthError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setAuthBusy(false);
                      }
                    }}
                    style={{
                      ...authPrimaryBtnStyle,
                      marginTop: 18,
                      opacity: authBusy ? 0.7 : 1,
                    }}
                    disabled={authBusy || !!supabaseConfigError}
                  >
                    Update password
                  </button>
                </>
              ) : authMode === "signup" && signupPendingConfirmation ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    padding: "8px 0",
                  }}
                >
                  <div
                    style={{
                      padding: 16,
                      border: "1px solid #BBF7D0",
                      background: "#F0FDF4",
                      color: INK,
                      fontSize: 14,
                      borderRadius: 12,
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 8, color: GOOD }}>
                      Thank you! Your account was created.
                    </div>
                    <div style={{ color: SLATE, marginBottom: 6, lineHeight: 1.5 }}>
                      We sent a confirmation link to <strong style={{ color: INK }}>{authEmail}</strong>.
                    </div>
                    <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.5 }}>
                      Click the link in the email to activate your account, then sign in.
                    </div>
                  </div>
                  <button
                    onClick={() => window.open("https://mail.google.com", "_blank")}
                    style={{
                      ...authGhostBtnStyle,
                      padding: "13px 16px",
                      color: ACCENT,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    Open Gmail
                  </button>
                  <button
                    onClick={() => {
                      setSignupPendingConfirmation(false);
                      setAuthMode("signin");
                    }}
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      borderRadius: 10,
                      border: "1px solid transparent",
                      cursor: "pointer",
                      background: PAPER,
                      color: SLATE,
                      fontFamily: FONT_UI,
                      fontSize: 13,
                    }}
                  >
                    Back to sign in
                  </button>
                </div>
              ) : authMode === "signup" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ color: SLATE, fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                    Signup is a short chat — plan, card (if paid), and you are in.
                  </p>
                  <button
                    type="button"
                    data-testid="open-onboarding-from-modal"
                    onClick={() => {
                      setShowAuthModal(false);
                      setOnboardingIntent("Create your blanko account.");
                      setShowOnboardingChat(true);
                    }}
                    style={authPrimaryBtnStyle}
                  >
                    Continue in chat →
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <input
                      type="email"
                      placeholder="Email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      style={authFieldStyle}
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      style={authFieldStyle}
                    />
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginTop: 4,
                      }}
                    >
                      <button
                        type="button"
                        onClick={async () => {
                          setAuthError(null);
                          setAuthMessage(null);
                          if (!supabase) {
                            setAuthError("Supabase is not configured.");
                            return;
                          }
                          if (!authEmail.trim()) {
                            setAuthError("Enter your email above, then click Forgot password.");
                            return;
                          }
                          setAuthBusy(true);
                          try {
                            const { error } = await supabase.auth.resetPasswordForEmail(
                              authEmail.trim(),
                              {
                                redirectTo: window.location.origin,
                              }
                            );
                            if (error) throw error;
                            setAuthMessage(
                              "If that email exists in our system, a reset link has been sent."
                            );
                          } catch (e: any) {
                            setAuthError(e?.message ? String(e.message) : String(e));
                            setAuthMessage(null);
                          } finally {
                            setAuthBusy(false);
                          }
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          fontFamily: FONT_UI,
                          fontSize: 12,
                          color: ACCENT,
                          cursor: "pointer",
                          textDecoration: "underline",
                        }}
                        disabled={authBusy || !!supabaseConfigError}
                      >
                        Forgot password?
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      setAuthError(null);
                      setAuthMessage(null);
                      if (!supabase) {
                        setAuthError("Supabase is not configured.");
                        return;
                      }
                      if (!authEmail.trim() || !authPassword) {
                        setAuthError("Email and password are required.");
                        return;
                      }
                      setAuthBusy(true);
                      try {
                        const { error } = await supabase.auth.signInWithPassword({
                          email: authEmail.trim(),
                          password: authPassword,
                        });
                        if (error) throw error;
                        setShowAuthModal(false);
                      } catch (e: any) {
                        setAuthError(e?.message ? String(e.message) : String(e));
                      } finally {
                        setAuthBusy(false);
                      }
                    }}
                    style={{
                      ...authPrimaryBtnStyle,
                      marginTop: 18,
                      opacity: authBusy ? 0.7 : 1,
                    }}
                    disabled={authBusy || !!supabaseConfigError}
                  >
                    Sign in
                  </button>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      margin: "20px 0",
                      color: SLATE,
                      fontFamily: FONT_UI,
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    <div style={{ flex: 1, height: 1, background: LINE }} />
                    <span>or</span>
                    <div style={{ flex: 1, height: 1, background: LINE }} />
                  </div>
                  <button
                    data-ll-interactive="true"
                    onClick={async () => {
                      setAuthError(null);
                      if (!supabase) {
                        setAuthError("Supabase is not configured.");
                        return;
                      }
                      const { error } = await supabase.auth.signInWithOAuth({
                        provider: "github",
                        options: { redirectTo: window.location.origin },
                      });
                      if (error) setAuthError(error.message);
                    }}
                    style={{
                      ...authGhostBtnStyle,
                      padding: "11px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                    }}
                    disabled={authBusy || !!supabaseConfigError}
                  >
                    <ProviderIcon providerId="github" size={16} chip={false} />
                    Continue with GitHub
                  </button>
                </>
              )}
            </div>
          </div>
        )}
    </>
  );

  // Landing / onboarding: no graph yet
  if (!graph && !loading) {
    return (
      <LandingPage
        repoUrl={repoUrl}
        onRepoUrlChange={setRepoUrl}
        error={error}
        authLoading={authLoading}
        onScan={handleScan}
        onDesignFromScratch={handleStartDesignFromScratch}
        onImportN8nClick={() => n8nFileInputRef.current?.click()}
        n8nFileInput={
          <input
            ref={n8nFileInputRef}
            type="file"
            accept="application/json,.json"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files?.length) void handleN8nWorkflowFiles(e.target.files);
              e.target.value = "";
            }}
          />
        }
        onForkBlueprint={handleForkBlueprint}
        onSignIn={() => {
          setAuthMode("signin");
          setShowAuthModal(true);
        }}
        onGetStarted={() => {
          setOnboardingIntent("Start building with blanko.");
          setShowOnboardingChat(true);
        }}
      >
        {renderGlobalOverlays()}
      </LandingPage>
    );
  }

  // Loading
  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: CANVAS,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
          fontFamily: FONT_UI,
          color: SLATE,
        }}
      >
        <div
          style={{
            fontFamily: FONT_BRAND,
            fontSize: 22,
            color: ACCENT,
            textTransform: "lowercase",
          }}
        >
          blanko
        </div>
        <div style={{ fontSize: 17, color: INK, fontWeight: 600 }}>⟳ {loading}</div>
        <div style={{ fontSize: 13 }}>This may take 30–60 seconds for large repos.</div>
      </div>
    );
  }

  // Main: chat left, ReactFlow right
  const selectedNodeData = graph?.nodes.find((n) => n.id === selectedNode);

  return (
    <>
      <style>{`
        @keyframes chatDots {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
      {authStatus === "mismatch" && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            background: "#7f1d1d",
            borderBottom: "1px solid #b91c1c",
            color: "#fee2e2",
            fontSize: 12,
            padding: "6px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>
            {authStatusMessage ??
              "Your browser is signed in, but the server does not recognize your Supabase token. Check Supabase client/server configuration."}
          </span>
        </div>
      )}
      <div
        data-testid="blanko-workspace"
        style={{ display: "flex", width: "100vw", height: "100vh", minWidth: 0, background: CANVAS }}
      >
      {blankoShell && graph && (
        <ScenePanel
          graph={graph}
          collapsed={sceneCollapsed}
          onToggle={() => setSceneCollapsed((c) => !c)}
          workspaceTitle={displayWorkspaceName}
          activeWorkspaceId={activeWorkspaceId}
          onRenameWorkspace={handleRenameWorkspaceTitle}
          workspaces={savedWorkspaces}
          loadingWorkspaces={loadingWorkspaces}
          onFetchWorkspaces={fetchSavedWorkspaces}
          onOpenWorkspace={(id) => {
            void loadWorkspace(id);
          }}
          onNewWorkspace={() => setShowNewRepoConfirm(true)}
          onDeleteWorkspace={(id) => {
            if (id === activeWorkspaceId) {
              setShowDeleteConfirm(true);
              return;
            }
            if (!accessToken) {
              promptSignup("delete a workspace");
              return;
            }
            void (async () => {
              try {
                const res = await fetch(`${API_BASE}/workspaces/${id}`, {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  setError(data.error || res.statusText || "Failed to delete workspace.");
                  return;
                }
                setSavedWorkspaces((prev) => prev.filter((w) => w.id !== id));
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            })();
          }}
          signedIn={!!accessToken}
          onOpenProfile={() => setShowProfileBilling(true)}
          onSignIn={() => {
            setAuthMode("signin");
            setShowAuthModal(true);
          }}
          onImportN8n={() => n8nFileInputRef.current?.click()}
          onImportGithub={() => {
            setError("Paste a GitHub URL on the landing page, or type a repo path in chat.");
          }}
        />
      )}
      {!blankoShell && (
      <div style={panelStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
        {!leftPanelCollapsed ? (
          <div
            style={{
              color: "#7d8590",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Repo
          </div>
        ) : (
          <div style={{ width: 1 }} />
        )}
        <button
          type="button"
          title={leftPanelCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => {
            leftPanelUserToggledRef.current = true;
            setLeftPanelCollapsed((c) => {
              const next = !c;
              if (next) panelWidthBeforeCollapseRef.current = panelWidth;
              else setPanelWidth(panelWidthBeforeCollapseRef.current || 320);
              return next;
            });
          }}
          style={{
            padding: "4px 8px",
            fontSize: 11,
            background: "#21262d",
            color: "#8b949e",
            border: "1px solid #30363d",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {leftPanelCollapsed ? "›" : "‹"}
        </button>
        {(accessToken || isSigningOut) && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {accessToken && (
              <button
                type="button"
                data-testid="account-profile-btn"
                onClick={() => setShowProfileBilling(true)}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  background: "#21262d",
                  color: "#e6edf3",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Profile
              </button>
            )}
            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                background: "#21262d",
                color: "#8b949e",
                border: "1px solid #30363d",
                borderRadius: 6,
                cursor: isSigningOut ? "wait" : "pointer",
                opacity: isSigningOut ? 0.8 : 1,
              }}
            >
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        )}
        </div>
        {leftPanelCollapsed ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" }}>
            {(
              [
                { key: "dashboard", label: "Dashboard", short: "D" },
                { key: "chat", label: "Chat", short: "C" },
                { key: "code", label: "Files", short: "<>" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                title={t.label}
                onClick={() => setSidebarTab(t.key as any)}
                style={{
                  padding: "10px 0",
                  fontSize: 11,
                  fontFamily: "monospace",
                  borderRadius: 10,
                  border: sidebarTab === (t.key as any) ? "1px solid #ef32a6" : "1px solid #30363d",
                  background: sidebarTab === (t.key as any) ? "#161b22" : "transparent",
                  color: sidebarTab === (t.key as any) ? "#e6edf3" : "#8b949e",
                  cursor: "pointer",
                }}
              >
                {t.short}
              </button>
            ))}
          </div>
        ) : graph!.nodes.length === 0 && !graph!.projectRoot ? (
          <div style={{ marginBottom: 12 }} data-testid="design-empty-sidebar">
            <button
              type="button"
              data-testid="design-from-scratch-sidebar"
              onClick={() => {
                handleStartDesignFromScratch();
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "#238636",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Design from scratch
            </button>
            <DesignPalette
              onPlaceAtCenter={(paletteId) => {
                const node = paletteItemToNode(paletteId);
                if (!node || !graph) return;
                setGraph({
                  ...graph,
                  nodes: [...graph.nodes, node],
                  generatedAt: Date.now(),
                });
                setSelectedNode(node.id);
                setGraphViewMode("2d");
              }}
            />
            <DesignBlueprintGallery onFork={handleForkBlueprint} />
            <div
              style={{
                fontSize: 10,
                color: "#8b949e",
                textTransform: "uppercase",
                letterSpacing: 0.06,
                margin: "10px 0 6px",
              }}
            >
              Import existing design
            </div>
            <input
              type="url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 12,
                background: "#21262d",
                border: "1px solid #30363d",
                borderRadius: 6,
                color: "#e6edf3",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            {error ? (
              <div style={{ fontSize: 11, color: "#f85149", marginTop: 6 }}>{error}</div>
            ) : null}
            <button
              onClick={handleScan}
              disabled={authLoading}
              style={{
                width: "100%",
                marginTop: 8,
                padding: "8px 12px",
                background: authLoading ? "#30363d" : "#21262d",
                color: "#e6edf3",
                border: "1px solid #30363d",
                borderRadius: 6,
                fontSize: 12,
                cursor: authLoading ? "wait" : "pointer",
                fontWeight: 600,
                opacity: authLoading ? 0.7 : 1,
              }}
            >
              Import from GitHub
            </button>
          </div>
        ) : isDesignMode ? (
          <div style={{ marginBottom: 12 }}>
            <div
              data-testid="design-mode-badge"
              style={{
                fontSize: 11,
                color: "#a78bfa",
                fontFamily: "monospace",
                marginBottom: 8,
                padding: "4px 8px",
                border: "1px solid #7c3aed55",
                borderRadius: 6,
                display: "inline-block",
              }}
            >
              Design mode
            </div>
            {designNextStep && (
              <div
                data-testid="design-whats-next"
                style={{
                  fontSize: 11,
                  color: "#8b949e",
                  lineHeight: 1.4,
                  marginBottom: 8,
                  padding: "6px 8px",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                }}
              >
                <span style={{ color: "#ef32a6", fontWeight: 600 }}>What's next: </span>
                Build "{designNextStep.label}" — {designNextStep.reason}
              </div>
            )}
            {llmopsDriftSummary && (
              <div
                data-testid="llmops-drift-banner"
                style={{
                  fontSize: 11,
                  color: "#d29922",
                  lineHeight: 1.4,
                  marginBottom: 8,
                  padding: "6px 8px",
                  border: "1px solid #d2992255",
                  borderRadius: 6,
                  background: "rgba(210,153,34,0.08)",
                }}
              >
                LLMOps: {llmopsDriftSummary.count} agent{llmopsDriftSummary.count === 1 ? "" : "s"} need Memory/Eval
              </div>
            )}
            <button
              type="button"
              data-testid="design-auto-arrange"
              onClick={handleAutoArrangeDesign}
              style={{
                width: "100%",
                padding: "6px 10px",
                marginBottom: 8,
                background: "none",
                border: "1px solid #30363d",
                borderRadius: 6,
                color: "#8b949e",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "monospace",
              }}
            >
              ⤢ Auto arrange
            </button>
            <DesignPalette
              onPlaceAtCenter={(paletteId) => {
                const node = paletteItemToNode(paletteId);
                if (!node || !graph) return;
                setGraph({
                  ...graph,
                  nodes: [...graph.nodes, node],
                  generatedAt: Date.now(),
                });
                setSelectedNode(node.id);
                setGraphViewMode("2d");
              }}
            />
            <div
              style={{
                fontSize: 10,
                color: "#8b949e",
                marginBottom: 6,
              }}
            >
              Or import an existing design
            </div>
            <input
              type="url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 12,
                background: "#21262d",
                border: "1px solid #30363d",
                borderRadius: 6,
                color: "#e6edf3",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={handleScan}
              disabled={authLoading}
              style={{
                width: "100%",
                marginTop: 8,
                padding: "8px 12px",
                background: "#21262d",
                color: "#e6edf3",
                border: "1px solid #30363d",
                borderRadius: 6,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Import from GitHub
            </button>
          </div>
        ) : (
        <div
          style={{
            fontSize: 12,
            color: "#ef32a6",
            wordBreak: "break-all",
            marginBottom: 12,
          }}
        >
          {repoUrl}
        </div>
        )}

        {/* Sidebar tabs: Dashboard / Chat / Code */}
        {!leftPanelCollapsed && (
        <div
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 8,
            marginTop: 4,
          }}
        >
          <button
            data-testid="sidebar-tab-dashboard"
            onClick={() => {
              setDashboardLastSeenViolations(activeViolations.length);
              setSidebarTab("dashboard");
            }}
            style={{
              flex: 1,
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 999,
              border:
                sidebarTab === "dashboard"
                  ? "1px solid #ef32a6"
                  : "1px solid #30363d",
              background:
                sidebarTab === "dashboard" ? "#161b22" : "#161b22",
              color: sidebarTab === "dashboard" ? "#e6edf3" : "#8b949e",
              cursor: "pointer",
              position: "relative",
            }}
          >
            Dashboard
            {isDesignMode ? " · Review" : ""}
            {activeViolations.length > dashboardLastSeenViolations && (
              <span
                style={{
                  position: "absolute",
                  top: -4,
                  right: 10,
                  minWidth: 14,
                  height: 14,
                  padding: "0 4px",
                  borderRadius: 999,
                  background: "#da3633",
                  color: "white",
                  fontSize: 9,
                  fontFamily: "monospace",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {Math.min(
                  activeViolations.length - dashboardLastSeenViolations,
                  9
                )}
              </span>
            )}
          </button>
          <button
            onClick={() => setSidebarTab("chat")}
            style={{
              flex: 1,
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 999,
              border:
                sidebarTab === "chat"
                  ? "1px solid #ef32a6"
                  : "1px solid #30363d",
              background: sidebarTab === "chat" ? "#161b22" : "#161b22",
              color: sidebarTab === "chat" ? "#e6edf3" : "#8b949e",
              cursor: "pointer",
            }}
          >
            Chat
          </button>
          <button
            onClick={() => setSidebarTab("code")}
            style={{
              flex: 1,
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 999,
              border:
                sidebarTab === "code"
                  ? "1px solid #ef32a6"
                  : "1px solid #30363d",
              background: sidebarTab === "code" ? "#161b22" : "#161b22",
              color: sidebarTab === "code" ? "#e6edf3" : "#8b949e",
              cursor: "pointer",
            }}
          >
            Files
          </button>
        </div>
        )}

        {/* Dashboard content: project overview, health, execution, violations, governance, proposed nodes */}
        {!leftPanelCollapsed && sidebarTab === "dashboard" && (
          isDesignMode && graph ? (
            <div style={{ display: "flex", flexDirection: "column", minHeight: 320, flex: 1 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <button
                  type="button"
                  data-testid="design-dashboard-tab-review"
                  onClick={() => setDesignDashboardTab("review")}
                  style={{
                    flex: 1,
                    fontSize: 11,
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: designDashboardTab === "review" ? "1px solid #ef32a6" : "1px solid #30363d",
                    background: "#0d1117",
                    color: designDashboardTab === "review" ? "#e6edf3" : "#8b949e",
                    cursor: "pointer",
                  }}
                >
                  Review
                </button>
                <button
                  type="button"
                  data-testid="design-dashboard-tab-plan"
                  onClick={() => setDesignDashboardTab("plan")}
                  style={{
                    flex: 1,
                    fontSize: 11,
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: designDashboardTab === "plan" ? "1px solid #ef32a6" : "1px solid #30363d",
                    background: "#0d1117",
                    color: designDashboardTab === "plan" ? "#e6edf3" : "#8b949e",
                    cursor: "pointer",
                  }}
                >
                  Plan
                </button>
              </div>
              {designDashboardTab === "review" ? (
                <DesignReviewPanel
                  findings={designFindings}
                  workspaceId={activeWorkspaceId}
                  apiBase={API_BASE}
                  accessToken={accessToken}
                  onHighlight={(finding: DesignFinding) => {
                    if (finding.nodeIds.length > 0) {
                      setAgentGraphCommand({ action: "highlight_nodes", nodeIds: finding.nodeIds });
                      setSelectedNode(finding.nodeIds[0] ?? null);
                    }
                    if (finding.edgeIds[0]) setSelectedEdgeId(finding.edgeIds[0]);
                  }}
                  onFix={(finding: DesignFinding) => {
                    if (!finding.fix?.length || !graph) return;
                    setGraph(applyDesignCommandsToGraph(graph, finding.fix));
                  }}
                />
              ) : (
                <DesignBuildPlanPanel
                  plan={designPlan}
                  graph={graph}
                  onSetBuildStatus={handleSetBuildStatus}
                  onHighlight={(step) => {
                    setAgentGraphCommand({ action: "highlight_nodes", nodeIds: [step.nodeId] });
                    setSelectedNode(step.nodeId);
                  }}
                />
              )}
            </div>
          ) : (
          <DashboardView
            graph={graph}
            onOpenFile={(path, line) => {
              setOpenFile({ path, line });
              setGraphViewMode("files");
            }}
            onGoToView={(v) => setGraphViewMode(v as never)}
            onSelectAgent={(file) => {
              setSelectedAgentFile(file);
              setLayersAgentFile(file);
            }}
          />
          )
        )}

        {!leftPanelCollapsed && sidebarTab === "code" && (
          <ChangesPanel
            graph={graph}
            onNewGraph={(g) => setGraph(analyseGraph(g))}
            projectRoot={graph?.projectRoot}
            apiBase={API_BASE}
            accessToken={accessToken}
          />
        )}
        {!leftPanelCollapsed && sidebarTab === "code" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, flex: 1 }}>
            {/* The browser is how you reach a file when you do not already know
                its name. Everything else in the app links straight into the
                viewer below. */}
            <div style={{ maxHeight: 260, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <FileBrowser
                graph={graph}
                openPath={openFile?.path}
                onOpen={(path, line) => setOpenFile({ path, line })}
              />
            </div>
            {/* The sidebar shows what is worth looking at, not the file
                itself — 400px cannot hold 6,840 lines and should not try. */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              <FileIssues
                graph={graph}
                filePath={openFile?.path}
                onOpenFull={(path, line) => {
                  setOpenFile({ path, line });
                  setGraphViewMode("files");
                }}
              />
            </div>
          </div>        )}

        <div
          style={{
            flex: 1,
            display: sidebarTab === "chat" ? "flex" : "none",
            flexDirection: "column",
            gap: 0,
            minHeight: 0,
          }}
        >
        {/* Agent section: Chat tabs at top */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            paddingBottom: 8,
            marginBottom: 8,
            borderBottom: "1px solid #30363d",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              color: "#7d8590",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {isDesignMode ? "Design" : "Agent"}
          </span>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              background: isDesignMode ? "rgba(167,139,250,0.16)" : "rgba(59,130,246,0.16)",
              color: "#ef32a6",
              border: isDesignMode
                ? "1px solid rgba(167,139,250,0.4)"
                : "1px solid rgba(59,130,246,0.4)",
            }}
            data-testid={isDesignMode ? "chrome-design-mode" : "chrome-analyze-mode"}
          >
            {isDesignMode ? "Build architecture" : "Analyze"}
          </span>
          {/* A conversation you cannot take anywhere is scrollback, not a
              record. Several sessions here have produced findings worth
              keeping — markdown pastes into a PR, an issuer a document. */}
          <button
            type="button"
            title="Download this conversation as markdown"
            disabled={chatHistory.length === 0}
            onClick={() => {
              const label = chatTabs.find((t) => t.id === activeChatId)?.label;
              downloadText(
                chatFilename(label, graph?.projectName),
                "text/markdown",
                chatToMarkdown(chatHistory as never[], {
                  title: label,
                  repo: graph?.projectName,
                })
              );
            }}
            style={{
              marginLeft: "auto",
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid #30363d",
              background: "transparent",
              color: chatHistory.length === 0 ? "#484f58" : "#8b949e",
              fontSize: 10,
              cursor: chatHistory.length === 0 ? "default" : "pointer",
            }}
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => setShowThinkingPanel((v) => !v)}
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid #30363d",
              background: showThinkingPanel ? "#0d1117" : "transparent",
              color: "#8b949e",
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            {showThinkingPanel ? "Hide thinking" : "Show thinking"}
          </button>
            {chatTabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => {
                  if (tab.id === activeChatId) return;
                  setActiveChatId(tab.id);
                  setActiveThreadId((tab as { threadId?: string }).threadId ?? null);
                  clearChatComposer();
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingTabId(tab.id);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "6px 12px",
                  fontSize: 12,
                  background: activeChatId === tab.id ? "#238636" : "transparent",
                  color: activeChatId === tab.id ? "white" : "#8b949e",
                  border: "none",
                  borderBottom:
                    activeChatId === tab.id ? "2px solid #238636" : "2px solid transparent",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                {editingTabId === tab.id ? (
                  <input
                    autoFocus
                    value={tab.label}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setChatTabs((prev) =>
                        prev.map((t) => (t.id === tab.id ? { ...t, label: e.target.value } : t))
                      )
                    }
                    onBlur={() => setEditingTabId(null)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") setEditingTabId(null);
                    }}
                    style={{
                      width: 80,
                      padding: "2px 4px",
                      fontSize: 12,
                      background: "#0d1117",
                      border: "1px solid #30363d",
                      borderRadius: 4,
                      color: "#e6edf3",
                      outline: "none",
                    }}
                  />
                ) : (
                  <span>{tab.label}</span>
                )}
                {chatTabs.length > 1 && (
                  <button
                    onClick={(e) => closeChatTab(tab.id, e)}
                    title="Close chat"
                    style={{
                      padding: 0,
                      marginLeft: 2,
                      background: "none",
                      border: "none",
                      color: "inherit",
                      cursor: "pointer",
                      fontSize: 14,
                      lineHeight: 1,
                      opacity: 0.8,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
              <button
                type="button"
                onClick={() => {
                  setThreadListOpen((v) => !v);
                  if (!threadListOpen) setThreadSearch("");
                }}
                title="Open a past conversation"
                style={{
                  padding: "6px 8px",
                  fontSize: 12,
                  background: threadListOpen ? "#21262d" : "transparent",
                  color: "#8b949e",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                History
              </button>
              {threadListOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    marginTop: 4,
                    minWidth: 220,
                    maxHeight: 280,
                    background: "#0d1117",
                    border: "1px solid #30363d",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    zIndex: 100,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    value={threadSearch}
                    onChange={(e) => setThreadSearch(e.target.value)}
                    placeholder="Search threads…"
                    style={{
                      margin: 8,
                      padding: "6px 10px",
                      fontSize: 12,
                      background: "#161b22",
                      border: "1px solid #30363d",
                      borderRadius: 6,
                      color: "#e6edf3",
                      outline: "none",
                    }}
                  />
                  <div style={{ overflowY: "auto", flex: 1, maxHeight: 220 }}>
                    {threadListLoading ? (
                      <div style={{ padding: 12, color: "#8b949e", fontSize: 12 }}>Loading…</div>
                    ) : threadList.length === 0 ? (
                      <div style={{ padding: 12, color: "#8b949e", fontSize: 12 }}>No threads found</div>
                    ) : (
                      threadList.map((t) => (
                        <div
                          key={t.id}
                          onClick={() => openThread(t)}
                          style={{
                            padding: "8px 12px",
                            fontSize: 12,
                            color: "#c9d1d9",
                            cursor: "pointer",
                            borderBottom: "1px solid #21262d",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "#21262d";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          {(t.title || "Untitled").slice(0, 50)}
                          {t.updated_at && (
                            <div style={{ fontSize: 10, color: "#8b949e", marginTop: 2 }}>
                              {new Date(t.updated_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={addChatTab}
              title="New chat — Start a fresh conversation. Your current chat history is preserved."
              style={{
                padding: "6px 10px",
                fontSize: 14,
                background: "transparent",
                color: "#8b949e",
                border: "1px dashed #30363d",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              +
            </button>
          </div>

          {(() => {
            const visibleTasks = tasksForWorkspace.filter((t) => t.dismissed !== true);
            if (visibleTasks.length === 0) return null;
            return (
              <div
                style={{
                  marginBottom: 8,
                  padding: 8,
                  borderRadius: 8,
                  background: "#0d1117",
                  border: "1px solid #30363d",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "#7d8590",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    marginBottom: 6,
                  }}
                >
                  Agent Tasks
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {visibleTasks
                    .slice()
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .slice(0, 8)
                    .map((t) => {
                      const statusColor =
                        t.status === "running"
                          ? "#ef32a6"
                          : t.status === "completed"
                            ? "#3fb950"
                            : "#d29922";
                      const isAttention = t.status === "failed" || t.status === "needs_review";
                      return (
                        <div
                          key={t.id}
                          onClick={() => {
                            setActiveTaskId((cur) => (cur === t.id ? null : t.id));
                            setBackgroundTasks((prev) =>
                              prev.map((x) =>
                                x.id === t.id ? { ...x, reviewed: true } : x
                              )
                            );
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 8px",
                            borderRadius: 6,
                            border: isAttention ? "1px solid rgba(245,158,11,0.4)" : "1px solid #21262d",
                            background: isAttention ? "rgba(245,158,11,0.08)" : "transparent",
                            cursor: "pointer",
                          }}
                          title="Click to expand or collapse task details"
                        >
                          <span
                            style={{
                              padding: "2px 6px",
                              borderRadius: 999,
                              fontSize: 9,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                              border: "1px solid #30363d",
                              color: "#c9d1d9",
                            }}
                          >
                            {t.mode}
                          </span>
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              color: "#e6edf3",
                              fontSize: 11,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {t.label}
                          </span>
                          <span
                            style={{
                              padding: "2px 6px",
                              borderRadius: 999,
                              fontSize: 9,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                              background: `${statusColor}22`,
                              border: `1px solid ${statusColor}55`,
                              color: statusColor,
                            }}
                          >
                            {t.status === "needs_review" ? "needs review" : t.status}
                          </span>
                          {t.totalSteps > 0 && (
                            <span style={{ fontSize: 10, color: "#7d8590", fontFamily: "monospace" }}>
                              {Math.min(t.currentStep, t.totalSteps)}/{t.totalSteps}
                            </span>
                          )}
                          {(t.retryAttempt != null && t.retryMax != null) && (
                            <span
                              style={{
                                fontSize: 10,
                                fontFamily: "monospace",
                                fontWeight: 600,
                                color: t.status === "running" && (t.retryAttempt ?? 0) >= 2 ? "#d29922" : (t.retryAttempt ?? 0) >= 2 ? "#f85149" : "#7d8590",
                              }}
                            >
                              Attempt {t.retryAttempt}/{t.retryMax}
                            </span>
                          )}
                          {(t.status === "completed" || t.reviewed === true) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setBackgroundTasks((prev) =>
                                  prev.map((x) =>
                                    x.id === t.id ? { ...x, dismissed: true } : x
                                  )
                                );
                                setActiveTaskId((cur) => (cur === t.id ? null : cur));
                              }}
                              title="Dismiss task"
                              style={{
                                padding: 0,
                                width: 18,
                                height: 18,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "transparent",
                                border: "1px solid #30363d",
                                borderRadius: 6,
                                color: "#7d8590",
                                cursor: "pointer",
                                fontSize: 12,
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })()}
          {/* Thinking panel */}
          {showThinkingPanel && (
            <div
              style={{
                marginTop: 8,
                marginBottom: 4,
                padding: 8,
                borderRadius: 6,
                background: "#0d1117",
                border: "1px solid #161b22",
                fontSize: 12,
                color: "#8b949e",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    color: "#7d8590",
                  }}
                >
                  Thinking
                </span>
                <button
                  type="button"
                  onClick={() => setShowThinkingPanel(false)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#7d8590",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Hide
                </button>
              </div>
            <div style={{ fontSize: 12, color: "#8b949e" }}>
              {(() => {
                const t = activeTaskId
                  ? backgroundTasks.find((x) => x.id === activeTaskId)
                  : backgroundTasks.find((x) => x.status === "running");
                if (!t) return "The agent will stream its reasoning here as tasks run.";
                return t.prompt ?? "No prompt recorded for this task.";
              })()}
            </div>
            </div>
          )}

          {lastCriticResult && (
            <div
              style={{
                marginBottom: 8,
                padding: 10,
                borderRadius: 6,
                background: "#0d1117",
                border: "1px solid #30363d",
                fontSize: 11,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: "#d29922",
                  marginBottom: 6,
                }}
              >
                Critic — score: {lastCriticResult.score}/10
              </div>
              <div style={{ color: "#8b949e", marginBottom: 8, whiteSpace: "pre-wrap" }}>
                {lastCriticResult.report}
              </div>
              {lastCriticResult.violations.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 16, color: "#e6edf3" }}>
                  {lastCriticResult.violations.slice(0, 10).map((v, i) => (
                    <li key={i}>
                      [{v.severity}] {v.description}
                    </li>
                  ))}
                  {lastCriticResult.violations.length > 10 && (
                    <li>+{lastCriticResult.violations.length - 10} more</li>
                  )}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setLastCriticResult(null)}
                style={{
                  marginTop: 6,
                  padding: "2px 8px",
                  fontSize: 10,
                  background: "transparent",
                  color: "#7d8590",
                  border: "1px solid #30363d",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {activeTaskId && (() => {
            const task = backgroundTasks.find((t) => t.id === activeTaskId);
            if (!task) return null;
            return (
              <div
                style={{
                  marginBottom: 8,
                  padding: 10,
                  borderRadius: 6,
                  background: "#0f172a",
                  border: "1px solid #1e293b",
                  fontSize: 11,
                  maxHeight: 320,
                  overflowY: "auto",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{task.label}</span>
                  {task.logicPath && task.logicPath.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10,
                        fontFamily: "monospace",
                        color: "#8b949e",
                      }}
                    >
                      {task.logicPath.map((step, i) => (
                        <span key={i}>
                          <span
                            style={{
                              color: task.currentStep === i ? "#ef32a6" : "#7d8590",
                              fontWeight: task.currentStep === i ? 600 : 400,
                            }}
                          >
                            {step}
                          </span>
                          {i < task.logicPath!.length - 1 && <span style={{ marginLeft: 4 }}>→</span>}
                        </span>
                      ))}
                      {(task.hallucinationIndex ?? 0) > 0.5 && (
                        <span style={{ marginLeft: 6, color: "#d29922" }}>⚠ drift</span>
                      )}
                    </div>
                  )}
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: 4,
                      fontSize: 10,
                      background:
                        task.status === "running"
                          ? "rgba(59,130,246,0.2)"
                          : task.status === "failed" || task.status === "needs_review"
                            ? "rgba(248,81,73,0.2)"
                            : "rgba(34,197,94,0.2)",
                      color: "#e2e8f0",
                    }}
                  >
                    {task.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setBackgroundTasks((prev) =>
                        prev.map((x) =>
                          x.id === task.id ? { ...x, reviewed: true } : x
                        )
                      );
                      setActiveTaskId(null);
                    }}
                    style={{
                      padding: "2px 6px",
                      background: "transparent",
                      border: "none",
                      color: "#8b949e",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ color: "#e6edf3", fontSize: 11, marginBottom: 4 }}>
                  <strong>Thinking</strong>
                </div>
                <div style={{ color: "#8b949e", fontSize: 11, marginBottom: 4 }}>
                  {task.prompt ?? "No prompt available."}
                </div>
                {task.answerPreview && (
                  <div
                    style={{
                      color: "#7d8590",
                      fontSize: 11,
                      marginBottom: 6,
                      maxHeight: 80,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {task.answerPreview}
                  </div>
                )}
                <div style={{ color: "#e6edf3", fontSize: 11, marginBottom: 4 }}>
                  <strong>Exploring</strong>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#8b949e", fontSize: 11, marginBottom: 6 }}>
                  {task.steps.map((s, idx) => {
                    const stepDone = task.totalSteps > 0 && task.currentStep > idx;
                    return (
                      <li
                        key={idx}
                        style={{
                          textDecoration: stepDone ? "line-through" : undefined,
                          color: stepDone ? "#7d8590" : "#8b949e",
                        }}
                      >
                        {idx + 1}. {s}
                        {stepDone && " ✓"}
                      </li>
                    );
                  })}
                </ul>
                <div style={{ color: "#e6edf3", fontSize: 11, marginBottom: 2 }}>
                  <strong>Progress</strong>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 4,
                      borderRadius: 999,
                      background: "#0d1117",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width:
                          task.totalSteps > 0
                            ? `${(Math.min(task.currentStep, task.totalSteps) / task.totalSteps) * 100}%`
                            : "0%",
                        height: "100%",
                        background: "#3fb950",
                        transition: "width 0.2s ease",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: "#8b949e", fontFamily: "monospace" }}>
                    {task.totalSteps > 0
                      ? `${Math.min(task.currentStep, task.totalSteps)}/${task.totalSteps}`
                      : "0/0"}
                  </span>
                </div>
                {(task.retryAttempt != null || task.rejectionReason) && (
                  <div style={{ marginBottom: 8, padding: 8, background: "rgba(245,158,11,0.08)", borderRadius: 6, border: "1px solid rgba(245,158,11,0.3)" }}>
                    <div style={{ color: "#d29922", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                      Self-correcting
                    </div>
                    {task.retryAttempt != null && task.retryMax != null && (
                      <div style={{ fontSize: 10, color: "#e6edf3", marginBottom: 4 }}>
                        Attempt {task.retryAttempt}/{task.retryMax}
                      </div>
                    )}
                    {task.rejectionReason && (
                      <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 4 }}>
                        <strong>Rejection:</strong> {task.rejectionReason}
                      </div>
                    )}
                    {task.selfCorrectingChange && (
                      <div style={{ fontSize: 10, color: "#8b949e" }}>
                        <strong>Changing:</strong> {task.selfCorrectingChange}
                      </div>
                    )}
                  </div>
                )}
                {(task.hallucinationIndex != null && task.hallucinationIndex > 0) && (
                  <div style={{ marginBottom: 8, padding: 8, background: "rgba(245,158,11,0.06)", borderRadius: 6, border: "1px solid rgba(245,158,11,0.2)" }}>
                    <div style={{ color: "#d29922", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                      Drift
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{ flex: 1, height: 6, background: "#0d1117", borderRadius: 999, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.min(100, task.hallucinationIndex! * 100)}%`,
                            height: "100%",
                            background: (task.hallucinationIndex ?? 0) > 0.5 ? "#f85149" : "#d29922",
                            transition: "width 0.2s",
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 10, fontFamily: "monospace", color: "#8b949e" }}>
                        {(task.hallucinationIndex! * 100).toFixed(0)}%
                      </span>
                    </div>
                    {(task.hallucinationIndex ?? 0) > 0.5 && !task.hallucinationAcknowledged && (
                      <div style={{ fontSize: 10, color: "#d29922", marginBottom: 4 }}>
                        High drift score — review the assistant response before acting on it.
                      </div>
                    )}
                    {!task.hallucinationAcknowledged && (
                      <button
                        type="button"
                        onClick={() => {
                          setBackgroundTasks((prev) =>
                            prev.map((x) => (x.id === task.id ? { ...x, hallucinationAcknowledged: true } : x))
                          );
                        }}
                        style={{
                          padding: "4px 8px",
                          fontSize: 10,
                          background: "rgba(34,197,94,0.2)",
                          color: "#4ade80",
                          border: "1px solid #3fb950",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                      >
                        Acknowledge drift
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Chat history */}
          <div
            ref={chatScrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "12px 0",
              minHeight: 80,
            }}
          >
            {(() => {
              const needsReviewTasks = tasksForWorkspace.filter(
                (x) =>
                  x.dismissed !== true &&
                  (x.status === "failed" || x.status === "needs_review") &&
                  x.toastDismissed !== true &&
                  x.reviewed !== true
              );
              if (needsReviewTasks.length === 0) return null;
              const t = needsReviewTasks[0];
              const count = needsReviewTasks.length;
              const color = t.status === "failed" ? "#f85149" : "#d29922";
              const bg = t.status === "failed" ? "rgba(248,81,73,0.12)" : "rgba(245,158,11,0.12)";
              const border = t.status === "failed" ? "1px solid #f85149" : "1px solid rgba(245,158,11,0.5)";
              return (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    background: bg,
                    border,
                    color,
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, opacity: 0.9 }}>
                      {count > 1 ? `${count} tasks need review` : "Needs review"}
                    </div>
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {count > 1 ? "Click Review to open the first task" : t.label}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTaskId(t.id);
                        setBackgroundTasks((prev) =>
                          prev.map((x) =>
                            x.id === t.id ? { ...x, reviewed: true } : x
                          )
                        );
                      }}
                      style={{
                        padding: "4px 10px",
                        fontSize: 11,
                        background: "transparent",
                        color,
                        border: `1px solid ${color}`,
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      Review
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBackgroundTasks((prev) =>
                          prev.map((x) =>
                            needsReviewTasks.some((n) => n.id === x.id) ? { ...x, toastDismissed: true } : x
                          )
                        );
                      }}
                      style={{
                        padding: "4px 10px",
                        fontSize: 11,
                        background: "transparent",
                        color: "#7d8590",
                        border: "1px solid #30363d",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })()}
            {chatHistory.length === 0 && !chatLoading && (
              <div
                style={{
                  color: "#7d8590",
                  fontSize: 12,
                  padding: 16,
                  textAlign: "center",
                }}
              >
                {isDesignMode
                  ? "Describe what to design, or drag components from the palette onto the canvas."
                  : "Ask about your architecture, dependencies, or patterns."}
              </div>
            )}
            {chatHistory.map((m, i) => {
              const isCritic = m.role === "assistant" && m.content.startsWith("Critic:");
              const isAssistant = m.role === "assistant" && !isCritic;
              const prevUser = i > 0 && chatHistory[i - 1]?.role === "user" ? chatHistory[i - 1]?.content : null;
              const contentToSave = prevUser ? `${prevUser}\n\n${m.content}` : m.content;
              return (
              <div
                key={i}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                    background: m.role === "user" ? "#1e3a5f" : isCritic ? "rgba(245,158,11,0.12)" : "#1c2128",
                    border: m.role === "user" ? "1px solid #30363d" : isCritic ? "1px solid #d2992244" : "1px solid #30363d",
                    color: m.role === "user" ? "#e6edf3" : isCritic ? "#d29922" : "#c9d1d9",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: isCritic ? "#d29922" : "#7d8590",
                      textTransform: "uppercase",
                    }}
                  >
                    {m.role === "user" ? "You" : isCritic ? "Critic" : "Assistant"}
                  </div>
                  {isAssistant && accessToken && activeWorkspaceId && (
                    <RememberThisButton
                      content={contentToSave.slice(0, 5000)}
                      nodeId={selectedNode ?? undefined}
                      workspaceId={activeWorkspaceId}
                      accessToken={accessToken}
                    />
                  )}
                </div>
                <ReactMarkdown
                  components={{
                    a({ href, children, ...props }) {
                      const railIdMatch = typeof href === "string" && href.match(/^#rail:(.+)$/);
                      if (railIdMatch) {
                        const railId = railIdMatch[1];
                        return (
                          <span style={{ color: "#ef32a6", fontFamily: "monospace" }}>
                            {children ?? railId}
                          </span>
                        );
                      }
                      return <a href={href} {...props}>{children}</a>;
                    },
                    code({ node, className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || "");
                      const isBlock =
                        match || String(children).includes("\n");

                      if (isBlock && match) {
                        return (
                          <SyntaxHighlighter
                            style={vscDarkPlus}
                            language={match[1]}
                            PreTag="div"
                            customStyle={{
                              borderRadius: "8px",
                              fontSize: "0.875em",
                              margin: "12px 0",
                            }}
                          >
                            {String(children).replace(/\n$/, "")}
                          </SyntaxHighlighter>
                        );
                      }

                      if (isBlock) {
                        return (
                          <SyntaxHighlighter
                            style={vscDarkPlus}
                            PreTag="div"
                            customStyle={{
                              borderRadius: "8px",
                              fontSize: "0.875em",
                              margin: "12px 0",
                            }}
                          >
                            {String(children).replace(/\n$/, "")}
                          </SyntaxHighlighter>
                        );
                      }

                      // Inline code
                      return (
                        <code
                          style={{
                            backgroundColor: "rgba(255, 100, 100, 0.15)",
                            color: "#ff6b6b",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.875em",
                            fontFamily: "monospace",
                            border: "1px solid rgba(255, 100, 100, 0.3)",
                          }}
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    },
                  }}
                >
                  {String(m.content ?? "")}
                </ReactMarkdown>
                {isAssistant && !isCritic && (() => {
                  const am = m as ArchitectureChatMessage;
                  const hasMeta =
                    (am.reasoningSteps && am.reasoningSteps.length > 0) ||
                    (am.citations && am.citations.length > 0) ||
                    typeof am.confidenceScore === "number";
                  if (!hasMeta) return null;
                  const confidence =
                    typeof am.confidenceScore === "number"
                      ? Math.round(Math.max(0, Math.min(1, am.confidenceScore)) * 100)
                      : null;
                  return (
                    <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid #30363d", fontSize: 11 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 4,
                          gap: 8,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {confidence !== null && (
                            <span
                              style={{
                                padding: "2px 8px",
                                borderRadius: 999,
                                border: "1px solid #475569",
                                fontSize: 10,
                                color: "#e6edf3",
                                background:
                                  confidence >= 80
                                    ? "rgba(22,163,74,0.15)"
                                    : confidence >= 50
                                      ? "rgba(202,138,4,0.12)"
                                      : "rgba(220,38,38,0.12)",
                              }}
                            >
                              Confidence {confidence}%
                            </span>
                          )}
                        </div>
                        {am.taskId && (
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontSize: 10, color: "#7d8590" }}>Feedback</span>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await fetch(`${API_BASE}/chat-feedback`, {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                                    },
                                    body: JSON.stringify({
                                      taskId: am.taskId,
                                      rating: "up",
                                      ...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
                                    }),
                                  });
                                  setChatSessions((prev) => {
                                    const copy = { ...prev };
                                    const list = copy[activeChatId] ?? [];
                                    const idx = list.indexOf(m as ArchitectureChatMessage);
                                    if (idx >= 0) {
                                      const updated = [...list];
                                      updated[idx] = { ...(updated[idx] as ArchitectureChatMessage), feedback: "up" };
                                      copy[activeChatId] = updated;
                                    }
                                    return copy;
                                  });
                                } catch {
                                  // ignore
                                }
                              }}
                              style={{
                                border: "none",
                                background: "transparent",
                                color: am.feedback === "up" ? "#4ade80" : "#8b949e",
                                cursor: "pointer",
                                fontSize: 12,
                              }}
                            >
                              👍
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await fetch(`${API_BASE}/chat-feedback`, {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                                    },
                                    body: JSON.stringify({
                                      taskId: am.taskId,
                                      rating: "down",
                                      ...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
                                    }),
                                  });
                                  setChatSessions((prev) => {
                                    const copy = { ...prev };
                                    const list = copy[activeChatId] ?? [];
                                    const idx = list.indexOf(m as ArchitectureChatMessage);
                                    if (idx >= 0) {
                                      const updated = [...list];
                                      updated[idx] = { ...(updated[idx] as ArchitectureChatMessage), feedback: "down" };
                                      copy[activeChatId] = updated;
                                    }
                                    return copy;
                                  });
                                } catch {
                                  // ignore
                                }
                              }}
                              style={{
                                border: "none",
                                background: "transparent",
                                color: am.feedback === "down" ? "#f97373" : "#8b949e",
                                cursor: "pointer",
                                fontSize: 12,
                              }}
                            >
                              👎
                            </button>
                          </div>
                        )}
                      </div>
                      {am.reasoningSteps && am.reasoningSteps.length > 0 && (
                        <details style={{ marginTop: 4 }}>
                          <summary style={{ cursor: "pointer", color: "#8b949e" }}>Show reasoning steps</summary>
                          <ol style={{ marginTop: 4, paddingLeft: 18 }}>
                            {am.reasoningSteps.map((step, idx) => (
                              <li key={idx} style={{ marginBottom: 2 }}>
                                {step}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                      {am.citations && am.citations.length > 0 && (
                        <div style={{ marginTop: 4, fontSize: 10, color: "#8b949e" }}>
                          <div style={{ marginBottom: 2 }}>Citations:</div>
                          <ul style={{ paddingLeft: 16, margin: 0, listStyle: "none" }}>
                            {am.citations.map((c, idx) => (
                              <li key={idx} style={{ marginBottom: 4 }}>
                                {c.nodeId ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedNode(c.nodeId!);
                                      setAgentGraphCommand(
                                        { action: "highlight_nodes" as const, nodeIds: [c.nodeId!] }
                                      );
                                    }}
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      color: "#ef32a6",
                                      cursor: "pointer",
                                      padding: 0,
                                      fontSize: "inherit",
                                      textAlign: "left",
                                      textDecoration: "underline",
                                    }}
                                    title={`Focus on ${c.nodeId}`}
                                  >
                                    {c.label}
                                    {c.nodeId ? ` · ${c.nodeId}` : ""}
                                  </button>
                                ) : c.filePath ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard?.writeText(c.filePath!).then(
                                        () => {},
                                        () => {}
                                      );
                                    }}
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      color: "#ef32a6",
                                      cursor: "pointer",
                                      padding: 0,
                                      fontSize: "inherit",
                                      textAlign: "left",
                                      textDecoration: "underline",
                                    }}
                                    title={`Copy path: ${c.filePath}`}
                                  >
                                    {c.label} · {c.filePath}
                                  </button>
                                ) : (
                                  <span>
                                    {c.label}
                                    {c.edgeId ? ` · edge ${c.edgeId}` : ""}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {am.suggestedActions && am.suggestedActions.length > 0 && (
                        <div style={{ marginTop: 4, fontSize: 10, color: "#8b949e" }}>
                          <div style={{ marginBottom: 2 }}>Suggested actions:</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {am.suggestedActions.map((label, idx) => (
                              <button
                                key={idx}
                                type="button"
                                disabled={chatLoading}
                                onClick={() => {
                                  if (am.graphCommands && am.graphCommands.length > 0) {
                                    const first = am.graphCommands[0];
                                    if (first) {
                                      if (first.action === "highlight_nodes" && first.nodeIds?.length) {
                                        setAgentGraphCommand({ action: "highlight_nodes", nodeIds: first.nodeIds });
                                        if (first.nodeIds[0]) setSelectedNode(first.nodeIds[0]);
                                      } else if (first.action === "focus_node" && first.nodeId) {
                                        setSelectedNode(first.nodeId);
                                        setAgentGraphCommand({ action: "highlight_nodes", nodeIds: [first.nodeId] });
                                      } else if (first.action === "filter_layer" && first.layer) {
                                        setAgentGraphCommand({ action: "filter_layer", layer: first.layer as any });
                                      } else if (first.action === "trace_path" && first.nodeIds?.length) {
                                        setAgentGraphCommand(first);
                                        if (first.nodeIds[0]) setSelectedNode(first.nodeIds[0]);
                                      } else if (first.action === "reset") {
                                        setAgentGraphCommand({ action: "reset" });
                                        setSelectedNode(null);
                                      } else {
                                        setAgentGraphCommand(first);
                                      }
                                    }
                                  } else if (am.relevantNodeIds && am.relevantNodeIds.length > 0) {
                                    setAgentGraphCommand({ action: "highlight_nodes", nodeIds: am.relevantNodeIds });
                                    if (am.relevantNodeIds[0]) setSelectedNode(am.relevantNodeIds[0]);
                                  }
                                }}
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: 999,
                                  border: "1px solid #30363d",
                                  background: "#0d1117",
                                  color: "#e6edf3",
                                  cursor: chatLoading ? "not-allowed" : "pointer",
                                  fontSize: 10,
                                }}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {isAssistant && (() => {
                  const raw = m as { rails?: { id: string }[] };
                  const msgRails = Array.isArray(raw?.rails) ? raw.rails : [];
                  if (msgRails.length === 0) return null;
                  const seen = new Set<string>();
                  const sessionOrder: string[] = [];
                  for (const msg of chatHistory) {
                    const rs = (msg as { rails?: { id: string }[] }).rails;
                    if (Array.isArray(rs)) {
                      for (const { id } of rs) {
                        if (id && !seen.has(id)) {
                          seen.add(id);
                          sessionOrder.push(id);
                        }
                      }
                    }
                  }
                  return (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
                    {msgRails.map((r) => {
                      const railNum = sessionOrder.indexOf(r.id) + 1;
                      return (
                        <span key={r.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button
                            type="button"
                            onClick={() => handleAsk(`retry rail ${railNum}`)}
                            disabled={chatLoading}
                            style={{
                              fontSize: 11,
                              padding: "4px 8px",
                              borderRadius: 6,
                              border: "1px solid #238636",
                              background: "rgba(34,197,94,0.15)",
                              color: "#4ade80",
                              cursor: chatLoading ? "not-allowed" : "pointer",
                            }}
                          >
                            Retry
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAsk(`cancel rail ${railNum}`)}
                            disabled={chatLoading}
                            style={{
                              fontSize: 11,
                              padding: "4px 8px",
                              borderRadius: 6,
                              border: "1px solid #f85149",
                              background: "rgba(248,81,73,0.1)",
                              color: "#f87171",
                              cursor: chatLoading ? "not-allowed" : "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  );
                })()}
              </div>
              );
            })}
            {chatLoading && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "#1c2128",
                  border: "1px solid #30363d",
                  color: "#7d8590",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    gap: 4,
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#ef32a6",
                        animation: "chatDots 1.4s ease-in-out infinite",
                        animationDelay: `${i * 0.2}s`,
                      }}
                    />
                  ))}
                </span>
                Asking architect… (Claude + Critic may take 10–30s)
              </div>
            )}
          </div>

          {tokenWarning && (
            <div
              style={{
                padding: "6px 10px",
                marginBottom: 8,
                background: tokenWarning.overBudget ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
                border: tokenWarning.overBudget ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(245,158,11,0.4)",
                borderRadius: 6,
                fontSize: 11,
                color: tokenWarning.overBudget ? "#f87171" : "#d29922",
              }}
            >
              {tokenWarning.overBudget
                ? `Context over limit (${((tokenWarning.input + tokenWarning.output) / 1000).toFixed(1)}K tokens). Start a new chat to avoid errors.`
                : `Context near limit (${((tokenWarning.input + tokenWarning.output) / 1000).toFixed(1)}K tokens). Consider starting a new chat.`}
            </div>
          )}

          {/* Bottom input bar */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              paddingTop: 12,
              borderTop: "1px solid #30363d",
              flexShrink: 0,
            }}
          >
            <input
              ref={pdfInputRef}
              type="file"
              accept=".pdf,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                processAttachmentFile(f);
                e.target.value = "";
              }}
            />
            <div
              title="Drop PDF or Word (.doc, .docx) here or click 📎 to attach"
              style={{
                flex: 1,
                display: "flex",
                gap: 6,
                alignItems: "flex-end",
                borderRadius: 8,
                outline: pdfDragOver ? "2px dashed #238636" : "none",
                outlineOffset: pdfDragOver ? 2 : 0,
                transition: "outline 0.15s ease",
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
                if (e.dataTransfer?.types.includes("Files")) setPdfDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setPdfDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPdfDragOver(false);
                const files = Array.from(e.dataTransfer.files ?? []);
                const f = files.find(
                  (x) =>
                    x.type === "application/pdf" ||
                    x.name.toLowerCase().endsWith(".pdf") ||
                    x.type === "application/msword" ||
                    x.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
                    x.name.toLowerCase().endsWith(".doc") ||
                    x.name.toLowerCase().endsWith(".docx")
                );
                if (f) processAttachmentFile(f);
              }}
            >
              <button
                type="button"
                onClick={() => pdfInputRef.current?.click()}
                title="Attach PDF or Word (.doc, .docx)"
                style={{
                  width: 36,
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: pdfAttachment || docAttachment ? "#238636" : "#21262d",
                  color: pdfAttachment || docAttachment ? "white" : "#8b949e",
                  border: "1px solid #30363d",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                📎
              </button>
              {(pdfAttachment || docAttachment) && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    color: "#8b949e",
                    alignSelf: "center",
                    maxWidth: 140,
                    overflow: "hidden",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {(pdfAttachment || docAttachment)?.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPdfAttachment(null);
                      setDocAttachment(null);
                    }}
                    title="Remove attachment"
                    style={{
                      background: "none",
                      border: "none",
                      color: "#8b949e",
                      cursor: "pointer",
                      padding: 2,
                      fontSize: 12,
                    }}
                  >
                    ×
                  </button>
                </span>
              )}
              <textarea
                ref={chatInputRef}
                value={aiQuestion}
                onChange={(e) => {
                  setAiQuestion(e.target.value);
                  resizeChatInput();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAsk();
                  }
                }}
                placeholder={
                  selectedNode
                    ? `Ask about ${selectedNode}...`
                    : isDesignMode
                      ? "Describe the architecture you want to design…"
                    : "Ask about your architecture..."
                }
                rows={1}
                style={{
                  flex: 1,
                  minHeight: 36,
                  maxHeight: 120,
                  overflow: "hidden",
                  background: "#0d1117",
                  border: "1px solid #30363d",
                  borderRadius: 8,
                  color: "#e6edf3",
                  padding: "8px 12px",
                  fontSize: 13,
                  resize: "none",
                  outline: "none",
                }}
              />
              <button
                onClick={() => handleAsk()}
                disabled={chatLoading}
                title="Send message"
                style={{
                  width: 36,
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#238636",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  cursor: chatLoading ? "wait" : "pointer",
                  fontSize: 16,
                }}
              >
                ↑
              </button>
            </div>
          </div>

          <div ref={workspaceDropUpRef} style={{ marginTop: 12, position: "relative" }}>
          <button
            onClick={() => {
              if (showWorkspaceDropUp) {
                setShowWorkspaceDropUp(false);
              } else {
                setShowWorkspaceDropUp(true);
                fetchSavedWorkspaces();
                fetchArchivedWorkspaces();
              }
            }}
            style={{
                width: "100%",
              background: "#21262d",
              color: "#e6edf3",
              border: "1px solid #30363d",
              borderRadius: 6,
              padding: "8px 16px",
              cursor: "pointer",
              fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
            }}
          >
              <span>New workspace</span>
              <span style={{ opacity: 0.7, fontSize: 10 }}>▾</span>
          </button>
            {showWorkspaceDropUp && (
              <div
                style={{
                  position: "absolute",
                  bottom: "100%",
                  left: 0,
                  right: 0,
                  marginBottom: 4,
                  background: "#161b22",
                  border: "1px solid #30363d",
                  borderRadius: 8,
                  boxShadow: "0 -4px 12px rgba(0,0,0,0.4)",
                  maxHeight: 280,
                  overflow: "auto",
                  zIndex: 50,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowWorkspaceDropUp(false);
                    setShowNewRepoConfirm(true);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    background: "none",
                    border: "none",
                    color: "#e6edf3",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  Start new workspace
                </button>
                <div style={{ height: 1, background: "#30363d", margin: "0 8px" }} />
                <div style={{ padding: "8px 12px 4px", fontSize: 10, color: "#7d8590", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Open saved
                </div>
                {!accessToken ? (
                  <div style={{ padding: "12px", color: "#7d8590", fontSize: 12 }}>Sign in to see saved workspaces</div>
                ) : loadingWorkspaces ? (
                  <div style={{ padding: "12px", color: "#7d8590", fontSize: 12 }}>Loading…</div>
                ) : savedWorkspaces.length === 0 ? (
                  <div style={{ padding: "12px", color: "#7d8590", fontSize: 12 }}>No saved workspaces</div>
                ) : (
                  savedWorkspaces.map((ws) => (
                    <button
                      key={ws.id}
                      type="button"
                      disabled={loadingWorkspaceId !== null}
                      onClick={() => loadWorkspace(ws.id)}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        background: loadingWorkspaceId === ws.id ? "#21262d" : "none",
                        border: "none",
                        color: "#e6edf3",
                        fontSize: 12,
                        cursor: loadingWorkspaceId ? "wait" : "pointer",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          width: 40,
                          height: 30,
                          flexShrink: 0,
                          borderRadius: 4,
                          overflow: "hidden",
                          background: "#161b22",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {ws.thumbnail_base64 ? (
                          <img
                            src={`data:image/png;base64,${ws.thumbnail_base64}`}
                            alt=""
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : (
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: "#ef32a6",
                              fontFamily: "monospace",
                            }}
                          >
                            {(ws.name || "?")[0].toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {loadingWorkspaceId === ws.id ? "⟳ " : ""}
                          {ws.name}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "#8b949e",
                            marginTop: 2,
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          {ws.last_scan_at && (
                            <span>scanned {new Date(ws.last_scan_at).toLocaleDateString()}</span>
                          )}
                          <span>{(ws.node_count ?? 0)} nodes</span>
                          <span>{(ws.violation_count ?? 0)} violations</span>
                        </div>
                      </div>
                    </button>
                  ))
                )}
                {accessToken && (
                  <>
                    <div style={{ height: 1, background: "#30363d", margin: "8px 8px 0" }} />
                    <div style={{ padding: "8px 12px 4px", fontSize: 10, color: "#7d8590", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Archived
                    </div>
                    {loadingArchived ? (
                      <div style={{ padding: "12px", color: "#7d8590", fontSize: 12 }}>Loading…</div>
                    ) : archivedWorkspaces.length === 0 ? (
                      <div style={{ padding: "12px", color: "#7d8590", fontSize: 12 }}>No archived workspaces</div>
                    ) : (
                      archivedWorkspaces.map((ws) => (
                        <div
                          key={ws.id}
                          style={{
                            padding: "6px 12px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            fontSize: 11,
                            color: "#8b949e",
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={ws.name}
                          >
                            {ws.name}
                          </span>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await fetch(`${API_BASE}/workspaces/${ws.id}/restore`, {
                                  method: "POST",
                                  headers: { Authorization: `Bearer ${accessToken}` },
                                });
                                await fetchSavedWorkspaces();
                                await fetchArchivedWorkspaces();
                              } catch {
                                // ignore
                              }
                            }}
                            style={{
                              fontSize: 10,
                              padding: "2px 6px",
                              borderRadius: 4,
                              border: "1px solid #ef32a6",
                              background: "transparent",
                              color: "#ef32a6",
                              cursor: "pointer",
                            }}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm("Permanently delete this workspace?")) return;
                              try {
                                await fetch(`${API_BASE}/workspaces/${ws.id}?hard=true`, {
                                  method: "DELETE",
                                  headers: { Authorization: `Bearer ${accessToken}` },
                                });
                                await fetchArchivedWorkspaces();
                              } catch {
                                // ignore
                              }
                            }}
                            style={{
                              fontSize: 10,
                              padding: "2px 6px",
                              borderRadius: 4,
                              border: "1px solid #f85149",
                              background: "transparent",
                              color: "#fca5a5",
                              cursor: "pointer",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {!blankoShell && !leftPanelCollapsed && (
        <div
          onMouseDown={() => setIsResizing(true)}
          title="Drag to resize panel"
          style={{
            width: 6,
            flexShrink: 0,
            background: isResizing ? "#30363d" : "transparent",
            cursor: "col-resize",
            transition: "background 0.1s",
          }}
          onMouseEnter={(e) => {
            if (!isResizing) e.currentTarget.style.background = "#30363d";
          }}
          onMouseLeave={(e) => {
            if (!isResizing) e.currentTarget.style.background = "transparent";
          }}
        />
      )}

      {showNewRepoConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setShowNewRepoConfirm(false)}
        >
          <div
            style={{
              background: "#21262d",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 20,
              maxWidth: 360,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: 12, fontSize: 14, color: "#e6edf3" }}>
              Start a new workspace? This will clear your current graph, chat history, and violations. You can then scan a different repository or start from scratch.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowNewRepoConfirm(false)}
                style={{
                  padding: "8px 16px",
                  background: "#30363d",
                  color: "#e6edf3",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleNewRepo}
                style={{
                  padding: "8px 16px",
                  background: "#f85149",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                New workspace
              </button>
            </div>
          </div>
        </div>
      )}



        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Graph toolbar + persona selector (legacy). Blanko uses floating ChromeBar on canvas. */}
        {!blankoShell && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderBottom: "1px solid #30363d",
            background: undefined,
            flexShrink: 0,
            flexWrap: "wrap",
            rowGap: 6,
          }}
        >
            {blankoShell && (
              <span
                data-testid="blanko-chrome-spacer"
                style={{ width: 0, overflow: "hidden" }}
                aria-hidden
              />
            )}
            <button
              type="button"
              title={leftPanelCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => {
                leftPanelUserToggledRef.current = true;
                setLeftPanelCollapsed((c) => {
                  const next = !c;
                  if (next) panelWidthBeforeCollapseRef.current = panelWidth;
                  else setPanelWidth(panelWidthBeforeCollapseRef.current || 320);
                  return next;
                });
              }}
              style={{
                display: blankoShell ? "none" : undefined,
                padding: "6px 10px",
                fontSize: 12,
                borderRadius: 8,
                border: "1px solid #30363d",
                background: "#161b22",
                color: "#e6edf3",
                cursor: "pointer",
              }}
            >
              {leftPanelCollapsed ? "Show panel" : "Hide panel"}
            </button>
          {graph && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 16 }}>
              {workspaceTitleEditing && handleRenameWorkspaceTitle ? (
                <input
                  autoFocus
                  value={workspaceTitleDraft}
                  maxLength={80}
                  onChange={(e) => setWorkspaceTitleDraft(e.target.value)}
                  onBlur={() => {
                    const t = workspaceTitleDraft.trim();
                    if (t) handleRenameWorkspaceTitle(t);
                    setWorkspaceTitleEditing(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const t = workspaceTitleDraft.trim();
                      if (t) handleRenameWorkspaceTitle(t);
                      setWorkspaceTitleEditing(false);
                    } else if (e.key === "Escape") {
                      setWorkspaceTitleDraft(displayWorkspaceName);
                      setWorkspaceTitleEditing(false);
                    }
                  }}
                  style={{
                    width: 140,
                    padding: "2px 6px",
                    fontSize: 11,
                    background: "#21262d",
                    border: "1px solid #30363d",
                    borderRadius: 4,
                    color: "#e6edf3",
                    outline: "none",
                  }}
                />
              ) : (
                <span
                  onClick={() => {
                    if (activeWorkspaceId && accessToken) {
                      setWorkspaceTitleDraft(displayWorkspaceName);
                      setWorkspaceTitleEditing(true);
                    }
                  }}
                  title={activeWorkspaceId && accessToken ? "Click to rename" : undefined}
                  style={{
                    fontSize: blankoShell ? 13 : 11,
                    fontWeight: blankoShell ? 600 : 400,
                    color: blankoShell ? INK : "#8b949e",
                    maxWidth: blankoShell ? 200 : 140,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    cursor: activeWorkspaceId && accessToken ? "pointer" : "default",
                    fontFamily: blankoShell ? FONT_UI : undefined,
                  }}
                >
                  {displayWorkspaceName}
                </span>
              )}
              <button
                type="button"
                data-testid="chrome-save"
                disabled={saveLoading || graph.nodes.length === 0}
                title={
                  accessToken
                    ? saveStatus === "saved"
                      ? "Saved"
                      : "Save workspace"
                    : "Sign up to save · free to view, account to keep"
                }
                onClick={async () => {
                  if (saveLoading || graph.nodes.length === 0) return;
                  if (!accessToken) {
                    promptSignup("save this workspace — viewing stays free");
                    return;
                  }
                  setSaveLoading(true);
                  setSaveStatus("idle");
                  try {
                    await handleSaveWorkspace();
                    setSaveStatus("saved");
                    if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
                    saveStatusTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 1500);
                  } catch {
                    setSaveStatus("error");
                    if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
                    saveStatusTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 2500);
                  } finally {
                    setSaveLoading(false);
                  }
                }}
                style={{
                  padding: blankoShell ? "5px 10px" : "2px 8px",
                  fontSize: blankoShell ? 12 : 10,
                  borderRadius: blankoShell ? 8 : 4,
                  border: `1px solid ${accessToken ? (blankoShell ? INK : "#238636") : ACCENT}`,
                  background: accessToken ? (blankoShell ? INK : "#238636") : ACCENT,
                  color: "white",
                  cursor: saveLoading || graph.nodes.length === 0 ? "not-allowed" : "pointer",
                  opacity: saveLoading || graph.nodes.length === 0 ? 0.5 : 1,
                  fontFamily: blankoShell ? FONT_UI : undefined,
                  fontWeight: blankoShell ? 600 : 400,
                }}
              >
                {saveLoading ? "…" : saveStatus === "saved" ? "Saved" : accessToken ? "Save" : "Save 🔒"}
              </button>
              <button
                type="button"
                data-testid="chrome-share"
                disabled={shareLoading}
                title={accessToken ? "Get share link" : "Sign up to share — viewing stays free"}
                onClick={async () => {
                  if (shareLoading) return;
                  if (!accessToken) {
                    promptSignup("share this workspace — viewing stays free");
                    return;
                  }
                  setShareLoading(true);
                  try {
                    const r = await handleShare();
                    if (r?.url) {
                      await navigator.clipboard.writeText(r.url);
                      setShareCopied(true);
                      if (shareCopiedTimeoutRef.current) clearTimeout(shareCopiedTimeoutRef.current);
                      shareCopiedTimeoutRef.current = setTimeout(() => setShareCopied(false), 1500);
                    }
                  } finally {
                    setShareLoading(false);
                  }
                }}
                style={{
                  padding: "2px 8px",
                  fontSize: 10,
                  borderRadius: 4,
                  border: `1px solid ${shareCopied ? "#238636" : accessToken ? ACCENT : LINE}`,
                  background: shareCopied ? "#238636" : accessToken ? ACCENT : CANVAS,
                  color: shareCopied || accessToken ? "white" : INK,
                  cursor: shareLoading ? "not-allowed" : "pointer",
                  opacity: shareLoading ? 0.5 : 1,
                }}
              >
                {shareLoading ? "…" : shareCopied ? "Copied" : accessToken ? "Share" : "Share 🔒"}
              </button>
              {accessToken && (
                <div style={{ marginLeft: 6 }}>
                  <NotificationsBell apiBase={API_BASE} accessToken={accessToken} />
                </div>
              )}
              <div
                style={{
                  display: blankoShell ? "none" : "flex",
                  alignItems: "center",
                  gap: 4,
                  marginLeft: 8,
                  padding: "2px 4px",
                  borderRadius: 6,
                  border: "1px solid #30363d",
                  background: "#020617",
                }}
              >
                {(["overview", "learn", "deep_dive"] as Persona[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPersona(p)}
                    style={{
                      padding: "2px 6px",
                      fontSize: 10,
                      borderRadius: 4,
                      border: "none",
                      background: persona === p ? "#238636" : "transparent",
                      color: persona === p ? "white" : "#8b949e",
                      cursor: "pointer",
                    }}
                    title={
                      p === "overview"
                        ? "High-level architecture view"
                        : p === "learn"
                        ? "Learning-focused view"
                        : "Deep dive for experienced engineers"
                    }
                  >
                    {p === "overview" ? "Overview" : p === "learn" ? "Learn" : "Deep Dive"}
                  </button>
                ))}
              </div>
              <input
                value={graphSearch}
                onChange={(e) => setGraphSearch(e.target.value)}
                placeholder="Search…"
                style={{
                  marginLeft: 8,
                  width: 160,
                  padding: "2px 6px",
                  fontSize: 11,
                  background: "#0b1120",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  color: "#e6edf3",
                  outline: "none",
                }}
              />
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setShowWorkspaceMenu((m) => !m)}
                  style={{
                    padding: "2px 6px",
                    fontSize: 10,
                    borderRadius: 4,
                    border: "1px solid #30363d",
                    background: "transparent",
                    color: "#8b949e",
                    cursor: "pointer",
                  }}
                >
                  ⋮
                </button>
                {showWorkspaceMenu && (
                  <>
                    <div
                      style={{ position: "fixed", inset: 0, zIndex: 40 }}
                      onClick={() => setShowWorkspaceMenu(false)}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        marginTop: 4,
                        background: "#161b22",
                        border: "1px solid #30363d",
                        borderRadius: 6,
                        padding: 6,
                        minWidth: 160,
                        zIndex: 41,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setWorkspaceTitleDraft(displayWorkspaceName);
                          setWorkspaceTitleEditing(true);
                          setShowWorkspaceMenu(false);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 11,
                          background: "none",
                          border: "none",
                          color: "#e6edf3",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMembersPanel(true);
                          setShowWorkspaceMenu(false);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 11,
                          background: "none",
                          border: "none",
                          color: "#e6edf3",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        Members
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowActivityPanel(true);
                          setShowWorkspaceMenu(false);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 11,
                          background: "none",
                          border: "none",
                          color: "#e6edf3",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        Activity log
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGraphViewMode("resources");
                          setShowWorkspaceMenu(false);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 11,
                          background: "none",
                          border: "none",
                          color: unclassifiedCount > 0 ? "#d29922" : "#e6edf3",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        Classify resources{unclassifiedCount > 0 ? ` (${unclassifiedCount} undecided)` : ""}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowScanHistoryPanel(true);
                          setShowWorkspaceMenu(false);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 11,
                          background: "none",
                          border: "none",
                          color: "#e6edf3",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        Scan history
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSnapshotPanel(true);
                          setShowWorkspaceMenu(false);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 11,
                          background: "none",
                          border: "none",
                          color: "#e6edf3",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        title="Switch between graph snapshots (scan history)"
                      >
                        Snapshot timeline
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowConnectGitHubPanel(true);
                          setShowWorkspaceMenu(false);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 11,
                          background: "none",
                          border: "none",
                          color: "#e6edf3",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        title="Connect workspace to a GitHub repo (OAuth + repo picker)"
                      >
                        Connect from GitHub
                      </button>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 8px",
                          fontSize: 11,
                          color: "#e6edf3",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={autosaveEnabled}
                          onChange={(e) => setAutosaveEnabled(e.target.checked)}
                          style={{ accentColor: "#238636" }}
                        />
                        Remember on device
                      </label>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 8px",
                          fontSize: 11,
                          color: "#e6edf3",
                          cursor: "pointer",
                        }}
                        title="Enable scene editor (snap/grid in 2D, gizmo + GLB/GLTF import in 3D)"
                      >
                        <input
                          type="checkbox"
                          checked={sceneEditMode}
                          onChange={(e) => setSceneEditMode(e.target.checked)}
                          style={{ accentColor: "#1f6feb" }}
                        />
                        Scene editor
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const scene = ensureSceneBase();
                          const json = exportSceneBundle(scene, { graph: graph ?? undefined, workspaceId: activeWorkspaceId ?? undefined });
                          const blob = new Blob([json], { type: "application/json" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `scene-bundle-${activeWorkspaceId ?? "workspace"}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                          setShowWorkspaceMenu(false);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 11,
                          background: "none",
                          border: "none",
                          color: "#e6edf3",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        title="Export scene JSON (includes embedded GLB/GLTF data URLs)"
                      >
                        Export scene bundle…
                      </button>
                      <label
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 11,
                          color: "#e6edf3",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        title="Import a previously exported scene bundle"
                      >
                        <input
                          type="file"
                          accept="application/json,.json"
                          style={{ display: "none" }}
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const text = await f.text();
                            try {
                              const { scene: next, graph: importedGraph } = importSceneBundle(text);
                              if (next && typeof next === "object" && Array.isArray((next as any).objects)) {
                                setWorkspaceScene(next);
                                setActiveSceneStateId(null);
                                if (importedGraph && !graph) setGraph(importedGraph);
                              }
                            } catch {
                              try {
                                const fallback = JSON.parse(text) as { scene?: WorkspaceSceneDoc };
                                if (fallback?.scene && Array.isArray((fallback.scene as any)?.objects)) {
                                  setWorkspaceScene(fallback.scene);
                                  setActiveSceneStateId(null);
                                }
                              } catch {
                                /* invalid JSON */
                              }
                            } finally {
                              e.target.value = "";
                              setShowWorkspaceMenu(false);
                            }
                          }}
                        />
                        Import scene bundle…
                      </label>
                      {activeWorkspaceId && accessToken && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowDeleteConfirm(true);
                            setShowWorkspaceMenu(false);
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            padding: "6px 8px",
                            fontSize: 11,
                            background: "none",
                            border: "none",
                            color: "#f85149",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          Delete workspace
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
              {showDeleteConfirm && handleDeleteWorkspace && (
                <div
                  style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(0,0,0,0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 50,
                  }}
                  onClick={() => !isDeletingWorkspace && setShowDeleteConfirm(false)}
                >
                  <div
                    style={{
                      background: "#161b22",
                      border: "1px solid #30363d",
                      borderRadius: 8,
                      padding: 16,
                      maxWidth: 320,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ marginBottom: 12, color: "#e6edf3", fontSize: 13 }}>
                      Delete this workspace and all its saved graphs?
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button
                        type="button"
                        disabled={isDeletingWorkspace}
                        onClick={() => setShowDeleteConfirm(false)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          border: "1px solid #30363d",
                          background: "transparent",
                          color: "#e6edf3",
                          fontSize: 12,
                          cursor: isDeletingWorkspace ? "default" : "pointer",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={isDeletingWorkspace}
                        onClick={async () => {
                          await handleDeleteWorkspace();
                          setShowDeleteConfirm(false);
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          border: "1px solid #f85149",
                          background: "#f85149",
                          color: "white",
                          fontSize: 12,
                          cursor: isDeletingWorkspace ? "wait" : "pointer",
                        }}
                      >
                        {isDeletingWorkspace ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {sceneEditMode && (
                <>
                  <div style={{ width: 1, alignSelf: "stretch", background: "#30363d", margin: "0 4px" }} />
                  <select
                    value={activeSceneStateId ?? ""}
                    onChange={(e) => setActiveSceneStateId(e.target.value || null)}
                    style={{
                      fontSize: 10,
                      fontFamily: "monospace",
                      background: "#161b22",
                      color: "#e6edf3",
                      border: "1px solid #30363d",
                      borderRadius: 6,
                      padding: "4px 6px",
                    }}
                    title="Scene states"
                  >
                    <option value="">(no state)</option>
                    {sceneStates.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const id = `state-${Date.now()}`;
                      upsertSceneState({ id, name: `State ${sceneStates.length + 1}` });
                      setActiveSceneStateId(id);
                    }}
                    style={{
                      padding: "2px 8px",
                      fontSize: 10,
                      borderRadius: 6,
                      border: "1px solid #30363d",
                      background: "transparent",
                      color: "#8b949e",
                      cursor: "pointer",
                    }}
                    title="Add state"
                  >
                    +State
                  </button>
                  <select
                    value={(activeSceneState?.cameraPresetId as string) ?? ""}
                    onChange={(e) => {
                      if (!activeSceneStateId) return;
                      const v = e.target.value || undefined;
                      upsertSceneState({ id: activeSceneStateId, cameraPresetId: v });
                    }}
                    style={{
                      fontSize: 10,
                      fontFamily: "monospace",
                      background: "#161b22",
                      color: "#e6edf3",
                      border: "1px solid #30363d",
                      borderRadius: 6,
                      padding: "4px 6px",
                    }}
                    title="3D camera preset for this state"
                  >
                    <option value="">camera: (none)</option>
                    {["top", "front", "side", "iso"].map((p) => (
                      <option key={p} value={p}>
                        camera: {p}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeSceneStateId) return;
                      const captured = captureViewRef.current?.();
                      if (captured?.viewport2D || captured?.camera3D) {
                        upsertSceneState({
                          id: activeSceneStateId,
                          ...(captured?.viewport2D && { viewport2D: captured.viewport2D }),
                          ...(captured?.camera3D && { camera3D: captured.camera3D }),
                        });
                      }
                    }}
                    style={{
                      padding: "2px 8px",
                      fontSize: 10,
                      borderRadius: 6,
                      border: "1px solid #30363d",
                      background: "transparent",
                      color: "#8b949e",
                      cursor: activeSceneStateId ? "pointer" : "not-allowed",
                    }}
                    title="Capture current view into this state"
                    disabled={!activeSceneStateId}
                  >
                    Capture
                  </button>
                  <select
                    value={scenePlaybackSpeed}
                    onChange={(e) => setScenePlaybackSpeed(Number(e.target.value))}
                    style={{
                      fontSize: 10,
                      fontFamily: "monospace",
                      background: "#161b22",
                      color: "#e6edf3",
                      border: "1px solid #30363d",
                      borderRadius: 6,
                      padding: "2px 6px",
                    }}
                    title="Playback speed"
                  >
                    {[0.5, 1, 1.5, 2].map((s) => (
                      <option key={s} value={s}>
                        {s}x
                      </option>
                    ))}
                  </select>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {sceneStates.map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setActiveSceneStateId(s.id)}
                        style={{
                          width: 20,
                          height: 14,
                          padding: 0,
                          fontSize: 9,
                          borderRadius: 4,
                          border: activeSceneStateId === s.id ? "1px solid #7dd3fc" : "1px solid #30363d",
                          background: activeSceneStateId === s.id ? "rgba(56,189,248,0.2)" : "transparent",
                          color: "#8b949e",
                          cursor: "pointer",
                        }}
                        title={`Go to ${s.name}`}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setScenePlaying((p) => !p)}
                    style={{
                      padding: "2px 8px",
                      fontSize: 10,
                      borderRadius: 6,
                      border: "1px solid #30363d",
                      background: scenePlaying ? "rgba(56,189,248,0.12)" : "transparent",
                      color: scenePlaying ? "#7dd3fc" : "#8b949e",
                      cursor: "pointer",
                    }}
                    title="Play/Pause timeline"
                  >
                    {scenePlaying ? "Pause" : "Play"}
                  </button>
                </>
              )}
            </div>
          )}
          {/* The tabs are the most-used control here, so they anchor the row
              rather than floating at its right edge where anything appearing
              to their left shifts them. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
            {graph && !blankoShell && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  background: "rgba(6,12,26,0.65)",
                  border: "1px solid #30363d",
                  borderRadius: 10,
                  padding: 4,
                  backdropFilter: "blur(10px)",
                }}
              >
                {/* Narrative order: what was found, what it reaches, how
                    complete it is, whether it meets the bar, what is enforced. */}
                  <button
                    key="assessment"
                    type="button"
                    title="What this system is, and what matters"
                    onClick={() => setGraphViewMode("assessment")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "assessment" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "assessment" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "assessment" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Assessment
                  </button>
                  <button
                    key="agents"
                    type="button"
                    title="Agent surfaces found in this repository"
                    onClick={() => setGraphViewMode("agents")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "agents" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "agents" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "agents" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Agents
                  </button>
                  <button
                    key="files"
                    type="button"
                    title="Browse and read the code"
                    onClick={() => setGraphViewMode("files")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "files" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "files" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "files" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Files
                  </button>
                  <button
                    key="reach"
                    type="button"
                    title="What each tool can touch"
                    onClick={() => setGraphViewMode("reach")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "reach" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "reach" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "reach" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Reach
                  </button>
                  <button
                    key="flow"
                    type="button"
                    title="How a request travels from caller to resource"
                    onClick={() => setGraphViewMode("flow")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "flow" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "flow" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "flow" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Flow
                  </button>
                  <button
                    key="layers"
                    type="button"
                    title="The eleven layers of this agent"
                    onClick={() => setGraphViewMode("layers")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "layers" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "layers" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "layers" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Layers
                  </button>
                  <button
                    key="platforms"
                    type="button"
                    data-testid="chrome-tab-platforms"
                    title="Real providers this architecture depends on"
                    onClick={() => setGraphViewMode("platforms")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "platforms" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "platforms" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "platforms" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Platforms
                  </button>
                  <button
                    key="usage"
                    type="button"
                    data-testid="chrome-tab-usage"
                    title="Token spend attributed to nodes and teammates"
                    onClick={() => setGraphViewMode("usage")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "usage" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "usage" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "usage" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Usage
                  </button>
                  <button
                    key="rollup"
                    type="button"
                    data-testid="chrome-tab-rollup"
                    title="Exec-readable ownership, findings, and spend by section"
                    onClick={() => setGraphViewMode("rollup")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "rollup" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "rollup" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "rollup" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Rollup
                  </button>
                  <button
                    key="devops"
                    type="button"
                    data-testid="chrome-tab-devops"
                    title="Missing env vars and CI status per node"
                    onClick={() => setGraphViewMode("devops")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "devops" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "devops" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "devops" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    DevOps
                  </button>
                  <button
                    key="standard"
                    type="button"
                    title="This agent against the reference model"
                    onClick={() => setGraphViewMode("standard")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "standard" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "standard" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "standard" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Standard
                  </button>
                  <button
                    key="guard"
                    type="button"
                    title="Rules and what would block a merge"
                    onClick={() => setGraphViewMode("guard")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "guard" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "guard" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "guard" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Guard
                  </button>
                  <button
                    key="changes"
                    type="button"
                    title="What moved since the last scan"
                    onClick={() => setGraphViewMode("changes")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "changes" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "changes" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "changes" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Changes
                  </button>
                  <button
                    key="terminal"
                    type="button"
                    title="A shell in the scanned repository"
                    onClick={() => setGraphViewMode("terminal")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      border: graphViewMode === "terminal" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "terminal" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "terminal" ? "#ef32a6" : "#8b949e",
                      cursor: "pointer",
                    }}
                  >
                    Terminal
                  </button>
                  <span style={{ width: 1, background: "#30363d", margin: "0 6px", alignSelf: "stretch" }} />
                  <button
                    key="2d"
                    type="button"
                    title="Module dependency graph (legacy)"
                    onClick={() => setGraphViewMode("2d")}
                    style={{
                      padding: "4px 8px",
                      fontSize: 10,
                      fontFamily: "monospace",
                      border: graphViewMode === "2d" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "2d" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "2d" ? "#ef32a6" : "#6e7681",
                      cursor: "pointer",
                    }}
                  >
                    2D
                  </button>
                  <button
                    key="3d"
                    type="button"
                    title="Module dependency graph in 3D (legacy)"
                    onClick={() => setGraphViewMode("3d")}
                    style={{
                      padding: "4px 8px",
                      fontSize: 10,
                      fontFamily: "monospace",
                      border: graphViewMode === "3d" ? "1px solid #ef32a6" : "1px solid transparent",
                      borderRadius: 8,
                      background: graphViewMode === "3d" ? "rgba(239, 50, 166, 0.2)" : "transparent",
                      color: graphViewMode === "3d" ? "#ef32a6" : "#6e7681",
                      cursor: "pointer",
                    }}
                  >
                    3D
                  </button>
                {isCanvasView && (
                  <button
                    type="button"
                    title="Canvas options"
                    onClick={() => setShowCanvasControls((v) => !v)}
                    style={{
                      padding: "4px 8px",
                      fontSize: 10,
                      fontFamily: "monospace",
                      border: showCanvasControls ? "1px solid #ef32a6" : "1px solid #30363d",
                      borderRadius: 8,
                      background: "transparent",
                      color: showCanvasControls ? "#ef32a6" : "#6e7681",
                      cursor: "pointer",
                      marginLeft: 4,
                    }}
                  >
                    canvas options {showCanvasControls ? "\u25B4" : "\u25BE"}
                  </button>
                )}
                {/* Layout and canvas-mode controls act on the module graph only. An
                    exclusion list meant every new view had to be remembered, and
                    none were — assessment, flow and changes all leaked through. */}
                {isCanvasView && showCanvasControls && (
                  <>
                    <span style={{ width: 1, background: "#30363d", margin: "0 4px", alignSelf: "stretch" }} />
                    {(["architecture", "domains", "runtime", "failure"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        title={
                          mode === "architecture"
                            ? "Layer-based architecture"
                            : mode === "domains"
                              ? "Group by domain"
                              : mode === "runtime"
                                ? "Emphasize runtime flows"
                                : "Blast radius on select"
                        }
                        onClick={() => setGraphCanvasViewMode(mode)}
                        style={{
                          padding: "4px 8px",
                          fontSize: 10,
                          fontFamily: "monospace",
                          border: graphCanvasViewMode === mode ? "1px solid #ef32a6" : "1px solid transparent",
                          borderRadius: 8,
                          background: graphCanvasViewMode === mode ? "rgba(239, 50, 166, 0.2)" : "transparent",
                          color: graphCanvasViewMode === mode ? "#ef32a6" : "#8b949e",
                          cursor: "pointer",
                          textTransform: "capitalize",
                        }}
                      >
                        {mode === "architecture" ? "Arch" : mode}
                      </button>
                    ))}
                    <span style={{ width: 1, background: "#30363d", margin: "0 4px", alignSelf: "stretch" }} />
                    {(["depth", "domain", "elk"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        title={mode === "depth" ? "By layer (depth)" : mode === "domain" ? "By domain" : "ELK auto-layout"}
                        onClick={() => setGraphLayoutMode(mode)}
                        style={{
                          padding: "4px 8px",
                          fontSize: 10,
                          fontFamily: "monospace",
                          border: graphLayoutMode === mode ? "1px solid #ef32a6" : "1px solid transparent",
                          borderRadius: 8,
                          background: graphLayoutMode === mode ? "rgba(239, 50, 166, 0.2)" : "transparent",
                          color: graphLayoutMode === mode ? "#ef32a6" : "#8b949e",
                          cursor: "pointer",
                          textTransform: "capitalize",
                        }}
                      >
                        {mode}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
            {isCanvasView && showCanvasControls && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 10, color: "#8b949e", fontFamily: "monospace" }}>Theme</span>
              <button
                type="button"
                onClick={() =>
                  setCanvasTheme((prev) => (prev === "dark" ? "light" : "dark"))
                }
                style={{
                  padding: "4px 10px",
                  fontSize: 10,
                  borderRadius: 999,
                  border: "1px solid #30363d",
                  background: canvasTheme === "dark" ? "#020617" : "#e6edf3",
                  color: canvasTheme === "dark" ? "#e6edf3" : "#020617",
                  cursor: "pointer",
                }}
              >
                {canvasTheme === "dark" ? "Dark" : "Light"}
              </button>
            </div>
            )}
            <div style={{ position: "relative", display: "flex", alignItems: "center", marginLeft: "auto" }}>
              <button
                type="button"
                data-testid="export-menu-toggle"
                onClick={() => setShowExportMenu((v) => !v)}
                style={{
                  padding: "4px 12px",
                  fontSize: 10,
                  borderRadius: 999,
                  border: "1px solid #30363d",
                  background: showExportMenu ? "rgba(96,165,250,0.15)" : "transparent",
                  color: "#8b949e",
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                Export ▾
              </button>
              {showExportMenu && (
                <>
                  <div
                    style={{
                      position: "fixed",
                      inset: 0,
                      zIndex: 40,
                    }}
                    onClick={() => setShowExportMenu(false)}
                    aria-hidden="true"
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      marginTop: 4,
                      minWidth: 100,
                      background: "#161b22",
                      border: "1px solid #30363d",
                      borderRadius: 8,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                      zIndex: 50,
                      padding: 4,
                    }}
                  >
                    {[
                      { id: "assessment", label: "Assessment", fn: () => buildAssessment, file: "assessment.md", mime: "text/markdown" },
                      { id: "svg", label: "SVG", fn: () => exportArchitectureSvg, file: "architecture.svg", mime: "image/svg+xml" },
                      { id: "doc", label: "Doc", fn: () => exportArchitectureMarkdown, file: "architecture.md", mime: "text/markdown" },
                      { id: "c4", label: "C4", fn: () => exportC4PlantUml, file: "architecture-c4.puml", mime: "text/plain" },
                      { id: "mermaid", label: "Mermaid", fn: () => exportMermaid, file: "architecture.mmd", mime: "text/plain" },
                      { id: "puml", label: "PUML", fn: () => exportPlantUml, file: "architecture.puml", mime: "text/plain" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          if (!graphRef.current) return;
                          const text = opt.fn()(graphRef.current);
                          downloadText(opt.file, opt.mime, text);
                          setShowExportMenu(false);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "6px 10px",
                          fontSize: 10,
                          fontFamily: "monospace",
                          background: "none",
                          border: "none",
                          color: "#e6edf3",
                          cursor: "pointer",
                          textAlign: "left",
                          borderRadius: 4,
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                    {graphRef.current && (
                      <>
                        <div style={{ height: 1, background: "#30363d", margin: "4px 0" }} />
                        {[
                          { id: "design-readme", label: "Design README", file: "DESIGN.md", mime: "text/markdown", fn: () => exportDesignReadme(graphRef.current!) },
                          { id: "design-adr", label: "Design ADR", file: "adr-architecture.md", mime: "text/markdown", fn: () => exportDesignAdr(graphRef.current!) },
                          { id: "design-score", label: "Design score", file: "design-score.json", mime: "application/json", fn: () => exportDesignScoreCard(graphRef.current!) },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            data-testid={`export-${opt.id}`}
                            onClick={() => {
                              downloadText(opt.file, opt.mime, opt.fn());
                              setShowExportMenu(false);
                            }}
                            style={{
                              display: "block",
                              width: "100%",
                              padding: "6px 10px",
                              fontSize: 10,
                              fontFamily: "monospace",
                              background: "none",
                              border: "none",
                              color: "#e6edf3",
                              cursor: "pointer",
                              textAlign: "left",
                              borderRadius: 4,
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          data-testid="export-design-png"
                          onClick={async () => {
                            const el =
                              (document.querySelector(".react-flow__viewport") as HTMLElement | null) ??
                              (document.querySelector(".react-flow") as HTMLElement | null);
                            setShowExportMenu(false);
                            if (!el) return;
                            try {
                              await exportDesignPng(el, "design.png");
                            } catch (e) {
                              console.warn("[export] PNG export failed:", e instanceof Error ? e.message : e);
                            }
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            padding: "6px 10px",
                            fontSize: 10,
                            fontFamily: "monospace",
                            background: "none",
                            border: "none",
                            color: "#e6edf3",
                            cursor: "pointer",
                            textAlign: "left",
                            borderRadius: 4,
                          }}
                        >
                          Design PNG
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            {isDesignMode && (
              <MaterializeDesignButton
                graph={graph}
                apiBase={API_BASE}
                accessToken={accessToken}
                onRequireAuth={() => promptSignup("materialize this design to disk")}
              />
            )}
          </div>
        </div>
        )}
          {/* Guest / view-first banner: canvas is free to look at; tokens & keep need signup. */}
          {!accessToken && (
            <div
              data-testid="guest-view-banner"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                padding: blankoShell ? "6px 14px" : "8px 14px",
                background: blankoShell ? PAPER : ACCENT_WASH,
                borderBottom: `1px solid ${LINE}`,
                fontFamily: FONT_UI,
                fontSize: blankoShell ? 12 : 13,
                color: INK,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {!blankoShell && (
                  <span
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: ACCENT,
                      background: CANVAS,
                      border: `1px solid ${LINE}`,
                      borderRadius: 6,
                      padding: "3px 8px",
                    }}
                  >
                    Viewing free
                  </span>
                )}
                <span style={{ color: SLATE, lineHeight: 1.4 }}>
                  {blankoShell
                    ? "Exploring freely — sign in to save and chat with blanko."
                    : "Look around without an account. Save, share, and AI chat need signup — nothing here is lost when you join."}
                </span>
              </div>
              <button
                type="button"
                data-testid="guest-view-join"
                data-ll-interactive="true"
                onClick={() =>
                  promptSignup("save, share, and use AI — viewing your canvas stays free")
                }
                style={{
                  flexShrink: 0,
                  padding: blankoShell ? "6px 12px" : "8px 14px",
                  borderRadius: 8,
                  border: blankoShell ? `1px solid ${LINE}` : "1px solid transparent",
                  background: blankoShell ? CANVAS : INK,
                  color: blankoShell ? INK : CANVAS,
                  fontFamily: FONT_UI,
                  fontWeight: 600,
                  fontSize: blankoShell ? 12 : 13,
                  cursor: "pointer",
                }}
              >
                {blankoShell ? "Sign in" : "Get started free →"}
              </button>
            </div>
          )}
          {/* Every view here is a picture of a scan, and a scan is a moment.
              Without this the picture goes stale silently — thirty files were
              wtten into the clone one week and the dashboard kept showing
              the scan from before they existed. */}
          <StalenessBanner
            projectRoot={graph?.projectRoot}
            generatedAt={graph?.generatedAt}
            apiBase={API_BASE}
            accessToken={accessToken}
            scanning={!!loading}
            onRescan={() => scanRepo(repoUrl)}
            hideForDesign={isDesignMode || blankoShell}
          />
          {graph?.reconciliation && (
            <div
              data-testid="design-reconciliation-banner"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 12px",
                background: "rgba(88,166,255,0.08)",
                borderBottom: "1px solid rgba(88,166,255,0.25)",
                fontFamily: "monospace",
                fontSize: 11.5,
                color: "#e6edf3",
                flexShrink: 0,
              }}
            >
              <span>
                Matched {graph.reconciliation.matched.length} · Missing{" "}
                {graph.reconciliation.missing.length} · Unplanned{" "}
                {graph.reconciliation.unplanned.length}
              </span>
            </div>
          )}
        {graph && (
          <div
            style={{
              position: "relative",
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              // Avoid height:100% — it overflows siblings (bottom ChatBar) and steals clicks.
              overflow: "hidden",
            }}
          >
            {blankoShell && (graphViewMode === "2d" || graphViewMode === "3d") && (
              <ChromeBar
                search={graphSearch}
                onSearchChange={setGraphSearch}
                saveDisabled={saveLoading || graph.nodes.length === 0}
                saveLabel={saveLoading ? "…" : saveStatus === "saved" ? "Saved" : accessToken ? "Save" : "Save"}
                onSave={async () => {
                  if (saveLoading || graph.nodes.length === 0) return;
                  if (!accessToken) {
                    promptSignup("save this workspace — viewing stays free");
                    return;
                  }
                  setSaveLoading(true);
                  setSaveStatus("idle");
                  try {
                    await handleSaveWorkspace();
                    setSaveStatus("saved");
                    if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
                    saveStatusTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 1500);
                  } catch {
                    setSaveStatus("error");
                    if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
                    saveStatusTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 2500);
                  } finally {
                    setSaveLoading(false);
                  }
                }}
                shareDisabled={shareLoading}
                shareLabel={shareLoading ? "…" : shareCopied ? "Copied" : "Share"}
                onShare={async () => {
                  if (shareLoading) return;
                  if (!accessToken) {
                    promptSignup("share this workspace — viewing stays free");
                    return;
                  }
                  setShareLoading(true);
                  try {
                    const r = await handleShare();
                    if (r?.url) {
                      await navigator.clipboard.writeText(r.url);
                      setShareCopied(true);
                      if (shareCopiedTimeoutRef.current) clearTimeout(shareCopiedTimeoutRef.current);
                      shareCopiedTimeoutRef.current = setTimeout(() => setShareCopied(false), 1500);
                    }
                  } finally {
                    setShareLoading(false);
                  }
                }}
                accessToken={accessToken}
                apiBase={API_BASE}
                projectRoot={graph?.projectRoot}
                generatedAt={graph?.generatedAt}
                scanning={!!loading}
                onRescan={() => scanRepo(repoUrl)}
                hideStaleness={isDesignMode}
                exportOptions={[
                  {
                    id: "assessment",
                    label: "Assessment",
                    onClick: () => {
                      if (!graphRef.current) return;
                      downloadText("assessment.md", "text/markdown", buildAssessment(graphRef.current));
                    },
                  },
                  {
                    id: "svg",
                    label: "SVG",
                    onClick: () => {
                      if (!graphRef.current) return;
                      downloadText("architecture.svg", "image/svg+xml", exportArchitectureSvg(graphRef.current));
                    },
                  },
                  {
                    id: "doc",
                    label: "Doc",
                    onClick: () => {
                      if (!graphRef.current) return;
                      downloadText("architecture.md", "text/markdown", exportArchitectureMarkdown(graphRef.current));
                    },
                  },
                  {
                    id: "c4",
                    label: "C4",
                    onClick: () => {
                      if (!graphRef.current) return;
                      downloadText("architecture-c4.puml", "text/plain", exportC4PlantUml(graphRef.current));
                    },
                  },
                  {
                    id: "mermaid",
                    label: "Mermaid",
                    onClick: () => {
                      if (!graphRef.current) return;
                      downloadText("architecture.mmd", "text/plain", exportMermaid(graphRef.current));
                    },
                  },
                  {
                    id: "puml",
                    label: "PUML",
                    onClick: () => {
                      if (!graphRef.current) return;
                      downloadText("architecture.puml", "text/plain", exportPlantUml(graphRef.current));
                    },
                  },
                  ...(graphRef.current
                    ? [
                        {
                          id: "design-readme",
                          label: "Design README",
                          onClick: () =>
                            downloadText("DESIGN.md", "text/markdown", exportDesignReadme(graphRef.current!)),
                        },
                        {
                          id: "design-adr",
                          label: "Design ADR",
                          onClick: () =>
                            downloadText("adr-architecture.md", "text/markdown", exportDesignAdr(graphRef.current!)),
                        },
                        {
                          id: "design-score",
                          label: "Design score",
                          onClick: () =>
                            downloadText(
                              "design-score.json",
                              "application/json",
                              exportDesignScoreCard(graphRef.current!)
                            ),
                        },
                        {
                          id: "design-png",
                          label: "Design PNG",
                          onClick: async () => {
                            const el =
                              (document.querySelector(".react-flow__viewport") as HTMLElement | null) ??
                              (document.querySelector(".react-flow") as HTMLElement | null);
                            if (!el) return;
                            try {
                              await exportDesignPng(el, "design.png");
                            } catch (e) {
                              console.warn("[export] PNG export failed:", e instanceof Error ? e.message : e);
                            }
                          },
                        },
                      ]
                    : []),
                ]}
                moreItems={[
                  {
                    id: "health",
                    label: showHealthBadges ? "Health badges: on" : "Health badges: off",
                    onClick: () => setShowHealthBadges((v) => !v),
                  },
                  ...(activeWorkspaceId && accessToken
                    ? [
                        {
                          id: "members",
                          label: "Members",
                          onClick: () => setShowMembersPanel(true),
                        },
                        {
                          id: "activity",
                          label: "Activity log",
                          onClick: () => setShowActivityPanel(true),
                        },
                      ]
                    : []),
                ]}
                materializeSlot={
                  isDesignMode ? (
                    <MaterializeDesignButton
                      graph={graph}
                      apiBase={API_BASE}
                      accessToken={accessToken}
                      onRequireAuth={() => promptSignup("materialize this design to disk")}
                    />
                  ) : undefined
                }
              />
            )}
            {isDesignMode &&
            graphViewMode !== "2d" &&
            graphViewMode !== "3d" &&
            graphViewMode !== "platforms" &&
            graphViewMode !== "usage" &&
            graphViewMode !== "rollup" &&
            graphViewMode !== "devops" ? (
              <ViewShell title={SCAN_ONLY_VIEW_LABEL[graphViewMode] ?? graphViewMode} onBackToCanvas={backToCanvas}>
                <ScanOnlyPlaceholder view={graphViewMode} />
              </ViewShell>
            ) : graphViewMode === "layers" ? (
              <ViewShell title="Layers" onBackToCanvas={backToCanvas}>
                <LayersView
                  onOpenFile={(path, line) => {
                    setOpenFile({ path, line });
                    setGraphViewMode("files");
                  }}
                  agents={graph?.agents}
                  selectedAgentFile={layersAgentFile}
                  onSelectAgent={setLayersAgentFile}
                />
              </ViewShell>
            ) : graphViewMode === "standard" ? (
              <ViewShell title="Layers" onBackToCanvas={backToCanvas}>
                <StandardView
                  agents={graph?.agents}
                  selectedAgentFile={layersAgentFile}
                  onSelectAgent={setLayersAgentFile}
                />
              </ViewShell>
            ) : graphViewMode === "assessment" ? (
              <ViewShell title="Review" onBackToCanvas={backToCanvas}>
                <AssessmentView
                  graph={graph}
                  apiBase={API_BASE}
                  accessToken={accessToken}
                  workspaceId={activeWorkspaceId}
                  onOpenFile={(path, line) => {
                    setOpenFile({ path, line });
                    setGraphViewMode("files");
                  }}
                />
              </ViewShell>
            ) : graphViewMode === "files" ? (
              <ViewShell title="Files" onBackToCanvas={backToCanvas}>
                <FilesView
                  graph={graph}
                  openFile={openFile}
                  onOpenFile={(path, line) => setOpenFile({ path, line })}
                  onClose={() => setOpenFile(null)}
                  apiBase={API_BASE}
                  accessToken={accessToken}
                />
              </ViewShell>
            ) : graphViewMode === "terminal" ? null : graphViewMode === "changes" ? (
              <ViewShell title="Changes" onBackToCanvas={backToCanvas}>
                <ChangesView
                  graph={graph}
                  apiBase={API_BASE}
                  accessToken={accessToken}
                  workspaceId={activeWorkspaceId}
                />
              </ViewShell>
            ) : graphViewMode === "flow" ? (
              <ViewShell title="Flow" onBackToCanvas={backToCanvas}>
                <FlowView
                  agents={graph?.agents}
                  selectedAgentFile={layersAgentFile}
                  onSelectAgent={setLayersAgentFile}
                  workspaceId={activeWorkspaceId}
                  accessToken={accessToken}
                  apiBase={API_BASE}
                  onOpenFile={(path, line) => {
                    setOpenFile({ path, line });
                    setGraphViewMode("files");
                  }}
                />
              </ViewShell>
            ) : graphViewMode === "agents" ? (
              <ViewShell title="Agents" onBackToCanvas={backToCanvas}>
                <AgentsView
                  agents={graph?.agents}
                  onOpenFile={(path, line) => {
                    setOpenFile({ path, line });
                    setGraphViewMode("files");
                  }}
                />
              </ViewShell>
            ) : graphViewMode === "reach" ? (
              <ViewShell title="Reach" onBackToCanvas={backToCanvas}>
                <ReachView agents={graph?.agents} />
              </ViewShell>
            ) : graphViewMode === "resources" ? (
              <ViewShell title="Resources" onBackToCanvas={backToCanvas}>
                <ResourcesView
                  agents={graph?.agents}
                  apiBase={API_BASE}
                  workspaceId={activeWorkspaceId}
                  onGraphPatch={(patch) => setGraph((g) => (g ? patch(g) : g))}
                />
              </ViewShell>
            ) : graphViewMode === "platforms" ? (
              <ViewShell title="Platforms" onBackToCanvas={backToCanvas}>
                <PlatformInventoryView
                  graph={graph}
                  onSelectNode={(id) => {
                    setSelectedNode(id);
                    setGraphViewMode("2d");
                  }}
                />
              </ViewShell>
            ) : graphViewMode === "usage" ? (
              <ViewShell title="Usage" onBackToCanvas={backToCanvas}>
                <UsageView
                  workspaceId={activeWorkspaceId}
                  apiBase={API_BASE}
                  accessToken={accessToken}
                  onSelectNode={(id) => {
                    setSelectedNode(id);
                    setGraphViewMode("2d");
                  }}
                />
              </ViewShell>
            ) : graphViewMode === "rollup" ? (
              <ViewShell title="Rollup" onBackToCanvas={backToCanvas}>
                <ManagementRollupView
                  graph={graph}
                  workspaceId={activeWorkspaceId}
                  apiBase={API_BASE}
                  accessToken={accessToken}
                  onSelectNode={(id) => {
                    setSelectedNode(id);
                    setGraphViewMode("2d");
                  }}
                />
              </ViewShell>
            ) : graphViewMode === "devops" ? (
              <ViewShell title="DevOps" onBackToCanvas={backToCanvas}>
                <DevOpsHealthView
                  graph={graph}
                  workspaceId={activeWorkspaceId}
                  apiBase={API_BASE}
                  accessToken={accessToken}
                  onSelectNode={(id) => {
                    setSelectedNode(id);
                    setGraphViewMode("2d");
                  }}
                />
              </ViewShell>
            ) : graphViewMode === "guard" ? (
              <ViewShell title="Guard" onBackToCanvas={backToCanvas}>
                <GuardView
                  agents={graph?.agents}
                  apiBase={API_BASE}
                  onOpenEvidence={({ agent, tool, cls }) => {
                    setGraphViewMode("reach");
                    try {
                      sessionStorage.setItem(
                        "arch_reach_focus",
                        JSON.stringify({ agent, tool, cls })
                      );
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              </ViewShell>
            ) : (
            <>
            <ArchCanvas
              graph={effectiveGraph!}
              selectedNode={selectedNode}
              selectedNodeData={selectedNodeData}
              repoUrl={repoUrl}
              designMode={isDesignMode}
              designAlertNodeIds={designAlertNodeIds}
              designAlertEdgeIds={designAlertEdgeIds}
              designFindingCounts={designFindingCounts}
              showHealthBadges={showHealthBadges}
              flashNodeIds={flashNodeIds}
              onHealthBadgeClick={(nodeId) => {
                setSelectedNode(nodeId);
                setDockMode("insights");
                setDockOpen(true);
                setAgentGraphCommand({ action: "highlight_nodes", nodeIds: [nodeId] });
              }}
              emptyStateHint={
                isDesignMode
                  ? "Design your agent — drag a piece or ask blanko."
                  : undefined
              }
              onOpenBuild={openComponents}
              onDesignDrop={(paletteId, flowPosition) => {
                if (!graph) return;
                const buildItem = getBuildItem(paletteId);
                const node =
                  paletteItemToNode(paletteId, graph.nodes.length, flowPosition) ??
                  (buildItem ? buildItemToNode(buildItem, graph.nodes.length, flowPosition) : null);
                if (!node) return;
                setGraph({
                  ...graph,
                  nodes: [...graph.nodes, node],
                  generatedAt: Date.now(),
                });
                setSelectedNode(node.id);
                setDockMode("insights");
                setDockOpen(true);
                setInsightsEditOpen(false);
              }}
              onDesignNodeMove={(nodeId, position) => {
                const now = Date.now();
                setGraph((prev) => {
                  if (!prev) return prev;
                  const moved = setDesignNodePosition(prev, nodeId, position);
                  const node = moved.nodes.find((n) => n.id === nodeId);
                  if (node && activeWorkspaceId && graphSyncUserId) {
                    broadcastPatch({
                      type: "nodes_upsert",
                      nodes: [{ ...node, updatedAt: now } as unknown as SyncNode],
                      revision: prev.revision,
                      userId: graphSyncUserId,
                    });
                  }
                  return moved;
                });
              }}
              onDesignConnect={(fromId, toId, relation) => {
                if (!graph) return;
                setGraph({
                  ...graph,
                  edges: [...graph.edges, createDesignEdge({ fromId, toId, relation })],
                  generatedAt: Date.now(),
                });
              }}
              onDesignEdgeSelect={(edgeId) => {
                setSelectedEdgeId(edgeId);
                if (edgeId) setSelectedNode(null);
              }}
              onDesignDeleteNodes={(ids) => {
                if (!graph) return;
                let next = graph;
                for (const id of ids) next = deleteDesignNode(next, id);
                setGraph(next);
                if (selectedNode && ids.includes(selectedNode)) setSelectedNode(null);
              }}
              onDesignDeleteEdges={(ids) => {
                if (!graph) return;
                let next = graph;
                for (const id of ids) next = deleteDesignEdge(next, id);
                setGraph(next);
                if (selectedEdgeId && ids.includes(selectedEdgeId)) setSelectedEdgeId(null);
              }}
              onNodeSelect={(id) => {
                setSelectedNode(id);
                setSelectedEdgeId(null);
                if (blankoShell) {
                  // Always Insights on select (design + scan) — never jump to Files.
                  setGraphViewMode("2d");
                  setDockMode("insights");
                  setDockOpen(true);
                  setInsightsEditOpen(false);
                  return;
                }
                if (isDesignMode) return;
                const n = graph?.nodes?.find((x: { id: string }) => x.id === id);
                const first = (n as { files?: string[] } | undefined)?.files?.[0];
                if (first) {
                  setOpenFile({ path: first });
                  setGraphViewMode("files");
                }
              }}
              onNodeDoubleClick={(id) => {
                setSelectedNode(id);
                setSelectedEdgeId(null);
                if (blankoShell) {
                  setGraphViewMode("2d");
                  setDockMode("insights");
                  setDockOpen(true);
                  setInsightsEditOpen(true);
                  return;
                }
                setDockMode("insights");
                setDockOpen(true);
                setInsightsEditOpen(true);
              }}
              edgeFilter={activeFilters}
              nodeFilter={personaNodeFilters}
              persona={persona}
              searchResults={graphSearchResults}
              viewMode={graphViewMode === "3d" ? "3d" : "2d"}
              onViewModeChange={(m) => setGraphViewMode(m)}
              canvasViewMode={graphCanvasViewMode}
              onCanvasViewModeChange={setGraphCanvasViewMode}
              layoutMode={graphLayoutMode}
              onLayoutModeChange={setGraphLayoutMode as any}
              agentGraphCommand={agentGraphCommand}
              theme={canvasTheme}
              density={canvasDensity}
              workspaceId={activeWorkspaceId ?? undefined}
              accessToken={accessToken}
              annotations={workspaceAnnotations}
              onAnnotationsChange={fetchAnnotations}
              onOpenComments={(annId) => setSelectedAnnotationForComments(annId)}
              scene={workspaceScene}
              sceneEditMode={sceneEditMode}
              onSceneChange={setWorkspaceScene}
              onSaveScene={handleSaveScene}
              activeSceneStateId={activeSceneStateId}
              captureViewRef={captureViewRef}
              viewportToApply={
                activeSceneState?.viewport2D && (workspaceScene?.settings as any)?.layoutMode !== "elk"
                  ? activeSceneState.viewport2D
                  : null
              }
              onExplainArea={(prompt) => {
                setAiQuestion(prompt);
                chatInputRef.current?.focus();
              }}
              presentationMode={presentationMode}
              onPresentationModeChange={setPresentationMode}
              runtimeSnapshot={runtimeSnapshot}
              runtimeLive={runtimeLive}
              vulnerableNodeIds={showSupplyChainRisk ? vulnerableNodeIds : undefined}
            />
            {blankoShell && isDesignMode && selectedEdgeId && graph && (() => {
              const edge = graph.edges.find((e) => e.id === selectedEdgeId);
              if (!edge) return null;
              const src = graph.nodes.find((n) => n.id === edge.source);
              const tgt = graph.nodes.find((n) => n.id === edge.target);
              return (
                <EdgeTeachStrip
                  edge={edge}
                  sourceLabel={src?.label}
                  targetLabel={tgt?.label}
                  onClose={() => setSelectedEdgeId(null)}
                />
              );
            })()}
            {isDesignMode && selectedEdgeId && graph && !blankoShell && (() => {
              const edge = graph.edges.find((e) => e.id === selectedEdgeId);
              if (!edge) return null;
              const src = graph.nodes.find((n) => n.id === edge.source);
              const tgt = graph.nodes.find((n) => n.id === edge.target);
              return (
                <DesignInspectPanel
                  mode="edge"
                  edge={edge}
                  sourceLabel={src?.label}
                  targetLabel={tgt?.label}
                  onChange={(patch) => {
                    setGraph(updateDesignEdge(graph, selectedEdgeId, patch));
                  }}
                  onDelete={() => {
                    setGraph(deleteDesignEdge(graph, selectedEdgeId));
                    setSelectedEdgeId(null);
                  }}
                  onClose={() => setSelectedEdgeId(null)}
                />
              );
            })()}
            {isDesignMode && selectedNodeData && !selectedEdgeId && !blankoShell && (
              <DesignInspectPanel
                mode="node"
                node={selectedNodeData}
                onChange={(patch) => {
                  if (!graph || !selectedNode) return;
                  setGraph(updateDesignNode(graph, selectedNode, patch));
                }}
                onDelete={() => {
                  if (!graph || !selectedNode) return;
                  setGraph(deleteDesignNode(graph, selectedNode));
                  setSelectedNode(null);
                }}
                onClose={() => setSelectedNode(null)}
                onAddNeighbours={() => {
                  if (!selectedNode) return;
                  handleAddDesignNeighbours(selectedNode);
                }}
                workspaceId={activeWorkspaceId}
                accessToken={accessToken}
                apiBase={API_BASE}
              />
            )}
            {selectedNode && !selectedEdgeId && !blankoShell && (
              <NodeCollabMeta
                workspaceId={activeWorkspaceId}
                nodeId={selectedNode}
                nodeLabel={selectedNodeData?.label}
                apiBase={API_BASE}
                accessToken={accessToken}
                rightOffset={
                  isDesignMode && selectedNodeData
                      ? 312
                      : 0
                }
              />
            )}
            {selectedNode &&
              !selectedEdgeId &&
              selectedNodeData &&
              isAgentLikeNode(selectedNodeData) &&
              !blankoShell && (
              <NodeLlmopsPanel
                workspaceId={activeWorkspaceId}
                nodeId={selectedNode}
                nodeLabel={selectedNodeData?.label}
                apiBase={API_BASE}
                accessToken={accessToken}
                graphNodes={graph?.nodes ?? []}
                graphEdges={graph?.edges ?? []}
                rightOffset={(isDesignMode && selectedNodeData ? 312 : 0) + 272}
              />
            )}
            </>
            )}
            {/* Outside the chain above, and hidden rather than unmounted. Every
                other view can be rebuilt from the graph; a shell cannot — its
                scrollback, working directory and running command are the state.
                Conditionally rendering it closed the websocket on every tab
                switch and you came back to an empty prompt. */}
            <div
              style={{
                display: graphViewMode === "terminal" ? "flex" : "none",
                flexDirection: "column",
                position: "absolute",
                inset: 0,
                minHeight: 0,
              }}
            >
              <TerminalPanel
                cwd={graph?.projectRoot}
                accessToken={accessToken}
                apiBase={API_BASE}
              />
            </div>
          </div>
        )}
        {showInsightsPanel && graph && !blankoShell && (
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              width: 260,
              maxHeight: 320,
              overflow: "auto",
              background: "rgba(15,23,42,0.96)",
              border: "1px solid #334155",
              borderRadius: 8,
              zIndex: 11,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          >
            <SystemInsightsPanel
              insights={computeGraphInsights(analyseGraph(graph))}
              onHighlight={(nodeIds) => setAgentGraphCommand({ action: "highlight_nodes", nodeIds })}
              onClose={() => setShowInsightsPanel(false)}
            />
          </div>
        )}

      {blankoShell && graph && (
          <ChatBar
            expanded={chatExpanded}
            onToggleExpand={() => setChatExpanded((v) => !v)}
            messages={chatHistory}
            draft={aiQuestion}
            onDraftChange={setAiQuestion}
            onSend={() => {
              setChatOnlyNotice(false);
              void handleAsk();
            }}
            loading={chatLoading}
            pendingCommands={pendingProposal}
            chatOnlyNotice={chatOnlyNotice}
            onAccept={acceptProposal}
            onReject={rejectProposal}
            canUndoAccept={graphUndoStack.length > 0}
            onUndoAccept={undoLastAccept}
            lastAcceptWhy={lastAcceptWhy}
            onPlusBuild={() => {
              openComponents();
            }}
            onPlusN8n={() => n8nFileInputRef.current?.click()}
            onPlusGithub={() => {
              setDockOpen(false);
              setError("Paste a GitHub URL on the landing page, or type a repo path in chat.");
            }}
          />
      )}

      {blankoShell && graph && dockOpen && dockMode && (
        <DockFrame
          mode={dockMode === "inspect" ? "insights" : dockMode}
          width={dockWidth}
          variant="overlay"
          onClose={() => {
            setDockOpen(false);
            setInsightsEditOpen(false);
          }}
          onResizeStart={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = dockWidth;
            const onMove = (ev: MouseEvent) => {
              const next = Math.min(560, Math.max(280, startW + (startX - ev.clientX)));
              setDockWidth(next);
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
        >
          {dockMode === "build" && (
            <BuildPanel
              variant="dock"
              selectedNode={selectedNodeData ?? null}
              onPlace={placeBuildItem}
              findings={allInsightsFindings}
              graphHasAuth={
                !!graph?.nodes.some(
                  (n) =>
                    /auth/i.test(n.label ?? "") ||
                    String(n.layer ?? "").includes("Safety") ||
                    String(n.techKind ?? "").includes("auth")
                )
              }
              graphNodes={graph?.nodes}
            />
          )}
          {(dockMode === "insights" || dockMode === "inspect") && (
            <InsightsPanel
              findings={allInsightsFindings}
              inventory={platformInventory}
              selectedNode={selectedNodeData ?? null}
              editDetailsOpen={insightsEditOpen}
              onEditDetailsOpenChange={setInsightsEditOpen}
              architectureSummary={
                !selectedNodeData && graph && graph.nodes.length > 0
                  ? (() => {
                      const sample = graph.nodes
                        .slice(0, 3)
                        .map((n) => n.label)
                        .join(", ");
                      return `AI design canvas: ${graph.nodes.length} pieces (${sample}${graph.nodes.length > 3 ? "…" : ""}) with ${graph.edges.length} connections. Insights highlights where the agent system is broken — click a finding to see it on the canvas.`;
                    })()
                  : undefined
              }
              onHighlight={(f) => {
                if (f.nodeIds[0]) {
                  setSelectedNode(f.nodeIds[0]);
                  setDockMode("insights");
                  setDockOpen(true);
                  setInsightsEditOpen(false);
                }
                setAgentGraphCommand({ action: "highlight_nodes", nodeIds: f.nodeIds });
              }}
              onFix={(f) => {
                if (f.fix?.length) {
                  setPendingProposal(f.fix);
                  setChatOnlyNotice(false);
                  setChatExpanded(true);
                }
              }}
              onAskFix={(f) => {
                setAiQuestion(`Help me fix: ${f.title}. ${f.whyItMatters}`);
                setChatExpanded(true);
              }}
              onContinueInChat={(node) => {
                setAiQuestion(`Looking at “${node.label}” (${node.layer ?? "piece"}): `);
                setChatExpanded(true);
                chatInputRef.current?.focus();
              }}
              onOpenFile={(path) => {
                setOpenFile({ path });
                setGraphViewMode("files");
                setDockOpen(false);
              }}
              onNodeChange={(patch) => {
                if (!selectedNodeData) return;
                setGraph((prev) =>
                  prev ? updateDesignNode(prev, selectedNodeData.id, patch) : prev
                );
              }}
              onNodeDelete={() => {
                if (!selectedNodeData) return;
                setGraph((prev) =>
                  prev ? deleteDesignNode(prev, selectedNodeData.id) : prev
                );
                setSelectedNode(null);
                setInsightsEditOpen(false);
              }}
              onAddNeighbours={() => {
                if (selectedNodeData) handleAddDesignNeighbours(selectedNodeData.id);
              }}
              workspaceId={activeWorkspaceId}
              accessToken={accessToken}
              apiBase={API_BASE}
            />
          )}
          {(dockMode === "terminal" || dockMode === "evidence") && (
            <div data-testid="blanko-terminal-dock" style={{ height: "100%", minHeight: 280, display: "flex", flexDirection: "column" }}>
              {dockMode === "evidence" && (
                <EvidencePanel
                  hasRepoFiles={!!(graph.projectRoot && graph.projectRoot.trim())}
                  files={
                    <div style={{ padding: 8 }}>
                      <FileBrowser
                        graph={graph}
                        openPath={openFile?.path}
                        onOpen={(path, line) => {
                          setOpenFile({ path, line });
                          setGraphViewMode("files");
                        }}
                      />
                    </div>
                  }
                />
              )}
              {dockMode === "terminal" && (
                <div style={{ flex: 1, minHeight: 0, height: "100%" }}>
                  <TerminalPanel
                    cwd={graph.projectRoot}
                    accessToken={accessToken}
                    apiBase={API_BASE}
                  />
                </div>
              )}
            </div>
          )}
        </DockFrame>
      )}

      {blankoShell && (
        <DockRail
          active={dockOpen ? (dockMode === "inspect" ? "insights" : dockMode) : null}
          dockOpen={dockOpen}
          awayFromCanvas={!isCanvasView}
          configOpen={configMenuOpen}
          onConfigOpenChange={setConfigMenuOpen}
          onConfig={() => {
            if (!isCanvasView) {
              backToCanvas();
              return;
            }
            setConfigMenuOpen((v) => !v);
          }}
          onSelect={(m) => {
            if (dockOpen && (dockMode === m || (m === "insights" && dockMode === "inspect"))) {
              setDockOpen(false);
              setInsightsEditOpen(false);
            } else {
              setDockMode(m);
              setDockOpen(true);
              if (m !== "insights") setInsightsEditOpen(false);
            }
          }}
          onOverflow={(v: OverflowView) => {
            if (v === "canvas") {
              backToCanvas();
              return;
            }
            if (v === "files") {
              setDockMode("evidence");
              setDockOpen(true);
              setGraphViewMode("2d");
              return;
            }
            if (v === "changes") {
              setGraphViewMode("changes");
              setDockOpen(false);
              return;
            }
            setGraphViewMode(v === "3d" ? "3d" : v);
            setDockOpen(false);
          }}
        />
      )}
        </div>

      </div>

      {renderGlobalOverlays()}
    </>
  );
}
