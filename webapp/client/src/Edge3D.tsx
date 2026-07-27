import { useRef, useMemo, useEffect } from "react";
import * as THREE from "three";
import type { ArchEdge } from "./types";
import { LAYER_COLORS } from "./layerPalette";
import { useSceneAnimation } from "./SceneAnimations";

const CARD_H = 0.9;
const CARD_D = 0.12;
const TUBE_RADII = { arch: 0.025, drift: 0.04, violation: 0.035 };
const TUBULAR_SEGMENTS = 40;
const ARROW_R = 0.04;
const ARROW_H = 0.08;
const DRIFT_PARTICLE_T = 1.8;
const ALL_PARTICLE_T = 4;
const DRIFT_GLOW_R = 0.03;
const ALL_GLOW_R = 0.015;
interface Edge3DProps {
  edge: ArchEdge & { runtimeLatencyMs?: number; runtimeErrorRate?: number };
  srcPos: { x: number; y: number; z: number };
  tgtPos: { x: number; y: number; z: number };
  srcLayer?: string;
  tgtLayer?: string;
  opacity: number;
  tracePathActive?: boolean;
}

function edgeColor(edge: Edge3DProps["edge"], srcLayer?: string, tgtLayer?: string): string {
  if (edge.isDrift) return "#ef4444";
  if (edge.isLayerViolation) return "#f59e0b";
  // Runtime latency heatmap override (similar to 2D)
  if (typeof edge.runtimeLatencyMs === "number") {
    if (edge.runtimeLatencyMs < 100) return "#22c55e";
    if (edge.runtimeLatencyMs < 300) return "#eab308";
    return "#ef4444";
  }
  if (edge.type === "runtime") return "#22c55e";
  const layer = (srcLayer ?? tgtLayer ?? "Uncategorized") as string;
  return LAYER_COLORS[layer]?.top ?? LAYER_COLORS["Uncategorized"].top;
}

function edgeRadius(edge: Edge3DProps["edge"]): number {
  if (edge.isDrift) return TUBE_RADII.drift;
  if (edge.isLayerViolation) return TUBE_RADII.violation;
  return edge.type === "runtime" ? TUBE_RADII.arch * 0.9 : TUBE_RADII.arch;
}

