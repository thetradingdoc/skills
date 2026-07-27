import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, TransformControls } from "@react-three/drei";
import type {
  ArchGraph,
  ArchNode,
  WorkspaceAnnotation,
  WorkspaceSceneDoc,
  WorkspaceRuntimeSnapshot,
} from "./types";
import { computeDepthLayout } from "./layout/depthLayout";
import { computeLayerLayout } from "./layout/layerLayout";
import { computeDomainLayout } from "./layout/domainLayout";
import { computeElkLayout } from "./layout/elkLayout";
import { layoutTo3D, layerToY3D, LAYOUT_SCALE } from "./layout/layoutTo3D";
import type { LayerBand } from "./layout/depthLayout";
import { isFlagEnabled } from "./featureFlags";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";

const CARD_W = 1.5;
const CARD_H = 0.9;
const CARD_D = 0.12;
const GRID_DIVISIONS = 80;
const INSTANCED_THRESHOLD = 50;
import { NodeCard3D } from "./NodeCard3D";
import { NodesInstanced } from "./NodesInstanced";
import { LayerPlane3D } from "./LayerPlane3D";
import { Edge3D } from "./Edge3D";
import { CameraControls3D, SnapButtons3D, type ViewPreset, DEFAULT_CAM_POS } from "./CameraControls3D";
import { SceneLighting } from "./SceneLighting";
import { SceneAnimations } from "./SceneAnimations";

type LegendHighlight =
  | { type: "layer"; layer: string }
  | { type: "nodes"; nodeIds: string[] }
  | { type: "edge"; kind: "import" | "violation" | "drift" }
  | { type: "status"; status: "ok" | "warning" | "error" }
  | null;

interface Arch3DViewProps {
  graph: ArchGraph;
  proposedNodes?: Array<{ id: string; label?: string; archNodeId?: string; layer?: string; description?: string }>;
  selectedNode: string | null;
  onNodeSelect: (nodeId: string | null) => void;
  legendHighlight?: LegendHighlight | null;
  tracePathNodeIds?: string[] | null;
  workspaceId?: string | null;
  accessToken?: string | null;
  annotations?: WorkspaceAnnotation[];
  scene?: WorkspaceSceneDoc | null;
  sceneEditMode?: boolean;
  onSceneChange?: (next: WorkspaceSceneDoc) => void;
  activeSceneStateId?: string | null;
  runtimeSnapshot?: WorkspaceRuntimeSnapshot | null;
  /** Ref to register capture-view function (camera3D). */
  captureViewRef?: React.MutableRefObject<(() => { camera3D?: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } }) | null>;
}

function GlCapture({ glRef }: { glRef: React.MutableRefObject<HTMLCanvasElement | null> }) {
  const { gl } = useThree();
  useEffect(() => {
    glRef.current = gl.domElement;
    return () => { glRef.current = null; };
  }, [gl, glRef]);
  return null;
}

function CameraCaptureRefSetter({
  captureViewRef,
}: {
  captureViewRef: React.MutableRefObject<(() => { camera3D?: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } }) | null>;
}) {
  const { camera, controls } = useThree((s) => ({ camera: s.camera, controls: s.controls }));
  useEffect(() => {
    captureViewRef.current = () => {
      const pos = camera.position;
      const oc = controls as { target?: THREE.Vector3 } | undefined;
      const tgt = oc?.target ?? new THREE.Vector3(0, 7, 0);
      return {
        camera3D: {
          position: { x: pos.x, y: pos.y, z: pos.z },
          target: { x: tgt.x, y: tgt.y, z: tgt.z },
        },
      };
    };
    return () => { captureViewRef.current = null; };
  }, [camera, controls, captureViewRef]);
  return null;
}

function toNode(
  n: { id: string; label?: string; layer?: string; description?: string } | ArchNode
): ArchNode & { isVirtual?: boolean; isVirtualError?: boolean } {
  const a = n as ArchNode;
  if (a.path != null && a.status != null) return { ...a };
  return {
    id: n.id,
    label: (n as { label?: string }).label ?? n.id,
    path: n.id,
    layer: ((n as { layer?: string }).layer ?? "Uncategorized") as ArchNode["layer"],
    description: (n as { description?: string }).description ?? "Proposed node",
    files: [],
    health: { hasDocs: false, hasTests: false, hasContext: false },
    status: "new",
    isDrift: false,
    isEntryPoint: false,
    isVirtual: true,
    isVirtualError: false,
  };
}

