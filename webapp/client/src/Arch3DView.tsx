import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import type { ArchGraph, ArchNode } from "./types";
import { computeDepthLayout } from "./layout/depthLayout";
import { computeLayerLayout } from "./layout/layerLayout";
import { layoutTo3D } from "./layout/layoutTo3D";

const CARD_W = 1.5;
const CARD_H = 0.9;
const CARD_D = 0.12;
import { NodeCard3D } from "./NodeCard3D";
import { NodesInstanced } from "./NodesInstanced";
import { LayerPlane3D } from "./LayerPlane3D";
import { Edge3D } from "./Edge3D";
import { CameraControls3D, SnapButtons3D } from "./CameraControls3D";
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
}

function GlCapture({ glRef }: { glRef: React.MutableRefObject<HTMLCanvasElement | null> }) {
  const { gl } = useThree();
  useEffect(() => {
    glRef.current = gl.domElement;
    return () => { glRef.current = null; };
  }, [gl, glRef]);
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
}: Arch3DViewProps) {
  const isGreenfield =
    graph.nodes.length === 0 && (proposedNodes?.length ?? 0) > 0;
  const { nodePositions, layerBands } = isGreenfield
    ? computeLayerLayout(
        (proposedNodes ?? []).map((n) => ({
          id: n.id,
          label: n.label ?? n.id,
          layer: n.layer,
        }))
      )
    : computeDepthLayout(graph);
  const nodes = isGreenfield ? proposedNodes ?? [] : graph.nodes;
  const nodeCountByLayer = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) {
      const l = (n.layer ?? "Uncategorized") as string;
      m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  }, [nodes]);
  const positions3D = layoutTo3D(nodePositions, nodes);
  const nodeById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes]
  );

  const edges3D = useMemo(() => {
    const edges = graph.edges ?? [];
    const out: Array<{
      edge: (typeof graph.edges)[0];
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
      out.push({
        edge,
        srcPos: src,
        tgtPos: tgt,
        srcLayer: (srcNode as { layer?: string })?.layer,
        tgtLayer: (tgtNode as { layer?: string })?.layer,
      });
    }
    return out;
  }, [graph.edges, positions3D, nodeById]);

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

  const [snapPreset, setSnapPreset] = useState<"top" | "front" | "side" | "iso" | null>(null);
  const [isolated, setIsolated] = useState(false);
  const onSnapComplete = useCallback(() => setSnapPreset(null), []);
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

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#000",
      }}
    >
      <Canvas
        onPointerMissed={() => onNodeSelect(null)}
        camera={{ position: [0, 14, 22], fov: 50 }}
        gl={{
          antialias: true,
          alpha: false,
          toneMapping: 4,
          toneMappingExposure: 1.1,
        }}
      >
        <GlCapture glRef={glRef} />
        <SceneAnimations />
        <SceneLighting
          layerBands={layerBands}
          selectedNodePos={selectedNodePos}
        />
        <CameraControls3D
          selectedNodePos={selectedNodePos}
          snapPreset={snapPreset}
          onSnapComplete={onSnapComplete}
        />
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
        {layerBands.map((band) => (
          <LayerPlane3D
            key={band.id}
            band={band}
            nodeCount={nodeCountByLayer.get(band.layer) ?? 0}
          />
        ))}
        {nodeCards.length > 30 ? (
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
      <SnapButtons3D onSnap={(p) => setSnapPreset(p)} onExport={onExport} />
    </div>
  );
}
