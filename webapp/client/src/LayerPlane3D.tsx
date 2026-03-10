import { useRef, useState, useMemo, useEffect } from "react";
import { Html, Billboard } from "@react-three/drei";
import * as THREE from "three";
import { LAYER_COLORS } from "./layerPalette";
import { LAYOUT_SCALE, layerToY3D } from "./layout/layoutTo3D";
import { useSceneAnimation } from "./SceneAnimations";

interface LayerBand {
  id: string;
  layer: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayerPlane3DProps {
  band: LayerBand;
  nodeCount: number;
}

export function LayerPlane3D({ band, nodeCount }: LayerPlane3DProps) {
  const cfg = LAYER_COLORS[band.layer] ?? LAYER_COLORS["Uncategorized"];
  const color = useMemo(() => new THREE.Color(cfg.top), [cfg.top]);
  const [hovered, setHovered] = useState(false);
  const [transparent, setTransparent] = useState(true); // P8-4: click to toggle
  const emissiveRef = useRef(0);
  const lightRef = useRef<THREE.PointLight>(null);
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const lineRef = useRef<THREE.LineSegments>(null);

  const w = band.width * LAYOUT_SCALE;
  const d = band.height * LAYOUT_SCALE;
  const cx = (band.x + band.width / 2) * LAYOUT_SCALE;
  const cz = (band.y + band.height / 2) * LAYOUT_SCALE;
  const cy = layerToY3D(band.layer);

  const geo = useMemo(() => new THREE.PlaneGeometry(w, d), [w, d]);
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);

  useEffect(() => () => {
    geo.dispose();
    edgesGeo.dispose();
  }, [geo, edgesGeo]);

  useEffect(() => {
    if (lineRef.current) lineRef.current.computeLineDistances();
  }, [edgesGeo]);

  useSceneAnimation(({ delta }) => {
    const target = hovered ? 0.25 : 0;
    emissiveRef.current += (target - emissiveRef.current) * Math.min(delta * 6, 1);
    if (matRef.current) matRef.current.emissiveIntensity = emissiveRef.current;
    if (lightRef.current) lightRef.current.intensity = hovered ? 0.4 : 0;
  });

  return (
    <group position={[cx, cy, cz]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* P2-1: PlaneGeometry, P2-2: Glass material */}
      <mesh
        geometry={geo}
        frustumCulled
        onPointerEnter={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation();
          setTransparent((t) => !t);
        }}
      >
        <meshPhysicalMaterial
          ref={matRef}
          color={color}
          transparent
          opacity={transparent ? 0.12 : 0.5}
          transmission={0.4}
          thickness={0.1}
          roughness={0.3}
          metalness={0.1}
          emissive={color}
          emissiveIntensity={0}
        />
      </mesh>

      {/* P2-3: Dashed border outline */}
      <lineSegments ref={lineRef} geometry={edgesGeo} position={[0, 0.001, 0]}>
        <lineDashedMaterial
          color={cfg.accent}
          dashSize={0.15}
          gapSize={0.1}
          transparent
          opacity={0.6}
        />
      </lineSegments>

      {/* P2-5: Hover PointLight */}
      {hovered && (
        <pointLight
          ref={lightRef}
          color={cfg.top}
          intensity={0.4}
          distance={w + d}
          decay={2}
          position={[0, 0.5, 0]}
        />
      )}

      {/* P2-4: Layer label billboard, P2-6: Node count badge */}
      <Billboard follow position={[0, 0.15, 0]}>
        <Html center style={{ pointerEvents: "none", userSelect: "none" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "'JetBrains Mono','Fira Code',monospace",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: cfg.top,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              {band.layer}
            </span>
            <span
              style={{
                fontSize: 9,
                color: "#64748b",
                background: "rgba(30,41,59,0.8)",
                padding: "2px 6px",
                borderRadius: 10,
              }}
            >
              {nodeCount}
            </span>
          </div>
        </Html>
      </Billboard>
    </group>
  );
}