export function Edge3D({
  edge,
  srcPos,
  tgtPos,
  srcLayer,
  tgtLayer,
  opacity,
  tracePathActive = false,
}: Edge3DProps) {
  const color = edgeColor(edge, srcLayer, tgtLayer);
  const radius = edgeRadius(edge);
  const isDrift = !!edge.isDrift;
  const isViolation = !!edge.isLayerViolation;
  const hasRuntimeLatency = typeof edge.runtimeLatencyMs === "number";

  const start = useMemo(
    () =>
      new THREE.Vector3(
        srcPos.x,
        srcPos.y - CARD_H / 2,
        srcPos.z + CARD_D / 2
      ),
    [srcPos.x, srcPos.y, srcPos.z]
  );
  const end = useMemo(
    () =>
      new THREE.Vector3(
        tgtPos.x,
        tgtPos.y + CARD_H / 2,
        tgtPos.z + CARD_D / 2
      ),
    [tgtPos.x, tgtPos.y, tgtPos.z]
  );
  const midYBase = (start.y + end.y) / 2;
  const midY = midYBase + (edge.type === "runtime" ? 1.2 : 0.5);
  const mid = useMemo(
    () =>
      new THREE.Vector3(
        (start.x + end.x) / 2,
        midY,
        (start.z + end.z) / 2
      ),
    [start, end, midY]
  );

  const curve = useMemo(
    () => new THREE.CatmullRomCurve3([start, mid, end]),
    [start, mid, end]
  );

  const tubeGeo = useMemo(
    () =>
      new THREE.TubeGeometry(curve, TUBULAR_SEGMENTS, radius, 8, false),
    [curve, radius]
  );

  const arrowGeo = useMemo(
    () => new THREE.ConeGeometry(ARROW_R, ARROW_H, 8),
    []
  );

  const dir = useMemo(() => {
    const d = new THREE.Vector3().subVectors(end, mid);
    return d.normalize();
  }, [end, mid]);

  const arrowQuat = useMemo(() => {
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(up, dir.clone().negate());
    return q;
  }, [dir]);

  const lightRef = useRef<THREE.PointLight>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const driftLightRef = useRef<THREE.PointLight>(null);
  useSceneAnimation(({ elapsed }) => {
    if (isDrift && matRef.current) {
      const t = Math.sin(elapsed * 2) * 0.5 + 0.5;
      matRef.current.emissiveIntensity = 0.15 + t * 0.25;
      if (driftLightRef.current) driftLightRef.current.intensity = 0.2 + t * 0.3;
    } else if (isViolation && lightRef.current && matRef.current) {
      const t = Math.sin(elapsed * 2) * 0.5 + 0.5;
      matRef.current.emissiveIntensity = 0.1 + t * 0.15;
      lightRef.current.intensity = 0.2 + t * 0.2;
    }
  });

  useEffect(() => () => {
    tubeGeo.dispose();
    arrowGeo.dispose();
  }, [tubeGeo, arrowGeo]);

  return (
    <group>
      {/* P3-1/P3-2/P3-3: TubeGeometry + CatmullRomCurve3, color by type */}
      <mesh geometry={tubeGeo} frustumCulled>
        <meshStandardMaterial
          ref={matRef}
          color={color}
          roughness={0.5}
          metalness={0.2}
          emissive={new THREE.Color(color)}
          emissiveIntensity={isDrift ? 0.2 : isViolation ? 0.15 : hasRuntimeLatency ? 0.08 : 0}
          transparent
          opacity={opacity}
        />
      </mesh>

      {/* P3-7: Arrowhead cone */}
      <mesh
        geometry={arrowGeo}
        position={[end.x, end.y, end.z]}
        quaternion={arrowQuat}
      >
        <meshStandardMaterial
          color={color}
          emissive={new THREE.Color(color)}
          emissiveIntensity={0.1}
          roughness={0.4}
          metalness={0.2}
          transparent
          opacity={opacity}
        />
      </mesh>

      {/* P3-8: Violation edge pulse */}
      {isViolation && (
        <pointLight
          ref={lightRef}
          color="#f59e0b"
          intensity={0.3}
          distance={1.5}
          decay={2}
          position={[mid.x, mid.y, mid.z]}
        />
      )}

      {/* P3-4: Drift particle; P8-1: Drift edge pulse light */}
      {isDrift && (
        <>
          <pointLight
            ref={driftLightRef}
            color="#ef4444"
            intensity={0.3}
            distance={1.5}
            decay={2}
            position={[mid.x, mid.y, mid.z]}
          />
          <DriftParticle curve={curve} color="#ef4444" opacity={opacity} period={DRIFT_PARTICLE_T} />
        </>
      )}

      {/* P3-5 / P6-6: All-edge particle; trace_path uses trace color + full opacity on path */}
      {tracePathActive ? (
        <DriftParticle curve={curve} color="#c084fc" opacity={opacity} period={DRIFT_PARTICLE_T} />
      ) : (
        <AllParticle curve={curve} opacity={opacity * 0.3} period={ALL_PARTICLE_T} />
      )}
    </group>
  );
}

function DriftParticle({
  curve,
  color,
  opacity,
  period,
}: {
  curve: THREE.CatmullRomCurve3;
  color: string;
  opacity: number;
  period: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const curveRef = useRef(curve);
  curveRef.current = curve;
  const periodRef = useRef(period);
  periodRef.current = period;
  useSceneAnimation(({ elapsed }) => {
    if (meshRef.current) {
      const t = (elapsed / periodRef.current) % 1;
      const p = curveRef.current.getPoint(t);
      meshRef.current.position.set(p.x, p.y, p.z);
    }
  });
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[DRIFT_GLOW_R, 12, 10]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity * 0.9}
      />
    </mesh>
  );
}

function AllParticle({
  curve,
  opacity,
  period,
}: {
  curve: THREE.CatmullRomCurve3;
  opacity: number;
  period: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const curveRef = useRef(curve);
  curveRef.current = curve;
  const periodRef = useRef(period);
  periodRef.current = period;
  useSceneAnimation(({ elapsed }) => {
    if (meshRef.current) {
      const t = (elapsed / periodRef.current) % 1;
      const p = curveRef.current.getPoint(t);
      meshRef.current.position.set(p.x, p.y, p.z);
    }
  });
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[ALL_GLOW_R, 8, 6]} />
      <meshBasicMaterial
        color="#60a5fa"
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}
