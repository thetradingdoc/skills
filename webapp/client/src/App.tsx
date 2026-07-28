import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ArchCanvas } from "./ArchCanvas";
import AgentsView from "./AgentsView";
import ReachView from "./ReachView";
import ResourcesView from "./ResourcesView";
import GuardView from "./GuardView";
import LayersView from "./LayersView";
import StandardView from "./StandardView";
import CodeViewerPanel from "./CodeViewerPanel";
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
import { analyseGraph, type EdgeFilter, type NodeFilter } from "./analysis/graphAnalyser";
import { computeGraphInsights } from "./analysis/graphInsights";
import { SystemInsightsPanel } from "./SystemInsightsPanel";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { supabase, getSupabaseConfigError } from "./supabaseClient";
import { logAuthHashErrors, logAuthStateChange } from "./authDebug";
import { WorkspaceMembersPanel } from "./WorkspaceMembersPanel";
import { ActivityLogPanel } from "./ActivityLogPanel";
import { AnnotationCommentsPanel } from "./AnnotationCommentsPanel";
import { ScanHistoryPanel } from "./ScanHistoryPanel";
import { SnapshotSelectorPanel } from "./SnapshotSelectorPanel";
import { ConnectGitHubModal } from "./ConnectGitHubModal";

import {
  exportArchitectureSvg,
  exportArchitectureMarkdown,
  exportC4PlantUml,
  exportMermaid,
  exportPlantUml,
  exportSceneBundle,
  importSceneBundle,
} from "./exporters";
import { safeStorageGet, safeStorageSet, safeStorageRemove } from "./utils/safeStorage";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

const API_BASE = "/api";

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
        color: saved ? "#4ade80" : "#94a3b8",
        cursor: saving || saved ? "default" : "pointer",
      }}
    >
      {saved ? "Saved" : saving ? "Saving…" : "Remember this"}
    </button>
  );
}

