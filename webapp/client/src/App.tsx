import { useState, useCallback, useEffect, useRef } from "react";
import { ArchCanvas } from "./ArchCanvas";
import type { ArchGraph, GraphCommand, CriticViolation, ArchNode } from "./types";
import { analyseGraph, type EdgeFilter } from "./analysis/graphAnalyser";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { supabase, getSupabaseConfigError } from "./supabaseClient";
import { logAuthHashErrors, logAuthStateChange } from "./authDebug";
import { JiraConnectModal } from "./JiraConnectModal";

import { deriveProjectKey, isValidProjectKey } from "./utils/deriveProjectKey";

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
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<EdgeFilter>>(new Set(["all"]));
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
  const [aiQuestion, setAiQuestion] = useState("");
  const [chatTabs, setChatTabs] = useState([{ id: "1", label: "Chat 1" }]);
  const [activeChatId, setActiveChatId] = useState("1");
  const [chatSessions, setChatSessions] = useState<Record<string, Array<{ role: "user" | "assistant"; content: string }>>>(
    { "1": [] }
  );
  const [chatLoading, setChatLoading] = useState(false);
  const [jiraIssues, setJiraIssues] = useState<
    Array<{ key: string; summary: string; status: string; type: string; priority?: string; baseUrl: string; labels?: string[] }>
  >([]);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [jiraFilterByRepo, setJiraFilterByRepo] = useState(() => {
    try {
      const v = localStorage.getItem("jiraFilterByRepo");
      return v === "false" ? false : true;
    } catch {
      return true;
    }
  });
  const [jiraRepoName, setJiraRepoName] = useState<string | undefined>();
  const [jiraConfigured, setJiraConfigured] = useState<boolean | null>(null);
  const [jiraConnectedEmail, setJiraConnectedEmail] = useState<string | null>(null);
  const [jiraProjectKey, setJiraProjectKey] = useState<string | null>(null);
  const [editingJiraProjectKey, setEditingJiraProjectKey] = useState(false);
  const [jiraProjectKeyDraft, setJiraProjectKeyDraft] = useState("");
  const [jiraProjects, setJiraProjects] = useState<Array<{ key: string; name: string }>>([]);
  const [jiraProjectsLoading, setJiraProjectsLoading] = useState(false);
  const [jiraConfigSource, setJiraConfigSource] = useState<"db" | null>(null);
  const [showJiraConnectModal, setShowJiraConnectModal] = useState(false);
  const [showJiraDisconnectConfirm, setShowJiraDisconnectConfirm] = useState(false);
  const [jiraProjectKeyReady, setJiraProjectKeyReady] = useState(false);
  const [agentGraphCommand, setAgentGraphCommand] = useState<GraphCommand | null>(null);
  const [virtualNodes, setVirtualNodes] = useState<
    Array<{ id: string; label: string; layer?: string; description?: string; archNodeId?: string }>
  >([]);
  const [virtualEdges, setVirtualEdges] = useState<
    Array<{ fromId: string; toId: string; edgeType?: string }>
  >([]);
  const [activeViolations, setActiveViolations] = useState<CriticViolation[]>([]);
  const [violationsCollapsed, setViolationsCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"dashboard" | "chat">("dashboard");
  const [dashboardLastSeenViolations, setDashboardLastSeenViolations] = useState(0);

  const criticalViolationsCount = activeViolations.filter(
    (v) => v.severity === "critical"
  ).length;
  const highViolationsCount = activeViolations.filter(
    (v) => v.severity === "high"
  ).length;
  const trackedViolationsCount = activeViolations.filter(
    (v) => !!v.jiraKey
  ).length;
  const untrackedViolationsCount =
    activeViolations.length - trackedViolationsCount;
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
  const [showContactForm, setShowContactForm] = useState(false);
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
    Array<{ id: string; name: string; created_at: string }>
  >([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [loadingWorkspaceId, setLoadingWorkspaceId] = useState<string | null>(null);
  const [showMaterializeModal, setShowMaterializeModal] = useState(false);
  const [materializeTargetPath, setMaterializeTargetPath] = useState("");
  const [materializeLoading, setMaterializeLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState<"unknown" | "ok" | "mismatch">("unknown");
  const [authStatusMessage, setAuthStatusMessage] = useState<string | null>(null);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingVirtualNodeId, setEditingVirtualNodeId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<{ label: string; archNodeId: string } | null>(null);
  const [designHistory, setDesignHistory] = useState<
    Array<{
      nodes: Array<{ id: string; label: string; layer?: string; description?: string; archNodeId?: string }>;
      edges: Array<{ fromId: string; toId: string; edgeType?: string }>;
    }>
  >([]);
  const [panelWidth, setPanelWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const graphRef = useRef<typeof graph>(graph);
  const skipNextJiraFetchRef = useRef(false);
  const trackViolationRef = useRef<(v: CriticViolation) => void>(() => {});
  const workspaceDropUpRef = useRef<HTMLDivElement | null>(null);
  const activeChatIdRef = useRef<string>(activeChatId);
  const chatSessionsRef = useRef<Record<string, Array<{ role: "user" | "assistant"; content: string }>>>(chatSessions);

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
      // Clear workspace so user lands on landing page (landing shows when !graph && !loading)
      setGraph(null);
      setSelectedNode(null);
      setChatTabs([{ id: "1", label: "Chat 1" }]);
      setActiveChatId("1");
      setChatSessions({ "1": [] });
      setAiQuestion("");
      setVirtualNodes([]);
      setVirtualEdges([]);
      setActiveViolations([]);
      setAgentGraphCommand(null);
      setJiraConfigured(null);
      setJiraConnectedEmail(null);
      setJiraProjectKey(null);
      setJiraConfigSource(null);
      setJiraProjectKeyReady(false);
      setJiraIssues([]);
      setJiraError(null);
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
    setGraph(null);
    setRepoUrl("");
    setActiveWorkspaceId(null);
    setJiraProjectKey(null);
    setJiraProjectKeyReady(false);
    setSelectedNode(null);
    setChatTabs([{ id: "1", label: "Chat 1" }]);
    setActiveChatId("1");
    setChatSessions({ "1": [] });
    setAiQuestion("");
    setVirtualNodes([]);
    setVirtualEdges([]);
    setActiveViolations([]);
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
      // Clear local state and autosave pointer.
      try {
        const last = localStorage.getItem("lastWorkspaceId");
        if (last && last === activeWorkspaceId) {
          localStorage.removeItem("lastWorkspaceId");
        }
      } catch {
        // ignore storage issues
      }
      setActiveWorkspaceId(null);
      setGraph(null);
      setActiveViolations([]);
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

  const fetchPersistedViolations = useCallback(
    async (workspaceId: string, tokenOverride?: string) => {
      const token = tokenOverride ?? accessToken;
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE}/violations?workspaceId=${workspaceId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const stored = (data.violations ?? []) as CriticViolation[];
        if (!stored.length) return;
        const key = (v: CriticViolation) =>
          `${v.type}:${v.sourceNodeId}:${v.targetNodeId ?? ""}`;
        const storedByKey = new Map(stored.map((v) => [key(v), v]));
        setActiveViolations((prev) => {
          const existingKeys = new Set(prev.map(key));
          const fresh = stored.filter((v) => !existingKeys.has(key(v)));
          const merged = prev.map((v) => {
            const s = storedByKey.get(key(v));
            return s?.jiraKey ? { ...v, jiraKey: s.jiraKey, jiraStatus: s.jiraStatus } : v;
          });
          return [...merged, ...fresh];
        });
        setGraph((prev) => {
          if (!prev) return prev;
          const relevantForNode = (n: ArchNode) =>
            stored.filter(
              (v) => v.sourceNodeId === n.id || v.targetNodeId === n.id
            );
          return {
            ...prev,
            nodes: prev.nodes.map((node) => {
              const existingVs = node.violationState?.violations ?? [];
              const storedForNode = relevantForNode(node);
              const mergedVs = [
                ...existingVs.map((v) => {
                  const s = storedByKey.get(key(v));
                  return s?.jiraKey ? { ...v, jiraKey: s.jiraKey, jiraStatus: s.jiraStatus } : v;
                }),
                ...storedForNode.filter(
                  (s) => !existingVs.some((ev) => key(ev) === key(s))
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
        });
      } catch {
        // non-fatal
      }
    },
    [accessToken]
  );

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
          // If the workspace is gone or access is denied, clear local pointer and surface a clear message.
          if (res.status === 404 || res.status === 403) {
            try {
              const last = localStorage.getItem("lastWorkspaceId");
              if (last && last === workspaceId) {
                localStorage.removeItem("lastWorkspaceId");
              }
            } catch {
              // ignore storage errors
            }
            setActiveWorkspaceId(null);
            setGraph(null);
            setError(
              res.status === 404
                ? "This workspace no longer exists."
                : "You no longer have access to this workspace."
            );
            return;
          }
          throw new Error(data.error || res.statusText);
        }
        const loadedGraph = data.graph as ArchGraph;
        const repo = (data.repoUrl ?? "") as string;
        if (loadedGraph && typeof loadedGraph === "object" && Array.isArray(loadedGraph.nodes) && Array.isArray(loadedGraph.edges)) {
          setGraph(analyseGraph(loadedGraph));
          setRepoUrl(repo);
          setActiveWorkspaceId(workspaceId);
          const jiraKey = data.jiraProjectKey as string | null | undefined;
          setJiraProjectKey(jiraKey ?? (repo ? deriveProjectKey(repo) : null));
          setJiraProjectKeyReady(true);
          setShowWorkspaceDropUp(false);
          setError(null);
          fetchPersistedViolations(workspaceId, token).catch(() => {});
          // Restore saved chat context for this workspace
          try {
            const saved = localStorage.getItem(`chat:${workspaceId}`);
            if (saved) {
              const parsed = JSON.parse(saved) as {
                chatTabs: Array<{ id: string; label: string }>;
                chatSessions: Record<string, Array<{ role: "user" | "assistant"; content: string }>>;
                activeChatId: string;
              };
              if (parsed.chatTabs?.length && parsed.chatSessions) {
                setChatTabs(parsed.chatTabs);
                setChatSessions(parsed.chatSessions);
                setActiveChatId(parsed.activeChatId ?? parsed.chatTabs[0]?.id ?? "1");
              }
            }
          } catch {
            // ignore malformed chat state
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
    [accessToken, fetchPersistedViolations]
  );

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

  // Persist chat context per workspace
  useEffect(() => {
    if (!activeWorkspaceId) return;
    try {
      const key = `chat:${activeWorkspaceId}`;
      localStorage.setItem(
        key,
        JSON.stringify({ chatTabs, chatSessions, activeChatId })
      );
    } catch {
      // ignore
    }
  }, [activeWorkspaceId, chatTabs, chatSessions, activeChatId]);

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
          setJiraProjectKey((data.jiraProjectKey as string | null | undefined) ?? (url ? deriveProjectKey(url) : null));
          setJiraProjectKeyReady(true);
          // lastWorkspaceId is also maintained by the autosave effect,
          // but we eagerly set it here for faster restore on refresh.
          try {
            if (autosaveEnabled) {
              localStorage.setItem("lastWorkspaceId", data.workspaceId);
              // New signed-in workspace should clear any anonymous graph snapshot.
              localStorage.removeItem("anonGraph");
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
    [accessToken, activeWorkspaceId, supabase]
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
      const q = (overrideQuestion ?? aiQuestion.trim()).trim();
      if (!q || !graph) return;

    setChatLoading(true);
      if (!overrideQuestion) setAiQuestion("");
    const currentHistory = chatSessionsRef.current[activeChatIdRef.current] ?? [];
    const historyForRequest = [...currentHistory, { role: "user" as const, content: q }];
    const cid = activeChatIdRef.current;
    setChatSessions((s) => ({
      ...s,
      [cid]: [...(s[cid] ?? []), { role: "user", content: q }],
    }));

    const history = historyForRequest;

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
            const cid = activeChatIdRef.current;
            setChatSessions((s) => ({
              ...s,
              [cid]: [
                ...(s[cid] ?? []),
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
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question: q,
          graph,
          nodeId: selectedNode ?? undefined,
          history,
          workspaceId: activeWorkspaceId ?? undefined,
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

        // Auto-create Jira tickets for critical violations (only when Jira is configured)
        if (jiraConfigured === true) {
          for (const v of violations) {
            if (v.severity === "critical") {
              trackViolationRef.current(v);
            }
          }
        }
      }

      const answer = data.answer ?? "No response.";
      const criticReport =
        typeof data.criticReport === "string" && data.criticReport
          ? data.criticReport
          : undefined;
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
        }
      } else if (relevantNodeIds.length > 0) {
        setAgentGraphCommand({ action: "highlight_nodes", nodeIds: relevantNodeIds });
      }

      const cid = activeChatIdRef.current;
      setChatSessions((prev) => {
        const current = prev[cid] ?? [];
        const updated: Array<{ role: "user" | "assistant"; content: string }> = [
          ...current,
          { role: "assistant", content: answer },
          ...(criticReport
            ? [{ role: "assistant" as const, content: `Critic: ${criticReport}` }]
            : []),
        ];
        return {
          ...prev,
          [cid]: updated,
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const cid = activeChatIdRef.current;
      setChatSessions((s) => ({
        ...s,
        [cid]: [
          ...(s[cid] ?? []),
          { role: "assistant", content: `Error: ${msg}` },
        ],
      }));
    } finally {
      setChatLoading(false);
    }
  },
    [aiQuestion, graph, selectedNode, accessToken, jiraConfigured, activeWorkspaceId]
  );

  const addChatTab = useCallback(() => {
    setChatTabs((prev) => {
      const nextId = String(Math.max(0, ...prev.map((t) => parseInt(t.id, 10) || 0)) + 1);
    setChatSessions((s) => ({ ...s, [nextId]: [] }));
    setActiveChatId(nextId);
      return [...prev, { id: nextId, label: `Chat ${nextId}` }];
    });
  }, []);

  const closeChatTab = useCallback((tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();
    setChatTabs((prev) => {
      if (prev.length <= 1) return prev;
      const remaining = prev.filter((t) => t.id !== tabId);
      if (activeChatIdRef.current === tabId) {
        setActiveChatId(remaining[0]?.id ?? "1");
      }
      setChatSessions((s) => {
        const next = { ...s };
        delete next[tabId];
        return next;
      });
      return remaining;
    });
  }, []);

  const fetchJiraTests = useCallback(
    async (filterByRepo?: boolean, projectKeyOverride?: string) => {
      setJiraLoading(true);
      setJiraError(null);
      try {
        if (!accessToken) {
          setJiraIssues([]);
          return;
        }
        const params = new URLSearchParams();
        if (repoUrl) params.set("repoUrl", repoUrl);
        if (activeWorkspaceId) params.set("workspaceId", activeWorkspaceId);
        if (projectKeyOverride) params.set("projectKey", projectKeyOverride);
        if (filterByRepo ?? jiraFilterByRepo) params.set("filterByRepo", "true");
        else params.set("filterByRepo", "false");
        const res = await fetch(`${API_BASE}/jira-issues?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.error === "project_key_required") {
            setJiraError("No project selected");
          } else {
            throw new Error(data.error || res.statusText);
          }
          return;
        }
        setJiraConfigured(true);
        setJiraIssues(data.issues ?? []);
        setJiraRepoName(data.repoName);
      } catch (err) {
        setJiraError(err instanceof Error ? err.message : String(err));
        setJiraIssues([]);
      } finally {
        setJiraLoading(false);
      }
    },
    [repoUrl, jiraFilterByRepo, accessToken, activeWorkspaceId]
  );

  const addLabelToIssue = useCallback(
    async (issueKey: string, label: string) => {
      if (!accessToken) {
        setJiraError("Please sign in first.");
        return;
      }
      const prevIssues = jiraIssues;
      setJiraIssues((prev) =>
        prev.map((i) =>
          i.key === issueKey ? { ...i, labels: [...(i.labels ?? []), label] } : i
        )
      );
      try {
        const res = await fetch(`${API_BASE}/jira-add-label`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ issueKey, label }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
      } catch (err) {
        setJiraIssues(prevIssues);
        setJiraError(err instanceof Error ? err.message : String(err));
      }
    },
    [accessToken, jiraIssues]
  );

  const handleDisconnectJira = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_BASE}/integrations/jira`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error("Failed to disconnect");
      setShowJiraDisconnectConfirm(false);
      setJiraConfigured(false);
      setJiraConnectedEmail(null);
      setJiraProjectKey(null);
      setJiraConfigSource(null);
      setJiraIssues([]);
      setJiraError(null);
    } catch (err) {
      setJiraError(err instanceof Error ? err.message : String(err));
    }
  }, [accessToken]);

  const saveProjectKey = useCallback(
    (k: string) => {
      const key = k.trim().toUpperCase();
      if (!key || !activeWorkspaceId || !accessToken) return;
      if (!isValidProjectKey(key)) return;
      fetch(`${API_BASE}/workspaces/${activeWorkspaceId}/jira-project-key`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ projectKey: key }),
      })
        .then(async (r) => {
          if (r.ok) {
            skipNextJiraFetchRef.current = true;
            setJiraProjectKey(key);
            setEditingJiraProjectKey(false);
            await fetchJiraTests(undefined, key);
          }
        })
        .catch(() => {});
    },
    [activeWorkspaceId, accessToken, fetchJiraTests]
  );

  const cancelProjectKeyEdit = useCallback(() => {
    setJiraProjectKeyDraft(jiraProjectKey ?? "");
    setEditingJiraProjectKey(false);
  }, [jiraProjectKey]);

  const clearProjectKey = useCallback(() => {
    if (!activeWorkspaceId || !accessToken) return;
    fetch(`${API_BASE}/workspaces/${activeWorkspaceId}/jira-project-key`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ projectKey: null }),
    })
      .then((r) => {
        if (r.ok) {
          setJiraProjectKey(null);
          setEditingJiraProjectKey(false);
          setJiraProjectKeyDraft("");
          setJiraIssues([]);
          setJiraError(null);
        }
      })
      .catch(() => {});
  }, [activeWorkspaceId, accessToken]);

  useEffect(() => {
    if (!accessToken) {
      setJiraConfigured(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/jira-status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = (await res.json().catch(() => ({}))) as { configured?: boolean; source?: "db" | "env" };
        if (!cancelled) {
          setJiraConfigured(!!data?.configured);
          setJiraConfigSource(data?.configured && data?.source === "db" ? "db" : null);
        }
      } catch {
        if (!cancelled) {
          setJiraConfigured(false);
          setJiraConfigSource(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || jiraConfigured !== true) {
      setJiraConnectedEmail(null);
      setJiraConfigSource(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/integrations`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = (await res.json()) as {
          integrations?: Array<{ provider?: string; email?: string }>;
        };
        if (!cancelled && data?.integrations) {
          const jira = data.integrations.find((i) => i.provider === "jira");
          setJiraConnectedEmail(jira?.email ?? null);
        }
      } catch {
        if (!cancelled) {
          setJiraConnectedEmail(null);
          setJiraConfigSource(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken, jiraConfigured]);

  useEffect(() => {
    if (!repoUrl && (!graph || (graph.nodes.length === 0 && !graph.projectRoot))) {
      setJiraIssues([]);
      setJiraError(null);
      return;
    }
    if (jiraConfigured !== true) return;
    if (loadingWorkspaceId) return;
    if (activeWorkspaceId && !jiraProjectKeyReady) return;
    if (activeWorkspaceId && !jiraProjectKey) return;
    if (skipNextJiraFetchRef.current) {
      skipNextJiraFetchRef.current = false;
      return;
    }
    fetchJiraTests();
  }, [fetchJiraTests, repoUrl, graph, jiraConfigured, loadingWorkspaceId, jiraProjectKeyReady, activeWorkspaceId, jiraProjectKey]);

  useEffect(() => {
    if (jiraError && /not configured|JIRA_/i.test(jiraError)) {
      setJiraConfigured(false);
      setJiraConnectedEmail(null);
      setJiraConfigSource(null);
    }
  }, [jiraError]);

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
        // Remove confirmed node and its virtual edges; a later scan can pick up the real node.
        setVirtualNodes((prev) => prev.filter((v) => v.id !== node.id));
        setVirtualEdges((prev) =>
          prev.filter((e) => e.fromId !== node.id && e.toId !== node.id)
        );
      } catch (err) {
        console.error("Scaffold failed:", err);
      }
    },
    [graph, accessToken]
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

  const handleMaterialize = useCallback(async () => {
    const targetRoot = materializeTargetPath.trim();
    if (!targetRoot || !accessToken || virtualNodes.length === 0) return;
    setMaterializeLoading(true);
    try {
      const idempotencyKey = `materialize-${targetRoot}-${virtualNodes.map((n) => n.id).sort().join(",")}`;
      const res = await fetch(`${API_BASE}/materialize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          targetRoot,
          nodes: virtualNodes.map((vn) => ({
            id: vn.id,
            label: vn.label,
            layer: vn.layer,
            archNodeId: vn.archNodeId ?? vn.id,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      setChatSessions((prev) => {
        const current = prev[activeChatId] ?? [];
        const msg = `Materialized ${data.created?.length ?? 0} node(s)${data.errors?.length ? `; ${data.errors.length} error(s)` : ""}.`;
        return {
          ...prev,
          [activeChatId]: [...current, { role: "assistant", content: msg }],
        };
      });
      setVirtualNodes([]);
      setVirtualEdges([]);
      setMaterializeTargetPath("");
      setShowMaterializeModal(false);
      if (targetRoot) {
        setRepoUrl(targetRoot);
        await scanRepo(targetRoot);
      }
    } catch (err) {
      setChatSessions((prev) => {
        const current = prev[activeChatId] ?? [];
        const msg = `Materialize failed: ${err instanceof Error ? err.message : String(err)}`;
        return {
          ...prev,
          [activeChatId]: [...current, { role: "assistant", content: msg }],
        };
      });
      setShowMaterializeModal(false);
    } finally {
      setMaterializeLoading(false);
    }
  }, [
    materializeTargetPath,
    accessToken,
    virtualNodes,
    activeChatId,
    scanRepo,
  ]);

  const handleFixViolation = useCallback((v: CriticViolation) => {
    const fixPrompt =
      `Fix this architecture violation:\n\n` +
      `Type: ${v.type}\n` +
      `Severity: ${v.severity}\n` +
      `Source: ${v.sourceNodeId}${v.targetNodeId ? ` → ${v.targetNodeId}` : ""}\n\n` +
      `What was found: ${v.description}\n\n` +
      `Suggested fix: ${v.suggestedFix}\n\n` +
      `Propose a concrete refactor plan and list the exact files you would change.`;
    setAiQuestion(fixPrompt);
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

  const handleTrackViolation = useCallback(
    async (v: CriticViolation) => {
      if (!graph) return;
      const vKey = violationKey(v);
      setJiraError(null);
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

        const srcNode = graph.nodes.find((n) => n.id === v.sourceNodeId || n.path === v.sourceNodeId);
        const archModulePath = srcNode?.path ?? v.sourceNodeId;
        const archModuleFiles = srcNode?.files;

        const res = await fetch(`${API_BASE}/jira-violation`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...(v as any).id ? { violationId: (v as any).id } : { violation: v },
            projectRoot: graph.projectRoot,
            projectName: graph.projectName ?? "",
            workspaceId: activeWorkspaceId ?? undefined,
            archModulePath,
            ...(archModuleFiles != null && { archModuleFiles }),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.error === "project_key_required") {
            setJiraError("Set a project key in the sidebar to track violations in Jira.");
            setEditingJiraProjectKey(true);
          } else {
            throw new Error(data.error || res.statusText);
          }
          return;
        }

        const key = data.key as string | undefined;
        const jiraStatus = "To Do";
        if (!key) return;

        setActiveViolations((prev) =>
          prev.map((existing) =>
            violationKey(existing) === vKey
              ? { ...existing, jiraKey: key, jiraStatus, trackedAt: Date.now() }
              : existing
          )
        );

        setGraph((prev) => {
          if (!prev) return prev;
          const affectedIds = new Set([v.sourceNodeId, v.targetNodeId].filter(Boolean));
          return {
            ...prev,
            nodes: prev.nodes.map((node) => {
              if (!affectedIds.has(node.id)) return node;
              const existingVs = node.violationState?.violations ?? [];
              const updatedVs = existingVs.map((nv) =>
                nv.type === v.type &&
                nv.sourceNodeId === v.sourceNodeId &&
                nv.targetNodeId === v.targetNodeId
                  ? { ...nv, jiraKey: key, jiraStatus }
                  : nv
              );
              return {
                ...node,
                violationState: {
                  violations: updatedVs,
                  highestSeverity: node.violationState?.highestSeverity ?? v.severity,
                },
              } as ArchNode;
            }),
          };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (jiraConfigured === true) {
          setJiraError(`Failed to create Jira ticket: ${msg}`);
        }
      }
    },
    [graph, accessToken, jiraConfigured, activeWorkspaceId]
  );

  useEffect(() => {
    trackViolationRef.current = handleTrackViolation;
  }, [handleTrackViolation]);

  const panelStyle: React.CSSProperties = {
    width: panelWidth,
    minWidth: 240,
    background: "#161b22",
    borderRight: "1px solid #30363d",
    display: "flex",
    flexDirection: "column",
    padding: 16,
    gap: 12,
    overflowY: "auto",
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
                  onClick={() => setShowContactForm(true)}
                  style={{
                    background: "none",
                    border: "none",
                    padding: "8px 20px",
                    color: "rgba(245,243,238,0.42)",
                    cursor: "pointer",
                  }}
                >
                  Contact
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

        {/* Contact overlay, using provided contact form design */}
        {showContactForm && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 5,
              background: "rgba(0,0,0,0.75)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onClick={() => setShowContactForm(false)}
          >
            <div
              style={{
                background: "#F2F3EB",
                border: "3px solid #474544",
                width: "90%",
                maxWidth: 768,
                margin: "60px auto",
                color: "#474544",
                position: "relative",
                boxSizing: "border-box",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <form
                style={{ padding: 37.5, margin: "50px 0" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  setShowContactForm(false);
                }}
              >
                <h1
                  style={{
                    fontFamily: '"Montserrat", Arial, sans-serif',
                    fontSize: 32,
                    fontWeight: 700,
                    letterSpacing: 7,
                    textAlign: "center",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  &bull; Keep in Touch &bull;
                </h1>
                <div
                  style={{
                    borderBottom: "2px solid #474544",
                    margin: "-0.512em auto",
                    width: 80,
                  }}
                />
                <div style={{ margin: "50px auto 0", width: "100%" }}>
                  <svg
                    viewBox="0 0 145.192 145.192"
                    style={{
                      display: "block",
                      fill: "#474544",
                      height: 50,
                      margin: "0 auto",
                      width: 50,
                    }}
                  >
                    <path d="M126.82,32.694c-2.804,0-5.08,2.273-5.08,5.075v2.721c-1.462,0-2.646,1.185-2.646,2.647v1.995    c0,1.585,1.286,2.873,2.874,2.873h20.577c1.462,0,2.646-1.185,2.646-2.647v-3.041c0-1.009-0.816-1.825-1.823-1.825v-2.722    c0-2.802-2.276-5.075-5.079-5.075h-1.985v-3.829c0-3.816-3.095-6.912-6.913-6.912h-0.589h-20.45c0-2.67-2.164-4.835-4.833-4.835    H56.843c-2.67,0-4.835,2.165-4.835,4.835H34.356v-3.384h-9.563v3.384v1.178h-7.061v1.416c-2.67,0.27-10.17,1.424-13.882,5.972    c-1.773,2.17-2.44,4.791-1.983,7.793c0.463,3.043,1.271,6.346,2.128,9.841c2.354,9.616,5.024,20.515,0.549,28.077    C2.647,79.44-3.125,90.589,2.201,99.547c4.123,6.935,13.701,10.44,28.5,10.44c1.186,0,2.405-0.023,3.658-0.068v9.028h-0.296    c-2.516,0-4.558,2.039-4.558,4.558v4.566h100.04v-4.564c0-2.519-2.039-4.558-4.558-4.558h-0.297V84.631h0.297    c2.519,0,4.558-2.037,4.558-4.556v-0.009c0-2.516-2.039-4.556-4.556-4.556l-36.786-0.009V61.973c0-2.193-1.777-3.971-3.972-3.971    v-4.711h0.456c1.629,0,2.952-1.32,2.952-2.949h14.227V34.459h1.658c2.672,0,4.834-2.165,4.834-4.834h20.45v3.069H126.82z     M34.06,75.511c-2.518,0-4.558,2.04-4.558,4.556v0.009c0,2.519,2.042,4.556,4.558,4.556h0.296v24.12l-0.042-1.168    c-15.994,0.574-26.122-2.523-30.106-9.229C-0.464,90.5,4.822,80.347,6.55,77.423c4.964-8.382,2.173-19.774-0.29-29.825    c-0.843-3.442-1.639-6.696-2.088-9.638c-0.354-2.35,0.129-4.3,1.484-5.958c3.029-3.714,9.509-4.805,12.076-5.1v1.233h7.061v1.49    v2.684c-2.403,1.114-4.153,2.997-4.676,5.237H18.15c-0.584,0-1.056,0.474-1.056,1.056v0.83c0,0.584,0.475,1.056,1.056,1.056h1.984    c0.561,2.18,2.304,3.999,4.658,5.092v0.029c0,0-2.282,20.823,16.479,22.099v1.102c0,1.177,0.955,2.133,2.133,2.133h3.297    c1.178,0,2.133-0.956,2.133-2.133V50.135c0-1.177-0.955-2.132-2.133-2.132h-3.297c-1.178,0-2.133,0.955-2.133,2.132    c-1.575-0.235-5.532-1.17-6.635-4.547c2.36-1.092,4.109-2.913,4.669-5.097h1.308c0.722,0,1.309-0.584,1.309-1.308v-0.578    c0-0.584-0.475-1.056-1.056-1.056h-1.539c-0.542-2.332-2.416-4.271-4.968-5.363v-2.559h17.651c0,2.67,2.166,4.835,4.836,4.835 h2.392v15.88h13.639c0,1.629,1.321,2.949,2.951,2.949h0.899v4.711c-2.194,0-3.972,1.778-3.972,3.971v13.529L34.06,75.511z     M95.188,101.78c0,8.655-7.012,15.665-15.664,15.665c-8.653,0-15.667-7.01-15.667-15.665c0-8.647,7.014-15.664,15.667-15.664    C88.177,86.116,95.188,93.132,95.188,101.78z M97.189,45.669h-9.556c0-0.896-0.726-1.62-1.619-1.62H74.494    c-0.896,0-1.621,0.727-1.621,1.62h-8.967v-11.21h33.283V45.669z" />
                    <path d="M70.865,101.78c0,4.774,3.886,8.657,8.66,8.657c4.774,0,8.657-3.883,8.657-8.657c0-4.773-3.883-8.656-8.657-8.656    C74.751,93.124,70.865,97.006,70.865,101.78z" />
                  </svg>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    marginTop: 40,
                  }}
                >
                  <div style={{ width: "45%", marginBottom: 24 }}>
                    <input
                      type="text"
                      placeholder="My name is"
                      name="name"
                      required
                      style={{
                        background: "none",
                        border: "none",
                        borderBottom: "2px solid #474544",
                        color: "#474544",
                        fontSize: "1em",
                        fontWeight: 400,
                        letterSpacing: 1,
                        padding: "0 0 0.875em 0",
                        textTransform: "uppercase",
                        width: "100%",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div style={{ width: "45%", marginBottom: 24 }}>
                    <input
                      type="email"
                      placeholder="My e-mail is"
                      name="email"
                      required
                      style={{
                        background: "none",
                        border: "none",
                        borderBottom: "2px solid #474544",
                        color: "#474544",
                        fontSize: "1em",
                        fontWeight: 400,
                        letterSpacing: 1,
                        padding: "0 0 0.875em 0",
                        textTransform: "uppercase",
                        width: "100%",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div style={{ width: "100%", marginBottom: 24 }}>
                    <input
                      type="text"
                      placeholder="My number is"
                      name="telephone"
                      required
                      style={{
                        background: "none",
                        border: "none",
                        borderBottom: "2px solid #474544",
                        color: "#474544",
                        fontSize: "1em",
                        fontWeight: 400,
                        letterSpacing: 1,
                        padding: "0 0 0.875em 0",
                        textTransform: "uppercase",
                        width: "100%",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div style={{ width: "100%", marginBottom: 24 }}>
                    <select
                      name="subject"
                      required
                      defaultValue=""
                      style={{
                        background: "none",
                        border: "none",
                        borderBottom: "2px solid #474544",
                        color: "#474544",
                        fontSize: "1em",
                        fontWeight: 400,
                        letterSpacing: 1,
                        padding: "0 0 0.875em 0",
                        textTransform: "uppercase",
                        width: "100%",
                        boxSizing: "border-box",
                        outline: "none",
                      }}
                    >
                      <option value="" disabled hidden>
                        Subject line
                      </option>
                      <option>I&apos;d like to start a project</option>
                      <option>I&apos;d like to ask a question</option>
                      <option>I&apos;d like to make a proposal</option>
                    </select>
                  </div>
                  <div style={{ width: "100%", marginBottom: 24 }}>
                    <textarea
                      name="message"
                      placeholder="I'd like to chat about"
                      rows={5}
                      required
                      style={{
                        background: "none",
                        border: "none",
                        borderBottom: "2px solid #474544",
                        color: "#474544",
                        fontSize: "1em",
                        fontWeight: 400,
                        letterSpacing: 1,
                        padding: "0 0 0.875em 0",
                        textTransform: "uppercase",
                        width: "100%",
                        height: 150,
                        lineHeight: "150%",
                        resize: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                <div style={{ textAlign: "center", marginTop: 10 }}>
                  <input
                    type="submit"
                    value="Send Message"
                    style={{
                      background: "none",
                      border: "2px solid #474544",
                      color: "#474544",
                      cursor: "pointer",
                      display: "inline-block",
                      fontFamily: '"Helvetica", Arial, sans-serif',
                      fontSize: "0.875em",
                      fontWeight: "bold",
                      padding: "20px 35px",
                      textTransform: "uppercase",
                    }}
                  />
                </div>
              </form>
            </div>
          </div>
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
      <div style={{ display: "flex", width: "100vw", height: "100vh" }}>
      <div style={panelStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
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
          Repo
        </div>
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
        {graph!.nodes.length === 0 && !graph!.projectRoot ? (
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

        {/* Sidebar tabs: Dashboard / Chat */}
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
        </div>

        {/* Dashboard content: project overview, edges, focus, violations, governance, proposed nodes */}
        {sidebarTab === "dashboard" && (
          <div
            style={{
              background: "#1c2128",
              borderRadius: 8,
              padding: 12,
              border: "1px solid #30363d",
            }}
          >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
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
            Project Overview
            </div>
            <button
              onClick={() => fetchJiraTests()}
              disabled={jiraLoading}
              style={{
                padding: "4px 8px",
                fontSize: 11,
                height: 24,
                background: "#21262d",
                color: "#e6edf3",
                border: "1px solid #30363d",
                borderRadius: 6,
                cursor: jiraLoading ? "wait" : "pointer",
              }}
            >
              {jiraLoading ? "⟳" : "↻"} Refresh
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            {[
              { val: graph!.nodes.length + (virtualNodes?.length ?? 0), label: "Modules" },
              { val: graph!.edges.length + (virtualEdges?.length ?? 0), label: "Connections" },
              {
                val: driftEdges.length,
                label: "Drift",
                color: driftEdges.length > 0 ? "#f85149" : "#3fb950",
              },
              {
                val: missingContextNodes.length,
                label: "No context",
                color: missingContextNodes.length > 0 ? "#f0883e" : "#3fb950",
              },
            ].map(({ val, label, color }) => (
              <div key={label}>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: color ?? "#e6edf3",
                  }}
                >
                  {val}
                </div>
                <div style={{ fontSize: 11, color: "#7d8590" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Health metrics from violations */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12 }}>
            {[
              {
                val: criticalViolationsCount,
                label: "Critical",
                color: criticalViolationsCount > 0 ? "#f85149" : "#3fb950",
                sub:
                  criticalViolationsCount > 0
                    ? `↑ ${criticalViolationsCount} active`
                    : "none",
                subColor: "#f85149",
              },
              {
                val: highViolationsCount,
                label: "High severity",
                color: highViolationsCount > 0 ? "#d29922" : "#3fb950",
                sub:
                  highViolationsCount > 0
                    ? `↑ ${highViolationsCount} open`
                    : "none",
                subColor: "#d29922",
              },
              {
                val: activeViolations.length,
                label: "Total violations",
                color: "#e6edf3",
                sub: "— all time",
                subColor: "#7d8590",
              },
              {
                val: trackedViolationsCount,
                label: "Tracked in Jira",
                color: "#3fb950",
                sub:
                  untrackedViolationsCount > 0
                    ? `↓ ${untrackedViolationsCount} untracked`
                    : "all tracked",
                subColor: "#3fb950",
              },
            ].map(({ val, label, color, sub, subColor }) => (
              <div key={label}>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: color ?? "#e6edf3",
                  }}
                >
                  {val}
                </div>
                <div style={{ fontSize: 11, color: "#7d8590" }}>{label}</div>
                <div
                  style={{
                    fontSize: 10,
                    color: subColor,
                    marginTop: 2,
                  }}
                >
                  {sub}
                </div>
              </div>
            ))}
          </div>

          {/* Edges */}
          <div
            style={{
              color: "#7d8590",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginTop: 12,
              marginBottom: 6,
            }}
          >
            Edges
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {(
              [
                { v: "all" as const, l: "All" },
                { v: "architectural" as const, l: "Arch" },
                { v: "violations" as const, l: "Violations" },
                { v: "drift" as const, l: "Drift" },
                { v: "jira" as const, l: "Jira" },
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

          {selectedNode && (
            <div
              style={{
                marginBottom: 12,
                padding: "8px 10px",
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
              <span style={{ fontWeight: 600 }} title={selectedNode}>{selectedNode}</span>
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

          {/* Violations — always visible so users know where to find them */}
          <div
            style={{
              background: activeViolations.length > 0 ? "transparent" : "#161b22",
              borderRadius: 8,
              border: activeViolations.length > 0 ? "1px solid #f8514944" : "1px solid #30363d",
              marginBottom: 8,
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
            {activeViolations.length === 0 ? (
              <div style={{ padding: "8px 12px 12px", fontSize: 11, color: "#7d8590" }}>
                No active violations. Ask the agent about your architecture to find issues.
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
                          <span
                            style={{
                              fontSize: 9,
                              padding: "2px 6px",
                              borderRadius: 3,
                              background: "#1e2d4544",
                              color: "#94a3b8",
                              whiteSpace: "nowrap",
                            }}
                            title="Jira priority"
                          >
                            {v.severity === "critical"
                              ? "Highest"
                              : v.severity === "high"
                                ? "High"
                                : v.severity === "medium"
                                  ? "Medium"
                                  : "Low"}
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
                        {!v.jiraKey && (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFixViolation(v);
                              }}
                              style={{
                                flex: 1,
                                padding: "5px 0",
                                fontSize: 10,
                                background: "#238636",
                                color: "white",
                                border: "none",
                                borderRadius: 4,
                                cursor: "pointer",
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                              }}
                            >
                              ✦ Fix now
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!jiraProjectKey && activeWorkspaceId) {
                                  setJiraProjectKeyDraft("");
                                  setEditingJiraProjectKey(true);
                                  return;
                                }
                                handleTrackViolation(v);
                              }}
                              disabled={jiraConfigured !== true}
                              title={
                                jiraConfigured !== true
                                  ? "Connect Jira and select a project to link architecture violations to issues"
                                  : !jiraProjectKey && activeWorkspaceId
                                    ? "Select a project key above to track in Jira"
                                    : "Track in Jira"
                              }
                              style={{
                                flex: 1,
                                padding: "5px 0",
                                fontSize: 10,
                                background: "#21262d",
                                color: "#58a6ff",
                                border: "1px solid #1f6feb",
                                borderRadius: 4,
                                cursor: jiraConfigured === true ? "pointer" : "not-allowed",
                                opacity: jiraConfigured === true ? 1 : 0.5,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                              }}
                            >
                              {jiraProjectKey ? "⬡ Track in Jira" : "Select project"}
                            </button>
                          </div>
                        )}
                        {v.jiraKey && (
                          <div style={{ fontSize: 10, color: "#7d8590", marginTop: 4 }}>
                            Tracked as {v.jiraKey}
                            {v.jiraStatus ? ` · ${v.jiraStatus}` : ""}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}
          </div>

          {/* Governance */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 6,
              marginTop: 12,
              marginBottom: 8,
            }}
          >
            <div>
              <div style={{ color: "#7d8590", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
                Governance
              </div>
              {jiraConfigured === null && (
                <div style={{ color: "#484f58", fontSize: 10, marginTop: 2 }}>Checking…</div>
              )}
              {jiraConfigured === true && jiraConnectedEmail && (
                <div style={{ color: "#484f58", fontSize: 10, marginTop: 2 }}>
                  Connected as {jiraConnectedEmail}
                </div>
              )}
              {jiraConfigured === true && activeWorkspaceId && (
                <div style={{ marginTop: 6, fontSize: 10 }}>
                  <div style={{ color: "#7d8590", marginBottom: 4 }}>Project key</div>
                  {editingJiraProjectKey ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {jiraProjectsLoading ? (
                        <div style={{ color: "#7d8590", fontSize: 11 }}>Loading projects…</div>
                      ) : jiraProjects.length > 0 ? (
                        <select
                          value={jiraProjects.some((p) => p.key === jiraProjectKeyDraft) ? jiraProjectKeyDraft : ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setJiraProjectKeyDraft(v);
                          }}
                          style={{
                            padding: "6px 8px",
                            fontSize: 11,
                            background: "#0d1117",
                            border: "1px solid #30363d",
                            borderRadius: 4,
                            color: "#e6edf3",
                            outline: "none",
                          }}
                        >
                          <option value="">Select a project</option>
                          {jiraProjects.map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.key} — {p.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <input
                              value={jiraProjectKeyDraft}
                              onChange={(e) => setJiraProjectKeyDraft(e.target.value.toUpperCase())}
                              placeholder={jiraProjects.length > 0 ? "Or type key" : "e.g. DOCLITTLE"}
                              style={{
                                flex: 1,
                                padding: "4px 8px",
                                fontSize: 11,
                                background: "#0d1117",
                                border: "1px solid #30363d",
                                borderRadius: 4,
                                color: "#e6edf3",
                                outline: "none",
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveProjectKey(jiraProjectKeyDraft);
                                else if (e.key === "Escape") cancelProjectKeyEdit();
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => saveProjectKey(jiraProjectKeyDraft)}
                              style={{
                                padding: "4px 8px",
                                fontSize: 10,
                                background: "#238636",
                                color: "white",
                                border: "none",
                                borderRadius: 4,
                                cursor: "pointer",
                              }}
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              onClick={cancelProjectKeyEdit}
                              style={{
                                padding: "4px 6px",
                                fontSize: 10,
                                background: "transparent",
                                color: "#8b949e",
                                border: "1px solid #30363d",
                                borderRadius: 4,
                                cursor: "pointer",
                              }}
                              title="Cancel and return to list"
                            >
                              ✕
                            </button>
                          </div>
                          {jiraProjectKeyDraft && !isValidProjectKey(jiraProjectKeyDraft) && (
                            <div style={{ fontSize: 10, color: "#f85149" }}>
                              Invalid key (no trailing hyphen, 2–10 chars)
                            </div>
                          )}
                        </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 8px",
                        background: "#0d1117",
                        borderRadius: 4,
                        border: "1px solid #30363d",
                        cursor: "pointer",
                        color: jiraProjectKey ? "#e6edf3" : "#7d8590",
                      }}
                      onClick={() => {
                        setJiraProjectKeyDraft(jiraProjectKey ?? "");
                        setEditingJiraProjectKey(true);
                        setJiraProjectsLoading(true);
                        fetch(`${API_BASE}/jira-projects`, { headers: { Authorization: `Bearer ${accessToken}` } })
                          .then((r) => r.json())
                          .then((d: { projects?: Array<{ key: string; name: string }> }) => setJiraProjects(d?.projects ?? []))
                          .catch(() => setJiraProjects([]))
                          .finally(() => setJiraProjectsLoading(false));
                      }}
                      title="Select which Jira project to fetch issues from"
                    >
                      <span style={{ flex: 1 }}>{jiraProjectKey ?? "Select project"}</span>
                      {jiraProjectKey && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); clearProjectKey(); }}
                          style={{
                            padding: "2px 6px",
                            fontSize: 9,
                            background: "transparent",
                            color: "#8b949e",
                            border: "1px solid #30363d",
                            borderRadius: 4,
                            cursor: "pointer",
                          }}
                          title="Clear project key"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            {jiraConfigured !== true ? (
              <button
                onClick={() => setShowJiraConnectModal(true)}
                style={{
                  padding: "4px 10px",
                  fontSize: 10,
                  height: 22,
                  background: "#21262d",
                  color: "#7d8590",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Connect Jira
              </button>
            ) : (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => {
                    setJiraFilterByRepo((v) => {
                      const next = !v;
                      try {
                        localStorage.setItem("jiraFilterByRepo", String(next));
                      } catch { /* ignore */ }
                      fetchJiraTests(next);
                      return next;
                    });
                  }}
                  disabled={jiraLoading}
                  style={{
                    padding: "4px 6px",
                    fontSize: 10,
                    height: 22,
                    background: jiraFilterByRepo ? "#238636" : "#21262d",
                    color: jiraFilterByRepo ? "white" : "#7d8590",
                    border: `1px solid ${jiraFilterByRepo ? "#238636" : "#30363d"}`,
                    borderRadius: 6,
                    cursor: jiraLoading ? "wait" : "pointer",
                  }}
                title={jiraFilterByRepo ? "Filter: show only issues labeled with this repo" : "Filter: show all unresolved issues in the project"}
                >
                  {jiraFilterByRepo ? "This repo" : "Show all"}
                </button>
                <button
                  onClick={() => setShowJiraDisconnectConfirm(true)}
                  style={{
                    padding: "4px 6px",
                    fontSize: 10,
                    height: 22,
                    background: "transparent",
                    color: "#8b949e",
                    border: "1px solid #30363d",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                  title="Disconnect Jira"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
          {jiraError && (
            jiraError === "No project selected" ? (
              <div
                style={{
                  fontSize: 11,
                  marginBottom: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #30363d",
                  background: "#111827",
                  color: "#9ca3af",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#4b5563",
                  }}
                />
                <span>{jiraError}</span>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#f85149", marginBottom: 8 }}>{jiraError}</div>
            )
          )}
          <div style={{ maxHeight: 220, overflowY: "auto", fontSize: 11 }}>
            {jiraIssues.length === 0 && !jiraLoading && !jiraError && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: "1px solid #30363d",
                  background: "#0d1117",
                  color: "#7d8590",
                  marginBottom: 4,
                }}
              >
                {jiraConfigured !== true
                  ? "Connect Jira to link architecture violations to issues"
                  : activeWorkspaceId && !jiraProjectKeyReady
                    ? "Loading Jira issues…"
                    : !jiraProjectKey && activeWorkspaceId
                      ? "Choose a project above to view Jira issues"
                      : "No unresolved Jira issues for this project"}
              </div>
            )}
            {jiraIssues.map((j) => {
              const canAddToRepo =
                !jiraFilterByRepo &&
                jiraRepoName &&
                !(j.labels ?? []).includes(jiraRepoName);
              return (
                <div
                  key={j.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 0",
                    borderBottom: "1px solid #21262d",
                  }}
                >
                  {j.priority && (
                    <span
                      style={{
                        fontSize: 9,
                        padding: "1px 4px",
                        borderRadius: 2,
                        background: "#1e2d4544",
                        color: "#94a3b8",
                        flexShrink: 0,
                      }}
                    >
                      {j.priority}
                    </span>
                  )}
                  <a
                    href={`${j.baseUrl}/browse/${j.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: "#58a6ff",
                      textDecoration: "none",
                    }}
                  >
                    <span style={{ color: "#8b949e" }}>{j.key}</span> {j.summary}
                    <span style={{ color: "#7d8590", marginLeft: 6 }}>{j.status}</span>
                  </a>
                  {canAddToRepo && (
                    <button
                      onClick={() => addLabelToIssue(j.key, jiraRepoName!)}
                      style={{
                        padding: "2px 6px",
                        fontSize: 10,
                        height: 20,
                        flexShrink: 0,
                        background: "#21262d",
                        color: "#58a6ff",
                        border: "1px solid #30363d",
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                    >
                      + Repo
                    </button>
                  )}
                </div>
              );
            })}
          </div>
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
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
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
              }}
              title="Create folders and index files for all proposed nodes"
            >
              Materialize this Architecture
            </button>
          </div>
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
              gap: 4,
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
                marginRight: 8,
              }}
            >
              Agent
            </span>
            {chatTabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveChatId(tab.id)}
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
                marginLeft: 4,
              }}
            >
              +
            </button>
          </div>
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
                    fontSize: 10,
                      color: isCritic ? "#f59e0b" : "#7d8590",
                    marginBottom: 4,
                    textTransform: "uppercase",
                  }}
                >
                    {m.role === "user" ? "You" : isCritic ? "Critic" : "Assistant"}
                </div>
                {m.content}
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
            <div style={{ flex: 1, display: "flex", gap: 6, alignItems: "flex-end" }}>
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
                      }}
                    >
                      {loadingWorkspaceId === ws.id ? "⟳ " : ""}{ws.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

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
          onClick={() => !materializeLoading && setShowMaterializeModal(false)}
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
              Materialize Architecture
            </div>
            <div
              style={{
                marginBottom: 12,
                fontSize: 11,
                color: "#7d8590",
              }}
            >
              Generated files include boilerplate only. Implement as needed. You approve creation.
            </div>
            <div style={{ marginBottom: 12, fontSize: 12, color: "#7d8590" }}>
              Enter the target folder path where modules will be created:
            </div>
            {virtualNodes.length > 0 && (
              <div
                style={{
                  marginBottom: 12,
                  padding: 8,
                  background: "#0d1117",
                  borderRadius: 6,
                  fontSize: 11,
                  color: "#7d8590",
                  maxHeight: 100,
                  overflowY: "auto",
                }}
              >
                <div style={{ marginBottom: 4, color: "#a78bfa" }}>
                  Will create {virtualNodes.length} node(s):
                </div>
                {virtualNodes.map((vn) => {
                  const path = vn.archNodeId ?? vn.id;
                  const filePath = path.includes(".") ? path : `${path}/index.ts`;
                  const full = materializeTargetPath.trim()
                    ? `${materializeTargetPath.trim()}/${filePath}`
                    : filePath;
                  return (
                    <div key={vn.id} style={{ fontFamily: "monospace", marginBottom: 2 }}>
                      {full}
                    </div>
                  );
                })}
              </div>
            )}
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
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => !materializeLoading && setShowMaterializeModal(false)}
                disabled={materializeLoading}
                style={{
                  padding: "8px 16px",
                  background: "#30363d",
                  color: "#e6edf3",
                  border: "none",
                  borderRadius: 6,
                  cursor: materializeLoading ? "wait" : "pointer",
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleMaterialize}
                disabled={materializeLoading || !materializeTargetPath.trim()}
                style={{
                  padding: "8px 16px",
                  background: "#7c3aed",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: materializeLoading ? "wait" : "pointer",
                  fontSize: 13,
                }}
              >
                {materializeLoading ? "Creating…" : "Materialize"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <ArchCanvas
          graph={graph!}
          selectedNode={selectedNode}
          selectedNodeData={selectedNodeData}
          repoUrl={repoUrl}
          onNodeSelect={setSelectedNode}
          edgeFilter={activeFilters}
          agentGraphCommand={agentGraphCommand}
          proposedNodes={virtualNodes}
          proposedEdges={virtualEdges}
          onRenameWorkspace={handleRenameWorkspaceTitle}
          onShare={activeWorkspaceId ? handleShare : undefined}
          onSave={activeWorkspaceId ? handleSaveWorkspace : undefined}
          onDeleteWorkspace={activeWorkspaceId ? handleDeleteWorkspace : undefined}
          isDeletingWorkspace={isDeletingWorkspace}
          workspaceId={activeWorkspaceId}
          accessToken={accessToken}
          autosaveEnabled={autosaveEnabled}
          onToggleAutosave={setAutosaveEnabled}
        />
      </div>
    </div>

      {showJiraConnectModal && (
        <JiraConnectModal
          accessToken={accessToken}
          onConnected={async () => {
            setShowJiraConnectModal(false);
            setJiraConfigured(true);
            try {
              const res = await fetch(`${API_BASE}/jira-status`, {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              const data = (await res.json().catch(() => ({}))) as { configured?: boolean; source?: "db" | "env" };
              setJiraConfigSource(data?.configured && data?.source === "db" ? "db" : null);
            } catch {
              setJiraConfigSource(null);
            }
            fetchJiraTests();
          }}
          onClose={() => setShowJiraConnectModal(false)}
        />
      )}

      {showJiraDisconnectConfirm && (
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
          onClick={() => setShowJiraDisconnectConfirm(false)}
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
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              Remove Jira connection?
            </div>
            <p style={{ fontSize: 13, color: "#8b949e", marginBottom: 20, lineHeight: 1.5 }}>
              Your Jira credentials will be removed. You’ll need to reconnect to track violations again.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowJiraDisconnectConfirm(false)}
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
                onClick={() => handleDisconnectJira()}
                style={{
                  padding: "8px 16px",
                  background: "#da3633",
                  color: "white",
                  border: "1px solid #da3633",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
