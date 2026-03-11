import { useMemo, useRef, useState, useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Html, Billboard } from "@react-three/drei";
import * as THREE from "three";
import type { ArchNode, ArchNodeViolationState } from "./types";
import { LAYER_CFG } from "./layerPalette";
import { useSceneAnimation } from "./SceneAnimations";

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

const TECH_COLOR: Record<string, string> = {
  "database": "#22c55e",
  "cache": "#f97316",
  "queue": "#eab308",
  "message-bus": "#a855f7",
  "http-api": "#60a5fa",
  "web-ui": "#38bdf8",
  "mobile-app": "#f472b6",
  "kubernetes": "#3b82f6",
  "container-service": "#a78bfa",
  "serverless": "#facc15",
  "object-storage": "#fb923c",
  "external-saas": "#f97316",
  "generic-service": "#e5e7eb",
  "unknown": "#9ca3af",
};

const CARD_W = 1.5;
const CARD_H = 0.9;
const CARD_D = 0.12;
const DEPTH_THICK = 0.04;
const TOP_BAR_H = 0.03;
const PIP_SIZE = 0.06;
const CROWN_OFFSET = 0.6;
const BADGE_R = 0.12;
const BADGE_OFFSET = 0.5;

function drawCardTexture(
  node: ArchNode & { isVirtual?: boolean; isVirtualError?: boolean },
  cfg: { color: string; accent: string; dim: string; bg: string }
): HTMLCanvasElement {
  const W = 512;
  const H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0c1220";
  ctx.fillRect(0, 0, W, H);

  const pad = 24;
  let y = pad;

  const kind = (node.kind ?? "unknown") as string;
  const kindIcon = KIND_ICON[kind] ?? KIND_ICON.unknown;
  const label = node.suggestedLabel ?? node.role ?? node.label;
  const layer = node.layer ?? "Uncategorized";

  ctx.font = "14px 'JetBrains Mono','Fira Code',monospace";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(`${kindIcon}  ${layer}`, pad, y);
  y += 22;

  ctx.font = "bold 24px 'JetBrains Mono','Fira Code',monospace";
  ctx.fillStyle = "#e2e8f0";
  const name = label.length > 28 ? label.slice(0, 25) + "…" : label;
  ctx.fillText(name, pad, y);
  y += 28;

  if (node.description) {
    ctx.font = "14px 'JetBrains Mono','Fira Code',monospace";
    ctx.fillStyle = "#475569";
    const desc =
      node.description.length > 60 ? node.description.slice(0, 57) + "…" : node.description;
    ctx.fillText(desc, pad, y);
    y += 22;
  }

  y += 8;

  const chips: string[] = [];
  if (node.hasRAG) chips.push("RAG");
  if ((node.toolCount ?? 0) > 0) chips.push(`${node.toolCount}T`);
  if (node.isDrift) chips.push("drift");
  if ((node.depth ?? -1) >= 0) chips.push(`d${node.depth}`);

  if (chips.length > 0) {
    ctx.font = "11px 'JetBrains Mono','Fira Code',monospace";
    let cx = pad;
    for (const c of chips) {
      ctx.fillStyle = cfg.bg;
      ctx.fillRect(cx, y - 10, ctx.measureText(c).width + 12, 16);
      ctx.strokeStyle = cfg.accent;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(cx, y - 10, ctx.measureText(c).width + 12, 16);
      ctx.fillStyle = cfg.color;
      ctx.fillText(c, cx + 6, y);
      cx += ctx.measureText(c).width + 20;
    }
    y += 20;
  }

  const health = node.health ?? { hasDocs: false, hasTests: false, hasContext: false };
  ctx.font = "10px 'JetBrains Mono','Fira Code',monospace";
  const healthChips: Array<[string, boolean]> = [
    ["docs", health.hasDocs],
    ["tests", health.hasTests],
    ["ctx", health.hasContext],
  ];
  for (const [lbl, ok] of healthChips) {
    ctx.fillStyle = ok ? "#22c55e" : "#1e2d45";
    ctx.beginPath();
    ctx.arc(pad, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ok ? "#22c55e" : "#475569";
    ctx.fillText(lbl, pad + 10, y + 4);
    y += 18;
  }

  return canvas;
}

function createTexture(
  node: ArchNode & { isVirtual?: boolean; isVirtualError?: boolean }
): THREE.CanvasTexture {
  const cfg =
    LAYER_CFG[(node.layer ?? "Uncategorized") as string] ?? LAYER_CFG["Uncategorized"];
  const canvas = drawCardTexture(node, cfg);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

interface NodeCard3DProps {
  node: ArchNode & { isVirtual?: boolean; isVirtualError?: boolean };
  position: [number, number, number];
  isSelected: boolean;
  violationState?: ArchNodeViolationState | null;
  opacity?: number;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

const FLOAT_OFFSET = 0.15;
const HOVER_SCALE = 1.04;
const LOD_DISTANCE = 15;

export function NodeCard3D({
  node,
  position: [px, py, pz],
  isSelected,
  violationState,
  opacity = 1,
  onClick,
  onDoubleClick,
}: NodeCard3DProps) {
  const [hovered, setHovered] = useState(false);
  const cfg = LAYER_CFG[(node.layer ?? "Uncategorized") as string] ?? LAYER_CFG["Uncategorized"];
  const statusColor = STATUS_COLOR[node.status ?? "unknown"] ?? STATUS_COLOR["unknown"];
  const isPulsing = ["new", "warning", "error"].includes(node.status ?? "");
  const isEntry = node.isEntryPoint ?? false;
  const hasViolation = !!(violationState?.violations?.length ?? 0);
  const count = violationState?.violations?.length ?? 0;
  const severity = violationState?.highestSeverity;
  const badgeColor =
    severity === "critical" ? "#f85149" : severity === "high" ? "#f97316" : "#eab308";

  const tex = useMemo(() => createTexture(node), [
    node.id,
    node.label,
    node.suggestedLabel,
    node.role,
    node.layer,
    node.description,
    node.status,
    node.kind,
    node.health?.hasDocs,
    node.health?.hasTests,
    node.health?.hasContext,
    node.hasRAG,
    node.toolCount,
    node.isDrift,
    node.depth,
  ]);

  useEffect(() => () => {
    tex.dispose();
  }, [tex]);

  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const violationOffset =
    severity === "critical" ? 0.4 : severity === "high" ? 0.2 : 0;
  const baseY = py + violationOffset + (isSelected ? FLOAT_OFFSET : 0);
  const [isNear, setIsNear] = useState(true);
  const prevNearRef = useRef(true);
  const posRef = useRef({ x: px, y: baseY, z: pz });
  posRef.current = { x: px, y: baseY, z: pz };
  useSceneAnimation(() => {
    const p = posRef.current;
    const d = camera.position.distanceTo(new THREE.Vector3(p.x, p.y, p.z));
    const near = d < LOD_DISTANCE;
    if (prevNearRef.current !== near) {
      prevNearRef.current = near;
      setIsNear(near);
    }
  });

  const scale = hovered ? HOVER_SCALE : 1;
  const outlineOpacity = isSelected ? 0.9 : hovered ? 0.4 : 0;
  const isDrift = node.isDrift ?? false;
  const isVirtual = node.isVirtual ?? false;
  const health = node.health ?? { hasDocs: false, hasTests: false, hasContext: false };
  const healthy = health.hasDocs && health.hasTests && health.hasContext;
  const techKind = (node as any).techKind as string | undefined;
  const matMainRef = useRef<THREE.MeshStandardMaterial>(null);
  useSceneAnimation(({ elapsed }) => {
    if (matMainRef.current) {
      let base = isSelected ? 0.9 : outlineOpacity > 0 ? 0.4 : 0.05;
      if (isDrift) {
        const t = Math.sin(elapsed * 2) * 0.5 + 0.5;
        base = 0.25 + t * 0.4;
      } else if (severity === "critical" || severity === "high") {
        const t = Math.sin(elapsed * 1.8) * 0.5 + 0.5;
        base = (severity === "critical" ? 0.4 : 0.25) + t * 0.35;
      }
      matMainRef.current.emissiveIntensity = base;
    }
  });

  return (
    <group
      ref={groupRef}
      position={[px, baseY, pz]}
      scale={scale}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "default";
      }}
    >
      {/* P1-1: Main card box; P7-3 LOD: far=colored box, near=full texture */}
      <mesh castShadow receiveShadow position={[0, 0, CARD_D / 2]} frustumCulled>
        <boxGeometry args={[CARD_W, CARD_H, CARD_D]} />
        {isNear ? (
        <meshStandardMaterial
          ref={matMainRef}
          map={tex}
          roughness={isVirtual ? 0.95 : healthy ? 0.35 : 0.95}
          metalness={isVirtual ? 0.2 : healthy ? 0.4 : 0.2}
          emissive={new THREE.Color(isDrift ? "#ef4444" : cfg.accent)}
          emissiveIntensity={isDrift ? 0.3 : isSelected ? 0.9 : outlineOpacity > 0 ? 0.4 : 0.05}
          color={techKind && TECH_COLOR[techKind] ? TECH_COLOR[techKind] : "#0c1220"}
          transparent={opacity < 1 || isVirtual}
          opacity={isVirtual ? 0.6 : opacity}
          wireframe={isVirtual}
        />
        ) : (
        <meshStandardMaterial
          color={techKind && TECH_COLOR[techKind] ? TECH_COLOR[techKind] : cfg.accent}
          emissive={new THREE.Color(techKind && TECH_COLOR[techKind] ? TECH_COLOR[techKind] : cfg.accent)}
          emissiveIntensity={0.2}
          roughness={isVirtual ? 0.95 : healthy ? 0.5 : 0.95}
          metalness={isVirtual ? 0.2 : healthy ? 0.4 : 0.2}
          transparent={opacity < 1 || isVirtual}
          opacity={isVirtual ? 0.6 : opacity}
          wireframe={isVirtual}
        />
        )}
      </mesh>

      {/* Tech-specific glyph mesh above the card (DB cylinder, queue torus, etc.) */}
      {!isVirtual && techKind && (
        <mesh position={[0, CARD_H / 2 + 0.2, CARD_D / 2 + 0.04]}>
          {(() => {
            const color = TECH_COLOR[techKind] ?? TECH_COLOR.unknown;
            if (techKind === "database") {
              return (
                <>
                  <cylinderGeometry args={[0.18, 0.18, 0.16, 24]} />
                  <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} />
                </>
              );
            }
            if (techKind === "queue" || techKind === "message-bus") {
              return (
                <>
                  <torusGeometry args={[0.18, 0.06, 12, 32]} />
                  <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} />
                </>
              );
            }
            if (techKind === "kubernetes" || techKind === "container-service") {
              return (
                <>
                  <octahedronGeometry args={[0.18, 0]} />
                  <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} />
                </>
              );
            }
            if (techKind === "http-api" || techKind === "web-ui" || techKind === "mobile-app") {
              return (
                <>
                  <boxGeometry args={[0.34, 0.18, 0.06]} />
                  <meshStandardMaterial color={color} roughness={0.4} metalness={0.2} />
                </>
              );
            }
            // Fallback: small sphere.
            return (
              <>
                <sphereGeometry args={[0.12, 16, 12]} />
                <meshStandardMaterial color={color} roughness={0.4} metalness={0.2} />
              </>
            );
          })()}
        </mesh>
      )}

      {/* P8-6: Greenfield ghost nodes - dashed outline when virtual */}
      {isVirtual && (
        <GhostDashedOutline position={[0, 0, CARD_D / 2]} color={cfg.accent} opacity={0.8} />
      )}

      {/* P1-4: Isometric depth faces - right + bottom - hide for ghost */}
      {!isVirtual && (
      <>
      <mesh position={[CARD_W / 2 + DEPTH_THICK / 2, 0, CARD_D / 2]}>
        <boxGeometry args={[DEPTH_THICK, CARD_H, CARD_D]} />
        <meshStandardMaterial
          color={cfg.accent}
          transparent
          opacity={0.4 * opacity}
          roughness={0.6}
          metalness={0.2}
        />
      </mesh>
      <mesh position={[0, -CARD_H / 2 - DEPTH_THICK / 2, CARD_D / 2]}>
        <boxGeometry args={[CARD_W, DEPTH_THICK, CARD_D]} />
        <meshStandardMaterial
          color={cfg.accent}
          transparent
          opacity={0.4 * opacity}
          roughness={0.6}
          metalness={0.2}
        />
      </mesh>
      </>
      )}

      {/* P1-5: Top accent bar - hide for ghost */}
      {!isVirtual && (
      <mesh position={[0, CARD_H / 2 + TOP_BAR_H / 2, CARD_D / 2]}>
        <boxGeometry args={[CARD_W, TOP_BAR_H, CARD_D]} />
        <meshStandardMaterial
          color={cfg.color}
          emissive={new THREE.Color(cfg.accent)}
          emissiveIntensity={0.3}
          roughness={0.4}
          metalness={0.3}
        />
      </mesh>
      )}

      {/* P1-6: Status pip diamond; P7-3: skip Html/crown/badge when far */}
      {isNear && <StatusPip
        position={[0, CARD_H / 2 + 0.02, CARD_D / 2 + 0.02]}
        color={statusColor}
        pulsing={isPulsing}
      />}

      {isNear && (
        <>
          {isEntry && <CrownBillboard position={[0, CARD_H / 2 + CROWN_OFFSET, CARD_D / 2]} />}
          {hasViolation && (
            <ViolationBadge
              position={[CARD_W / 2 + BADGE_OFFSET, CARD_H / 2 + BADGE_OFFSET, CARD_D / 2]}
              color={badgeColor}
              count={count}
            />
          )}
        </>
      )}
    </group>
  );
}

