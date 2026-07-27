import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArchCanvas } from "./ArchCanvas";
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

const COLUMN_CARD_ESTIMATE = 140;
const COLUMN_MAX_HEIGHT = 420;

function VirtualizedRailList({
  items,
  onCardClick,
  onApproveClick,
  queuePositionByRailId = {},
}: {
  items: Array<{
    id: string;
    outcome?: string;
    state?: string;
    archetype?: string;
    logicPath?: string[];
    lastCritique?: { message?: string; source?: string; attempt?: number; totalAttempts?: number } | null;
    tasks?: Array<{ kind?: string; status?: string }>;
  }>;
  onCardClick: (r: { id: string }) => void;
  onApproveClick?: (r: { id: string }) => void;
  queuePositionByRailId?: Record<string, string>;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => COLUMN_CARD_ESTIMATE,
    overscan: 3,
  });
  if (items.length === 0) return null;
  return (
    <div ref={parentRef} style={{ maxHeight: COLUMN_MAX_HEIGHT, overflowY: "auto" }}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const r = items[virtualRow.index];
          if (!r) return null;
          const verifTask = (r.tasks ?? []).find((t) => t.kind === "verification");
          const status = verifTask?.status ?? "unknown";
          const isGreenfield =
            typeof r.archetype === "string" && r.archetype.toLowerCase().includes("greenfield");
          const lastMsg = r.lastCritique?.message ?? "";
          return (
            <div
              key={r.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: 8,
              }}
            >
              <div
                style={{
                  borderRadius: 8,
                  border: "1px solid #30363d",
                  background: "#0d1117",
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-rail-id", r.id);
                }}
                onClick={() => onCardClick(r)}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#e6edf3",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={r.outcome || r.id}
                  >
                    {r.outcome?.slice(0, 60) || r.id}
                  </div>
                  {isGreenfield && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 6px",
                        borderRadius: 999,
                        border: "1px solid rgba(56,189,248,0.6)",
                        color: "#7dd3fc",
                      }}
                    >
                      Greenfield
                    </span>
                  )}
                  {r.archetype === "greenfield-materialize" &&
                    r.state === "VERIFYING" &&
                    onApproveClick && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onApproveClick(r);
                        }}
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 6,
                          background: "#7c3aed",
                          color: "white",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        Approve
                      </button>
                    )}
                </div>
                {(r.tasks ?? []).length > 0 && (
                  <div
                    style={{
                      fontSize: 9,
                      color: "#6b7280",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                    }}
                  >
                    {(r.tasks ?? []).slice(0, 4).map((t, i) => (
                      <span key={`${t.kind}-${t.status}-${i}`}>
                        {t.kind}:{t.status ?? "?"}
                      </span>
                    ))}
                    {(r.tasks ?? []).length > 4 && (
                      <span>+{r.tasks!.length - 4}</span>
                    )}
                  </div>
                )}
                {r.state === "SELF_CORRECTING" &&
                  r.lastCritique &&
                  typeof r.lastCritique.attempt === "number" &&
                  typeof r.lastCritique.totalAttempts === "number" && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "#f59e0b",
                        fontWeight: 600,
                      }}
                    >
                      Attempt {r.lastCritique.attempt}/{r.lastCritique.totalAttempts}
                    </span>
                  )}
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: "#111827",
                      color: "#9ca3af",
                      border: "1px solid #1f2937",
                    }}
                  >
                    {r.state ?? "UNKNOWN"}
                  </span>
                  {queuePositionByRailId[r.id] && (
                    <span
                      style={{
                        fontSize: 9,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: queuePositionByRailId[r.id] === "Running"
                          ? "rgba(56,189,248,0.15)"
                          : "rgba(234,179,8,0.12)",
                        color: queuePositionByRailId[r.id] === "Running" ? "#7dd3fc" : "#facc15",
                        border: "1px solid rgba(100,116,139,0.4)",
                      }}
                      title="Queue position"
                    >
                      {queuePositionByRailId[r.id]}
                    </span>
                  )}
                  {verifTask && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 999,
                        background:
                          status === "completed"
                            ? "rgba(16,185,129,0.15)"
                            : status === "rejected"
                              ? "rgba(248,113,113,0.15)"
                              : "rgba(59,130,246,0.15)",
                        color:
                          status === "completed"
                            ? "#6ee7b7"
                            : status === "rejected"
                              ? "#fecaca"
                              : "#bfdbfe",
                        border:
                          status === "completed"
                            ? "1px solid rgba(16,185,129,0.5)"
                            : status === "rejected"
                              ? "1px solid rgba(248,113,113,0.5)"
                              : "1px solid rgba(59,130,246,0.5)",
                      }}
                    >
                      Verify: {status}
                    </span>
                  )}
                </div>
                {((verifTask?.status === "rejected") || ["FAILED", "SELF_CORRECTING"].includes(r.state ?? "")) &&
                  lastMsg && (
                  <div
                    style={{
                      fontSize: 10,
                      padding: 6,
                      borderRadius: 4,
                      background: "rgba(248,113,113,0.1)",
                      border: "1px solid rgba(248,113,113,0.35)",
                      color: "#fecaca",
                      maxHeight: 64,
                      overflow: "hidden",
                      lineHeight: 1.4,
                    }}
                    title={lastMsg}
                  >
                    {(r.lastCritique as { source?: string })?.source && (
                      <span style={{ fontWeight: 600, marginRight: 4 }}>
                        {(r.lastCritique as { source?: string }).source}:
                      </span>
                    )}
                    {lastMsg.slice(0, 120)}
                    {lastMsg.length > 120 ? "…" : ""}
                  </div>
                )}
                {lastMsg &&
                  !(verifTask?.status === "rejected" || ["FAILED", "SELF_CORRECTING"].includes(r.state ?? "")) && (
                  <div style={{ fontSize: 11, color: "#9ca3af", maxHeight: 48, overflow: "hidden" }}>
                    {lastMsg.slice(0, 140)}
                    {lastMsg.length > 140 ? "…" : ""}
                  </div>
                )}
                {r.logicPath && r.logicPath.length > 0 && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "#6b7280",
                      fontFamily: "monospace",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={r.logicPath.join(" → ")}
                  >
                    {r.logicPath.join(" → ")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LittleLabsScene() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = window.innerWidth;
    const h = window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
    camera.position.set(-7, -5, 11);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
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
  }, []);

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
  const [graph, setGraph] = useState<ArchGraph | null>(null);
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
  const [materializeDiffWarning, setMaterializeDiffWarning] = useState<{
    message: string;
    limits?: { maxChangedFiles?: number; maxTotalBytes?: number };
    actual?: { changedFiles?: number; totalBytes?: number };
  } | null>(null);
  const [agentGraphCommand, setAgentGraphCommand] = useState<GraphCommand | null>(null);
  const [virtualNodes, setVirtualNodes] = useState<
    Array<{ id: string; label: string; layer?: string; description?: string; archNodeId?: string }>
  >([]);
  const [virtualEdges, setVirtualEdges] = useState<
    Array<{ fromId: string; toId: string; edgeType?: string }>
  >([]);
  const [activeViolations, setActiveViolations] = useState<CriticViolation[]>([]);
  const [violationsCollapsed, setViolationsCollapsed] = useState(false);
  const [violationBeingFixed, setViolationBeingFixed] = useState<string | null>(null);
  const [violationsRestoreError, setViolationsRestoreError] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"dashboard" | "chat" | "code">("dashboard");
  const [mainViewMode, setMainViewMode] = useState<"graph" | "board">("graph");
  const [graphViewMode, setGraphViewMode] = useState<"2d" | "3d">("2d");
  const [graphCanvasViewMode, setGraphCanvasViewMode] =
    useState<"architecture" | "domains" | "runtime" | "failure">("architecture");
  const [showModeSwitchConfirm, setShowModeSwitchConfirm] = useState(false);
  const [pendingModeSwitch, setPendingModeSwitch] = useState<"graph" | "board" | null>(null);
  const [rails, setRails] = useState<
    Array<{
      id: string;
      outcome?: string;
      state?: string;
      archetype?: string;
      logicPath?: string[];
      sessionId?: string;
      updatedAt?: number;
      createdAt?: number;
      lastCritique?: {
        source: string;
        message: string;
        failureType?: string;
        createdAt: number;
        attempt?: number;
        totalAttempts?: number;
        criticScore?: number;
      } | null;
      hallucinationIndex?: number | null;
      acceptanceCriteria?: {
        functional: string[];
        visual: string[];
        architectural: string[];
      } | null;
      tasks?: Array<{
        id: string;
        kind?: string;
        description?: string;
        status?: string;
        createdAt?: number;
      }>;
    }>
  >([]);

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
  const BOARD_FILTERS_KEY = "boardFilters";
  const readBoardFilters = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = {
      search: urlParams.get("search") ?? undefined,
      archetype: urlParams.get("archetype") ?? undefined,
      onlyWithFailures: urlParams.get("onlyWithFailures") === "1",
    };
    if (fromUrl.search !== undefined || fromUrl.archetype || fromUrl.onlyWithFailures) {
      return {
        search: typeof fromUrl.search === "string" ? fromUrl.search : "",
        archetype: typeof fromUrl.archetype === "string" ? fromUrl.archetype : "all",
        onlyWithFailures: fromUrl.onlyWithFailures,
      };
    }
    try {
      const raw = localStorage.getItem(BOARD_FILTERS_KEY);
      if (!raw) return { search: "", archetype: "all", onlyWithFailures: false };
      const p = JSON.parse(raw) as { search?: string; archetype?: string; onlyWithFailures?: boolean };
      return {
        search: typeof p.search === "string" ? p.search : "",
        archetype: typeof p.archetype === "string" ? p.archetype : "all",
        onlyWithFailures: p.onlyWithFailures === true,
      };
    } catch {
      return { search: "", archetype: "all", onlyWithFailures: false };
    }
  };
  const initialFilters = readBoardFilters();
  const [railSearch, setRailSearch] = useState<string>(initialFilters.search);
  const [railArchetypeFilter, setRailArchetypeFilter] = useState<string>(initialFilters.archetype);
  const [railOnlyWithFailures, setRailOnlyWithFailures] = useState<boolean>(initialFilters.onlyWithFailures);
  const [railWorkspaceFilter, setRailWorkspaceFilter] = useState<string | null>(null);
  const [railStateFilter, setRailStateFilter] = useState<Set<string>>(
    () =>
      new Set([
        "PRE_PLANNING",
        "PLANNING",
        "AWAITING_APPROVAL",
        "EXECUTING",
        "AWAITING_HITL",
        "VERIFYING",
        "SELF_CORRECTING",
        "MATERIALIZING",
        "ARCHIVED",
        "FAILED",
        "SUSPENDED",
      ])
  );
  const [railsPerColumn, setRailsPerColumn] = useState<number>(50);
  const [railDropError, setRailDropError] = useState<{
    message: string;
    code?: string;
    details?: string;
    retryable?: boolean;
  } | null>(null);
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
  const [materializeError, setMaterializeError] = useState<string | null>(null);
  const [lastCriticResult, setLastCriticResult] = useState<{
    score: number;
    report: string;
    violations: CriticViolation[];
  } | null>(null);
  const [greenfieldSessionId, setGreenfieldSessionId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("greenfieldSessionId");
    } catch {
      return null;
    }
  });
  const [greenfieldAcceptanceCriteria, setGreenfieldAcceptanceCriteria] = useState<{
    functional: string[];
    visual: string[];
    architectural: string[];
  } | null>(null);
  const [pendingRailApproval, setPendingRailApproval] = useState<{ railId: string; rootPath: string } | null>(
    null
  );
  const [selectedRailId, setSelectedRailId] = useState<string | null>(null);
  const [selectedRailDetail, setSelectedRailDetail] = useState<any | null>(null);
  const [selectedRailSandboxPaths, setSelectedRailSandboxPaths] = useState<string[] | null>(null);
  const [selectedRailSandboxLoading, setSelectedRailSandboxLoading] = useState(false);
  const [selectedRailDiffs, setSelectedRailDiffs] = useState<
    Array<{ path: string; before?: string; after?: string }> | null
  >(null);
  const [selectedRailDiffsLoading, setSelectedRailDiffsLoading] = useState(false);
  const [railImpactNodeIds, setRailImpactNodeIds] = useState<string[] | null>(null);
  const [lastMaterializedSnapshot, setLastMaterializedSnapshot] = useState<{
    targetRoot: string;
    created: string[];
  } | null>(null);

  const criticalViolationsCount = activeViolations.filter(
    (v) => v.severity === "critical"
  ).length;
  const highViolationsCount = activeViolations.filter(
    (v) => v.severity === "high"
  ).length;
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
  const [showReplaceDraftPrompt, setShowReplaceDraftPrompt] = useState(false);
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
  const [showMaterializeModal, setShowMaterializeModal] = useState(false);
  const [materializeTargetPath, setMaterializeTargetPath] = useState("");
  const [materializeLoading, setMaterializeLoading] = useState(false);
  const [implementLoading, setImplementLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState<"unknown" | "ok" | "mismatch">("unknown");
  const [authStatusMessage, setAuthStatusMessage] = useState<string | null>(null);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [threadListOpen, setThreadListOpen] = useState(false);
  const [threadList, setThreadList] = useState<Array<{ id: string; title: string; created_at?: string; updated_at?: string }>>([]);
  const [threadSearch, setThreadSearch] = useState("");
  const [threadListLoading, setThreadListLoading] = useState(false);
  const [tokenWarning, setTokenWarning] = useState<{ input: number; output: number; overBudget?: boolean } | null>(null);
  const [editingVirtualNodeId, setEditingVirtualNodeId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<{ label: string; archNodeId: string } | null>(null);
  const [designHistory, setDesignHistory] = useState<
    Array<{
      nodes: Array<{ id: string; label: string; layer?: string; description?: string; archNodeId?: string }>;
      edges: Array<{ fromId: string; toId: string; edgeType?: string }>;
    }>
  >([]);
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

  const isGreenfieldMode = !!graph && graph.nodes.length === 0;

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

  useEffect(() => {
    try {
      if (greenfieldSessionId) localStorage.setItem("greenfieldSessionId", greenfieldSessionId);
      else localStorage.removeItem("greenfieldSessionId");
    } catch {
      // ignore
    }
  }, [greenfieldSessionId]);

  useEffect(() => {
    const wsId = mainViewMode === "board" ? (railWorkspaceFilter ?? activeWorkspaceId) : activeWorkspaceId;
    if (!selectedRailId || !wsId || !accessToken) {
      setSelectedRailDetail(null);
      setSelectedRailSandboxPaths(null);
      setSelectedRailDiffs(null);
      setRailImpactNodeIds(null);
      return;
    }
    setSelectedRailDiffs(null);
    setRailImpactNodeIds(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/rails/${encodeURIComponent(selectedRailId)}?workspaceId=${encodeURIComponent(wsId)}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        setSelectedRailDetail(data);
      } catch {
        if (!cancelled) setSelectedRailDetail(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRailId, mainViewMode, railWorkspaceFilter, activeWorkspaceId, accessToken]);

  const effectiveRailsWorkspaceId = railWorkspaceFilter ?? activeWorkspaceId;

  useEffect(() => {
    if (!selectedRailDetail || !graph || !accessToken) return;
    const wsId = mainViewMode === "board" ? effectiveRailsWorkspaceId : activeWorkspaceId;
    if (!wsId) return;
    let cancelled = false;
    fetch(
      `${API_BASE}/rails/${encodeURIComponent(selectedRailDetail.id)}/impact?workspaceId=${encodeURIComponent(wsId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled || !data.changedFiles) return;
        const baseIds = Array.isArray(data.baselineNodeIds) ? data.baselineNodeIds : [];
        const changedFiles = Array.isArray(data.changedFiles) ? data.changedFiles : [];
        const fileIds = new Set<string>();
        for (const node of graph.nodes) {
          for (const f of node.files ?? []) {
            if (changedFiles.some((cf: string) => f.includes(cf) || cf.includes(f)))
              fileIds.add(node.id);
          }
        }
        setRailImpactNodeIds([...new Set([...baseIds, ...fileIds])]);
      })
      .catch(() => {
        if (cancelled) return;
        const base = selectedRailDetail.baselineNodeIds ?? [];
        const logic = (selectedRailDetail.logicPath ?? []).map((s: any) => s?.nodeId).filter(Boolean);
        setRailImpactNodeIds([...new Set([...base, ...logic])]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRailDetail?.id, graph, accessToken, mainViewMode, effectiveRailsWorkspaceId, activeWorkspaceId]);

  const mapRailsFromApi = useCallback((items: any[]) =>
    items.map((r: any) => ({
      id: String(r.id),
      outcome: typeof r.outcome === "string" ? r.outcome : undefined,
      state: typeof r.state === "string" ? r.state : undefined,
      archetype: typeof r.archetype === "string" ? r.archetype : undefined,
      logicPath: Array.isArray(r.logicPath)
        ? r.logicPath
            .map((s: any) =>
              s && typeof s.layer === "string" && typeof s.nodeId === "string"
                ? `${s.layer}:${s.nodeId}`
                : null
            )
            .filter((x: string | null): x is string => x != null)
        : undefined,
      sessionId: typeof r.sessionId === "string" ? r.sessionId : undefined,
      updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : undefined,
      createdAt: typeof r.createdAt === "number" ? r.createdAt : undefined,
      lastCritique:
        r.lastCritique && typeof r.lastCritique === "object"
          ? {
              source: String(r.lastCritique.source ?? ""),
              message: String(r.lastCritique.message ?? ""),
              failureType: typeof r.lastCritique.failureType === "string" ? r.lastCritique.failureType : undefined,
              createdAt: Number(r.lastCritique.createdAt ?? Date.now()),
              attempt: typeof r.lastCritique.attempt === "number" ? r.lastCritique.attempt : undefined,
              totalAttempts: typeof r.lastCritique.totalAttempts === "number" ? r.lastCritique.totalAttempts : undefined,
              criticScore: typeof r.lastCritique.criticScore === "number" ? r.lastCritique.criticScore : undefined,
            }
          : null,
      hallucinationIndex: typeof r.hallucinationIndex === "number" ? r.hallucinationIndex : null,
      acceptanceCriteria:
        r.acceptanceCriteria && typeof r.acceptanceCriteria === "object"
          ? {
              functional: Array.isArray(r.acceptanceCriteria.functional)
                ? r.acceptanceCriteria.functional.filter((x: any) => typeof x === "string")
                : [],
              visual: Array.isArray(r.acceptanceCriteria.visual)
                ? r.acceptanceCriteria.visual.filter((x: any) => typeof x === "string")
                : [],
              architectural: Array.isArray(r.acceptanceCriteria.architectural)
                ? r.acceptanceCriteria.architectural.filter((x: any) => typeof x === "string")
                : [],
            }
          : null,
      tasks: Array.isArray(r.tasks)
        ? r.tasks.map((t: any) => ({
            id: String(t.id),
            kind: typeof t.kind === "string" ? t.kind : undefined,
            description: typeof t.description === "string" ? t.description : undefined,
            status: typeof t.status === "string" ? t.status : undefined,
            createdAt: typeof t.createdAt === "number" ? t.createdAt : undefined,
          }))
        : [],
    })),
  []);

  useEffect(() => {
    if (mainViewMode !== "board") return;
    if (!effectiveRailsWorkspaceId || !accessToken) return;
    let cancelled = false;
    const fetchRails = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/rails?workspaceId=${encodeURIComponent(effectiveRailsWorkspaceId)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const items = Array.isArray(data.rails) ? data.rails : [];
        setRails(mapRailsFromApi(items));
      } catch {
        if (!cancelled) {
          // non-fatal; board can be empty
        }
      }
    };
    fetchRails();
    let sseAbort: AbortController | null = null;
    let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    const MAX_RETRY_DELAY = 30000;
    const BASE_RETRY_DELAY = 1000;
    const connectSSE = (retryDelay = BASE_RETRY_DELAY) => {
      if (!effectiveRailsWorkspaceId || !accessToken || cancelled) return;
      sseAbort = new AbortController();
      fetch(`${API_BASE}/rails/events?workspaceId=${encodeURIComponent(effectiveRailsWorkspaceId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: sseAbort.signal,
      })
        .then((res) => {
          if (cancelled || !res.ok || !res.body) return;
          retryCount = 0;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          const pump = (): Promise<void> =>
            reader.read().then(({ done, value }) => {
              if (cancelled) return;
              if (done) {
                const delay = Math.min(retryDelay * Math.pow(2, retryCount), MAX_RETRY_DELAY);
                const jitter = delay * 0.2 * (Math.random() - 0.5);
                sseReconnectTimer = setTimeout(() => {
                  retryCount++;
                  connectSSE(BASE_RETRY_DELAY);
                }, Math.max(500, delay + jitter));
                return;
              }
              buf += decoder.decode(value, { stream: true });
              const lines = buf.split("\n");
              buf = lines.pop() ?? "";
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  try {
                    const payload = JSON.parse(line.slice(6).trim());
                    if (payload?.type === "rail_state" || payload?.type === "rail_execute_complete") fetchRails();
                  } catch {
                    /* ignore */
                  }
                }
              }
              return pump();
            });
          return pump();
        })
        .catch(() => {
          if (cancelled) return;
          const delay = Math.min(retryDelay * Math.pow(2, retryCount), MAX_RETRY_DELAY);
          const jitter = delay * 0.2 * (Math.random() - 0.5);
          retryCount++;
          sseReconnectTimer = setTimeout(() => connectSSE(BASE_RETRY_DELAY), Math.max(500, delay + jitter));
        });
    };
    if (effectiveRailsWorkspaceId && accessToken) connectSSE();
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && effectiveRailsWorkspaceId && accessToken && !cancelled) {
        if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
        retryCount = 0;
        sseAbort?.abort();
        connectSSE(BASE_RETRY_DELAY);
      }
    };
    const handleOnline = () => {
      if (effectiveRailsWorkspaceId && accessToken && !cancelled) {
        if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
        retryCount = 0;
        sseAbort?.abort();
        connectSSE(BASE_RETRY_DELAY);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    const id = window.setInterval(fetchRails, 8000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      window.clearInterval(id);
      sseAbort?.abort();
      if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
    };
  }, [mainViewMode, effectiveRailsWorkspaceId, accessToken, mapRailsFromApi]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== "visible") return;
      if (mainViewMode !== "board") return;
      if (!effectiveRailsWorkspaceId || !accessToken) return;
      fetch(
        `${API_BASE}/rails?workspaceId=${encodeURIComponent(effectiveRailsWorkspaceId)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
          const items = Array.isArray((data as any).rails) ? (data as any).rails : [];
          setRails((prev) => (items.length === 0 ? prev : mapRailsFromApi(items)));
        })
        .catch(() => {
          // ignore
        });
    };
    document.addEventListener("visibilitychange", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
    };
  }, [mainViewMode, effectiveRailsWorkspaceId, accessToken, mapRailsFromApi]);

  useEffect(() => {
    setRailWorkspaceFilter(null);
  }, [activeWorkspaceId]);
  useEffect(() => {
    try {
      localStorage.setItem(
        BOARD_FILTERS_KEY,
        JSON.stringify({
          search: railSearch,
          archetype: railArchetypeFilter,
          onlyWithFailures: railOnlyWithFailures,
        })
      );
    } catch {
      // ignore
    }
    try {
      const params = new URLSearchParams(window.location.search);
      if (railSearch) params.set("search", railSearch); else params.delete("search");
      if (railArchetypeFilter && railArchetypeFilter !== "all") params.set("archetype", railArchetypeFilter); else params.delete("archetype");
      if (railOnlyWithFailures) params.set("onlyWithFailures", "1"); else params.delete("onlyWithFailures");
      const qs = params.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, "", url);
    } catch {
      // ignore
    }
  }, [railSearch, railArchetypeFilter, railOnlyWithFailures]);

  const filteredRails = useMemo(() => {
    const search = railSearch.trim().toLowerCase();
    return rails.filter((r) => {
      if (r.state && !railStateFilter.has(r.state)) return false;
      if (railArchetypeFilter !== "all") {
        if (!r.archetype || r.archetype !== railArchetypeFilter) return false;
      }
      if (railOnlyWithFailures) {
        const hasFailedVerification =
          (r.tasks ?? []).some((t) => t.kind === "verification" && t.status === "rejected") ||
          (r.lastCritique?.source === "playwright" && (r.lastCritique?.criticScore ?? 0) < 8);
        if (!hasFailedVerification) return false;
      }
      if (search) {
        const haystack = `${r.outcome ?? ""} ${r.archetype ?? ""} ${r.sessionId ?? ""}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [rails, railSearch, railStateFilter, railArchetypeFilter, railOnlyWithFailures]);

  const executingRailsCount = useMemo(
    () => rails.filter((r) => r.state === "EXECUTING").length,
    [rails]
  );
  const activeRailsCount = useMemo(
    () =>
      rails.filter(
        (r) =>
          r.state &&
          !["ARCHIVED", "FAILED", "SUSPENDED"].includes(r.state)
      ).length,
    [rails]
  );

  const queuePositionByRailId = useMemo(() => {
    const active = rails
      .filter((r) => r.state && !["ARCHIVED", "FAILED", "SUSPENDED"].includes(r.state))
      .sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
    const execCount = active.filter((r) => r.state === "EXECUTING").length;
    const map: Record<string, string> = {};
    let queuePos = 0;
    for (const r of active) {
      if (r.state === "EXECUTING") map[r.id] = "Running";
      else {
        queuePos += 1;
        map[r.id] = queuePos === 1 ? "Next" : `#${queuePos}`;
      }
    }
    return map;
  }, [rails]);

  useEffect(() => {
    if (!isGreenfieldMode) return;
    if (!accessToken) return;
    if (greenfieldSessionId) return;

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
        if (!res.ok) return;
        const sid = typeof data.sessionId === "string" ? data.sessionId : null;
        if (!sid) return;
        if (!cancelled) setGreenfieldSessionId(sid);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isGreenfieldMode, accessToken, greenfieldSessionId, activeWorkspaceId]);

  useEffect(() => {
    if (!isGreenfieldMode) return;
    if (!accessToken) return;
    if (!greenfieldSessionId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/greenfield/draft/${encodeURIComponent(greenfieldSessionId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (cancelled) return;
        const nodes = Array.isArray(data.nodes) ? data.nodes : [];
        const edges = Array.isArray(data.edges) ? data.edges : [];
        setVirtualNodes(
          nodes
            .filter((n: any) => n && typeof n.id === "string")
            .map((n: any) => ({
              id: n.id,
              label: typeof n.label === "string" ? n.label : n.id,
              layer: typeof n.layer === "string" ? n.layer : undefined,
              description: typeof n.description === "string" ? n.description : undefined,
              archNodeId: typeof n.archNodeId === "string" ? n.archNodeId : undefined,
            }))
        );
        setVirtualEdges(
          edges
            .filter((e: any) => e && typeof e.source === "string" && typeof e.target === "string")
            .map((e: any) => ({ fromId: e.source, toId: e.target }))
        );
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isGreenfieldMode, accessToken, greenfieldSessionId]);

  useEffect(() => {
    if (!isGreenfieldMode) return;
    if (!accessToken) return;
    if (!greenfieldSessionId) return;

    const handle = window.setTimeout(() => {
      const nodesPayload = virtualNodes.map((n) => ({
        id: n.id,
        label: n.label,
        layer: n.layer,
        description: n.description,
        archNodeId: n.archNodeId,
      }));
      const edgesPayload = virtualEdges.map((e) => ({ source: e.fromId, target: e.toId }));
      fetch(`${API_BASE}/greenfield/draft/${encodeURIComponent(greenfieldSessionId)}`, {
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

    return () => window.clearTimeout(handle);
  }, [isGreenfieldMode, accessToken, greenfieldSessionId, virtualNodes, virtualEdges, activeWorkspaceId]);

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
      setVirtualNodes([]);
      setVirtualEdges([]);
      setGreenfieldSessionId(null);
      setGreenfieldAcceptanceCriteria(null);
      setPendingRailApproval(null);
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
    setVirtualNodes([]);
    setVirtualEdges([]);
    setGreenfieldSessionId(null);
    setGreenfieldAcceptanceCriteria(null);
    setPendingRailApproval(null);
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
      setVirtualNodes([]);
      setVirtualEdges([]);
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

        // Successful scan: always show the graph.
        setGraph(analyseGraph(data));

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
      const mode: "greenfield" | "analysis" =
        graph.nodes.length === 0 ? "greenfield" : "analysis";
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
        if (Array.isArray((data as any).rails) && (data as any).rails.length > 0) {
          const rs = (data as any).rails as Array<{ id?: string }>;
          const firstId = rs.find((r) => typeof r.id === "string")?.id as string | undefined;
          if (firstId) {
            setMainViewMode("board");
            setSelectedRailId(firstId);
          }
        }
        const acceptanceCriteria =
          data.acceptanceCriteria &&
          typeof data.acceptanceCriteria === "object" &&
          Array.isArray((data.acceptanceCriteria as any).functional)
            ? {
                functional: Array.isArray((data.acceptanceCriteria as any).functional)
                  ? ((data.acceptanceCriteria as any).functional as any[]).filter((x) => typeof x === "string")
                  : [],
                visual: Array.isArray((data.acceptanceCriteria as any).visual)
                  ? ((data.acceptanceCriteria as any).visual as any[]).filter((x) => typeof x === "string")
                  : [],
                architectural: Array.isArray((data.acceptanceCriteria as any).architectural)
                  ? ((data.acceptanceCriteria as any).architectural as any[]).filter((x) => typeof x === "string")
                  : [],
              }
            : null;
        if (acceptanceCriteria) {
          setGreenfieldAcceptanceCriteria(acceptanceCriteria);
        }
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
        const newNodes: Array<{ id: string; label: string; layer?: string; archNodeId?: string; description?: string }> = [];
        const newEdges: Array<{ fromId: string; toId: string; edgeType?: string }> = [];
        for (const cmd of graphCommands) {
          if (cmd.action === "filter_edge_type") {
            const f = cmd.edgeType === "arch" ? "architectural" : cmd.edgeType;
            setActiveFilters(new Set([f]));
          } else if (cmd.action === "focus_node") {
            setSelectedNode(cmd.nodeId);
          } else if (cmd.action === "create_node") {
            newNodes.push({
              id: cmd.id,
              label: cmd.label,
              layer: cmd.layer,
              archNodeId: cmd.archNodeId,
              description: cmd.description,
            });
          } else if (cmd.action === "connect") {
            newEdges.push({
              fromId: cmd.fromId,
              toId: cmd.toId,
              edgeType: cmd.edgeType,
            });
          }
        }
        if (newNodes.length > 0 || newEdges.length > 0) {
          setVirtualNodes((prev) => [...prev, ...newNodes]);
          setVirtualEdges((prev) => [...prev, ...newEdges]);
          setMaterializeError(null);
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
            ...(graph.nodes.length === 0 && greenfieldSessionId
              ? { greenfieldSessionId }
              : {}),
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
      greenfieldSessionId,
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

  const handleConfirmNode = useCallback(
    async (node: { id: string; label: string; layer?: string; archNodeId?: string }) => {
      if (!graph) return;
      try {
        if (!accessToken) throw new Error("Please sign in first.");
        const res = await fetch(`${API_BASE}/scaffold-node`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            projectRoot: graph.projectRoot,
            archNodeId: node.archNodeId ?? node.id,
            relPath: node.archNodeId ?? node.id,
            layer: node.layer,
            kind: "module",
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || res.statusText);
        }
        // Remove confirmed node and its virtual edges; then refresh scan to persist the new module.
        setVirtualNodes((prev) => prev.filter((v) => v.id !== node.id));
        setVirtualEdges((prev) =>
          prev.filter((e) => e.fromId !== node.id && e.toId !== node.id)
        );
        if (activeWorkspaceId && accessToken) {
          try {
            const r = await fetch(`${API_BASE}/scan/refresh`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ workspaceId: activeWorkspaceId }),
            });
            const refreshData = await r.json().catch(() => ({}));
            if (r.ok && refreshData.nodes) {
              setGraph(analyseGraph(refreshData));
            }
          } catch {
            // Non-fatal
          }
        }
      } catch (err) {
        console.error("Scaffold failed:", err);
      }
    },
    [graph, accessToken, activeWorkspaceId]
  );

  const handleUpdateVirtualNode = useCallback(
    (nodeId: string, updates: { label?: string; archNodeId?: string }) => {
      setEditingVirtualNodeId(null);
      setDesignHistory((h) => [...h.slice(-4), { nodes: virtualNodes, edges: virtualEdges }]);
      setVirtualNodes((prev) =>
        prev.map((v) =>
          v.id === nodeId
            ? { ...v, ...(updates.label !== undefined && { label: updates.label }), ...(updates.archNodeId !== undefined && { archNodeId: updates.archNodeId }) }
            : v
        )
      );
    },
    [virtualNodes, virtualEdges]
  );

  const handleUndoDesign = useCallback(() => {
    const prev = designHistory[designHistory.length - 1];
    if (!prev) return;
    setDesignHistory((h) => h.slice(0, -1));
    setVirtualNodes(prev.nodes);
    setVirtualEdges(prev.edges);
    setEditingVirtualNodeId(null);
    setEditingDraft(null);
  }, [designHistory]);

  const handleDiscardNode = useCallback(
    (nodeId: string) => {
      setDesignHistory((h) => [...h.slice(-4), { nodes: virtualNodes, edges: virtualEdges }]);
      setVirtualNodes((prev) => prev.filter((v) => v.id !== nodeId));
      setVirtualEdges((prev) =>
        prev.filter((e) => e.fromId !== nodeId && e.toId !== nodeId)
      );
      setEditingVirtualNodeId((id) => (id === nodeId ? null : id));
    },
    [virtualNodes, virtualEdges]
  );

  const handleResetGreenfieldDraft = useCallback(async () => {
    setDesignHistory([]);
    setEditingVirtualNodeId(null);
    setEditingDraft(null);
    setVirtualNodes([]);
    setVirtualEdges([]);
    setGreenfieldAcceptanceCriteria(null);
    setPendingRailApproval(null);
    const sid = greenfieldSessionId;
    setGreenfieldSessionId(null);
    if (!sid || !accessToken) return;
    try {
      await fetch(`${API_BASE}/greenfield/draft/${encodeURIComponent(sid)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      // ignore
    }
  }, [greenfieldSessionId, accessToken]);

  const handleMaterialize = useCallback(async () => {
    const targetRoot = materializeTargetPath.trim();
    if (!targetRoot || !accessToken || virtualNodes.length === 0) return;
    setMaterializeError(null);
    const materializeTaskId = crypto.randomUUID?.() ?? `materialize-${Date.now()}`;
    const matSteps = ["Validate nodes", "Write files", "Rescan workspace"];
    setBackgroundTasks((prev) => [
      ...prev,
      {
        id: materializeTaskId,
        label: "Materialize architecture",
        mode: "greenfield",
        kind: "materialize",
        status: "running" as const,
        steps: matSteps,
        currentStep: 0,
        totalSteps: matSteps.length,
        createdAt: Date.now(),
        reviewed: false,
        dismissed: false,
        toastDismissed: false,
        workspaceId: activeWorkspaceId ?? undefined,
      },
    ]);
    setActiveTaskId(materializeTaskId);
    setMaterializeLoading(true);
    const nodesPayload = virtualNodes.map((vn) => ({
      id: vn.id,
      label: vn.label,
      layer: vn.layer,
      archNodeId: vn.archNodeId ?? vn.id,
    }));

    const applyMaterializeResult = async (data: any) => {
      const created = Array.isArray(data.created) ? data.created : [];
      if (created.length > 0) setLastMaterializedSnapshot({ targetRoot, created });
      const railId = typeof data.railId === "string" ? data.railId : null;
      const verificationPassed =
        (data?.verification && typeof data.verification.passed === "boolean" && data.verification.passed === true) ||
        data?.verificationPassed === true;
      const materializeNeedsReview = Array.isArray(data.errors) && data.errors.length > 0;
      setBackgroundTasks((prev) =>
        prev.map((t) =>
          t.id === materializeTaskId
            ? {
                ...t,
                status: materializeNeedsReview ? "needs_review" : "completed",
                currentStep: t.totalSteps,
                railId: railId ?? t.railId,
                result: data,
              }
            : t
        )
      );
      setChatSessions((prev) => {
        const current = prev[activeChatId] ?? [];
        const msg = railId
          ? verificationPassed
            ? `Verification passed. Approval required to apply. Rail: ${railId}.`
            : `Verification failed. Approval blocked. Rail: ${railId}.`
          : `Materialized ${created.length} node(s)${data.errors?.length ? `; ${data.errors.length} error(s)` : ""}.`;
        return {
          ...prev,
          [activeChatId]: [...current, { role: "assistant", content: msg }],
        };
      });
      setShowMaterializeModal(false);
      if (railId) {
        if (verificationPassed) {
          setPendingRailApproval({ railId, rootPath: targetRoot });
        }
        return;
      }
      setVirtualNodes([]);
      setVirtualEdges([]);
      setDesignHistory([]);
      setMaterializeTargetPath("");
      if (data.recommendRescan && activeWorkspaceId && accessToken) {
        try {
          const r = await fetch(`${API_BASE}/scan/refresh`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ workspaceId: activeWorkspaceId }),
          });
          const refreshData = await r.json().catch(() => ({}));
          if (r.ok && refreshData.nodes) {
            setGraph(analyseGraph(refreshData));
          }
        } catch {
          // Non-fatal
        }
      } else if (targetRoot && /github\.com[/:]/i.test(targetRoot)) {
        setRepoUrl(targetRoot);
        await scanRepo(targetRoot);
      }
    };

    try {
      const lastUserMsg =
        chatHistory
          .slice()
          .reverse()
          .find((m) => m.role === "user")?.content ?? "Greenfield materialize";
      const idempotencyKey = `materialize-${targetRoot}-${virtualNodes.map((n) => n.id).sort().join(",")}`;
      const res = await fetch(`${API_BASE}/materialize-async`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          targetRoot,
          nodes: nodesPayload,
          useRailFlow: isGreenfieldMode,
          sessionId: isGreenfieldMode ? greenfieldSessionId ?? undefined : undefined,
          outcome: isGreenfieldMode ? lastUserMsg : undefined,
          acceptanceCriteria: isGreenfieldMode ? greenfieldAcceptanceCriteria ?? undefined : undefined,
          lastCritique: lastCriticResult
            ? {
                criticScore: lastCriticResult.score,
                message: lastCriticResult.report,
                violations: lastCriticResult.violations,
              }
            : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      const remoteTaskId = typeof data.taskId === "string" ? data.taskId : null;
      if (!remoteTaskId) {
        throw new Error("Server did not return a taskId for materialize.");
      }

      setBackgroundTasks((prev) =>
        prev.map((t) => (t.id === materializeTaskId ? { ...t, remoteTaskId } : t))
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
            const msg = typeof payload.error === "string" ? payload.error : "Materialize failed.";
            setMaterializeError(msg);
            setBackgroundTasks((prev) =>
              prev.map((t) =>
                t.id === materializeTaskId
                  ? { ...t, status: "failed" as const, error: msg, currentStep: t.totalSteps }
                  : t
              )
            );
            setChatSessions((prev) => {
              const current = prev[activeChatId] ?? [];
              return {
                ...prev,
                [activeChatId]: [...current, { role: "assistant", content: `Materialize failed: ${msg}` }],
              };
            });
            setShowMaterializeModal(false);
            return;
          }
          if (status === "completed") {
            await applyMaterializeResult(payload.result ?? {});
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setMaterializeError(msg);
          setBackgroundTasks((prev) =>
            prev.map((t) =>
              t.id === materializeTaskId
                ? { ...t, status: "failed" as const, error: msg, currentStep: t.totalSteps }
                : t
            )
          );
          setChatSessions((prev) => {
            const current = prev[activeChatId] ?? [];
            return {
              ...prev,
              [activeChatId]: [...current, { role: "assistant", content: `Materialize failed: ${msg}` }],
            };
          });
          setShowMaterializeModal(false);
        } finally {
          setMaterializeLoading(false);
        }
      };

      poll(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMaterializeError(msg);
      setBackgroundTasks((prev) =>
        prev.map((t) =>
          t.id === materializeTaskId
            ? { ...t, status: "failed" as const, error: msg, currentStep: t.totalSteps }
            : t
        )
      );
      setChatSessions((prev) => {
        const current = prev[activeChatId] ?? [];
        return {
          ...prev,
          [activeChatId]: [...current, { role: "assistant", content: `Materialize failed: ${msg}` }],
        };
      });
      setShowMaterializeModal(false);
      setMaterializeLoading(false);
    }
  }, [
    materializeTargetPath,
    accessToken,
    virtualNodes,
    chatHistory,
    isGreenfieldMode,
    greenfieldSessionId,
    greenfieldAcceptanceCriteria,
    lastCriticResult,
    activeChatId,
    scanRepo,
    activeWorkspaceId,
  ]);

  const handleImplement = useCallback(async () => {
    const targetRoot = materializeTargetPath.trim();
    if (!targetRoot || !accessToken || !greenfieldSessionId || !activeWorkspaceId || virtualNodes.length === 0) return;
    setMaterializeError(null);
    setImplementLoading(true);
    try {
      const res = await fetch(`${API_BASE}/greenfield/implement`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          sessionId: greenfieldSessionId,
          workspaceId: activeWorkspaceId,
          targetRoot,
          acceptanceCriteria: greenfieldAcceptanceCriteria ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      const railIds = Array.isArray(data.railIds) ? data.railIds : [];
      const errors = Array.isArray(data.errors) ? data.errors : [];
      setShowMaterializeModal(false);
      setChatSessions((prev) => {
        const current = prev[activeChatId] ?? [];
        const msg =
          railIds.length > 0
            ? `Started implementing ${railIds.length} node(s). Rails are running in the background. Check the board for progress.${
                errors.length > 0 ? ` (${errors.length} failed: ${errors.join("; ")})` : ""
              }`
            : errors.length > 0
              ? `Implement failed: ${errors.join("; ")}`
              : "No nodes implemented.";
        return { ...prev, [activeChatId]: [...current, { role: "assistant", content: msg }] };
      });
      if (railIds.length > 0) {
        setSelectedRailId(railIds[0]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMaterializeError(msg);
      setChatSessions((prev) => {
        const current = prev[activeChatId] ?? [];
        return { ...prev, [activeChatId]: [...current, { role: "assistant", content: `Implement failed: ${msg}` }] };
      });
    } finally {
      setImplementLoading(false);
    }
  }, [
    materializeTargetPath,
    accessToken,
    greenfieldSessionId,
    activeWorkspaceId,
    virtualNodes.length,
    greenfieldAcceptanceCriteria,
    activeChatId,
  ]);

  const handleApprovePendingRail = useCallback(async () => {
    if (!pendingRailApproval || !accessToken) return;
    const { railId, rootPath } = pendingRailApproval;
    try {
      const res = await fetch(`${API_BASE}/materialize/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ rootPath, railId, force: materializeDiffWarning != null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data && data.code === "MATERIALIZE_DIFF_TOO_LARGE") {
          setMaterializeDiffWarning({
            message:
              typeof data.error === "string"
                ? data.error
                : "This change set is large. Please double-check before approving.",
            limits: data.limits,
            actual: data.actual,
          });
          return;
        }
        throw new Error(data.error || res.statusText);
      }
      setMaterializeDiffWarning(null);
      setPendingRailApproval(null);
      setVirtualNodes([]);
      setVirtualEdges([]);
      setDesignHistory([]);
      setMaterializeTargetPath("");
      if (activeWorkspaceId) {
        try {
          const r = await fetch(`${API_BASE}/scan/refresh`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ workspaceId: activeWorkspaceId }),
          });
          const refreshData = await r.json().catch(() => ({}));
          if (r.ok && refreshData.nodes) {
            setGraph(analyseGraph(refreshData));
          }
        } catch {
          // ignore
        }
      }
      setChatSessions((prev) => {
        const current = prev[activeChatId] ?? [];
        return {
          ...prev,
          [activeChatId]: [...current, { role: "assistant", content: "Materialization approved and applied." }],
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMaterializeError(msg);
      setChatSessions((prev) => {
        const current = prev[activeChatId] ?? [];
        return {
          ...prev,
          [activeChatId]: [...current, { role: "assistant", content: `Approve failed: ${msg}` }],
        };
      });
    }
  }, [pendingRailApproval, accessToken, activeWorkspaceId, activeChatId]);

  const [violationRailStatus, setViolationRailStatus] = useState<Record<string, { railId: string; state: string }>>({});

  useEffect(() => {
    const vWithRail = activeViolations.filter((v) => (v as any).railId);
    if (vWithRail.length === 0) return;
    setViolationRailStatus((prev) => {
      const next = { ...prev };
      for (const v of vWithRail) {
        const rid = (v as any).railId as string;
        const k = violationKey(v);
        if (rid && (!next[k] || next[k].railId !== rid))
          next[k] = { railId: rid, state: "CREATED" };
      }
      return next;
    });
  }, [activeViolations]);

  useEffect(() => {
    setViolationRailStatus((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [vKey, entry] of Object.entries(prev)) {
        const rail = rails.find((r) => r.id === entry.railId);
        if (rail && rail.state && rail.state !== entry.state) {
          next[vKey] = { ...entry, state: rail.state };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rails]);

  const handleFixViolation = useCallback(
    (v: CriticViolation) => {
      const vKey = violationKey(v);
      const fixPrompt = `Fix the ${v.type.replace(/_/g, " ")}: ${v.description ?? v.suggestedFix ?? `${v.sourceNodeId} → ${v.targetNodeId ?? "?"}`}`;
      fixPromptRef.current = fixPrompt;
      setViolationBeingFixed(vKey);
      (async () => {
        try {
          if (!accessToken || !activeWorkspaceId) return;
          const res = await fetch(`${API_BASE}/rails/from-violation`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ workspaceId: activeWorkspaceId, violation: v }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            setViolationBeingFixed(null);
            return;
          }
          const railId = data.railId;
          if (!railId) {
            setViolationBeingFixed(null);
            return;
          }
          setViolationRailStatus((prev) => ({ ...prev, [vKey]: { railId, state: "PRE_PLANNING" } }));
          setRails((prev) => [
            ...prev,
            {
              id: railId,
              outcome: v.description ?? "Fix violation",
              state: "PRE_PLANNING",
              archetype: "analysis-chat",
              logicPath: [],
              tasks: [],
              updatedAt: Date.now(),
              createdAt: Date.now(),
            } as any,
          ]);
          setSidebarTab("dashboard");
          setMainViewMode("board");
          setSelectedRailId(railId);
          const execRes = await fetch(
            `${API_BASE}/rails/${encodeURIComponent(railId)}/execute?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
          const execData = await execRes.json().catch(() => ({}));
          if (execRes.ok) {
            setViolationRailStatus((prev) => ({
              ...prev,
              [vKey]: { railId, state: "EXECUTING" },
            }));
            setRails((prev) =>
              prev.map((r) => (r.id === railId ? { ...r, state: "EXECUTING" } : r))
            );
          }
        } finally {
          fixPromptRef.current = null;
          setViolationBeingFixed(null);
        }
      })();
    },
    [accessToken, activeWorkspaceId]
  );

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
  const driftEdges = graph?.edges.filter((e) => e.isDrift) ?? [];
  const missingContextNodes = graph?.nodes.filter((n) => !n.health?.hasContext) ?? [];
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

        {/* Greenfield entry CTA when graph is empty and no proposed nodes */}
        {sidebarTab === "dashboard" &&
          graph?.nodes.length === 0 &&
          (virtualNodes?.length ?? 0) === 0 && (
            <div
              style={{
                background: "#111827",
                borderRadius: 8,
                padding: 12,
                border: "1px dashed #4b5563",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: "#e5e7eb",
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                Start in Greenfield Mode
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#9ca3af",
                  marginBottom: 10,
                }}
              >
                Design a new architecture from scratch. The agent will propose modules and
                connections on the canvas without requiring a scanned repository.
              </div>
              <button
                type="button"
                onClick={() => {
                  setSidebarTab("chat");
                  setAiQuestion(
                    graph?.projectName
                      ? `Design a clean, modular architecture for ${graph.projectName} from scratch.`
                      : "Design a clean, modular architecture for a new project from scratch."
                  );
                }}
                style={{
                  padding: "6px 10px",
                  fontSize: 12,
                  background: "#4c1d95",
                  color: "#e5e7eb",
                  borderRadius: 6,
                  border: "1px solid #7c3aed",
                  cursor: "pointer",
                }}
              >
                Design from scratch
              </button>
            </div>
          )}

        {/* Dashboard content: project overview, health, execution, violations, governance, proposed nodes */}
        {sidebarTab === "dashboard" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.1fr)",
              gap: 12,
            }}
          >
            {/* System Overview */}
            <DashboardCard title="System Overview">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                <DashboardMetric
                  value={graph!.nodes.length + (virtualNodes?.length ?? 0)}
                  label="Modules"
                />
                <DashboardMetric
                  value={graph!.edges.length + (virtualEdges?.length ?? 0)}
                  label="Connections"
                />
                <DashboardMetric
                  value={driftEdges.length}
                  label="Drift"
                  color={driftEdges.length > 0 ? "#f85149" : "#3fb950"}
                />
                <DashboardMetric
                  value={missingContextNodes.length}
                  label="No context"
                  color={missingContextNodes.length > 0 ? "#f0883e" : "#3fb950"}
                />
              </div>
            </DashboardCard>

            {/* Health & Risk */}
            <DashboardCard title="Health & Risk">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                <DashboardMetric
                  value={criticalViolationsCount}
                  label="Critical"
                  color={criticalViolationsCount > 0 ? "#f85149" : "#3fb950"}
                  subLabel={criticalViolationsCount > 0 ? `↑ ${criticalViolationsCount} active` : "none"}
                  subColor="#f85149"
                />
                <DashboardMetric
                  value={highViolationsCount}
                  label="High severity"
                  color={highViolationsCount > 0 ? "#d29922" : "#3fb950"}
                  subLabel={highViolationsCount > 0 ? `↑ ${highViolationsCount} open` : "none"}
                  subColor="#d29922"
                />
                <DashboardMetric
                  value={activeViolations.length}
                  label="Total violations"
                  color="#e6edf3"
                  subLabel="— all time"
                  subColor="#7d8590"
                />
              </div>
            </DashboardCard>

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
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {violationRailStatus[violationKey(v)] ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSidebarTab("dashboard");
                                    setMainViewMode("board");
                                    setSelectedRailId(violationRailStatus[violationKey(v)].railId);
                                  }}
                                  style={{
                                    flex: 1,
                                    padding: "5px 0",
                                    fontSize: 10,
                                    background: "#1e3a5f",
                                    color: "#58a6ff",
                                    border: "1px solid #2563eb",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    letterSpacing: "0.08em",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Rail: {violationRailStatus[violationKey(v)].state} · View
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleFixViolation(v);
                                  }}
                                  disabled={violationBeingFixed === violationKey(v)}
                                  style={{
                                    flex: 1,
                                    padding: "5px 0",
                                    fontSize: 10,
                                    background: violationBeingFixed === violationKey(v) ? "#388934" : "#238636",
                                    color: "white",
                                    border: "none",
                                    borderRadius: 4,
                                    cursor: violationBeingFixed === violationKey(v) ? "wait" : "pointer",
                                    opacity: violationBeingFixed === violationKey(v) ? 0.9 : 1,
                                    letterSpacing: "0.08em",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  {violationBeingFixed === violationKey(v) ? "Creating rail…" : "✦ Fix now"}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
              </div>
            </DashboardCard>

          </div>
        )}

        {virtualNodes.length > 0 && (
        <div
          style={{
              background: "#1c2128",
              borderRadius: 8,
              padding: 12,
              border: "1px solid #4b5563",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#a78bfa",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                ◈ Proposed nodes
              </div>
              {designHistory.length > 0 && (
                <button
                  onClick={handleUndoDesign}
                  style={{
                    padding: "2px 6px",
                    fontSize: 10,
                    background: "#21262d",
                    color: "#58a6ff",
                    border: "1px solid #30363d",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                  title="Undo last change"
                >
                  Undo
                </button>
              )}
            </div>
            {materializeError && (
              <div
                style={{
                  marginBottom: 8,
                  padding: 8,
                  borderRadius: 6,
                  background: "rgba(248,81,73,0.12)",
                  border: "1px solid #f85149",
                  color: "#f85149",
                  fontSize: 11,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>{materializeError}</span>
                <button
                  type="button"
                  onClick={() => setMaterializeError(null)}
                  style={{
                    padding: "2px 6px",
                    fontSize: 10,
                    background: "transparent",
                    color: "#f85149",
                    border: "1px solid #f85149",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}
            {virtualNodes.map((vn) => (
              <div
                key={vn.id}
                style={{
                  padding: "6px 0",
                  borderBottom: "1px solid #21262d",
                  gap: 6,
                }}
              >
                {editingVirtualNodeId === vn.id && editingDraft ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <input
                      value={editingDraft.label}
                      onChange={(e) =>
                        setEditingDraft((d) => (d ? { ...d, label: e.target.value } : d))
                      }
                      placeholder="Label"
                      autoFocus
                      style={{
                        padding: "4px 6px",
                        fontSize: 12,
                        background: "#0d1117",
                        border: "1px solid #30363d",
                        borderRadius: 4,
                        color: "#e6edf3",
                        outline: "none",
                      }}
                    />
                    <input
                      value={editingDraft.archNodeId}
                      onChange={(e) =>
                        setEditingDraft((d) => (d ? { ...d, archNodeId: e.target.value } : d))
                      }
                      placeholder="Folder path"
                      style={{
                        padding: "4px 6px",
                        fontSize: 11,
                        background: "#0d1117",
                        border: "1px solid #30363d",
                        borderRadius: 4,
                        color: "#e6edf3",
                        outline: "none",
                      }}
                    />
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        onClick={() => {
                          handleUpdateVirtualNode(vn.id, {
                            label: editingDraft.label,
                            archNodeId: editingDraft.archNodeId,
                          });
                          setEditingDraft(null);
                        }}
                        style={{
                          padding: "3px 8px",
                          fontSize: 10,
                          background: "#238636",
                          color: "white",
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingVirtualNodeId(null);
                          setEditingDraft(null);
                        }}
                        style={{
                          padding: "3px 8px",
                          fontSize: 10,
                          background: "#30363d",
                          color: "#e6edf3",
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#e2e8f0",
                          fontWeight: 600,
                        }}
                      >
                        {vn.label}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
            color: "#7d8590",
                        }}
                      >
                        {vn.archNodeId ?? vn.id} · {vn.layer ?? "Uncategorized"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap" }}>
                      {accessToken && activeWorkspaceId && greenfieldSessionId && (
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch(
                                  `${API_BASE}/greenfield/nodes/${encodeURIComponent(vn.id)}/to-rail`,
                                  {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      Authorization: `Bearer ${accessToken}`,
                                    },
                                    body: JSON.stringify({
                                      sessionId: greenfieldSessionId,
                                      workspaceId: activeWorkspaceId,
                                    }),
                                  }
                                );
                                const data = await res.json().catch(() => ({}));
                                if (!res.ok) {
                                  console.warn(
                                    typeof data.error === "string" ? data.error : "Create & run failed."
                                  );
                                  return;
                                }
                                const railId = data.railId;
                                if (railId) {
                                  setMainViewMode("board");
                                  setSelectedRailId(railId);
                                }
                              } catch (err) {
                                console.warn(err instanceof Error ? err.message : "Create & run failed.");
                              }
                            }}
                            style={{
                              padding: "3px 8px",
                              fontSize: 10,
                              background: "#238636",
                              color: "white",
                              border: "1px solid #238636",
                              borderRadius: 4,
                              cursor: "pointer",
                            }}
                            title="Create rail and start execution"
                          >
                            Run
                          </button>
                      )}
                      <button
                        onClick={() => {
                          setEditingVirtualNodeId(vn.id);
                          setEditingDraft({
                            label: vn.label,
                            archNodeId: vn.archNodeId ?? vn.id,
                          });
                        }}
                        style={{
                          padding: "3px 8px",
                          fontSize: 10,
                          background: "#21262d",
                          color: "#58a6ff",
                          border: "1px solid #30363d",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                        title="Edit label and path"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleConfirmNode(vn)}
                        style={{
                          padding: "3px 8px",
                          fontSize: 10,
                          background: "#238636",
                          color: "white",
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                        title="Scaffold this node on disk"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => handleDiscardNode(vn.id)}
                        style={{
                          padding: "3px 8px",
                          fontSize: 10,
                          background: "#21262d",
                          color: "#f85149",
                          border: "1px solid #f85149",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                        title="Discard this proposal"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <button
              onClick={() => {
                setMaterializeTargetPath(graph?.projectRoot ?? "");
                setShowMaterializeModal(true);
              }}
              disabled={
                tasksForWorkspace.some(
                  (t) =>
                    (t.hallucinationIndex ?? 0) > 0.5 && t.hallucinationAcknowledged !== true
                )
              }
              style={{
                width: "100%",
                marginTop: 10,
                padding: "8px 12px",
                background: "#7c3aed",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 600,
                opacity: tasksForWorkspace.some(
                  (t) => (t.hallucinationIndex ?? 0) > 0.5 && t.hallucinationAcknowledged !== true
                )
                  ? 0.5
                  : 1,
              }}
              title={
                tasksForWorkspace.some(
                  (t) => (t.hallucinationIndex ?? 0) > 0.5 && t.hallucinationAcknowledged !== true
                )
                  ? "Acknowledge drift in the task detail panel first"
                  : "Create folders and index files for all proposed nodes"
              }
            >
              Materialize this Architecture
            </button>
            <button
              onClick={handleResetGreenfieldDraft}
              style={{
                width: "100%",
                marginTop: 8,
                padding: "8px 12px",
                background: "#0d1117",
                color: "#f85149",
                border: "1px solid #f85149",
                borderRadius: 6,
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 600,
              }}
              title="Delete the saved draft and start over"
            >
              Reset Greenfield Draft
            </button>
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
              background:
                graph?.nodes.length === 0 && (virtualNodes?.length ?? 0) > 0
                  ? "rgba(22,163,74,0.16)"
                  : "rgba(59,130,246,0.16)",
              color:
                graph?.nodes.length === 0 && (virtualNodes?.length ?? 0) > 0
                  ? "#4ade80"
                  : "#93c5fd",
              border:
                graph?.nodes.length === 0 && (virtualNodes?.length ?? 0) > 0
                  ? "1px solid rgba(34,197,94,0.4)"
                  : "1px solid rgba(59,130,246,0.4)",
            }}
          >
            {graph?.nodes.length === 0 && (virtualNodes?.length ?? 0) > 0
              ? "Greenfield"
              : "Analysis"}
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
                          {t.railId && (
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setMainViewMode("board");
                                setSelectedRailId(t.railId ?? null);
                                setActiveTaskId(null);
                              }}
                              style={{
                                fontSize: 10,
                                color: "#58a6ff",
                                textDecoration: "none",
                              }}
                            >
                              View on Board
                            </a>
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
                        Acknowledge drift to allow materialize.
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
                {(task.kind === "materialize" || task.label === "Materialize architecture") &&
                  (() => {
                    const paths: string[] =
                      task.status === "completed" && task.result && typeof task.result === "object" && Array.isArray((task.result as { created?: string[] }).created)
                        ? (task.result as { created: string[] }).created
                        : virtualNodes.map((n) => {
                            const id = n.archNodeId ?? n.id;
                            return /\.(ts|tsx|js|jsx)$/.test(id) ? id : `${id}/index.ts`;
                          });
                    if (paths.length === 0) return null;
                    const isDone = task.status === "completed";
                    return (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ color: "#e5e7eb", fontSize: 11, marginBottom: 4 }}>
                          <strong>Files</strong>
                        </div>
                        <div
                          style={{
                            maxHeight: 100,
                            overflowY: "auto",
                            padding: "6px 8px",
                            background: "#0d1117",
                            borderRadius: 4,
                            border: "1px solid #21262d",
                            fontSize: 10,
                            fontFamily: "monospace",
                            color: "#9ca3af",
                          }}
                        >
                          {paths.map((p, i) => (
                            <div
                              key={i}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "2px 0",
                              }}
                            >
                              <span style={{ color: isDone ? "#22c55e" : "#6b7280", flexShrink: 0 }}>
                                {isDone ? "✓" : "⏳"}
                              </span>
                              <span style={{ wordBreak: "break-all" }}>{p}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                {(task.kind === "materialize" || task.label === "Materialize architecture") &&
                  task.status === "failed" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (virtualNodes.length > 0 && materializeTargetPath.trim()) {
                        handleMaterialize();
                      } else {
                        setShowMaterializeModal(true);
                      }
                    }}
                    style={{
                      marginTop: 4,
                      padding: "6px 12px",
                      fontSize: 11,
                      background: "rgba(34,197,94,0.2)",
                      color: "#4ade80",
                      border: "1px solid #22c55e",
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    Retry materialize
                  </button>
                )}
                {task.status === "completed" &&
                  task.label === "Materialize architecture" &&
                  lastMaterializedSnapshot && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!lastMaterializedSnapshot || !accessToken) return;
                      try {
                        const res = await fetch(`${API_BASE}/materialize/undo`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${accessToken}`,
                          },
                          body: JSON.stringify({
                            targetRoot: lastMaterializedSnapshot.targetRoot,
                            created: lastMaterializedSnapshot.created,
                          }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          throw new Error(data.error || res.statusText);
                        }
                        setLastMaterializedSnapshot(null);
                        setChatSessions((prev) => {
                          const current = prev[activeChatId] ?? [];
                          const msg = data.message ?? "Undo materialization completed.";
                          return {
                            ...prev,
                            [activeChatId]: [...current, { role: "assistant", content: msg }],
                          };
                        });
                        if (lastMaterializedSnapshot.targetRoot) {
                          setRepoUrl(lastMaterializedSnapshot.targetRoot);
                          await scanRepo(lastMaterializedSnapshot.targetRoot);
                        }
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        setMaterializeError(msg);
                        setChatSessions((prev) => {
                          const current = prev[activeChatId] ?? [];
                          return {
                            ...prev,
                            [activeChatId]: [...current, { role: "assistant", content: `Undo failed: ${msg}` }],
                          };
                        });
                      }
                    }}
                    style={{
                      marginTop: 4,
                      padding: "4px 8px",
                      fontSize: 10,
                      background: "rgba(248,81,73,0.15)",
                      color: "#f87171",
                      border: "1px solid #f87171",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    Undo materialization
                  </button>
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
                          <button
                            type="button"
                            onClick={() => {
                              setMainViewMode("board");
                              setSelectedRailId(railId);
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              margin: 0,
                              font: "inherit",
                              color: "#58a6ff",
                              cursor: "pointer",
                              textDecoration: "underline",
                            }}
                          >
                            {children}
                          </button>
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
                            onClick={() => {
                              setMainViewMode("board");
                              setSelectedRailId(r.id);
                            }}
                            style={{
                              fontSize: 11,
                              padding: "4px 10px",
                              borderRadius: 6,
                              border: "1px solid #30363d",
                              background: "#21262d",
                              color: "#58a6ff",
                              cursor: "pointer",
                            }}
                          >
                            View rail {r.id.slice(0, 12)}…
                          </button>
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

          {virtualNodes.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button
                onClick={() => handleAsk("Please revise this design.")}
                disabled={chatLoading}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  background: "#21262d",
                  color: "#58a6ff",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  cursor: chatLoading ? "wait" : "pointer",
                }}
                title="Ask the agent to revise the proposed architecture"
              >
                Fix this
              </button>
            </div>
          )}

          {lastMaterializedSnapshot && (
            <div
              style={{
                padding: "8px 10px",
                background: "rgba(34,197,94,0.1)",
                border: "1px solid rgba(34,197,94,0.3)",
                borderRadius: 6,
                fontSize: 11,
                color: "#4ade80",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <span>Materialized {lastMaterializedSnapshot.created.length} file(s) into {lastMaterializedSnapshot.targetRoot}</span>
              <button
                type="button"
                onClick={async () => {
                  if (!lastMaterializedSnapshot || !accessToken) return;
                  try {
                    const res = await fetch(`${API_BASE}/materialize/undo`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${accessToken}`,
                      },
                      body: JSON.stringify({
                        targetRoot: lastMaterializedSnapshot.targetRoot,
                        created: lastMaterializedSnapshot.created,
                      }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      throw new Error(data.error || res.statusText);
                    }
                    setLastMaterializedSnapshot(null);
                    setChatSessions((prev) => {
                      const current = prev[activeChatId] ?? [];
                      const msg = data.message ?? "Undo materialization completed.";
                      return {
                        ...prev,
                        [activeChatId]: [...current, { role: "assistant", content: msg }],
                      };
                    });
                    if (lastMaterializedSnapshot.targetRoot) {
                      setRepoUrl(lastMaterializedSnapshot.targetRoot);
                      await scanRepo(lastMaterializedSnapshot.targetRoot);
                    }
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    setMaterializeError(msg);
                    setChatSessions((prev) => {
                      const current = prev[activeChatId] ?? [];
                      return {
                        ...prev,
                        [activeChatId]: [...current, { role: "assistant", content: `Undo failed: ${msg}` }],
                      };
                    });
                  }
                }}
                style={{
                  padding: "2px 8px",
                  fontSize: 10,
                  background: "transparent",
                  color: "#4ade80",
                  border: "1px solid rgba(34,197,94,0.5)",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Undo
              </button>
            </div>
          )}

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
                    if (virtualNodes.length > 0 && greenfieldSessionId) {
                      setShowReplaceDraftPrompt(true);
                    } else {
                      setShowNewRepoConfirm(true);
                    }
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

      {showReplaceDraftPrompt && (
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
          onClick={() => setShowReplaceDraftPrompt(false)}
        >
          <div
            style={{
              background: "#21262d",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 20,
              maxWidth: 380,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: 12, fontSize: 14, color: "#e6edf3" }}>
              Replace existing draft?
            </div>
            <div style={{ marginBottom: 16, fontSize: 12, color: "#9ca3af" }}>
              You have an unsaved Greenfield draft. What would you like to do?
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                onClick={() => setShowReplaceDraftPrompt(false)}
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
                onClick={() => {
                  setShowReplaceDraftPrompt(false);
                  // Keep existing — stay on current draft
                }}
                style={{
                  padding: "8px 16px",
                  background: "#238636",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Keep existing
              </button>
              <button
                onClick={() => {
                  setShowReplaceDraftPrompt(false);
                  handleNewRepo();
                }}
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
                Replace
              </button>
            </div>
          </div>
        </div>
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

      {showMaterializeModal && (
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
          onClick={() => !materializeLoading && !implementLoading && setShowMaterializeModal(false)}
        >
          <div
            style={{
              background: "#21262d",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 20,
              maxWidth: 400,
              width: "90%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: 12, fontSize: 14, color: "#e6edf3" }}>
              Materialize or Implement
            </div>
            <div
              style={{
                marginBottom: 12,
                fontSize: 11,
                color: "#7d8590",
              }}
            >
              <strong>Materialize</strong> — creates folders and index stubs. <strong>Implement</strong> — runs the
              code writer to generate real implementations for each node.
            </div>
            <div style={{ marginBottom: 12, fontSize: 12, color: "#7d8590" }}>
              Enter the target folder path where modules will be created:
            </div>
            {virtualNodes.length > 0 && (() => {
              const base = materializeTargetPath.trim();
              const paths = virtualNodes.map((vn) => {
                const path = vn.archNodeId ?? vn.id;
                return path.includes(".") ? path : `${path}/index.ts`;
              });
              const fullPaths = base ? paths.map((p) => `${base}/${p}`) : paths;
              const tree: Record<string, unknown> = {};
              for (const p of fullPaths) {
                const parts = p.split("/").filter(Boolean);
                let cur: Record<string, unknown> = tree;
                for (let i = 0; i < parts.length; i++) {
                  const key = parts[i];
                  const isFile = i === parts.length - 1 && (key.includes(".") || key === "index.ts");
                  if (isFile) {
                    cur[key] = "file";
                  } else {
                    if (!(key in cur) || cur[key] === "file") cur[key] = {};
                    cur = cur[key] as Record<string, unknown>;
                  }
                }
              }
              const renderTree = (obj: Record<string, unknown>, indent: number) => {
                return Object.entries(obj).map(([k, v]) =>
                  v === "file" ? (
                    <div key={k} style={{ fontFamily: "monospace", marginLeft: indent * 12, marginBottom: 2, color: "#94a3b8" }}>
                      {k}
                    </div>
                  ) : (
                    <div key={k}>
                      <div style={{ fontFamily: "monospace", marginLeft: indent * 12, marginBottom: 2, color: "#a78bfa" }}>
                        {k}/
                      </div>
                      {renderTree((v as Record<string, unknown>) ?? {}, indent + 1)}
                    </div>
                  )
                );
              };
              return (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 8,
                    background: "#0d1117",
                    borderRadius: 6,
                    fontSize: 11,
                    color: "#7d8590",
                    maxHeight: 140,
                    overflowY: "auto",
                  }}
                >
                  <div style={{ marginBottom: 6, color: "#a78bfa" }}>
                    Will create {virtualNodes.length} node(s):
                  </div>
                  {renderTree(tree, 0)}
                </div>
              );
            })()}
            <input
              type="text"
              value={materializeTargetPath}
              onChange={(e) => setMaterializeTargetPath(e.target.value)}
              placeholder="/path/to/project"
              disabled={materializeLoading}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 13,
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: 6,
                color: "#e6edf3",
                outline: "none",
                boxSizing: "border-box",
                marginBottom: 16,
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                onClick={() => !materializeLoading && !implementLoading && setShowMaterializeModal(false)}
                disabled={materializeLoading || implementLoading}
                style={{
                  padding: "8px 16px",
                  background: "#30363d",
                  color: "#e6edf3",
                  border: "none",
                  borderRadius: 6,
                  cursor: materializeLoading || implementLoading ? "wait" : "pointer",
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleMaterialize}
                disabled={materializeLoading || implementLoading || !materializeTargetPath.trim()}
                style={{
                  padding: "8px 16px",
                  background: "#6e40c9",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: materializeLoading || implementLoading ? "wait" : "pointer",
                  fontSize: 13,
                }}
              >
                {materializeLoading ? "Creating…" : "Materialize"}
              </button>
              <button
                onClick={handleImplement}
                disabled={materializeLoading || implementLoading || !materializeTargetPath.trim()}
                style={{
                  padding: "8px 16px",
                  background: "#238636",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: materializeLoading || implementLoading ? "wait" : "pointer",
                  fontSize: 13,
                }}
                title="Create rails and run the code writer for each node"
              >
                {implementLoading ? "Implementing…" : "Implement"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRailApproval && (
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
          onClick={() => setPendingRailApproval(null)}
        >
          <div
            style={{
              background: "#21262d",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 20,
              maxWidth: 420,
              width: "90%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: 10, fontSize: 14, color: "#e6edf3" }}>
              Approve materialization
            </div>
            <div style={{ marginBottom: 12, fontSize: 12, color: "#7d8590" }}>
              Rail: <span style={{ fontFamily: "monospace", color: "#a78bfa" }}>{pendingRailApproval.railId}</span>
            </div>
            <div style={{ marginBottom: 16, fontSize: 12, color: "#7d8590" }}>
              Target: <span style={{ fontFamily: "monospace", color: "#94a3b8" }}>{pendingRailApproval.rootPath}</span>
            </div>
            {materializeDiffWarning && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "rgba(248,81,73,0.08)",
                  border: "1px solid rgba(248,81,73,0.4)",
                  fontSize: 11,
                  color: "#f85149",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Large change warning</div>
                <div style={{ marginBottom: 4 }}>
                  {materializeDiffWarning.message}
                </div>
                {(materializeDiffWarning.actual?.changedFiles != null ||
                  materializeDiffWarning.actual?.totalBytes != null) && (
                  <div style={{ color: "#e6edf3" }}>
                    {materializeDiffWarning.actual?.changedFiles != null && (
                      <span>
                        Files changed: {materializeDiffWarning.actual.changedFiles}
                        {materializeDiffWarning.limits?.maxChangedFiles != null
                          ? ` (limit ${materializeDiffWarning.limits.maxChangedFiles})`
                          : ""}
                      </span>
                    )}
                    {materializeDiffWarning.actual?.totalBytes != null && (
                      <span>
                        {materializeDiffWarning.actual?.changedFiles != null ? " · " : ""}
                        Approx. bytes: {materializeDiffWarning.actual.totalBytes.toLocaleString()}
                        {materializeDiffWarning.limits?.maxTotalBytes != null
                          ? ` (limit ${materializeDiffWarning.limits.maxTotalBytes.toLocaleString()})`
                          : ""}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setPendingRailApproval(null)}
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
                Not yet
              </button>
              <button
                onClick={handleApprovePendingRail}
                style={{
                  padding: "8px 16px",
                  background: "#7c3aed",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Approve & apply
              </button>
            </div>
          </div>
        </div>
      )}

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* [ Graph | Board | Chat ] tabs + persona selector */}
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
          {mainViewMode === "graph" && graph && (
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
                      setWorkspaceTitleDraft(graph.projectName ?? (isGreenfieldMode ? "New Design" : "My workspace"));
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
                      setWorkspaceTitleDraft(graph.projectName ?? (isGreenfieldMode ? "New Design" : "My workspace"));
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
                  {graph.projectName ?? (isGreenfieldMode ? "New Design" : "My workspace")}
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
                          setWorkspaceTitleDraft(graph.projectName ?? (isGreenfieldMode ? "New Design" : "My workspace"));
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
            </div>
          )}
          {(["graph", "board"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                const hasActiveTask = tasksForWorkspace.some((t) => t.status === "running");
                const hasUnsavedGhosts = virtualNodes.length > 0;
                if ((hasActiveTask || hasUnsavedGhosts) && mainViewMode !== mode) {
                  setPendingModeSwitch(mode);
                  setShowModeSwitchConfirm(true);
                  return;
                }
                setMainViewMode(mode);
              }}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid transparent",
                background: mainViewMode === mode ? "#238636" : "transparent",
                color: mainViewMode === mode ? "white" : "#8b949e",
                cursor: "pointer",
              }}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {mainViewMode === "graph" && (
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
        {mainViewMode === "graph" && (
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
              viewMode={graphViewMode}
              onViewModeChange={setGraphViewMode}
              canvasViewMode={graphCanvasViewMode}
              onCanvasViewModeChange={setGraphCanvasViewMode}
              layoutMode={graphLayoutMode}
              onLayoutModeChange={setGraphLayoutMode as any}
              agentGraphCommand={
                mainViewMode === "graph" && railImpactNodeIds && railImpactNodeIds.length > 0
                  ? { action: "highlight_nodes" as const, nodeIds: railImpactNodeIds }
                  : mainViewMode === "graph" &&
                    selectedRailDetail &&
                    (selectedRailDetail.baselineNodeIds?.length ||
                      (Array.isArray(selectedRailDetail.logicPath) &&
                        selectedRailDetail.logicPath.some((s: any) => s && typeof s.nodeId === "string")))
                  ? {
                      action: "highlight_nodes" as const,
                      nodeIds:
                        selectedRailDetail.baselineNodeIds ??
                        (selectedRailDetail.logicPath ?? [])
                          .map((s: any) => (s && typeof s.nodeId === "string" ? s.nodeId : null))
                          .filter(Boolean),
                    }
                  : agentGraphCommand
              }
              proposedNodes={virtualNodes}
              proposedEdges={virtualEdges}
              theme={canvasTheme}
              density={canvasDensity}
              ghostNodeStatus={
                virtualNodes.length > 0 &&
                tasksForWorkspace.some((t) => t.kind === "materialize" && t.status === "failed")
                  ? "error"
                  : undefined
              }
              workspaceId={activeWorkspaceId ?? undefined}
              accessToken={accessToken}
              violationBeingFixedKey={violationBeingFixed}
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
            {railImpactNodeIds && railImpactNodeIds.length > 0 && selectedRailDetail && (
              <div
                style={{
                  position: "absolute",
                  top: 12,
                  left: 12,
                  padding: "6px 12px",
                  borderRadius: 8,
                  background: "rgba(30,58,95,0.95)",
                  border: "1px solid #2563eb",
                  color: "#7dd3fc",
                  fontSize: 11,
                  fontWeight: 600,
                  zIndex: 10,
                }}
              >
                Impact: {railImpactNodeIds.length} node{railImpactNodeIds.length !== 1 ? "s" : ""}
              </div>
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
        {mainViewMode === "board" && (
          <div
            style={{
              flex: 1,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              background: "#0d1117",
              minWidth: 0,
            }}
          >
            <div style={{ padding: "16px 16px 12px", flexShrink: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "#7d8590",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Board
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#9ca3af",
                    fontFamily: "monospace",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span>
                    rails: {rails.length}
                  </span>
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: 999,
                      border: "1px solid #374151",
                      background: executingRailsCount > 0 ? "rgba(56,189,248,0.12)" : "rgba(15,23,42,1)",
                      color: executingRailsCount > 0 ? "#7dd3fc" : "#9ca3af",
                    }}
                    title="Concurrent agent executions in this workspace"
                  >
                    running: {executingRailsCount}
                  </span>
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: 999,
                      border: "1px solid #374151",
                      background: activeRailsCount > executingRailsCount ? "rgba(234,179,8,0.12)" : "rgba(15,23,42,1)",
                      color: activeRailsCount > executingRailsCount ? "#facc15" : "#9ca3af",
                    }}
                    title="Non-terminal rails waiting for a free execution slot or verification"
                  >
                    queue: {Math.max(0, activeRailsCount - executingRailsCount)}
                  </span>
                </div>
              </div>
            </div>
            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "0 16px 16px",
                minHeight: 0,
              }}
            >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                marginBottom: 14,
                alignItems: "center",
                minWidth: 0,
              }}
            >
                  <input
                    type="text"
                    value={railSearch}
                    onChange={(e) => setRailSearch(e.target.value)}
                    placeholder="Search rails by outcome, archetype, session…"
                    style={{
                      flex: 1,
                      minWidth: 180,
                      padding: "6px 8px",
                      fontSize: 12,
                      borderRadius: 6,
                      border: "1px solid #30363d",
                      background: "#010409",
                      color: "#e6edf3",
                    }}
                  />
                  {savedWorkspaces.length > 1 && (
                    <select
                      value={railWorkspaceFilter ?? ""}
                      onChange={(e) => setRailWorkspaceFilter(e.target.value ? e.target.value : null)}
                      style={{
                        padding: "6px 8px",
                        fontSize: 12,
                        borderRadius: 6,
                        border: "1px solid #30363d",
                        background: "#010409",
                        color: "#e6edf3",
                      }}
                    >
                      <option value="">Current workspace</option>
                      {savedWorkspaces.map((w: { id: string; title?: string }) => (
                        <option key={w.id} value={w.id}>
                          {(w as { title?: string }).title ?? w.id}
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    value={railArchetypeFilter}
                    onChange={(e) => setRailArchetypeFilter(e.target.value)}
                    style={{
                      padding: "6px 8px",
                      fontSize: 12,
                      borderRadius: 6,
                      border: "1px solid #30363d",
                      background: "#010409",
                      color: "#e6edf3",
                    }}
                  >
                    <option value="all">All archetypes</option>
                    {Array.from(
                      new Set((rails ?? []).map((r) => r.archetype).filter((a): a is string => !!a))
                    ).map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      color: "#9ca3af",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={railOnlyWithFailures}
                      onChange={(e) => setRailOnlyWithFailures(e.target.checked)}
                    />
                    <span>Only with verification failures</span>
                  </label>
                </div>
            {railDropError && (
                  <div
                    style={{
                      marginBottom: 12,
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: "rgba(248,113,113,0.15)",
                      border: "1px solid rgba(248,113,113,0.5)",
                      color: "#fecaca",
                      fontSize: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>{railDropError.message}</span>
                      <button
                      type="button"
                      onClick={() => setRailDropError(null)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#fecaca",
                        cursor: "pointer",
                        fontSize: 14,
                        padding: "0 4px",
                      }}
                    >
                      ×
                    </button>
                    </div>
                    {(railDropError.code || railDropError.details) && (
                      <div style={{ fontSize: 11, color: "#fca5a5", opacity: 0.9 }}>
                        {[railDropError.code, railDropError.details].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    {railDropError.retryable && (
                      <div style={{ fontSize: 11, color: "#86efac" }}>You can retry by dragging again.</div>
                    )}
                  </div>
                )}
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "stretch",
                overflowX: "auto",
                overflowY: "hidden",
                paddingBottom: 8,
                minHeight: "min(420px, calc(100vh - 200px))",
              }}
            >
                {(
                  [
                    { key: "PRE_PLANNING", label: "Pre-planning" },
                    { key: "PLANNING", label: "Planning" },
                    { key: "AWAITING_APPROVAL", label: "Awaiting approval" },
                    { key: "EXECUTING", label: "Executing" },
                    { key: "AWAITING_HITL", label: "Awaiting HITL" },
                    { key: "VERIFYING", label: "Verifying" },
                    { key: "SELF_CORRECTING", label: "Self-correcting" },
                    { key: "MATERIALIZING", label: "Materializing" },
                    { key: "ARCHIVED", label: "Archived" },
                    { key: "FAILED", label: "Failed" },
                    { key: "SUSPENDED", label: "Suspended" },
                  ] as const
                ).map((col, colIndex) => {
                  const columnAll = filteredRails.filter((r) => r.state === col.key);
                  const items = columnAll.slice(0, railsPerColumn);
                  const isFirstColumn = colIndex === 0;
                  const showOnboarding = isFirstColumn && rails.length === 0;
                  const isTerminal = ["MATERIALIZING", "ARCHIVED", "FAILED"].includes(col.key);
                  return (
                    <div
                      key={col.key}
                      style={{
                        minWidth: 280,
                        width: 280,
                        flexShrink: 0,
                        background: isTerminal ? "#0f1419" : "#161b22",
                        borderRadius: 12,
                        border: isTerminal ? "1px solid #30363d" : "1px solid #21262d",
                        padding: 12,
                        display: "flex",
                        flexDirection: "column",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                        opacity: isTerminal ? 0.92 : 1,
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                      }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        setRailDropError(null);
                        const railId = e.dataTransfer.getData("application/x-rail-id");
                        if (!railId || !activeWorkspaceId || !accessToken) return;
                        try {
                          const res = await fetch(
                            `${API_BASE}/rails/${encodeURIComponent(railId)}/state?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
                            {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${accessToken}`,
                              },
                              body: JSON.stringify({ state: col.key }),
                            }
                          );
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            const payload = data as { error?: string; code?: string; details?: string; retryable?: boolean };
                            setRailDropError({
                              message: typeof payload.error === "string" ? payload.error : `Invalid transition.`,
                              code: payload.code,
                              details: payload.details,
                              retryable: payload.retryable,
                            });
                            setTimeout(() => setRailDropError(null), 8000);
                            return;
                          }
                          setRails((prev) =>
                            prev.map((r) => (r.id === railId ? { ...r, state: data.state ?? col.key } : r))
                          );
                        } catch (err) {
                          setRailDropError({
                            message: err instanceof Error ? err.message : "Failed to move rail.",
                            retryable: true,
                          });
                          setTimeout(() => setRailDropError(null), 8000);
                        }
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 10,
                          paddingBottom: 8,
                          borderBottom: "1px solid #21262d",
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3" }}>{col.label}</span>
                        <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>
                          {columnAll.length}
                          {columnAll.length > railsPerColumn ? ` (${items.length})` : ""}
                          {col.key === "EXECUTING" && columnAll.length > 0 && (
                            <span style={{ marginLeft: 6, color: "#58a6ff" }}>
                              · Queue {columnAll.length}
                            </span>
                          )}
                        </span>
                      </div>
                      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                          {showOnboarding ? (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#7d8590",
                            lineHeight: 1.5,
                            padding: 12,
                            background: "rgba(33,38,45,0.6)",
                            borderRadius: 8,
                            border: "1px dashed #30363d",
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 6, color: "#9ca3af" }}>No rails yet</div>
                          <div style={{ color: "#6b7280" }}>
                            Rails are agent work items that move left→right as tasks run. Create them
                            from Chat (analysis) or Greenfield (materialize). Each rail tracks tasks,
                            verification, and state.
                          </div>
                        </div>
                      ) : items.length === 0 ? (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#4b5563",
                            padding: 12,
                            fontStyle: "italic",
                          }}
                        >
                          No rails in this state. Drop rails here.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <VirtualizedRailList
                            items={items}
                            onCardClick={(r) => setSelectedRailId(r.id)}
                            queuePositionByRailId={queuePositionByRailId}
                            onApproveClick={
                              graph?.projectRoot
                                ? (r) => {
                                    setPendingRailApproval({ railId: r.id, rootPath: graph.projectRoot ?? "" });
                                    setSelectedRailId(null);
                                    setSelectedRailDetail(null);
                                  }
                                : undefined
                            }
                          />
                          {columnAll.length > items.length && (
                            <button
                              type="button"
                              onClick={() => setRailsPerColumn((n) => n + 50)}
                              style={{
                                marginTop: 4,
                                padding: "4px 6px",
                                fontSize: 10,
                                borderRadius: 999,
                                border: "1px solid #374151",
                                background: "#020617",
                                color: "#9ca3af",
                                cursor: "pointer",
                              }}
                            >
                              Show more…
                            </button>
                          )}
                        </div>
                      )}
                      </div>
                    </div>
                  );
                })}
            </div>
            </div>
          </div>
        )}
      </div>

      {selectedRailDetail && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => {
            setSelectedRailId(null);
            setSelectedRailDetail(null);
            setSelectedRailSandboxPaths(null);
            setSelectedRailDiffs(null);
            setRailImpactNodeIds(null);
          }}
        >
          <div
            style={{
              background: "#010409",
              borderRadius: 12,
              border: "1px solid #30363d",
              maxWidth: 720,
              width: "90%",
              maxHeight: "80vh",
              padding: 16,
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e6edf3" }}>
                Rail details
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedRailId(null);
                  setSelectedRailDetail(null);
                  setSelectedRailSandboxPaths(null);
                  setSelectedRailDiffs(null);
                  setRailImpactNodeIds(null);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#9ca3af",
                  cursor: "pointer",
                  fontSize: 16,
                }}
              >
                ×
              </button>
            </div>
            {graph && (
              <button
                type="button"
                onClick={async () => {
                  const wsId = mainViewMode === "board" ? effectiveRailsWorkspaceId : activeWorkspaceId;
                  if (!accessToken || !wsId || !selectedRailDetail) return;
                  setMainViewMode("graph");
                  try {
                    const r = await fetch(
                      `${API_BASE}/rails/${encodeURIComponent(selectedRailDetail.id)}/impact?workspaceId=${encodeURIComponent(wsId)}`,
                      { headers: { Authorization: `Bearer ${accessToken}` } }
                    );
                    const data = await r.json().catch(() => ({}));
                    if (!r.ok) return;
                    const baseIds = Array.isArray(data.baselineNodeIds) ? data.baselineNodeIds : [];
                    const changedFiles = Array.isArray(data.changedFiles) ? data.changedFiles : [];
                    const fileIds = new Set<string>();
                    for (const node of graph.nodes) {
                      for (const f of node.files ?? []) {
                        if (changedFiles.some((cf: string) => f.includes(cf) || cf.includes(f)))
                          fileIds.add(node.id);
                      }
                    }
                    setRailImpactNodeIds([...new Set([...baseIds, ...fileIds])]);
                  } catch {
                    setRailImpactNodeIds(
                      selectedRailDetail.baselineNodeIds ??
                        (selectedRailDetail.logicPath ?? [])
                          .map((s: any) => (s?.nodeId ? s.nodeId : null))
                          .filter(Boolean)
                    );
                  }
                }}
                style={{
                  marginBottom: 12,
                  padding: "6px 12px",
                  fontSize: 11,
                  background: "#1e3a5f",
                  color: "#58a6ff",
                  border: "1px solid #2563eb",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Show on graph
              </button>
            )}
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12 }}>
              <div style={{ marginBottom: 4 }}>
                <strong>ID:</strong>{" "}
                <span style={{ fontFamily: "monospace" }}>{selectedRailDetail.id}</span>
              </div>
              {selectedRailDetail.outcome && (
                <div style={{ marginBottom: 4 }}>
                  <strong>Outcome:</strong> {selectedRailDetail.outcome}
                </div>
              )}
              {selectedRailDetail.originSummary && (
                <div style={{ marginBottom: 4, fontSize: 11, color: "#94a3b8" }}>
                  <strong>Why:</strong> {selectedRailDetail.originSummary}
                </div>
              )}
              <div style={{ marginBottom: 4 }}>
                <strong>State:</strong> {selectedRailDetail.state}
              </div>
              {selectedRailDetail.archetype && (
                <div style={{ marginBottom: 4 }}>
                  <strong>Archetype:</strong> {selectedRailDetail.archetype}
                </div>
              )}
              {(selectedRailDetail.createdAt != null || selectedRailDetail.updatedAt != null) && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #21262d", fontSize: 11 }}>
                  <strong>Timeline</strong>
                  {selectedRailDetail.createdAt != null && (
                    <div>Created: {new Date(selectedRailDetail.createdAt).toLocaleString()}</div>
                  )}
                  {selectedRailDetail.updatedAt != null && (
                    <div>Updated: {new Date(selectedRailDetail.updatedAt).toLocaleString()}</div>
                  )}
                </div>
              )}
            </div>
            {Array.isArray(selectedRailDetail.tasks) && selectedRailDetail.tasks.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#e6edf3", marginBottom: 4 }}>
                  Tasks
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {selectedRailDetail.tasks.map((t: any) => (
                    <li
                      key={t.id}
                      style={{
                        padding: "4px 0",
                        borderBottom: "1px solid #111827",
                        fontSize: 11,
                        color: "#9ca3af",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{t.kind ?? "task"}</span>{" "}
                      <span>· {t.status ?? "unknown"}</span>
                      {t.kind === "verification" &&
                        selectedRailDetail.lastCritique &&
                        typeof selectedRailDetail.lastCritique.attempt === "number" &&
                        typeof selectedRailDetail.lastCritique.totalAttempts === "number" && (
                          <span style={{ marginLeft: 4, color: "#f59e0b" }}>
                            (Attempt {selectedRailDetail.lastCritique.attempt}/{selectedRailDetail.lastCritique.totalAttempts})
                          </span>
                        )}
                      {t.description && <div>{t.description}</div>}
                      {t.kind === "verification" && t.evidence && t.status === "rejected" && (
                        (() => {
                          let parsed: { lint?: { passed?: boolean }; vitest?: { passed?: boolean; summary?: { total?: number; passed?: number; failed?: number }; failures?: Array<{ testName?: string; filePath?: string; error?: string }> }; playwright?: unknown } | null = null;
                          try {
                            parsed = typeof t.evidence === "string" ? JSON.parse(t.evidence) : t.evidence;
                          } catch { /* ignore */ }
                          const vitest = parsed?.vitest;
                          const hasVitest = vitest && typeof vitest === "object";
                          const vitestFailures = (hasVitest && Array.isArray(vitest!.failures)) ? vitest!.failures : [];
                          const lastSource = selectedRailDetail.lastCritique?.source;
                          const isPlaywright = lastSource === "playwright";
                          return (
                            <details key={`ev-${t.id}`} style={{ marginTop: 4 }}>
                              <summary style={{ cursor: "pointer", color: "#f87171" }}>
                                {isPlaywright ? "Playwright" : "Verification"} failure details
                                {hasVitest ? ` · Vitest: ${vitest!.passed ? "Passed" : `${vitestFailures.length} failed`}` : ""}
                              </summary>
                              {hasVitest && (
                                <div
                                  style={{
                                    marginTop: 8,
                                    padding: 8,
                                    background: "#1c1917",
                                    borderRadius: 6,
                                    fontSize: 10,
                                    border: "1px solid #374151",
                                  }}
                                >
                                  <div
                                    style={{
                                      marginBottom: 6,
                                      fontWeight: 600,
                                      color: vitest!.passed ? "#4ade80" : "#f87171",
                                    }}
                                  >
                                    Vitest: {vitest!.passed ? "Passed" : "Failed"}
                                    {vitest!.summary && (
                                      <span style={{ marginLeft: 8, fontWeight: 400, color: "#9ca3af" }}>
                                        {vitest!.summary.passed ?? 0}/{vitest!.summary.total ?? 0} passed
                                        {(vitest!.summary.failed ?? 0) > 0 && ` · ${vitest!.summary.failed} failed`}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                                    {(vitestFailures).map((f: any, i: number) => (
                                      <div
                                        key={i}
                                        style={{
                                          padding: 6,
                                          marginBottom: 4,
                                          background: "#0f1419",
                                          borderRadius: 4,
                                          borderLeft: "3px solid #f87171",
                                        }}
                                      >
                                        <div style={{ fontWeight: 600, color: "#fecaca" }}>
                                          {f.testName ?? f.filePath ?? "Test"}
                                        </div>
                                        {f.filePath && (
                                          <div style={{ fontSize: 9, color: "#6b7280" }}>{f.filePath}</div>
                                        )}
                                        {f.error && (
                                          <pre
                                            style={{
                                              marginTop: 4,
                                              whiteSpace: "pre-wrap",
                                              wordBreak: "break-word",
                                              fontSize: 9,
                                              color: "#fecaca",
                                            }}
                                          >
                                            {String(f.error).slice(0, 800)}
                                            {String(f.error).length > 800 ? "…" : ""}
                                          </pre>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {isPlaywright && selectedRailDetail.lastCritique?.message && (
                                <div
                                  style={{
                                    marginTop: hasVitest ? 8 : 4,
                                    padding: 8,
                                    background: "#1c1917",
                                    borderRadius: 6,
                                    fontSize: 10,
                                    overflow: "auto",
                                    maxHeight: 200,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {selectedRailDetail.lastCritique.message}
                                </div>
                              )}
                            </details>
                          );
                        })()
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {selectedRailDetail.lastCritique && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#e6edf3", marginBottom: 4 }}>
                  Last critique
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "pre-wrap" }}>
                  {selectedRailDetail.lastCritique.message}
                </div>
                {selectedRailDetail.lastCritique.source === "playwright" &&
                  selectedRailDetail.lastCritique.message && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", color: "#f87171", fontSize: 11 }}>
                      Playwright failure details
                    </summary>
                    <pre
                      style={{
                        marginTop: 4,
                        padding: 8,
                        background: "#1c1917",
                        borderRadius: 6,
                        fontSize: 10,
                        overflow: "auto",
                        maxHeight: 300,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {selectedRailDetail.lastCritique.message}
                    </pre>
                  </details>
                )}
              </div>
            )}
            {Array.isArray(selectedRailDetail.attemptHistory) &&
              selectedRailDetail.attemptHistory.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#e6edf3", marginBottom: 4 }}>
                    Attempt history
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 11 }}>
                    {selectedRailDetail.attemptHistory
                      .slice()
                      .reverse()
                      .map((h: any, idx: number) => (
                        <li
                          key={idx}
                          style={{
                            padding: "4px 0",
                            borderBottom: "1px solid #111827",
                            color: "#9ca3af",
                          }}
                        >
                          <div style={{ fontSize: 10, color: "#6b7280" }}>
                            {h.timestamp ? new Date(h.timestamp).toLocaleString() : "Attempt"}
                          </div>
                          <div>{h.summary}</div>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            {["SELF_CORRECTING", "FAILED"].includes(selectedRailDetail.state) && (
              <div style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  disabled={selectedRailSandboxLoading}
                  onClick={async () => {
                    if (selectedRailSandboxPaths !== null) return;
                    const wsId = mainViewMode === "board" ? effectiveRailsWorkspaceId : activeWorkspaceId;
                    if (!accessToken || !wsId) return;
                    setSelectedRailSandboxLoading(true);
                    try {
                      const r = await fetch(
                        `${API_BASE}/rails/${encodeURIComponent(selectedRailDetail.id)}/sandbox/files?workspaceId=${encodeURIComponent(wsId)}`,
                        { headers: { Authorization: `Bearer ${accessToken}` } }
                      );
                      const data = await r.json().catch(() => ({}));
                      if (r.ok && Array.isArray(data.paths)) setSelectedRailSandboxPaths(data.paths);
                    } finally {
                      setSelectedRailSandboxLoading(false);
                    }
                  }}
                  style={{
                    padding: "4px 8px",
                    fontSize: 11,
                    background: "#1e3a5f",
                    color: "#58a6ff",
                    border: "1px solid #2563eb",
                    borderRadius: 6,
                    cursor: selectedRailSandboxLoading ? "wait" : "pointer",
                  }}
                >
                  {selectedRailSandboxLoading ? "Loading…" : selectedRailSandboxPaths ? "Sandbox files" : "View sandbox files"}
                </button>
                {selectedRailSandboxPaths && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: 8,
                      background: "#0d1117",
                      borderRadius: 6,
                      maxHeight: 200,
                      overflowY: "auto",
                      fontSize: 10,
                      fontFamily: "monospace",
                      color: "#9ca3af",
                    }}
                  >
                    {selectedRailSandboxPaths.length === 0 ? (
                      <div>No files</div>
                    ) : (
                      selectedRailSandboxPaths.map((p, i) => (
                        <div key={i} style={{ padding: "2px 0" }}>{p}</div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
            {["VERIFYING", "SELF_CORRECTING", "MATERIALIZING", "ARCHIVED"].includes(
              selectedRailDetail.state
            ) && (
              <div style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  disabled={selectedRailDiffsLoading}
                  onClick={async () => {
                    if (selectedRailDiffs !== null) return;
                    const wsId = mainViewMode === "board" ? effectiveRailsWorkspaceId : activeWorkspaceId;
                    if (!accessToken || !wsId) return;
                    setSelectedRailDiffsLoading(true);
                    try {
                      const r = await fetch(
                        `${API_BASE}/rails/${encodeURIComponent(selectedRailDetail.id)}/diff?workspaceId=${encodeURIComponent(wsId)}`,
                        { headers: { Authorization: `Bearer ${accessToken}` } }
                      );
                      const data = await r.json().catch(() => ({}));
                      if (r.ok && Array.isArray(data.files)) setSelectedRailDiffs(data.files);
                    } finally {
                      setSelectedRailDiffsLoading(false);
                    }
                  }}
                  style={{
                    padding: "4px 8px",
                    fontSize: 11,
                    background: "#1e3a5f",
                    color: "#58a6ff",
                    border: "1px solid #2563eb",
                    borderRadius: 6,
                    cursor: selectedRailDiffsLoading ? "wait" : "pointer",
                  }}
                >
                  {selectedRailDiffsLoading ? "Loading…" : selectedRailDiffs ? "Diffs loaded" : "View diffs"}
                </button>
                {selectedRailDiffs && selectedRailDiffs.length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      maxHeight: 280,
                      overflowY: "auto",
                      border: "1px solid #21262d",
                      borderRadius: 6,
                    }}
                  >
                    {selectedRailDiffs.map((f, i) => (
                      <details key={i} style={{ borderBottom: "1px solid #21262d" }}>
                        <summary style={{ padding: "6px 8px", cursor: "pointer", fontSize: 11 }}>
                          {f.path}
                        </summary>
                        <div style={{ padding: 8, fontSize: 10, fontFamily: "monospace" }}>
                          {f.before !== undefined && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ color: "#f87171", marginBottom: 4 }}>Before</div>
                              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {f.before.slice(0, 2000)}
                                {(f.before?.length ?? 0) > 2000 ? "…" : ""}
                              </pre>
                            </div>
                          )}
                          {f.after !== undefined && (
                            <div>
                              <div style={{ color: "#4ade80", marginBottom: 4 }}>After</div>
                              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {f.after.slice(0, 2000)}
                                {(f.after?.length ?? 0) > 2000 ? "…" : ""}
                              </pre>
                            </div>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              {(selectedRailDetail.state === "SUSPENDED" || selectedRailDetail.state === "AWAITING_HITL") && (
                <button
                  type="button"
                  onClick={async () => {
                    const wsId = mainViewMode === "board" ? effectiveRailsWorkspaceId : activeWorkspaceId;
                    if (!accessToken || !wsId) return;
                    try {
                      const r = await fetch(
                        `${API_BASE}/rails/${encodeURIComponent(selectedRailDetail.id)}/state?workspaceId=${encodeURIComponent(wsId)}`,
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${accessToken}`,
                          },
                          body: JSON.stringify({ state: "EXECUTING" }),
                        }
                      );
                      const data = await r.json().catch(() => ({}));
                      if (!r.ok) throw new Error(data.error || r.statusText);
                      setRails((prev) =>
                        prev.map((r) => (r.id === selectedRailDetail.id ? { ...r, state: "EXECUTING" } : r))
                      );
                      setSelectedRailDetail((d: any) => (d ? { ...d, state: "EXECUTING" } : d));
                    } catch (err) {
                      console.error("Resume failed:", err);
                    }
                  }}
                  style={{
                    padding: "6px 12px",
                    background: "#059669",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Resume
                </button>
              )}
              {["EXECUTING", "AWAITING_APPROVAL", "VERIFYING", "SELF_CORRECTING", "MATERIALIZING"].includes(
                selectedRailDetail.state
              ) && (
                <button
                  type="button"
                  onClick={async () => {
                    const wsId = mainViewMode === "board" ? effectiveRailsWorkspaceId : activeWorkspaceId;
                    if (!accessToken || !wsId) return;
                    try {
                      const r = await fetch(
                        `${API_BASE}/rails/${encodeURIComponent(selectedRailDetail.id)}/state?workspaceId=${encodeURIComponent(wsId)}`,
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${accessToken}`,
                          },
                          body: JSON.stringify({ state: "SUSPENDED" }),
                        }
                      );
                      const data = await r.json().catch(() => ({}));
                      if (!r.ok) throw new Error(data.error || r.statusText);
                      setRails((prev) =>
                        prev.map((r) => (r.id === selectedRailDetail.id ? { ...r, state: "SUSPENDED" } : r))
                      );
                      setSelectedRailDetail((d: any) => (d ? { ...d, state: "SUSPENDED" } : d));
                    } catch (err) {
                      console.error("Suspend failed:", err);
                    }
                  }}
                  style={{
                    padding: "6px 12px",
                    background: "#dc2626",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Suspend
                </button>
              )}
              {selectedRailDetail.state === "ARCHIVED" && (
                <button
                  type="button"
                  onClick={async () => {
                    const wsId = mainViewMode === "board" ? effectiveRailsWorkspaceId : activeWorkspaceId;
                    if (!accessToken || !wsId) return;
                    if (!window.confirm("Rollback materialized changes for this rail?")) return;
                    try {
                      const r = await fetch(
                        `${API_BASE}/rails/${encodeURIComponent(selectedRailDetail.id)}/rollback?workspaceId=${encodeURIComponent(wsId)}`,
                        {
                          method: "POST",
                          headers: {
                            Authorization: `Bearer ${accessToken}`,
                          },
                        }
                      );
                      const data = await r.json().catch(() => ({}));
                      if (!r.ok) {
                        const msg = typeof data.error === "string" ? data.error : "Rollback failed.";
                        setError(msg);
                        return;
                      }
                      setSelectedRailId(null);
                      setSelectedRailDetail(null);
                      setSelectedRailSandboxPaths(null);
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : String(err);
                      setError(msg);
                    }
                  }}
                  style={{
                    padding: "6px 12px",
                    background: "#450a0a",
                    color: "#fecaca",
                    border: "1px solid #7f1d1d",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Rollback materialization
                </button>
              )}
              {graph &&
                (selectedRailDetail.baselineNodeIds?.length ||
                  (Array.isArray(selectedRailDetail.logicPath) &&
                    selectedRailDetail.logicPath.some((s: any) => s && typeof s.nodeId === "string"))) && (
                <button
                  type="button"
                  onClick={() => {
                    const nodeIds =
                      selectedRailDetail.baselineNodeIds ??
                      (selectedRailDetail.logicPath ?? [])
                        .map((s: any) => (s && typeof s.nodeId === "string" ? s.nodeId : null))
                        .filter(Boolean);
                    if (nodeIds.length > 0) {
                      setAgentGraphCommand({ action: "highlight_nodes", nodeIds });
                      setMainViewMode("graph");
                      setSelectedRailId(null);
                      setSelectedRailDetail(null);
                    }
                  }}
                  style={{
                    padding: "6px 12px",
                    background: "#1e3a5f",
                    color: "#60a5fa",
                    border: "1px solid #2563eb",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Jump to graph
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (!accessToken || !activeWorkspaceId || !selectedRailDetail) return;
                  try {
                    const res = await fetch(
                      `${API_BASE}/rails/${encodeURIComponent(
                        selectedRailDetail.id
                      )}/trace?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
                      {
                        headers: {
                          Authorization: `Bearer ${accessToken}`,
                        },
                      }
                    );
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      const msg =
                        typeof data.error === "string"
                          ? data.error
                          : "Failed to download trace.";
                      alert(msg);
                      return;
                    }
                    const blob = new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `rail-${selectedRailDetail.id}-trace.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    alert(msg);
                  }
                }}
                style={{
                  padding: "6px 12px",
                  background: "#020617",
                  color: "#e5e7eb",
                  border: "1px solid #4b5563",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Download trace
              </button>
              {selectedRailDetail.archetype === "analysis-chat" &&
                ["PRE_PLANNING", "PLANNING", "AWAITING_APPROVAL"].includes(selectedRailDetail.state) &&
                (selectedRailDetail.tasks ?? []).some((t: { kind?: string }) => t.kind === "code_change") && (
                  <button
                    type="button"
                    onClick={async () => {
                      const wsId = mainViewMode === "board" ? effectiveRailsWorkspaceId : activeWorkspaceId;
                      if (!accessToken || !wsId) return;
                      const execTaskId = `exec-${selectedRailDetail.id}-${Date.now()}`;
                      setBackgroundTasks((prev) => [
                        ...prev,
                        {
                          id: execTaskId,
                          label: "Run analysis in sandbox",
                          mode: "analysis",
                          status: "running" as const,
                          kind: "other" as const,
                          steps: ["Execute code tasks", "Lint & Vitest", "Verify"],
                          currentStep: 0,
                          totalSteps: 3,
                          railId: selectedRailDetail.id,
                          createdAt: Date.now(),
                          workspaceId: wsId ?? undefined,
                        },
                      ]);
                      setActiveTaskId(execTaskId);
                      setSelectedRailId(null);
                      setSelectedRailDetail(null);
                      try {
                        const r = await fetch(
                          `${API_BASE}/rails/${encodeURIComponent(selectedRailDetail.id)}/execute?workspaceId=${encodeURIComponent(wsId)}`,
                          { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }
                        );
                        const data = await r.json().catch(() => ({}));
                        if (!r.ok) throw new Error(data.error || r.statusText);
                        const remoteId = data.taskId;
                        setBackgroundTasks((prev) =>
                          prev.map((t) => (t.id === execTaskId ? { ...t, remoteTaskId: remoteId } : t))
                        );
                        const poll = async (attempt: number) => {
                          if (!remoteId) return;
                          const pr = await fetch(`${API_BASE}/tasks/${remoteId}`, {
                            headers: { Authorization: `Bearer ${accessToken}` },
                          });
                          const payload = await pr.json().catch(() => ({}));
                          const status = payload.status;
                          if (status === "pending" || status === "running") {
                            setTimeout(() => poll(attempt + 1), Math.min(2000 + attempt * 500, 8000));
                            return;
                          }
                          setBackgroundTasks((prev) =>
                            prev.map((t) =>
                              t.id === execTaskId
                                ? {
                                    ...t,
                                    status: (status === "failed" || status === "cancelled" ? "failed" : "completed") as "failed" | "completed",
                                    error: status === "failed" ? payload.error : undefined,
                                    currentStep: 3,
                                  }
                                : t
                            )
                          );
                          if (status === "completed") {
                            setRails((prev) =>
                              prev.map((r) =>
                                r.id === selectedRailDetail.id ? { ...r, state: payload.result?.verificationPassed ? "VERIFYING" : "SELF_CORRECTING" } : r
                              )
                            );
                          }
                        };
                        poll(0);
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        setBackgroundTasks((prev) =>
                          prev.map((t) => (t.id === execTaskId ? { ...t, status: "failed" as const, error: msg, currentStep: 3 } : t))
                        );
                      }
                    }}
                    style={{
                      padding: "6px 12px",
                      background: "#059669",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Run in sandbox
                  </button>
                )}
              {selectedRailDetail.archetype === "greenfield-materialize" &&
                selectedRailDetail.state === "VERIFYING" && (
                  <button
                    type="button"
                    onClick={() => {
                      setPendingRailApproval({
                        railId: selectedRailDetail.id,
                        rootPath: graph?.projectRoot ?? "",
                      });
                      setSelectedRailId(null);
                      setSelectedRailDetail(null);
                    }}
                    style={{
                      padding: "6px 12px",
                      background: "#7c3aed",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Approve materialization
                  </button>
                )}
              <button
                type="button"
                onClick={() => {
                  const related = tasksForWorkspace.find((t) => t.railId === selectedRailDetail.id);
                  if (related) setActiveTaskId(related.id);
                  setSelectedRailId(null);
                  setSelectedRailDetail(null);
                }}
                style={{
                  padding: "6px 12px",
                  background: "#111827",
                  color: "#e5e7eb",
                  border: "1px solid #374151",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Focus task
              </button>
            </div>
          </div>
        </div>
      )}

      {showModeSwitchConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => {
            setShowModeSwitchConfirm(false);
            setPendingModeSwitch(null);
          }}
        >
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 12,
              padding: 24,
              maxWidth: 360,
              color: "#e6edf3",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Switch view?</div>
            <p style={{ fontSize: 13, color: "#8b949e", marginBottom: 20, lineHeight: 1.5 }}>
              You have an active background task or unsaved ghost nodes. Switching may leave them running. Continue?
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  setShowModeSwitchConfirm(false);
                  setPendingModeSwitch(null);
                }}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  color: "#8b949e",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pendingModeSwitch) {
                    setMainViewMode(pendingModeSwitch);
                  }
                  setShowModeSwitchConfirm(false);
                  setPendingModeSwitch(null);
                }}
                style={{
                  padding: "8px 16px",
                  background: "#238636",
                  color: "white",
                  border: "1px solid #238636",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