function LittleLabsScene() {
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

function LittleLabsCursor() {
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
        background: "#c8f135",
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

function DesignTicker() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("ll-ticker-style")) return;
    const style = document.createElement("style");
    style.id = "ll-ticker-style";
    style.textContent = `
.ll-ticker {
  position: relative;
  height: 80px;
  overflow: hidden;
  font-family: "DM Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 56px;
  line-height: 80px;
  color: #000000;
}
.ll-ticker__container {
  font-weight: 700;
  overflow: hidden;
  height: 80px;
  padding: 0 48px;
  position: relative;
}
.ll-ticker__container::before,
.ll-ticker__container::after {
  position: absolute;
  top: 0;
  color: #c8f135;
  font-size: 64px;
  line-height: 80px;
  animation-name: llTickerOpacity;
  animation-duration: 2s;
  animation-iteration-count: infinite;
}
.ll-ticker__container::before {
  content: "[";
  left: 0;
}
.ll-ticker__container::after {
  content: "]";
  right: 0;
}
.ll-ticker__text {
  display: inline;
  float: left;
  margin: 0;
}
.ll-ticker__list {
  margin-top: 0;
  padding-left: 190px;
  text-align: left;
  list-style: none;
  animation-name: llTickerChange;
  animation-duration: 10s;
  animation-iteration-count: infinite;
}
.ll-ticker__item {
  line-height: 80px;
  color: #c8f135;
  margin: 0;
}
@keyframes llTickerOpacity {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}
@keyframes llTickerChange {
  0%, 12.66%, 100% { transform: translate3d(0,0,0); }
  16.66%, 29.32% { transform: translate3d(0,-25%,0); }
  33.32%, 45.98% { transform: translate3d(0,-50%,0); }
  49.98%, 62.64% { transform: translate3d(0,-75%,0); }
  66.64%, 79.3% { transform: translate3d(0,-50%,0); }
  83.3%, 95.96% { transform: translate3d(0,-25%,0); }
}
`;
    document.head.appendChild(style);
  }, []);

  return (
    <div className="ll-ticker">
      <div className="ll-ticker__container">
        <p className="ll-ticker__text">Design</p>
        <ul className="ll-ticker__list">
          <li className="ll-ticker__item">your code.</li>
          <li className="ll-ticker__item">your systems.</li>
          <li className="ll-ticker__item">your architecture.</li>
          <li className="ll-ticker__item">your future.</li>
        </ul>
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
      alert("PDF must be under 25MB.");
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
      alert("Word document must be under 10MB.");
      return;
    }
    setPdfAttachment(null);
    try {
      const mammoth = await import("mammoth");
      const arr = await f.arrayBuffer();
      const { value } = await mammoth.extractRawText({ arrayBuffer: arr });
      const text = (value ?? "").trim();
      if (!text) {
        alert("Could not extract text from document. The file may be empty or corrupted.");
        return;
      }
      setDocAttachment({ name: f.name, extractedText: text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Could not read document: ${msg}. Try saving as .docx (Word 2007+ format).`);
    }
  }, []);

  const processAttachmentFile = useCallback(
    (f: File) => {
      const lower = f.name.toLowerCase();
      const isPdf = f.type === "application/pdf" || lower.endsWith(".pdf");
      const isDoc = f.type === "application/msword" || f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || lower.endsWith(".doc") || lower.endsWith(".docx");
      if (isPdf) processPdfFile(f);
      else if (isDoc) processDocFile(f);
      else alert("Please attach a PDF or Word document (.doc, .docx).");
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
  const [graphViewMode, setGraphViewMode] = useState<"2d" | "3d" | "agents" | "reach" | "resources" | "guard" | "layers" | "standard">("2d");
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
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "reset">("signup");
  const [loginHover, setLoginHover] = useState(false);
  const [ctaHover, setCtaHover] = useState(false);
  const [signupFirstName, setSignupFirstName] = useState("");
  const [signupLastName, setSignupLastName] = useState("");
  const [signupNickname, setSignupNickname] = useState("");
  const [signupHasRepos, setSignupHasRepos] = useState<"yes" | "no">("yes");
  const [signupRepos, setSignupRepos] = useState("");
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
  const [canvasTheme, setCanvasTheme] = useState<"dark" | "light">("dark");
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
  const [workspaceTitleEditing, setWorkspaceTitleEditing] = useState(false);
  const [workspaceTitleDraft, setWorkspaceTitleDraft] = useState("");
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panelWidth, setPanelWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
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
  const chatSessionsRef = useRef<Record<string, ArchitectureChatMessage[]>>(chatSessions);
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
        alert(data.error ?? "Failed to run npm audit.");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to run npm audit.");
    } finally {
      setNpmAuditRunning(false);
    }
  }, [activeWorkspaceId, accessToken]);

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
    } catch {
      // ignore
    }
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
    if (!activeWorkspaceId || !accessToken) return null;
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
    if (!graph || !activeWorkspaceId || !accessToken) {
      return;
    }
    try {
      const now = Date.now();
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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
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
                setGraph(analysed);
                setActiveWorkspaceId(workspaceId);
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
              setActiveWorkspaceId(workspaceId);
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
            setActiveWorkspaceId(null);
            setActiveWorkspaceIsOwner(false);
            setRepoUrl("");
            setActiveViolations([]);
            setViolationsRestoreError(null);
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
          setGraph(mergedGraph);
          setActiveViolations(violations);
          setRepoUrl(repo);
          setActiveWorkspaceId(workspaceId);
          // Best-effort: load authored scene document (if any).
          const scene = await fetchLatestScene(workspaceId, token);
          setWorkspaceScene(scene);
          const annotations = (data.annotations ?? []) as WorkspaceAnnotation[];
          setWorkspaceAnnotations(annotations);
          setActiveWorkspaceIsOwner(Boolean(data.isOwner));
          setShowWorkspaceDropUp(false);
          setError(null);
          // Restore saved chat context for this workspace, or reset to empty when none exists
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
              } else {
                setChatTabs([{ id: "1", label: "Chat 1" }]);
                setActiveChatId("1");
                setChatSessions({ "1": [] });
              }
            } else {
              setChatTabs([{ id: "1", label: "Chat 1" }]);
              setActiveChatId("1");
              setChatSessions({ "1": [] });
            }
          } catch {
            setChatTabs([{ id: "1", label: "Chat 1" }]);
            setActiveChatId("1");
            setChatSessions({ "1": [] });
          }
        } else {
          throw new Error("Invalid graph data");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingWorkspaceId(null);
      }
    },
    [accessToken, fetchViolationsRaw, repoUrl]
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
  chatSessionsRef.current = chatSessions;

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
  const chatPersistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
            setAuthMode("signup");
            setShowAuthModal(true);
            setError(null);
            setAuthMessage(
              `You've used your free scan${data.limit ? ` (${data.limit} per day)` : ""}. Sign up to continue.`
            );
            return;
          }
          const msg = data.error || res.statusText || "Scan failed.";
          setError(msg);
          return;
        }

        // Successful scan: always show the graph — Layers is the default picture.
        setSelectedAgentFile(null);
        setGraph(analyseGraph(data));
        setGraphViewMode("layers");
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
          setError(`Workspace save failed: ${data.persistError}`);
          // Persist anonymous graph snapshot for refresh-only restore.
          try {
            localStorage.setItem("anonGraph", JSON.stringify(data));
          } catch {
            // ignore
          }
          // Gentle governance: prompt user to sign in so future scans can be saved.
          if (!accessToken) {
            setAuthMode("signup");
            setShowAuthModal(true);
            setAuthMessage("Sign in to save and share this workspace.");
          }
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

      const inFlight = backgroundTasksRef.current.some(
        (t) =>
          t.kind === "chat" &&
          t.status === "running" &&
          (t.prompt ?? t.label ?? "").trim() === q &&
          (t.workspaceId ?? activeWorkspaceId) === activeWorkspaceId
      );
      if (inFlight) return;

      const clientTaskId = crypto.randomUUID?.() ?? `task-${Date.now()}`;
      const mode = "analysis" as const;
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
    setTokenWarning(null);
  }, [chatTabs, accessToken, activeWorkspaceId]);

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
        setThreadListOpen(false);
      } catch {
        /* non-fatal */
      }
    },
    [accessToken, activeWorkspaceId, chatTabs]
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
      }
      setChatSessions((s) => {
        const next = { ...s };
        delete next[tabId];
        return next;
      });
      return remaining;
    });
  }, []);

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

        {/* Auth modal (signup / login) */}
        {showAuthModal && (
          <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.82)",
                backdropFilter: "blur(12px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 50,
              }}
            onClick={() => setShowAuthModal(false)}
          >
            <div
              style={{
                width: 520,
                maxWidth: "96vw",
                background: "#050505",
                borderRadius: 8,
                border: "1px solid rgba(148,163,184,0.35)",
                padding: "40px 40px 32px",
                boxShadow: "0 32px 80px rgba(0,0,0,0.85)",
                position: "relative",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  position: "absolute",
                  top: 22,
                  left: 40,
                  width: 6,
                  height: 6,
                  borderRadius: "999px",
                  background: "#c8f135",
                }}
              />
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
                      fontFamily: '"DM Mono", monospace',
                      fontSize: 10,
                      letterSpacing: "0.24em",
                      textTransform: "uppercase",
                      color: "#c8f135",
                    }}
                  >
                    LITTLELABS
                  </div>
                  <div
                    style={{
                      fontFamily: '"Bebas Neue", sans-serif',
                      fontSize: 40,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "#f9fafb",
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
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: 13,
                      color: "#9ca3af",
                    }}
                  >
                    {authMode === "reset"
                      ? "Enter your new password below."
                      : authMode === "signup"
                        ? "Free forever for personal projects."
                        : "Sign in to your workspace."}
                  </div>
                </div>
                <button
                  onClick={() => setShowAuthModal(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#9ca3af",
                    cursor: "pointer",
                    fontSize: 18,
                  }}
                >
                  ×
                </button>
              </div>

              {authMode !== "reset" && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 24,
                  fontSize: 12,
                }}
              >
                <button
                  onClick={() => {
                    setSignupPendingConfirmation(false);
                    setAuthMode("signup");
                  }}
                  style={{
                    flex: 1,
                    padding: "8px 0",
                    borderRadius: 0,
                    border: "none",
                    cursor: "pointer",
                    borderBottom:
                      authMode === "signup"
                        ? "2px solid #c8f135"
                        : "1px solid rgba(55,65,81,0.9)",
                    background: "transparent",
                    color: authMode === "signup" ? "#f9fafb" : "#6b7280",
                    fontFamily: '"DM Mono", monospace',
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
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
                    padding: "8px 0",
                    borderRadius: 0,
                    border: "none",
                    cursor: "pointer",
                    borderBottom:
                      authMode === "signin"
                        ? "2px solid #c8f135"
                        : "1px solid rgba(55,65,81,0.9)",
                    background: "transparent",
                    color: authMode === "signin" ? "#f9fafb" : "#6b7280",
                    fontFamily: '"DM Mono", monospace',
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                  }}
                >
                  Sign in
                </button>
              </div>
              )}

              {supabaseConfigError && (
                <div
                  style={{
                    padding: 10,
                    border: "1px solid rgba(248,113,113,0.7)",
                    background: "rgba(127,29,29,0.25)",
                    color: "#fecaca",
                    fontSize: 12,
                    borderRadius: 6,
                    marginBottom: 14,
                  }}
                >
                  {supabaseConfigError}
                </div>
              )}
              {authMessage && (
                <div
                  style={{
                    padding: 10,
                    border: "1px solid rgba(74,222,128,0.7)",
                    background: "rgba(22,163,74,0.25)",
                    color: "#bbf7d0",
                    fontSize: 12,
                    borderRadius: 6,
                    marginBottom: 14,
                  }}
                >
                  {authMessage}
                </div>
              )}
              {authError && (
                <div
                  style={{
                    padding: 10,
                    border: "1px solid rgba(248,113,113,0.7)",
                    background: "rgba(127,29,29,0.25)",
                    color: "#fecaca",
                    fontSize: 12,
                    borderRadius: 6,
                    marginBottom: 14,
                  }}
                >
                  {authError}
                </div>
              )}

              {authMode === "reset" ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <input
                      type="password"
                      placeholder="New password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      style={{
                        padding: "12px 12px",
                        background: "#050505",
                        border: "1px solid #4b5563",
                        borderRadius: 2,
                        color: "#f9fafb",
                        fontSize: 13,
                        outline: "none",
                      }}
                    />
                    <input
                      type="password"
                      placeholder="Confirm new password"
                      value={authConfirmPassword}
                      onChange={(e) => setAuthConfirmPassword(e.target.value)}
                      style={{
                        padding: "12px 12px",
                        background: "#050505",
                        border: "1px solid #4b5563",
                        borderRadius: 2,
                        color: "#f9fafb",
                        fontSize: 13,
                        outline: "none",
                      }}
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
                      width: "100%",
                      marginTop: 18,
                      padding: "13px 16px",
                      borderRadius: 0,
                      border: "none",
                      cursor: "pointer",
                      background:
                        "linear-gradient(135deg, #c8f135 0%, #d9ff4a 45%, #c8f135 100%)",
                      color: "#111827",
                      fontWeight: 600,
                      fontSize: 14,
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
                      padding: 14,
                      border: "1px solid rgba(74,222,128,0.7)",
                      background: "rgba(22,163,74,0.15)",
                      color: "#bbf7d0",
                      fontSize: 14,
                      borderRadius: 6,
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>Thank you! Your account was created.</div>
                    <div style={{ color: "#9ca3af", marginBottom: 6 }}>
                      We sent a confirmation link to <strong style={{ color: "#e5e7eb" }}>{authEmail}</strong>.
                    </div>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>
                      Click the link in the email to activate your account, then sign in.
                    </div>
                  </div>
                  <button
                    onClick={() => window.open("https://mail.google.com", "_blank")}
                    style={{
                      width: "100%",
                      padding: "13px 16px",
                      borderRadius: 0,
                      border: "1px solid #4b5563",
                      cursor: "pointer",
                      background: "transparent",
                      color: "#c8f135",
                      fontWeight: 600,
                      fontSize: 14,
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
                      borderRadius: 0,
                      border: "none",
                      cursor: "pointer",
                      background: "rgba(75,85,99,0.3)",
                      color: "#9ca3af",
                      fontSize: 13,
                    }}
                  >
                    Back to sign in
                  </button>
                </div>
              ) : authMode === "signup" ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <input
                      type="text"
                      placeholder="First name"
                      value={signupFirstName}
                      onChange={(e) => setSignupFirstName(e.target.value)}
                      style={{
                        padding: "12px 12px",
                        background: "#050505",
                        border: "1px solid #4b5563",
                        borderRadius: 2,
                        color: "#f9fafb",
                        fontSize: 13,
                        outline: "none",
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Last name"
                      value={signupLastName}
                      onChange={(e) => setSignupLastName(e.target.value)}
                      style={{
                        padding: "12px 12px",
                        background: "#050505",
                        border: "1px solid #4b5563",
                        borderRadius: 2,
                        color: "#f9fafb",
                        fontSize: 13,
                        outline: "none",
                      }}
                    />
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span
                        style={{
                          color: "#9ca3af",
                          fontSize: 13,
                          padding: "0 4px",
                        }}
                      >
                        @
                      </span>
                      <input
                        type="text"
                        placeholder="nickname"
                        value={signupNickname}
                        onChange={(e) => {
                          const raw = e.target.value.trim().replace(/^@+/, "");
                          setSignupNickname(raw);
                        }}
                        style={{
                          flex: 1,
                          padding: "12px 12px",
                          background: "#050505",
                          border: "1px solid #4b5563",
                          borderRadius: 2,
                          color: "#f9fafb",
                          fontSize: 13,
                          outline: "none",
                        }}
                      />
                    </div>
                    <input
                      type="email"
                      placeholder="Email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      style={{
                        padding: "12px 12px",
                        background: "#050505",
                        border: "1px solid #4b5563",
                        borderRadius: 2,
                        color: "#f9fafb",
                        fontSize: 13,
                        outline: "none",
                      }}
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      style={{
                        padding: "12px 12px",
                        background: "#050505",
                        border: "1px solid #4b5563",
                        borderRadius: 2,
                        color: "#f9fafb",
                        fontSize: 13,
                        outline: "none",
                      }}
                    />
                    <input
                      type="password"
                      placeholder="Confirm password"
                      value={authConfirmPassword}
                      onChange={(e) => setAuthConfirmPassword(e.target.value)}
                      style={{
                        padding: "12px 12px",
                        background: "#050505",
                        border: "1px solid #4b5563",
                        borderRadius: 2,
                        color: "#f9fafb",
                        fontSize: 13,
                        outline: "none",
                      }}
                    />
                    <div style={{ marginTop: 8, fontSize: 13, color: "#9ca3af" }}>
                      During signup, would you like to connect existing GitHub repositories?
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        marginTop: 4,
                        marginBottom: 4,
                      }}
                    >
                      <button
                        onClick={() => setSignupHasRepos("yes")}
                        style={{
                          flex: 1,
                          padding: "6px 0",
                          borderRadius: 999,
                          border: "1px solid #4b5563",
                          cursor: "pointer",
                          background:
                            signupHasRepos === "yes"
                              ? "rgba(200,241,53,0.18)"
                              : "transparent",
                          color:
                            signupHasRepos === "yes" ? "#e5ff7a" : "#e5e7eb",
                          fontSize: 12,
                        }}
                      >
                        I have repos
                      </button>
                      <button
                        onClick={() => setSignupHasRepos("no")}
                        style={{
                          flex: 1,
                          padding: "6px 0",
                          borderRadius: 999,
                          border: "1px solid #4b5563",
                          cursor: "pointer",
                          background:
                            signupHasRepos === "no"
                              ? "rgba(31,41,55,0.9)"
                              : "transparent",
                          color:
                            signupHasRepos === "no" ? "#f9fafb" : "#e5e7eb",
                          fontSize: 12,
                        }}
                      >
                        I’m starting from scratch
                      </button>
                    </div>
                    {signupHasRepos === "yes" && (
                      <>
                        <label
                          style={{
                            fontSize: 12,
                            color: "#9ca3af",
                            marginTop: 4,
                          }}
                        >
                          Paste one or more GitHub repo URLs (one per line)
                        </label>
                        <textarea
                          value={signupRepos}
                          onChange={(e) => setSignupRepos(e.target.value)}
                          rows={3}
                          style={{
                            width: "100%",
                            padding: 10,
                            background: "#050505",
                            border: "1px solid #4b5563",
                            borderRadius: 2,
                            color: "#f9fafb",
                            fontSize: 12,
                            outline: "none",
                            resize: "vertical",
                          }}
                        />
                      </>
                    )}
                    {signupHasRepos === "no" && (
                      <p
                        style={{
                          fontSize: 12,
                          color: "#9ca3af",
                          marginTop: 4,
                        }}
                      >
                        We’ll start you in a blank workspace where the AI can propose
                        architecture nodes and connections before you create a repo.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      setAuthError(null);
                      setAuthMessage(null);
                      if (!supabase) {
                        setAuthError("Supabase is not configured.");
                        return;
                      }
                      if (!signupFirstName.trim()) {
                        setAuthError("First name is required.");
                        return;
                      }
                      if (!signupLastName.trim()) {
                        setAuthError("Last name is required.");
                        return;
                      }
                      if (!signupNickname.trim()) {
                        setAuthError("Nickname is required.");
                        return;
                      }
                      if (!authEmail.trim()) {
                        setAuthError("Email is required.");
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
                        const nicknameClean = signupNickname.trim().replace(/^@+/, "");
                        // Optional client-side format check; backend uniqueness is enforced via DB constraint.
                        if (!/^[a-zA-Z0-9_]+$/.test(nicknameClean)) {
                          throw new Error(
                            "Nickname can only contain letters, numbers, and underscores."
                          );
                        }

                        // Mark that a confirmation redirect is expected. Survives page reload (unlike React state).
                        sessionStorage.setItem("ll_post_confirm", "true");
                        const { data, error } = await supabase.auth.signUp({
                          email: authEmail.trim(),
                          password: authPassword,
                          options: {
                            emailRedirectTo: window.location.origin,
                            data: {
                              first_name: signupFirstName.trim(),
                              last_name: signupLastName.trim(),
                              nickname: nicknameClean,
                            },
                          },
                        });
                        if (error) {
                          sessionStorage.removeItem("ll_post_confirm");
                          throw error;
                        }

                        // If email confirmations are enabled, session may be null.
                        const token = data.session?.access_token ?? null;
                        if (!token) {
                          setAuthError(null);
                          setAuthMessage(null);
                          setSignupPendingConfirmation(true);
                          setAuthBusy(false);
                          return;
                        }

                        // Create profile row with unique @nickname; relies on unique constraint in public.profiles.
                        try {
                          const userId = data.user?.id;
                          if (userId) {
                            const { error: profileError } = await supabase
                              .from("profiles")
                              .insert({
                                user_id: userId,
                                first_name: signupFirstName.trim(),
                                last_name: signupLastName.trim(),
                                nickname: nicknameClean,
                              });
                            if (profileError) {
                              if (
                                // Postgres unique violation
                                (profileError as any).code === "23505" ||
                                /duplicate key value/i.test(profileError.message)
                              ) {
                                throw new Error("That nickname is already taken. Try another.");
                              }
                              throw profileError;
                            }
                          }
                        } catch (profileErr: any) {
                          setAuthError(
                            profileErr?.message
                              ? String(profileErr.message)
                              : "Could not save profile. Try a different nickname."
                          );
                          setAuthMessage(null);
                          setAuthBusy(false);
                          return;
                        }

                        // Now continue onboarding actions (repo import or greenfield).
                        if (signupHasRepos === "yes" && signupRepos.trim()) {
                          const firstUrl =
                            signupRepos
                              .split(/\s+/)
                              .map((s) => s.trim())
                              .filter(Boolean)[0] ?? "";
                          if (firstUrl) {
                            setRepoUrl(firstUrl);
                            await scanRepo(firstUrl);
                            setShowAuthModal(false);
                            return;
                          }
                        }
                        if (signupHasRepos === "no") {
                          const name =
                            `${signupFirstName.trim()} ${signupLastName.trim()}`.trim() ||
                            "New LittleLabs workspace";
                          const emptyGraph: ArchGraph = {
                            nodes: [],
                            edges: [],
                            generatedAt: Date.now(),
                            projectRoot: "",
                            projectName: name,
                          };
                          setGraph(emptyGraph);
                          setError(null);
                        }
                        setAuthMessage(null);
                        setShowAuthModal(false);
                      } catch (e: any) {
                        setAuthError(e?.message ? String(e.message) : String(e));
                        setAuthMessage(null);
                      } finally {
                        setAuthBusy(false);
                      }
                    }}
                    style={{
                      width: "100%",
                      marginTop: 18,
                      padding: "13px 16px",
                      borderRadius: 0,
                      border: "none",
                      cursor: "pointer",
                      background:
                        "linear-gradient(135deg, #c8f135 0%, #d9ff4a 45%, #c8f135 100%)",
                      color: "#111827",
                      fontWeight: 600,
                      fontSize: 14,
                      opacity: authBusy ? 0.7 : 1,
                    }}
                    disabled={authBusy || !!supabaseConfigError}
                  >
                    Create account →
                  </button>
                  <div style={{ marginTop: 18 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        margin: "22px 0",
                        color: "rgba(245,243,238,0.42)",
                        fontFamily: '"DM Mono", monospace',
                        fontSize: 9,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                      }}
                    >
                      <div style={{ flex: 1, height: 1, background: "rgba(245,243,238,0.10)" }} />
                      <span>or</span>
                      <div style={{ flex: 1, height: 1, background: "rgba(245,243,238,0.10)" }} />
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
                        width: "100%",
                        padding: "13px",
                        background: "transparent",
                        border: "1px solid rgba(245,243,238,0.10)",
                        color: "#f9fafb",
                        cursor: "pointer",
                        fontFamily: '"DM Mono", monospace',
                        fontSize: 10,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                      }}
                      disabled={authBusy || !!supabaseConfigError}
                    >
                      Sign up with GitHub
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <input
                      type="email"
                      placeholder="Email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      style={{
                        padding: "12px 12px",
                        background: "#050505",
                        border: "1px solid #4b5563",
                        borderRadius: 2,
                        color: "#f9fafb",
                        fontSize: 13,
                        outline: "none",
                      }}
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      style={{
                        padding: "12px 12px",
                        background: "#050505",
                        border: "1px solid #4b5563",
                        borderRadius: 2,
                        color: "#f9fafb",
                        fontSize: 13,
                        outline: "none",
                      }}
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
                          fontSize: 11,
                          color: "#9ca3af",
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
                      width: "100%",
                      marginTop: 18,
                      padding: "13px 16px",
                      borderRadius: 0,
                      border: "none",
                      cursor: "pointer",
                      background:
                        "linear-gradient(135deg, #c8f135 0%, #d9ff4a 45%, #c8f135 100%)",
                      color: "#111827",
                      fontWeight: 600,
                      fontSize: 14,
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
                      margin: "22px 0",
                      color: "rgba(245,243,238,0.42)",
                      fontFamily: '"DM Mono", monospace',
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                    }}
                  >
                    <div style={{ flex: 1, height: 1, background: "rgba(245,243,238,0.10)" }} />
                    <span>or</span>
                    <div style={{ flex: 1, height: 1, background: "rgba(245,243,238,0.10)" }} />
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
                      width: "100%",
                      padding: "13px",
                      background: "transparent",
                      border: "1px solid rgba(245,243,238,0.10)",
                      color: "#f9fafb",
                      cursor: "pointer",
                      fontFamily: '"DM Mono", monospace',
                      fontSize: 10,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                    }}
                    disabled={authBusy || !!supabaseConfigError}
                  >
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
      <div
        className="landing-page"
        style={{
          minHeight: "100vh",
          backgroundColor: "#000000",
          color: "#000000",
          position: "relative",
          overflow: "hidden",
          fontFamily:
            '"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        }}
      >
        <style>{`
          .landing-page .landing-header {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 10;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 30px 52px;
            flex-wrap: wrap;
            gap: 12px;
            box-sizing: border-box;
          }
          @media (max-width: 768px) {
            .landing-page .landing-header {
              padding: 16px 20px;
            }
            .landing-page .landing-nav ul {
              flex-wrap: wrap;
              justify-content: flex-end;
            }
            .landing-page .landing-scan-card {
              left: 16px !important;
              bottom: 16px !important;
              right: 16px !important;
              width: auto !important;
              max-width: none !important;
            }
          }
          @media (max-width: 480px) {
            .landing-page .landing-header {
              padding: 12px 16px;
            }
          }
        `}</style>
        <LittleLabsCursor />
        <LittleLabsScene />

        {/* Title + nav overlay (LittleLabs, based on Daniel Muñoz layout) */}
        {/* Nav + hero (LittleLabs) */}
        <header
          className="landing-header"
          style={{
            fontFamily: '"DM Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}
        >
          <div
            style={{
              fontFamily: '"Bebas Neue", sans-serif',
              fontSize: 24,
              letterSpacing: "0.24em",
          display: "flex",
          alignItems: "center",
              color: "#000000",
            }}
          >
            LITTLELABS
          </div>
          <nav className="landing-nav">
            <ul
              className="landing-nav-ul"
              style={{
                display: "flex",
                gap: 0,
                alignItems: "center",
                listStyle: "none",
                fontFamily: '"DM Mono", monospace',
                fontSize: 10.5,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              }}
            >
              <li>
                <button
                  data-ll-interactive="true"
                  style={{
                    background: "none",
                    border: "none",
                    padding: "8px 20px",
                    color: "rgba(245,243,238,0.42)",
                    cursor: "pointer",
                  }}
                >
                  Home
                </button>
              </li>
              <li>
                <button
                  data-ll-interactive="true"
                  style={{
                    background: "none",
                    border: "none",
                    padding: "8px 20px",
                    color: "rgba(245,243,238,0.42)",
                    cursor: "pointer",
                  }}
                >
                  About
                </button>
              </li>
              <li>
                <button
                  data-ll-interactive="true"
                  onMouseEnter={() => setLoginHover(true)}
                  onMouseLeave={() => setLoginHover(false)}
                  onClick={() => {
                    setAuthMode("signin");
                    setShowAuthModal(true);
                  }}
                  style={{
                    background: loginHover ? "#c8f135" : "rgba(245,243,238,0.96)",
                    color: "#070707",
                    border: `1px solid #c8f135`,
                    borderRadius: 999,
                    padding: "8px 20px",
                    marginLeft: 8,
                    cursor: "pointer",
                    transition: "background 0.2s, color 0.2s, transform 0.15s",
                  }}
                >
                  Sign in
                </button>
              </li>
              <li>
                <button
                  data-ll-interactive="true"
                  onMouseEnter={() => setCtaHover(true)}
                  onMouseLeave={() => setCtaHover(false)}
                  onClick={() => {
                    setAuthMode("signup");
                    setShowAuthModal(true);
                  }}
                  style={{
                    background: "#c8f135",
                    color: "#070707",
                    border: "none",
                    borderRadius: 999,
                    padding: "10px 24px",
                    marginLeft: 8,
                    cursor: "pointer",
                    fontWeight: 500,
                    transition: "opacity 0.2s, transform 0.15s",
                    opacity: ctaHover ? 0.85 : 1,
                    transform: ctaHover ? "translateY(-1px)" : "none",
                  }}
                >
                  Get started
                </button>
              </li>
            </ul>
          </nav>
        </header>

        {/* Center hero text */}
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            textAlign: "center",
            pointerEvents: "none",
            color: "#f5f3ee",
            paddingTop: "18vh",
          }}
        >
          <DesignTicker />
        </div>

        {/* Quick GitHub scan input anchored bottom-left, responsive */}
        <div
          className="landing-scan-card"
          style={{
            position: "absolute",
            left: 40,
            bottom: 40,
            zIndex: 2,
            width: 360,
            maxWidth: "90vw",
            backgroundColor: "#ffffff",
            borderRadius: 12,
            border: "1px solid rgba(15,23,42,0.08)",
            padding: 16,
            color: "#111827",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
            boxSizing: "border-box",
            boxShadow: "0 18px 40px rgba(15,23,42,0.35)",
          }}
        >
          <div
            style={{
              height: 3,
              borderRadius: "8px 8px 0 0",
              background: "#c8f135",
              margin: "-16px -16px 12px",
            }}
          />
          <div
            style={{
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "#6b7280",
              marginBottom: 6,
            }}
          >
            Scan a GitHub repository
          </div>
          <input
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            style={{
              width: "100%",
              padding: "10px 14px",
              fontSize: 13,
              background: "#ffffff",
              border: "1px solid rgba(209,213,219,1)",
              borderRadius: 8,
              color: "#111827",
              marginBottom: 10,
              outline: "none",
              boxSizing: "border-box",
            }}
            onKeyDown={(e) => e.key === "Enter" && handleScan()}
          />
          {error && (
            <div
              style={{
                padding: 8,
                marginBottom: 8,
                background: "#fef2f2",
                border: "1px solid #f87171",
                borderRadius: 8,
                color: "#b91c1c",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
          <button
            onClick={handleScan}
            disabled={authLoading}
            style={{
              width: "100%",
              padding: "10px 16px",
              background: authLoading ? "#d4d4d8" : "#c8f135",
              color: "#111827",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              cursor: authLoading ? "wait" : "pointer",
              fontWeight: 600,
              opacity: authLoading ? 0.7 : 1,
            }}
          >
            Scan repository →
          </button>
        </div>

        {renderGlobalOverlays()}
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0d1117",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          color: "#7d8590",
        }}
      >
        <div style={{ fontSize: 18 }}>⟳ {loading}</div>
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
      <div style={{ display: "flex", width: "100vw", height: "100vh", minWidth: 0 }}>
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
          <div>
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
                { key: "code", label: "Code", short: "<>" },
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
                  border: sidebarTab === (t.key as any) ? "1px solid #58a6ff" : "1px solid #30363d",
                  background: sidebarTab === (t.key as any) ? "#1f2937" : "transparent",
                  color: sidebarTab === (t.key as any) ? "#e6edf3" : "#8b949e",
                  cursor: "pointer",
                }}
              >
                {t.short}
              </button>
            ))}
          </div>
        ) : graph!.nodes.length === 0 && !graph!.projectRoot ? (
          <div style={{ marginBottom: 12 }}>
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
                background: authLoading ? "#374151" : "#238636",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 12,
                cursor: authLoading ? "wait" : "pointer",
                fontWeight: 600,
                opacity: authLoading ? 0.7 : 1,
              }}
            >
              Scan repository
            </button>
          </div>
        ) : (
        <div
          style={{
            fontSize: 12,
            color: "#58a6ff",
            wordBreak: "break-all",
            marginBottom: 12,
          }}
        >
          {repoUrl}
        </div>
        )}

        {/* Sidebar tabs: Dashboard / Chat / Code */}
        <div
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 8,
            marginTop: 4,
          }}
        >
          <button
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
                  ? "1px solid #58a6ff"
                  : "1px solid #30363d",
              background:
                sidebarTab === "dashboard" ? "#1f2937" : "#161b22",
              color: sidebarTab === "dashboard" ? "#e6edf3" : "#8b949e",
              cursor: "pointer",
              position: "relative",
            }}
          >
            Dashboard
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
                  ? "1px solid #58a6ff"
                  : "1px solid #30363d",
              background: sidebarTab === "chat" ? "#1f2937" : "#161b22",
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
                  ? "1px solid #58a6ff"
                  : "1px solid #30363d",
              background: sidebarTab === "code" ? "#1f2937" : "#161b22",
              color: sidebarTab === "code" ? "#e6edf3" : "#8b949e",
              cursor: "pointer",
            }}
          >
            Code
          </button>
        </div>

        {/* Dashboard content: project overview, health, execution, violations, governance, proposed nodes */}
        {sidebarTab === "dashboard" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.1fr)",
              gap: 12,
            }}
          >
            {/* Agents Found — replaces System Overview / Health & Risk */}
            <div style={{ gridColumn: "1 / span 2" }}>
              <DashboardCard
                title="Agents Found"
                rightHeaderContent={
                  <span style={{ fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 11, color: "#8b949e" }}>
                    {(graph?.agents?.agents ?? []).length} surface{(graph?.agents?.agents ?? []).length === 1 ? "" : "s"}
                    {" · "}
                    {graph!.nodes.length} modules
                    {" · "}
                    {graph!.edges.length} connections
                  </span>
                }
              >
                {(graph?.agents?.agents ?? []).length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "#8b949e", lineHeight: 1.55 }}>
                    <div style={{ color: "#e6edf3", marginBottom: 8 }}>
                      No agent surfaces found in this repository.
                    </div>
                    <div style={{ fontSize: 11, color: "#6e7681", marginBottom: 6 }}>
                      Searched for:
                    </div>
                    <div
                      style={{
                        fontFamily: "JetBrains Mono, ui-monospace, monospace",
                        fontSize: 11,
                        color: "#8b949e",
                        lineHeight: 1.6,
                      }}
                    >
                      {(graph?.agents?.searchedFor?.length
                        ? graph.agents.searchedFor
                        : [
                            "openai",
                            "@anthropic-ai/sdk",
                            "groq-sdk",
                            "retell-ai",
                            "api.openai.com",
                            "api.anthropic.com",
                            "api.groq.com",
                            "api.retellai.com",
                          ]
                      ).join(" · ")}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {(graph?.agents?.agents ?? []).map((a) => {
                      const selected = selectedAgentFile === a.file;
                      const base = a.file.split("/").pop() ?? a.file;
                      return (
                        <button
                          key={a.file}
                          type="button"
                          onClick={() =>
                            setSelectedAgentFile((prev) =>
                              prev === a.file ? null : a.file
                            )
                          }
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1.4fr) 88px minmax(0, 1fr) minmax(0, 1fr) 36px",
                            gap: 8,
                            alignItems: "center",
                            width: "100%",
                            textAlign: "left",
                            background: selected ? "rgba(88,166,255,0.1)" : "transparent",
                            border: "0",
                            borderBottom: "1px solid #22272e",
                            borderLeft: selected
                              ? "2px solid #58a6ff"
                              : "2px solid transparent",
                            padding: "8px 6px",
                            cursor: "pointer",
                            color: "#e6edf3",
                          }}
                          title={a.evidence}
                        >
                          <span
                            style={{
                              fontFamily: "JetBrains Mono, ui-monospace, monospace",
                              fontSize: 11.5,
                              color: selected ? "#58a6ff" : "#e6edf3",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={a.file}
                          >
                            {base}
                          </span>
                          <span
                            style={{
                              fontFamily: "JetBrains Mono, ui-monospace, monospace",
                              fontSize: 11,
                              color: "#8b949e",
                            }}
                          >
                            {a.provider}
                          </span>
                          <span style={{ fontSize: 11.5, color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {a.model ?? "model not determinable"}
                          </span>
                          <span style={{ fontSize: 11.5, color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {a.toolCandidates.length > 0
                              ? `${a.toolCandidates.length} tool${a.toolCandidates.length === 1 ? "" : "s"}`
                              : "tools not declared in repo"}
                          </span>
                          <span
                            style={{
                              fontFamily: "JetBrains Mono, ui-monospace, monospace",
                              fontSize: 10,
                              color: a.confidence === "low" ? "#d29922" : "#3fb950",
                              textAlign: "right",
                            }}
                            title={a.confidence === "low" ? "Low confidence — import/URL only" : "High confidence — construction + provider"}
                          >
                            {a.confidence === "low" ? "low" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </DashboardCard>
            </div>

            {/* Not scanned — Python agent frameworks invisible to the JS/TS graph */}
            {(graph?.agents?.pythonAgents?.length ?? 0) > 0 && (
              <div style={{ gridColumn: "1 / span 2" }}>
                <DashboardCard title="Not Scanned">
                  <div style={{ fontSize: 12.5, color: "#e6edf3", lineHeight: 1.55, marginBottom: 10 }}>
                    {graph!.agents!.pythonAgents.length} Python file
                    {graph!.agents!.pythonAgents.length === 1 ? "" : "s"} import an agent
                    framework and are not in the graph.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {graph!.agents!.pythonAgents.map((p) => (
                      <div
                        key={p}
                        style={{
                          fontFamily: "JetBrains Mono, ui-monospace, monospace",
                          fontSize: 11.5,
                          color: "#f85149",
                          padding: "4px 0",
                          borderBottom: "1px solid #22272e",
                        }}
                      >
                        {p}
                      </div>
                    ))}
                  </div>
                </DashboardCard>
              </div>
            )}

            {/* Agent Tasks (full width) */}
            {tasksForWorkspace.filter((t) => t.dismissed !== true).length > 0 && (
              <div style={{ gridColumn: "1 / span 2" }}>
                <DashboardCard
                  title="Agent Tasks"
                  rightHeaderContent={(() => {
                    const wsTasks = tasksForWorkspace;
                    const running = wsTasks.filter((t) => t.status === "running").length;
                    const needsReview = wsTasks.filter((t) => t.status === "needs_review").length;
                    const completed = wsTasks.filter((t) => t.status === "completed").length;
                    if (wsTasks.length === 0) {
                      return (
                        <span style={{ fontSize: 10, color: "#6b7280" }}>
                          No tasks yet
                        </span>
                      );
                    }
                    return (
                      <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>
                        {running} running ·{" "}
                        <span style={{ color: needsReview > 0 ? "#f59e0b" : "#6b7280" }}>
                          {needsReview} needs review
                        </span>{" "}
                        · {completed} completed
                      </span>
                    );
                  })()}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {tasksForWorkspace
                      .filter((t) => t.dismissed !== true)
                      .slice()
                      .sort((a, b) => b.createdAt - a.createdAt)
                      .slice(0, 5)
                      .map((t) => {
                        const isAttention = t.status === "failed" || t.status === "needs_review";
                        const border = isAttention ? "1px solid rgba(245,158,11,0.6)" : "1px solid #30363d";
                        const bg = isAttention ? "rgba(245,158,11,0.06)" : "#111827";
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setSidebarTab("chat");
                              setActiveTaskId(t.id);
                              setBackgroundTasks((prev) =>
                                prev.map((x) =>
                                  x.id === t.id ? { ...x, reviewed: true } : x
                                )
                              );
                            }}
                            style={{
                              width: "100%",
                              padding: "6px 8px",
                              borderRadius: 6,
                              background: bg,
                              border,
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <span
                              style={{
                                padding: "2px 6px",
                                borderRadius: 999,
                                border: "1px solid #30363d",
                                fontSize: 9,
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                color: "#cbd5f5",
                              }}
                            >
                              {t.mode}
                            </span>
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: 11,
                                color: "#e5e7eb",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {t.label}
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                color:
                                  t.status === "running"
                                    ? "#60a5fa"
                                    : t.status === "completed"
                                      ? "#4ade80"
                                      : "#f59e0b",
                              }}
                            >
                              {t.status === "needs_review" ? "needs review" : t.status}
                            </span>
                            {t.retryAttempt != null && t.retryMax != null && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontFamily: "monospace",
                                  color: (t.retryAttempt ?? 0) >= 2 ? "#f85149" : "#7d8590",
                                }}
                              >
                                {t.retryAttempt}/{t.retryMax}
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                </DashboardCard>
              </div>
            )}

            {/* Architecture */}
            <DashboardCard title="Architecture">
              <div style={{ marginBottom: selectedNode ? 8 : 0 }}>
                <div style={{ fontSize: 10, color: "#7d8590", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Edges</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {(
                    [
                      { v: "all" as const, l: "All" },
                      { v: "architectural" as const, l: "Arch" },
                      { v: "violations" as const, l: "Violations" },
                      { v: "drift" as const, l: "Drift" },
                    ] as const
                  ).map(({ v, l }) => {
                    const isActive =
                      v === "all"
                        ? activeFilters.has("all") || activeFilters.size === 0
                        : activeFilters.has(v);
                    return (
                      <button
                        key={v}
                        onClick={() => toggleFilter(v)}
                        style={{
                          padding: "4px 8px",
                          fontSize: 10,
                          background: isActive ? "#238636" : "#21262d",
                          color: isActive ? "white" : "#7d8590",
                          border: `1px solid ${isActive ? "#238636" : "#30363d"}`,
                          borderRadius: 6,
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        {l}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 10, color: "#7d8590", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Nodes</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {(
                    [
                      { v: "all" as const, l: "All" },
                      { v: "core" as const, l: "Core" },
                      { v: "databases" as const, l: "DBs" },
                      { v: "queues" as const, l: "Queues" },
                      { v: "utilities" as const, l: "Utils" },
                      { v: "external" as const, l: "External" },
                    ] as const
                  ).map(({ v, l }) => {
                    const isActive =
                      v === "all"
                        ? activeNodeFilters.has("all") || activeNodeFilters.size === 0
                        : activeNodeFilters.has(v);
                    return (
                      <button
                        key={v}
                        onClick={() => toggleNodeFilter(v)}
                        style={{
                          padding: "4px 8px",
                          fontSize: 10,
                          background: isActive ? "#238636" : "#21262d",
                          color: isActive ? "white" : "#7d8590",
                          border: `1px solid ${isActive ? "#238636" : "#30363d"}`,
                          borderRadius: 6,
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        {l}
                      </button>
                    );
                  })}
                </div>
                {selectedNode && (
                  <div
                    style={{
                      padding: "6px 8px",
                      background: "rgba(34,197,94,0.12)",
                      border: "1px solid #22c55e44",
                      borderRadius: 6,
                      fontSize: 11,
                      color: "#22c55e",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span>Focus:</span>
                    <span style={{ fontWeight: 600 }} title={selectedNode}>
                      {selectedNode}
                    </span>
                    <button
                      onClick={() => setSelectedNode(null)}
                      style={{
                        marginLeft: "auto",
                        padding: "2px 6px",
                        fontSize: 10,
                        background: "transparent",
                        color: "#7d8590",
                        border: "1px solid #30363d",
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                    >
                      Clear
                    </button>
                  </div>
                )}
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #21262d" }}>
                  <div style={{ fontSize: 10, color: "#7d8590", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                    Supply chain
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setShowSupplyChainRisk((v) => !v)}
                      style={{
                        padding: "4px 8px",
                        fontSize: 10,
                        background: showSupplyChainRisk ? "#b45309" : "#21262d",
                        color: showSupplyChainRisk ? "white" : "#7d8590",
                        border: `1px solid ${showSupplyChainRisk ? "#b45309" : "#30363d"}`,
                        borderRadius: 6,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      Risks
                    </button>
                    <button
                      type="button"
                      onClick={runNpmAudit}
                      disabled={!activeWorkspaceId || npmAuditRunning}
                      style={{
                        padding: "4px 8px",
                        fontSize: 10,
                        background: "#21262d",
                        color: npmAuditRunning ? "#6b7280" : "#7d8590",
                        border: "1px solid #30363d",
                        borderRadius: 6,
                        cursor: activeWorkspaceId && !npmAuditRunning ? "pointer" : "not-allowed",
                        flexShrink: 0,
                      }}
                    >
                      {npmAuditRunning ? "Running…" : "npm audit"}
                    </button>
                  </div>
                  {showSupplyChainRisk && vulnerableNodeIds && vulnerableNodeIds.size > 0 && (
                    <div style={{ marginTop: 6, fontSize: 10, color: "#f59e0b" }}>
                      {vulnerableNodeIds.size} node{vulnerableNodeIds.size !== 1 ? "s" : ""} with risky deps
                    </div>
                  )}
                </div>
              </div>
            </DashboardCard>

            {/* Violations */}
            <DashboardCard title="Violations">
              <div
                style={{
                  background: activeViolations.length > 0 ? "transparent" : "#161b22",
                  borderRadius: 8,
                  border: activeViolations.length > 0 ? "1px solid #f8514944" : "1px solid #30363d",
                  flexShrink: 0,
                }}
              >
                <div
                  onClick={() => activeViolations.length > 0 && setViolationsCollapsed((v) => !v)}
                  style={{
                    padding: "8px 12px",
                    cursor: activeViolations.length > 0 ? "pointer" : "default",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    userSelect: "none",
                  }}
                >
                  <span style={{ fontSize: 11, color: activeViolations.length > 0 ? "#f85149" : "#7d8590", textTransform: "uppercase", letterSpacing: 1 }}>
                    Active violations
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {activeViolations.length > 0 ? (
                      <>
                        <span style={{
                          fontSize: 9,
                          padding: "1px 6px",
                          borderRadius: 9,
                          background: "#f8514922",
                          color: "#f85149",
                          fontWeight: 700,
                        }}>
                          {activeViolations.length}
                        </span>
                        <span style={{ fontSize: 10, color: "#7d8590" }}>
                          {violationsCollapsed ? "▸" : "▾"}
                        </span>
                      </>
                    ) : (
                      <span style={{ fontSize: 10, color: "#7d8590" }}>0</span>
                    )}
                  </div>
                </div>
                {violationsRestoreError && (
                  <div
                    style={{
                      padding: "6px 12px",
                      margin: "0 12px 8px",
                      background: "rgba(248,81,73,0.12)",
                      border: "1px solid rgba(248,81,73,0.3)",
                      borderRadius: 6,
                      fontSize: 10,
                      color: "#f87171",
                    }}
                  >
                    Could not restore violations: {violationsRestoreError}
                  </div>
                )}
                {activeViolations.length === 0 && !violationsRestoreError ? (
                  <div style={{ padding: "8px 12px 12px", fontSize: 11, color: "#7d8590" }}>
                    No active violations. Ask the agent about your architecture to find issues.
                  </div>
                ) : activeViolations.length === 0 && violationsRestoreError ? (
                  <div style={{ padding: "8px 12px 12px", fontSize: 11, color: "#7d8590" }}>
                    Violations could not be loaded. Try refreshing the workspace.
                  </div>
                ) : !violationsCollapsed && (
                    <div
                      style={{
                        maxHeight: 220,
                        overflowY: "auto",
                        padding: "0 12px 12px",
                      }}
                    >
                      {[...activeViolations]
                        .sort((a, b) => {
                          const o = { critical: 0, high: 1, medium: 2, low: 3 };
                          return (o[a.severity as keyof typeof o] ?? 4) - (o[b.severity as keyof typeof o] ?? 4);
                        })
                        .map((v) => (
                          <div
                            key={violationKey(v)}
                            onClick={() => handleFocusViolation(v)}
                            style={{
                              padding: "8px 0",
                              borderBottom: "1px solid #21262d",
                              marginBottom: 6,
                              cursor: "pointer",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                marginBottom: 4,
                              }}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDismissViolation(v);
                                }}
                                style={{
                                  padding: 2,
                                  background: "none",
                                  border: "none",
                                  color: "#7d8590",
                                  cursor: "pointer",
                                  fontSize: 12,
                                  lineHeight: 1,
                                }}
                                title="Dismiss"
                              >
                                ✕
                              </button>
                              <span
                                style={{
                                  fontSize: 9,
                                  padding: "2px 6px",
                                  borderRadius: 3,
                                  fontWeight: 700,
                                  letterSpacing: "0.1em",
                                  textTransform: "uppercase",
                                  background:
                                    v.severity === "critical"
                                      ? "#f8514922"
                                      : v.severity === "high"
                                        ? "#f9731622"
                                        : "#eab30822",
                                  color:
                                    v.severity === "critical"
                                      ? "#f85149"
                                      : v.severity === "high"
                                        ? "#f97316"
                                        : "#eab308",
                                }}
                              >
                                {v.severity}
                              </span>
                              <span style={{ fontSize: 10, color: "#8b949e", flex: 1 }}>
                                {v.sourceNodeId}
                                {v.targetNodeId ? ` → ${v.targetNodeId}` : ""}
                              </span>
                              {v.jiraKey && (
                                <span
                                  style={{
                                    fontSize: 9,
                                    padding: "2px 6px",
                                    borderRadius: 3,
                                    background: "#1f6feb33",
                                    color: "#58a6ff",
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {v.jiraKey}
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#c9d1d9",
                                marginBottom: 6,
                                lineHeight: 1.4,
                              }}
                            >
                              {v.description}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
              </div>
            </DashboardCard>

          </div>
        )}

        {sidebarTab === "code" && (
          <CodeViewerPanel
            node={selectedNodeData ?? null}
            graph={effectiveGraph ?? null}
            selectedNodeId={selectedNode}
          />
        )}

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
            Agent
          </span>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              background: "rgba(59,130,246,0.16)",
              color: "#93c5fd",
              border: "1px solid rgba(59,130,246,0.4)",
            }}
          >
            Analysis
          </span>
          <button
            type="button"
            onClick={() => setShowThinkingPanel((v) => !v)}
            style={{
              marginLeft: "auto",
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid #374151",
              background: showThinkingPanel ? "#111827" : "transparent",
              color: "#9ca3af",
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
                  setActiveChatId(tab.id);
                  setActiveThreadId((tab as { threadId?: string }).threadId ?? null);
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
                          ? "#58a6ff"
                          : t.status === "completed"
                            ? "#3fb950"
                            : "#f59e0b";
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
                                color: t.status === "running" && (t.retryAttempt ?? 0) >= 2 ? "#f59e0b" : (t.retryAttempt ?? 0) >= 2 ? "#f85149" : "#7d8590",
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
                background: "#111827",
                border: "1px solid #1f2937",
                fontSize: 12,
                color: "#9ca3af",
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
                    color: "#6b7280",
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
                    color: "#6b7280",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Hide
                </button>
              </div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>
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
                background: "#111827",
                border: "1px solid #30363d",
                fontSize: 11,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: "#f59e0b",
                  marginBottom: 6,
                }}
              >
                Critic — score: {lastCriticResult.score}/10
              </div>
              <div style={{ color: "#9ca3af", marginBottom: 8, whiteSpace: "pre-wrap" }}>
                {lastCriticResult.report}
              </div>
              {lastCriticResult.violations.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 16, color: "#e5e7eb" }}>
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
                  color: "#6b7280",
                  border: "1px solid #374151",
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
                        color: "#9ca3af",
                      }}
                    >
                      {task.logicPath.map((step, i) => (
                        <span key={i}>
                          <span
                            style={{
                              color: task.currentStep === i ? "#58a6ff" : "#6b7280",
                              fontWeight: task.currentStep === i ? 600 : 400,
                            }}
                          >
                            {step}
                          </span>
                          {i < task.logicPath!.length - 1 && <span style={{ marginLeft: 4 }}>→</span>}
                        </span>
                      ))}
                      {(task.hallucinationIndex ?? 0) > 0.5 && (
                        <span style={{ marginLeft: 6, color: "#f59e0b" }}>⚠ drift</span>
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
                      color: "#94a3b8",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ color: "#e5e7eb", fontSize: 11, marginBottom: 4 }}>
                  <strong>Thinking</strong>
                </div>
                <div style={{ color: "#9ca3af", fontSize: 11, marginBottom: 4 }}>
                  {task.prompt ?? "No prompt available."}
                </div>
                {task.answerPreview && (
                  <div
                    style={{
                      color: "#6b7280",
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
                <div style={{ color: "#e5e7eb", fontSize: 11, marginBottom: 4 }}>
                  <strong>Exploring</strong>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#9ca3af", fontSize: 11, marginBottom: 6 }}>
                  {task.steps.map((s, idx) => {
                    const stepDone = task.totalSteps > 0 && task.currentStep > idx;
                    return (
                      <li
                        key={idx}
                        style={{
                          textDecoration: stepDone ? "line-through" : undefined,
                          color: stepDone ? "#6b7280" : "#9ca3af",
                        }}
                      >
                        {idx + 1}. {s}
                        {stepDone && " ✓"}
                      </li>
                    );
                  })}
                </ul>
                <div style={{ color: "#e5e7eb", fontSize: 11, marginBottom: 2 }}>
                  <strong>Progress</strong>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 4,
                      borderRadius: 999,
                      background: "#111827",
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
                        background: "#22c55e",
                        transition: "width 0.2s ease",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>
                    {task.totalSteps > 0
                      ? `${Math.min(task.currentStep, task.totalSteps)}/${task.totalSteps}`
                      : "0/0"}
                  </span>
                </div>
                {(task.retryAttempt != null || task.rejectionReason) && (
                  <div style={{ marginBottom: 8, padding: 8, background: "rgba(245,158,11,0.08)", borderRadius: 6, border: "1px solid rgba(245,158,11,0.3)" }}>
                    <div style={{ color: "#f59e0b", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                      Self-correcting
                    </div>
                    {task.retryAttempt != null && task.retryMax != null && (
                      <div style={{ fontSize: 10, color: "#e5e7eb", marginBottom: 4 }}>
                        Attempt {task.retryAttempt}/{task.retryMax}
                      </div>
                    )}
                    {task.rejectionReason && (
                      <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>
                        <strong>Rejection:</strong> {task.rejectionReason}
                      </div>
                    )}
                    {task.selfCorrectingChange && (
                      <div style={{ fontSize: 10, color: "#9ca3af" }}>
                        <strong>Changing:</strong> {task.selfCorrectingChange}
                      </div>
                    )}
                  </div>
                )}
                {(task.hallucinationIndex != null && task.hallucinationIndex > 0) && (
                  <div style={{ marginBottom: 8, padding: 8, background: "rgba(245,158,11,0.06)", borderRadius: 6, border: "1px solid rgba(245,158,11,0.2)" }}>
                    <div style={{ color: "#f59e0b", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                      Drift
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{ flex: 1, height: 6, background: "#111827", borderRadius: 999, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.min(100, task.hallucinationIndex! * 100)}%`,
                            height: "100%",
                            background: (task.hallucinationIndex ?? 0) > 0.5 ? "#f85149" : "#f59e0b",
                            transition: "width 0.2s",
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 10, fontFamily: "monospace", color: "#9ca3af" }}>
                        {(task.hallucinationIndex! * 100).toFixed(0)}%
                      </span>
                    </div>
                    {(task.hallucinationIndex ?? 0) > 0.5 && !task.hallucinationAcknowledged && (
                      <div style={{ fontSize: 10, color: "#f59e0b", marginBottom: 4 }}>
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
                          border: "1px solid #22c55e",
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
              const color = t.status === "failed" ? "#f85149" : "#f59e0b";
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
                Ask about your architecture, dependencies, or patterns.
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
                    border: m.role === "user" ? "1px solid #30363d" : isCritic ? "1px solid #f59e0b44" : "1px solid #30363d",
                    color: m.role === "user" ? "#e6edf3" : isCritic ? "#fbbf24" : "#c9d1d9",
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
                      color: isCritic ? "#f59e0b" : "#7d8590",
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
                          <span style={{ color: "#58a6ff", fontFamily: "monospace" }}>
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
                  {String(m.content ?? "").replace(
                    /(rail-[a-zA-Z0-9-]+)/g,
                    (match) => `[${match}](#rail:${match})`
                  )}
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
                                color: "#e5e7eb",
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
                            <span style={{ fontSize: 10, color: "#6b7280" }}>Feedback</span>
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
                                color: am.feedback === "up" ? "#4ade80" : "#9ca3af",
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
                                color: am.feedback === "down" ? "#f97373" : "#9ca3af",
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
                          <summary style={{ cursor: "pointer", color: "#9ca3af" }}>Show reasoning steps</summary>
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
                        <div style={{ marginTop: 4, fontSize: 10, color: "#9ca3af" }}>
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
                                      color: "#58a6ff",
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
                                      color: "#58a6ff",
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
                        <div style={{ marginTop: 4, fontSize: 10, color: "#9ca3af" }}>
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
                                  background: "#111827",
                                  color: "#e5e7eb",
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
                        background: "#60a5fa",
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
                color: tokenWarning.overBudget ? "#f87171" : "#fbbf24",
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
                    : graph?.nodes.length === 0 && !graph?.projectRoot
                      ? "e.g. Design a modular backend from scratch"
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
                              color: "#60a5fa",
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
                            color: "#9ca3af",
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
                            color: "#9ca3af",
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
                              border: "1px solid #2563eb",
                              background: "transparent",
                              color: "#93c5fd",
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
                              border: "1px solid #dc2626",
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

      {!leftPanelCollapsed && (
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
        {/* Graph toolbar + persona selector */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderBottom: "1px solid #30363d",
            flexShrink: 0,
          }}
        >
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
                      setWorkspaceTitleDraft(graph.projectName ?? "My workspace");
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
                      setWorkspaceTitleDraft(graph.projectName ?? "My workspace");
                      setWorkspaceTitleEditing(true);
                    }
                  }}
                  title={activeWorkspaceId && accessToken ? "Click to rename" : undefined}
                  style={{
                    fontSize: 11,
                    color: "#000000",
                    maxWidth: 140,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    cursor: activeWorkspaceId && accessToken ? "pointer" : "default",
                  }}
                >
                  {graph.projectName ?? "My workspace"}
                </span>
              )}
              <button
                type="button"
                disabled={saveLoading || !activeWorkspaceId || !accessToken || graph.nodes.length === 0}
                title={activeWorkspaceId && accessToken ? (saveStatus === "saved" ? "Saved" : "Save workspace") : "Sign in to save"}
                onClick={async () => {
                  if (saveLoading || !activeWorkspaceId || !accessToken) return;
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
                  padding: "2px 8px",
                  fontSize: 10,
                  borderRadius: 4,
                  border: "1px solid #238636",
                  background: "#238636",
                  color: "white",
                  cursor: saveLoading || !activeWorkspaceId || !accessToken ? "not-allowed" : "pointer",
                  opacity: saveLoading || !activeWorkspaceId || !accessToken ? 0.5 : 1,
                }}
              >
                {saveLoading ? "…" : saveStatus === "saved" ? "Saved" : "Save"}
              </button>
              <button
                type="button"
                disabled={shareLoading || !activeWorkspaceId || !accessToken}
                title={activeWorkspaceId && accessToken ? "Get share link" : "Sign in to share"}
                onClick={async () => {
                  if (shareLoading || !activeWorkspaceId || !accessToken) return;
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
                  border: "1px solid #1f6feb",
                  background: shareCopied ? "#238636" : "#1f6feb",
                  color: "white",
                  cursor: shareLoading || !activeWorkspaceId || !accessToken ? "not-allowed" : "pointer",
                  opacity: shareLoading || !activeWorkspaceId || !accessToken ? 0.5 : 1,
                }}
              >
                {shareLoading ? "…" : shareCopied ? "Copied" : "Share"}
              </button>
              <div
                style={{
                  display: "flex",
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
                placeholder="Search nodes…"
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
                          setWorkspaceTitleDraft(graph.projectName ?? "My workspace");
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
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {graph && (
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
                <button
                  type="button"
                  title="2D view"
                  onClick={() => setGraphViewMode("2d")}
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    fontFamily: "monospace",
                    border: graphViewMode === "2d" ? "1px solid #60a5fa" : "1px solid transparent",
                    borderRadius: 8,
                    background: graphViewMode === "2d" ? "rgba(29,78,216,0.2)" : "transparent",
                    color: graphViewMode === "2d" ? "#93c5fd" : "#9ca3af",
                    cursor: "pointer",
                  }}
                >
                  2D
                </button>
                <button
                  type="button"
                  title="3D view"
                  onClick={() => setGraphViewMode("3d")}
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    fontFamily: "monospace",
                    border: graphViewMode === "3d" ? "1px solid #60a5fa" : "1px solid transparent",
                    borderRadius: 8,
                    background: graphViewMode === "3d" ? "rgba(29,78,216,0.2)" : "transparent",
                    color: graphViewMode === "3d" ? "#93c5fd" : "#9ca3af",
                    cursor: "pointer",
                  }}
                >
                  3D
                </button>
                <button
                  type="button"
                  title="Layers canvas"
                  onClick={() => setGraphViewMode("layers")}
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    fontFamily: "monospace",
                    border: graphViewMode === "layers" ? "1px solid #60a5fa" : "1px solid transparent",
                    borderRadius: 8,
                    background: graphViewMode === "layers" ? "rgba(29,78,216,0.2)" : "transparent",
                    color: graphViewMode === "layers" ? "#93c5fd" : "#9ca3af",
                    cursor: "pointer",
                  }}
                >
                  Layers
                </button>
                <button
                  type="button"
                  title="Standard scorecard"
                  onClick={() => setGraphViewMode("standard")}
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    fontFamily: "monospace",
                    border: graphViewMode === "standard" ? "1px solid #60a5fa" : "1px solid transparent",
                    borderRadius: 8,
                    background: graphViewMode === "standard" ? "rgba(29,78,216,0.2)" : "transparent",
                    color: graphViewMode === "standard" ? "#93c5fd" : "#9ca3af",
                    cursor: "pointer",
                  }}
                >
                  Standard
                </button>
                <button
                  type="button"
                  title="Agents view"
                  onClick={() => setGraphViewMode("agents")}
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    fontFamily: "monospace",
                    border: graphViewMode === "agents" ? "1px solid #60a5fa" : "1px solid transparent",
                    borderRadius: 8,
                    background: graphViewMode === "agents" ? "rgba(29,78,216,0.2)" : "transparent",
                    color: graphViewMode === "agents" ? "#93c5fd" : "#9ca3af",
                    cursor: "pointer",
                  }}
                >
                  Agents
                </button>
                <button
                  type="button"
                  title="Reach matrix"
                  onClick={() => setGraphViewMode("reach")}
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    fontFamily: "monospace",
                    border: graphViewMode === "reach" ? "1px solid #60a5fa" : "1px solid transparent",
                    borderRadius: 8,
                    background: graphViewMode === "reach" ? "rgba(29,78,216,0.2)" : "transparent",
                    color: graphViewMode === "reach" ? "#93c5fd" : "#9ca3af",
                    cursor: "pointer",
                  }}
                >
                  Reach
                </button>
                <button
                  type="button"
                  title="Resource classification"
                  onClick={() => setGraphViewMode("resources")}
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    fontFamily: "monospace",
                    border: graphViewMode === "resources" ? "1px solid #60a5fa" : "1px solid transparent",
                    borderRadius: 8,
                    background: graphViewMode === "resources" ? "rgba(29,78,216,0.2)" : "transparent",
                    color: graphViewMode === "resources" ? "#93c5fd" : "#9ca3af",
                    cursor: "pointer",
                  }}
                >
                  Resources
                </button>
                <button
                  type="button"
                  title="Guard rules"
                  onClick={() => setGraphViewMode("guard")}
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    fontFamily: "monospace",
                    border: graphViewMode === "guard" ? "1px solid #60a5fa" : "1px solid transparent",
                    borderRadius: 8,
                    background: graphViewMode === "guard" ? "rgba(29,78,216,0.2)" : "transparent",
                    color: graphViewMode === "guard" ? "#93c5fd" : "#9ca3af",
                    cursor: "pointer",
                  }}
                >
                  Guard
                </button>
                {graphViewMode !== "agents" && graphViewMode !== "reach" && graphViewMode !== "resources" && graphViewMode !== "guard" && graphViewMode !== "layers" && graphViewMode !== "standard" && (
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
                          border: graphCanvasViewMode === mode ? "1px solid #60a5fa" : "1px solid transparent",
                          borderRadius: 8,
                          background: graphCanvasViewMode === mode ? "rgba(29,78,216,0.2)" : "transparent",
                          color: graphCanvasViewMode === mode ? "#93c5fd" : "#9ca3af",
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
                          border: graphLayoutMode === mode ? "1px solid #60a5fa" : "1px solid transparent",
                          borderRadius: 8,
                          background: graphLayoutMode === mode ? "rgba(29,78,216,0.2)" : "transparent",
                          color: graphLayoutMode === mode ? "#93c5fd" : "#9ca3af",
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
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 10, color: "#000", fontFamily: "monospace" }}>Theme</span>
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
                  background: canvasTheme === "dark" ? "#020617" : "#e5e7eb",
                  color: canvasTheme === "dark" ? "#e5e7eb" : "#020617",
                  cursor: "pointer",
                }}
              >
                {canvasTheme === "dark" ? "Dark" : "Light"}
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 10, color: "#000", fontFamily: "monospace" }}>Presentation</span>
              <button
                type="button"
                onClick={() => setPresentationMode((p) => !p)}
                style={{
                  padding: "4px 10px",
                  fontSize: 10,
                  borderRadius: 999,
                  border: presentationMode ? "1px solid #60a5fa" : "1px solid #30363d",
                  background: presentationMode ? "rgba(96,165,250,0.2)" : "transparent",
                  color: presentationMode ? "#93c5fd" : "#9ca3af",
                  cursor: "pointer",
                }}
              >
                {presentationMode ? "On" : "Off"}
              </button>
              <span style={{ fontSize: 10, color: "#000", fontFamily: "monospace" }}>Runtime</span>
              <button
                type="button"
                onClick={() => setRuntimeLive((p) => !p)}
                style={{
                  padding: "4px 10px",
                  fontSize: 10,
                  borderRadius: 999,
                  border: runtimeLive ? "1px solid #22c55e" : "1px solid #30363d",
                  background: runtimeLive ? "rgba(34,197,94,0.16)" : "transparent",
                  color: runtimeLive ? "#bbf7d0" : "#9ca3af",
                  cursor: "pointer",
                }}
              >
                {runtimeLive ? "Live" : "Off"}
              </button>
              <span style={{ fontSize: 10, color: "#000", fontFamily: "monospace" }}>Density</span>
              <button
                type="button"
                onClick={() =>
                  setCanvasDensity((prev) => (prev === "standard" ? "compact" : "standard"))
                }
                style={{
                  padding: "4px 10px",
                  fontSize: 10,
                  borderRadius: 999,
                  border: "1px solid #30363d",
                  background: canvasDensity === "standard" ? "#0f172a" : "#e5e7eb",
                  color: canvasDensity === "standard" ? "#e5e7eb" : "#020617",
                  cursor: "pointer",
                }}
              >
                {canvasDensity === "standard" ? "Std" : "Compact"}
              </button>
            </div>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setShowExportMenu((v) => !v)}
                style={{
                  padding: "4px 12px",
                  fontSize: 10,
                  borderRadius: 999,
                  border: "1px solid #30363d",
                  background: showExportMenu ? "rgba(96,165,250,0.15)" : "transparent",
                  color: "#9ca3af",
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
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {graph && (
          <div
            style={{
              position: "relative",
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              height: "100%",
            }}
          >
            {graphViewMode === "layers" ? (
              <LayersView
                agents={graph?.agents}
                selectedAgentFile={layersAgentFile}
                onSelectAgent={setLayersAgentFile}
              />
            ) : graphViewMode === "standard" ? (
              <StandardView
                agents={graph?.agents}
                selectedAgentFile={layersAgentFile}
                onSelectAgent={setLayersAgentFile}
              />
            ) : graphViewMode === "agents" ? (
              <AgentsView agents={graph?.agents} />
            ) : graphViewMode === "reach" ? (
              <ReachView agents={graph?.agents} />
            ) : graphViewMode === "resources" ? (
              <ResourcesView
                agents={graph?.agents}
                apiBase={API_BASE}
                onGraphPatch={(patch) => setGraph((g) => (g ? patch(g) : g))}
              />
            ) : graphViewMode === "guard" ? (
              <GuardView
                agents={graph?.agents}
                apiBase={API_BASE}
                onOpenEvidence={({ agent, tool, cls }) => {
                  setGraphViewMode("reach");
                  // ReachView owns its own selection; stash for optional future deep-link
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
            ) : (
            <ArchCanvas
              graph={effectiveGraph!}
              selectedNode={selectedNode}
              selectedNodeData={selectedNodeData}
              repoUrl={repoUrl}
              onNodeSelect={setSelectedNode}
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
            )}
          </div>
        )}
        {showInsightsPanel && graph && (
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
        </div>
      </div>

      {renderGlobalOverlays()}
    </>
  );
}