export function Arch3DView({
  graph,
  proposedNodes,
  selectedNode,
  onNodeSelect,
  legendHighlight = null,
  tracePathNodeIds = null,
  workspaceId,
  accessToken,
  annotations = [],
  scene = null,
  sceneEditMode = false,
  onSceneChange,
  activeSceneStateId = null,
  runtimeSnapshot = null,
  captureViewRef,
}: Arch3DViewProps) {
  const isGreenfield =
    graph.nodes.length === 0 && (proposedNodes?.length ?? 0) > 0;
  const layoutMode = (scene?.settings?.layoutMode as "depth" | "domain" | "elk") ?? "depth";

  const [elkPositions, setElkPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  useEffect(() => {
    if (layoutMode !== "elk" || isGreenfield) {
      setElkPositions(null);
      return;
    }
    let cancelled = false;
    computeElkLayout(graph).then((res) => {
      if (!cancelled) setElkPositions(res.nodePositions);
    });
    return () => { cancelled = true; };
  }, [layoutMode, isGreenfield, graph.nodes.length, graph.edges?.length]);

  const syncLayout = isGreenfield
    ? computeLayerLayout(
        (proposedNodes ?? []).map((n) => ({
          id: n.id,
          label: n.label ?? n.id,
          layer: n.layer,
        }))
      )
    : layoutMode === "domain"
      ? computeDomainLayout(graph)
      : layoutMode === "elk" && elkPositions && elkPositions.size > 0
        ? { nodePositions: elkPositions, layerBands: [] as LayerBand[] }
        : computeDepthLayout(graph);
  const { nodePositions, layerBands } = syncLayout;
  const nodes = isGreenfield ? proposedNodes ?? [] : graph.nodes;
  const nodeCountByLayer = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) {
      const l = (n.layer ?? "Uncategorized") as string;
      m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  }, [nodes]);
  const basePositions3D = layoutTo3D(nodePositions, nodes);
  const [posOverrides, setPosOverrides] = useState<Record<string, { x: number; y: number; z: number }>>({});
  const positions3D = useMemo(() => {
    const m = new Map(basePositions3D);
    for (const [k, v] of Object.entries(posOverrides)) m.set(k, v);
    return m;
  }, [basePositions3D, posOverrides]);
  const nodeById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes]
  );

  useEffect(() => {
    if (!scene) return;
    const next: Record<string, { x: number; y: number; z: number }> = {};
    for (const obj of scene.objects ?? []) {
      if (obj.kind !== "node") continue;
      const nodeId = (obj.props as any)?.nodeId as string | undefined;
      const p = obj.transform?.position as any;
      if (!nodeId || !p) continue;
      if (typeof p.x === "number" && typeof p.y === "number") {
        next[nodeId] = { x: p.x, y: p.y, z: typeof p.z === "number" ? p.z : 0 };
      }
    }
    setPosOverrides(next);
  }, [scene]);

  const edges3D = useMemo(() => {
    const edges = graph.edges ?? [];
    const metricsEdges = (runtimeSnapshot?.edges ?? {}) as Record<string, { latencyMs?: number; errorRate?: number }>;
    const out: Array<{
      edge: (typeof graph.edges)[0] & { runtimeLatencyMs?: number; runtimeErrorRate?: number };
      srcPos: { x: number; y: number; z: number };
      tgtPos: { x: number; y: number; z: number };
      srcLayer?: string;
      tgtLayer?: string;
    }> = [];
    for (const edge of edges) {
      const src = positions3D.get(edge.source);
      const tgt = positions3D.get(edge.target);
      if (!src || !tgt) continue;
      const srcNode = nodeById.get(edge.source);
      const tgtNode = nodeById.get(edge.target);
      const m = metricsEdges[edge.id];
      out.push({
        edge: {
          ...(edge as any),
          runtimeLatencyMs: m?.latencyMs,
          runtimeErrorRate: m?.errorRate,
        },
        srcPos: src,
        tgtPos: tgt,
        srcLayer: (srcNode as { layer?: string })?.layer,
        tgtLayer: (tgtNode as { layer?: string })?.layer,
      });
    }
    return out;
  }, [graph.edges, positions3D, nodeById, runtimeSnapshot]);

  const connectedNodeIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const s = new Set<string>([selectedNode]);
    for (const e of graph.edges ?? []) {
      if (e.source === selectedNode || e.target === selectedNode) {
        s.add(e.source);
        s.add(e.target);
      }
    }
    return s;
  }, [selectedNode, graph.edges]);

  const selectedNodePos = useMemo(() => {
    if (!selectedNode) return null;
    const pos = positions3D.get(selectedNode);
    return pos ?? null;
  }, [selectedNode, positions3D]);

  const selectedPivotRef = useRef<THREE.Object3D | null>(null);
  const upsertSceneNodePos = useCallback(
    (nodeId: string, pos: { x: number; y: number; z: number }) => {
      if (!onSceneChange) return;
      const base: WorkspaceSceneDoc =
        scene && typeof scene === "object"
          ? scene
          : { schemaVersion: 1, objects: [], states: [], cameraPresets: [] };
      const objects = Array.isArray(base.objects) ? [...base.objects] : [];
      const idx = objects.findIndex((o) => o.kind === "node" && ((o.props as any)?.nodeId as string) === nodeId);
      const nextObj = {
        id: idx >= 0 ? objects[idx]!.id : `node-${nodeId}`,
        kind: "node" as const,
        archNodeId: (nodeById.get(nodeId) as any)?.archNodeId ?? undefined,
        props: { ...(idx >= 0 ? (objects[idx]!.props ?? {}) : {}), nodeId },
        transform: { ...(idx >= 0 ? (objects[idx]!.transform ?? {}) : {}), position: pos },
      };
      if (idx >= 0) objects[idx] = nextObj as any;
      else objects.push(nextObj as any);
      onSceneChange({ ...base, objects });
    },
    [onSceneChange, scene, nodeById]
  );

  const [importing, setImporting] = useState(false);
  const [customGlbObjects, setCustomGlbObjects] = useState<Array<{ id: string; gltf: THREE.Group; pos: { x: number; y: number; z: number } }>>([]);
  const gltfCacheRef = useRef<Map<string, THREE.Group>>(new Map());

  useEffect(() => {
    if (!scene) {
      setCustomGlbObjects([]);
      return;
    }
    let cancelled = false;
    const loader = new GLTFLoader();
    (async () => {
      const out: Array<{ id: string; gltf: THREE.Group; pos: { x: number; y: number; z: number } }> = [];
      for (const obj of scene.objects ?? []) {
        if (obj.kind !== "custom") continue;
        const asset = (obj.props as any)?.asset as { type?: string; dataUrl?: string } | undefined;
        if (!asset?.dataUrl) continue;
        const p = (obj.transform?.position ?? { x: 0, y: 0, z: 0 }) as any;
        const pos = { x: typeof p.x === "number" ? p.x : 0, y: typeof p.y === "number" ? p.y : 0, z: typeof p.z === "number" ? p.z : 0 };
        const cached = gltfCacheRef.current.get(asset.dataUrl);
        if (cached) {
          out.push({ id: obj.id, gltf: cached.clone(true), pos });
          continue;
        }
        try {
          const buf = await (await fetch(asset.dataUrl)).arrayBuffer();
          const gltf = await new Promise<THREE.Group>((resolve, reject) => {
            loader.parse(buf as any, "", (parsed) => resolve(parsed.scene), (err) => reject(err));
          });
          gltfCacheRef.current.set(asset.dataUrl, gltf);
          out.push({ id: obj.id, gltf: gltf.clone(true), pos });
        } catch {
          // ignore malformed assets
        }
      }
      if (!cancelled) setCustomGlbObjects(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [scene]);

  const [snapPreset, setSnapPreset] = useState<"top" | "front" | "side" | "iso" | null>(null);
  const [isolated, setIsolated] = useState(false);
  const onSnapComplete = useCallback(() => setSnapPreset(null), []);

  useEffect(() => {
    if (!scene || !activeSceneStateId) return;
    const st = (scene.states ?? []).find((s) => s.id === activeSceneStateId) as any;
    if (st?.camera3D) return;
    const cam = st?.cameraPresetId;
    if (cam === "top" || cam === "front" || cam === "side" || cam === "iso") {
      setSnapPreset(cam);
    }
  }, [scene, activeSceneStateId]);
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const onExport = useCallback(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "architecture-3d.png";
    a.click();
  }, []);

  const nodeOpacity = useCallback(
    (node: { id: string; layer?: string; status?: string; isDrift?: boolean }) => {
      if (!legendHighlight) return 1;
      if (legendHighlight.type === "layer")
        return (node.layer ?? "Uncategorized") === legendHighlight.layer ? 1 : 0.08;
      if (legendHighlight.type === "nodes")
        return legendHighlight.nodeIds.includes(node.id) ? 1 : 0.08;
      if (legendHighlight.type === "status") {
        const ok = legendHighlight.status === "ok" && (node.status ?? "unknown") === "stable";
        const warn = legendHighlight.status === "warning" && (node.status ?? "unknown") === "warning";
        const err = legendHighlight.status === "error" && ((node.isDrift ?? false) || (node.status ?? "unknown") === "error");
        return ok || warn || err ? 1 : 0.08;
      }
      return 1;
    },
    [legendHighlight]
  );

  const visibleNodeIds = useMemo(() => {
    if (!isolated || !selectedNode) return null;
    const s = new Set<string>([selectedNode]);
    for (const e of graph.edges ?? []) {
      if (e.source === selectedNode || e.target === selectedNode) {
        s.add(e.source);
        s.add(e.target);
      }
    }
    return s;
  }, [isolated, selectedNode, graph.edges]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsolated(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const annotations3D = useMemo(() => {
    const out: Array<{ ann: WorkspaceAnnotation; pos: [number, number, number] }> = [];
    for (const ann of annotations) {
      let x = 0,
        y = 0,
        z = 0;
      if (ann.node_id) {
        const p = positions3D.get(ann.node_id);
        if (!p) continue;
        x = p.x + 0.08;
        y = p.y + 0.15;
        z = p.z;
      } else if (ann.layer) {
        const band = layerBands.find((b) => b.layer === ann.layer);
        if (!band) continue;
        x = (band.x + band.width / 2) * LAYOUT_SCALE;
        y = layerToY3D(band.layer) + 0.2;
        z = band.y * LAYOUT_SCALE;
      } else if (typeof ann.canvas_x === "number" && typeof ann.canvas_y === "number") {
        x = ann.canvas_x * LAYOUT_SCALE;
        y = layerToY3D("Uncategorized") + 0.2;
        z = ann.canvas_y * LAYOUT_SCALE;
      } else continue;
      out.push({ ann, pos: [x, y, z] });
    }
    return out;
  }, [annotations, positions3D, layerBands]);

  const nodeCards = useMemo(() => {
    const out: Array<{ node: ArchNode & { isVirtual?: boolean; isVirtualError?: boolean }; pos: [number, number, number] }> = [];
    for (const node of nodes) {
      if (visibleNodeIds && !visibleNodeIds.has(node.id)) continue;
      const pos = positions3D.get(node.id);
      if (!pos) continue;
      const archNode = toNode(node);
      out.push({ node: archNode, pos: [pos.x, pos.y, pos.z] });
    }
    return out;
  }, [nodes, positions3D, visibleNodeIds]);

  const [viewPresetSlots, setViewPresetSlots] = useState<Record<number, ViewPreset | undefined>>({});
  const [lastSnapPreset, setLastSnapPreset] = useState<ViewPreset>("iso");
  const [gridDensity, setGridDensity] = useState<"coarse" | "medium" | "fine">("medium");
  const [gridOpacity, setGridOpacity] = useState<number>(0.22);
  const API_BASE = "/api";
  const [fps3d, setFps3d] = useState(0);

  useEffect(() => {
    if (!isFlagEnabled("perf_hud")) return;
    let frames = 0;
    let last = performance.now();
    let raf = window.requestAnimationFrame(function loop() {
      const now = performance.now();
      frames += 1;
      if (now - last >= 1000) {
        setFps3d(frames);
        frames = 0;
        last = now;
      }
      raf = window.requestAnimationFrame(loop);
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const handleSnap = useCallback((preset: ViewPreset) => {
    setLastSnapPreset(preset);
    setSnapPreset(preset);
  }, []);

  const handleSavePreset = useCallback(
    (slot: number) => {
      setViewPresetSlots((prev) => {
        const existing = prev[slot];
        // If a preset exists, jumping to it is just another snap.
        if (existing) {
          setSnapPreset(existing);
          return prev;
        }
        return { ...prev, [slot]: lastSnapPreset };
      });
      if (workspaceId && accessToken) {
        fetch(`${API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/views`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ slot, preset: lastSnapPreset }),
        }).catch(() => {
          // ignore errors for now — UI still works locally
        });
      }
    },
    [lastSnapPreset, workspaceId, accessToken]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "1" && e.key <= "5") {
        const slot = Number(e.key);
        const preset = viewPresetSlots[slot];
        if (preset) {
          setSnapPreset(preset);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewPresetSlots]);

  // Load saved camera views for this workspace.
  useEffect(() => {
    if (!workspaceId || !accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/views`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        if (!res.ok) return;
        const data: { views?: Array<{ slot: number; preset: ViewPreset }> } =
          await res.json().catch(() => ({}));
        if (cancelled || !Array.isArray(data.views)) return;
        setViewPresetSlots((prev) => {
          const next = { ...prev };
          for (const v of data.views!) {
            if (v.slot >= 1 && v.slot <= 5 && v.preset) {
              next[v.slot] = v.preset;
            }
          }
          return next;
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, accessToken]);

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        width: "100%",
        height: "100%",
        background: "#000",
        overflow: "hidden",
      }}
    >
      <Canvas
        style={{ width: "100%", height: "100%" }}
        onPointerMissed={() => onNodeSelect(null)}
        camera={{ position: DEFAULT_CAM_POS, fov: 50 }}
        gl={{
          antialias: true,
          alpha: false,
          toneMapping: 4,
          toneMappingExposure: 1.1,
        }}
      >
        <GlCapture glRef={glRef} />
        {captureViewRef && <CameraCaptureRefSetter captureViewRef={captureViewRef} />}
        <SceneAnimations />
        <SceneLighting
          layerBands={layerBands}
          selectedNodePos={selectedNodePos}
          gridDivisions={
            gridDensity === "fine"
              ? GRID_DIVISIONS * 2
              : gridDensity === "coarse"
                ? GRID_DIVISIONS / 2
                : GRID_DIVISIONS
          }
          gridOpacity={gridOpacity}
        />
        <CameraControls3D
          selectedNodePos={selectedNodePos}
          snapPreset={snapPreset}
          onSnapComplete={onSnapComplete}
          camera3DOverride={
            activeSceneStateId && scene?.states
              ? (scene.states.find((s) => s.id === activeSceneStateId) as any)?.camera3D ?? null
              : null
          }
        />

        {sceneEditMode && (
          <>
            {selectedNode && selectedNodePos && (
              <>
                <group
                  ref={(g) => {
                    selectedPivotRef.current = g as unknown as THREE.Object3D;
                    if (g) g.position.set(selectedNodePos.x, selectedNodePos.y, selectedNodePos.z);
                  }}
                />
                {selectedPivotRef.current && (
                  <TransformControls
                    object={selectedPivotRef.current}
                    mode="translate"
                    onObjectChange={() => {
                      const o = selectedPivotRef.current;
                      if (!o || !selectedNode) return;
                      const p = { x: o.position.x, y: o.position.y, z: o.position.z };
                      setPosOverrides((prev) => ({ ...prev, [selectedNode]: p }));
                      upsertSceneNodePos(selectedNode, p);
                    }}
                  />
                )}
              </>
            )}
            <Html position={[0, 0, 0]} style={{ pointerEvents: "auto" }}>
              <div style={{ position: "absolute", left: 16, bottom: 16, zIndex: 30 }}>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 8,
                    background: "rgba(15,23,42,0.92)",
                    border: "1px solid #1e293b",
                    color: "#e2e8f0",
                    fontFamily: "monospace",
                    fontSize: 11,
                    cursor: importing ? "wait" : "pointer",
                  }}
                >
                  <input
                    type="file"
                    accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                    disabled={importing}
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f || !onSceneChange) return;
                      setImporting(true);
                      try {
                        const reader = new FileReader();
                        const dataUrl = await new Promise<string>((resolve, reject) => {
                          reader.onerror = () => reject(new Error("read failed"));
                          reader.onload = () => resolve(String(reader.result));
                          reader.readAsDataURL(f);
                        });
                        const base: WorkspaceSceneDoc =
                          scene && typeof scene === "object"
                            ? scene
                            : { schemaVersion: 1, objects: [], states: [], cameraPresets: [] };
                        const objects = Array.isArray(base.objects) ? [...base.objects] : [];
                        objects.push({
                          id: `asset-${Date.now()}`,
                          kind: "custom",
                          props: { asset: { type: "gltf", dataUrl, name: f.name } },
                          transform: { position: { x: 0, y: 0.2, z: 0 } },
                        } as any);
                        onSceneChange({ ...base, objects });
                      } finally {
                        setImporting(false);
                        e.target.value = "";
                      }
                    }}
                  />
                  Import GLB/GLTF
                </label>
              </div>
            </Html>
          </>
        )}

        {customGlbObjects.map((o) => (
          <primitive key={o.id} object={o.gltf} position={[o.pos.x, o.pos.y, o.pos.z]} />
        ))}
        {edges3D.map(({ edge, srcPos, tgtPos, srcLayer, tgtLayer }) => {
          if (visibleNodeIds && (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)))
            return null;
          const connected =
            !selectedNode ||
            connectedNodeIds.has(edge.source) ||
            connectedNodeIds.has(edge.target);
          const traceIds = tracePathNodeIds ? new Set(tracePathNodeIds) : null;
          const onTracePath =
            traceIds && traceIds.has(edge.source) && traceIds.has(edge.target);
          let edgeOpacity = connected ? 1 : 0.05;
          if (traceIds) edgeOpacity = onTracePath ? 1 : 0.08;
          // P6-5: GraphCommand highlight/filter should also affect edges in 3D.
          if (legendHighlight?.type === "nodes") {
            const s = new Set(legendHighlight.nodeIds);
            edgeOpacity = s.has(edge.source) && s.has(edge.target) ? 1 : Math.min(edgeOpacity, 0.08);
          } else if (legendHighlight?.type === "layer") {
            const srcL = srcLayer ?? "Uncategorized";
            const tgtL = tgtLayer ?? "Uncategorized";
            edgeOpacity =
              srcL === legendHighlight.layer || tgtL === legendHighlight.layer ? edgeOpacity : Math.min(edgeOpacity, 0.08);
          } else if (legendHighlight?.type === "edge") {
            const matches =
              legendHighlight.kind === "import"
                ? !edge.isDrift && !edge.isLayerViolation
                : legendHighlight.kind === "violation"
                  ? !!edge.isLayerViolation && !edge.isDrift
                  : !!edge.isDrift;
            edgeOpacity = matches ? edgeOpacity : Math.min(edgeOpacity, 0.08);
          }
          return (
            <Edge3D
              key={edge.id}
              edge={edge}
              srcPos={srcPos}
              tgtPos={tgtPos}
              srcLayer={srcLayer}
              tgtLayer={tgtLayer}
              opacity={edgeOpacity}
              tracePathActive={onTracePath ?? false}
            />
          );
        })}
        {annotations3D.map(({ ann, pos }) => {
          const typeColor =
            ann.type === "note"
              ? "#fef08a"
              : ann.type === "highlight"
                ? "#bbf7d0"
                : "#bfdbfe";
          return (
            <group key={ann.id} position={pos}>
              <Html
                center
                style={{
                  minWidth: 120,
                  maxWidth: 200,
                  padding: "6px 8px",
                  background: typeColor,
                  color: "#0f172a",
                  borderRadius: 6,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                  fontFamily: "monospace",
                  fontSize: 10,
                  lineHeight: 1.35,
                  pointerEvents: "none",
                }}
              >
                <div style={{ fontWeight: 600, textTransform: "uppercase", fontSize: 9 }}>{ann.type}</div>
                <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 2 }}>
                  {ann.content || "(empty)"}
                </div>
              </Html>
            </group>
          );
        })}
        {layerBands.map((band) => (
          <LayerPlane3D
            key={band.id}
            band={band}
            nodeCount={nodeCountByLayer.get(band.layer) ?? 0}
          />
        ))}
        {nodeCards.length > INSTANCED_THRESHOLD ? (
          <>
            <NodesInstanced
              nodes={nodeCards.map((c) => c.node)}
              positions={nodeCards.map((c) => c.pos)}
              selectedNode={selectedNode}
            />
            {nodeCards.map(({ node, pos }) => {
              const sev = node.violationState?.highestSeverity;
              const vOff = sev === "critical" ? 0.4 : sev === "high" ? 0.2 : 0;
              return (
              <mesh
                key={node.id}
                position={[pos[0], pos[1] + vOff + (selectedNode === node.id ? 0.15 : 0), pos[2] + CARD_D / 2]}
                onClick={(e) => {
                  e.stopPropagation();
                  onNodeSelect(selectedNode === node.id ? null : node.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  selectedNode === node.id ? setIsolated(true) : onNodeSelect(node.id);
                }}
              >
                <boxGeometry args={[CARD_W, CARD_H, CARD_D]} />
                <meshBasicMaterial visible={false} />
              </mesh>
            );
            })}
          </>
        ) : (
          nodeCards.map(({ node, pos }) => (
            <NodeCard3D
              key={node.id}
              node={node}
              position={pos}
              isSelected={selectedNode === node.id}
              violationState={node.violationState}
              opacity={nodeOpacity(node)}
              onClick={() => onNodeSelect(selectedNode === node.id ? null : node.id)}
              onDoubleClick={() =>
                selectedNode === node.id ? setIsolated(true) : onNodeSelect(node.id)
              }
            />
          ))
        )}
      </Canvas>
      {isFlagEnabled("perf_hud") && (
        <div
          style={{
            position: "absolute",
            bottom: 12,
            right: 16,
            fontSize: 10,
            padding: "4px 6px",
            background: "rgba(15,23,42,0.9)",
            borderRadius: 4,
            border: "1px solid #1e293b",
            fontFamily: "monospace",
            color: "#e5e7eb",
            pointerEvents: "none",
          }}
        >
          3D · {graph.nodes.length} nodes · {graph.edges.length} edges · {fps3d} fps
        </div>
      )}
      <SnapButtons3D
        onSnap={handleSnap}
        onExport={onExport}
        onSavePreset={handleSavePreset}
        presetSlots={viewPresetSlots}
      />
      {/* Ground grid controls */}
      <div
        style={{
          position: "absolute",
          left: 16,
          bottom: 16,
          zIndex: 21,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: 6,
          borderRadius: 8,
          border: "1px solid #1e2d45",
          background: "rgba(6,12,26,0.9)",
          backdropFilter: "blur(10px)",
          fontFamily: "monospace",
          fontSize: 10,
          color: "#9ca3af",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Grid
          </span>
          {(["coarse", "medium", "fine"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setGridDensity(d)}
              style={{
                padding: "2px 6px",
                borderRadius: 999,
                border:
                  gridDensity === d ? "1px solid #38bdf8" : "1px solid transparent",
                background:
                  gridDensity === d ? "rgba(56,189,248,0.16)" : "transparent",
                color: gridDensity === d ? "#e0f2fe" : "#64748b",
                cursor: "pointer",
              }}
            >
              {d[0].toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>Opacity</span>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.02}
            value={gridOpacity}
            onChange={(e) => setGridOpacity(Number(e.target.value))}
            style={{ flex: 1 }}
          />
        </div>
      </div>
    </div>
  );
}