function GhostDashedOutline({
  position,
  color,
  opacity,
}: {
  position: [number, number, number];
  color: string;
  opacity: number;
}) {
  const boxGeo = useMemo(() => new THREE.BoxGeometry(CARD_W, CARD_H, CARD_D), []);
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(boxGeo), [boxGeo]);
  const lineRef = useRef<THREE.LineSegments>(null);
  useEffect(() => () => {
    boxGeo.dispose();
    edgesGeo.dispose();
  }, [boxGeo, edgesGeo]);
  useEffect(() => {
    if (lineRef.current) lineRef.current.computeLineDistances();
  }, [edgesGeo]);
  return (
    <lineSegments ref={lineRef} position={position} geometry={edgesGeo}>
      <lineDashedMaterial
        color={color}
        dashSize={0.08}
        gapSize={0.06}
        transparent
        opacity={opacity}
      />
    </lineSegments>
  );
}

function StatusPip({
  position,
  color,
  pulsing,
}: {
  position: [number, number, number];
  color: string;
  pulsing: boolean;
}) {
  const lightRef = useRef<THREE.PointLight>(null);
  useSceneAnimation(({ elapsed }) => {
    if (lightRef.current && pulsing) {
      lightRef.current.intensity = 0.5 + Math.sin(elapsed * 2) * 0.3;
    }
  });

  return (
    <group position={position} rotation={[0, 0, Math.PI / 4]}>
      <mesh castShadow>
        <boxGeometry args={[PIP_SIZE, PIP_SIZE, PIP_SIZE * 0.5]} />
        <meshStandardMaterial
          color={color}
          emissive={new THREE.Color(color)}
          emissiveIntensity={pulsing ? 0.5 : 0.2}
          roughness={0.3}
          metalness={0.2}
        />
      </mesh>
      {pulsing && (
        <pointLight
          ref={lightRef}
          color={color}
          intensity={0.5}
          distance={0.5}
          decay={2}
        />
      )}
    </group>
  );
}

function CrownBillboard({ position }: { position: [number, number, number] }) {
  return (
    <Billboard follow={true} lockX={false} lockY={false} lockZ={false} position={position}>
      <Html center style={{ pointerEvents: "none", userSelect: "none" }}>
        <span style={{ fontSize: 28, lineHeight: 1 }} title="Entry point">
          👑
        </span>
      </Html>
    </Billboard>
  );
}

function ViolationBadge({
  position,
  color,
  count,
}: {
  position: [number, number, number];
  color: string;
  count: number;
}) {
  return (
    <group position={position}>
      <mesh castShadow>
        <sphereGeometry args={[BADGE_R, 12, 10]} />
        <meshStandardMaterial
          color={color}
          emissive={new THREE.Color(color)}
          emissiveIntensity={0.4}
          roughness={0.4}
          metalness={0.2}
        />
      </mesh>
      {/* Count via Html from drei - but Html causes portal; use Sprite or small plane with texture */}
      <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>
        <Html center style={{ pointerEvents: "none", userSelect: "none" }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#0b1120",
              background: color,
              borderRadius: "50%",
              width: 18,
              height: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {count > 9 ? "9+" : count}
          </span>
        </Html>
      </Billboard>
    </group>
  );
}
