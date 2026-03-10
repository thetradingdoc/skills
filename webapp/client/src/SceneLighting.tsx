import { useMemo, useRef, useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LAYER_COLORS } from "./layerPalette";
import { LAYOUT_SCALE, layerToY3D } from "./layout/layoutTo3D";

function createRadialGradientTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2
  );
  grad.addColorStop(0, "#0a1628");
  grad.addColorStop(0.5, "#050d18");
  grad.addColorStop(1, "#020408");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const FILL_COLOR = 0x9333ea;
const DIR_COLOR = 0xd4e4ff;
const LAYER_LIGHT_INTENSITY = 0.4;
const LAYER_LIGHT_DISTANCE = 8;
const SELECTED_LIGHT_INTENSITY = 2.5;
const SELECTED_LIGHT_DISTANCE = 10;
const GRID_SIZE = 80;
const GRID_DIVISIONS = 80;

interface LayerBand {
  id: string;
  layer: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SceneLightingProps {
  layerBands: LayerBand[];
  selectedNodePos: { x: number; y: number; z: number } | null;
}

export function SceneLighting({ layerBands, selectedNodePos }: SceneLightingProps) {
  const { scene } = useThree();
  const bgTex = useMemo(() => createRadialGradientTexture(), []);
  const gridRef = useRef<THREE.GridHelper>(null);

  useEffect(() => {
    const prevBackground = scene.background;
    const prevFog = scene.fog;
    scene.background = new THREE.Color(0x040810);
    scene.fog = new THREE.FogExp2(0x040810, 0.015);
    return () => {
      bgTex.dispose();
      scene.background = prevBackground ?? null;
      // Three.js allows null to clear fog; preserve previous if any.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (scene as any).fog = prevFog ?? null;
    };
  }, [scene, bgTex]);

  // P5-6 edge fade is handled by FadingGrid shader below.

  return (
    <>
      {/* P5-5: Radial gradient sky (scene.background must be Color) */}
      <mesh scale={[200, 200, 200]} frustumCulled={false}>
        <sphereGeometry args={[1, 32, 24]} />
        <meshBasicMaterial map={bgTex} side={THREE.BackSide} depthWrite={false} />
      </mesh>

      {/* P5-1: Base light rig */}
      <ambientLight intensity={0.35} color={0x94a3b8} />
      <directionalLight
        position={[12, 18, 10]}
        intensity={1.2}
        color={DIR_COLOR}
        castShadow
      />
      <pointLight
        position={[-8, 8, -8]}
        intensity={0.5}
        color={FILL_COLOR}
        distance={40}
      />
      <pointLight
        position={[8, 4, -12]}
        intensity={0.3}
        color={FILL_COLOR}
        distance={35}
      />

      {/* P5-2: Per-layer accent lights */}
      {layerBands.map((band) => {
        const cfg = LAYER_COLORS[band.layer] ?? LAYER_COLORS["Uncategorized"];
        const cx = (band.x + band.width / 2) * LAYOUT_SCALE;
        const cz = (band.y + band.height / 2) * LAYOUT_SCALE;
        const cy = layerToY3D(band.layer);
        const color = new THREE.Color(cfg.top);
        return (
          <pointLight
            key={band.id}
            position={[cx, cy, cz]}
            color={color}
            intensity={LAYER_LIGHT_INTENSITY}
            distance={LAYER_LIGHT_DISTANCE}
            decay={2}
          />
        );
      })}

      {/* P5-3: Selected node light */}
      {selectedNodePos && (
        <pointLight
          position={[selectedNodePos.x, selectedNodePos.y, selectedNodePos.z]}
          intensity={SELECTED_LIGHT_INTENSITY}
          distance={SELECTED_LIGHT_DISTANCE}
          decay={2}
          color={0x60a5fa}
        />
      )}

      {/* P5-6: Floor grid with edge fade */}
      <FadingGrid size={GRID_SIZE} divisions={GRID_DIVISIONS} y={-2} />
    </>
  );
}

function FadingGrid({ size, divisions, y }: { size: number; divisions: number; y: number }) {
  const mat = useMemo(() => {
    const uniforms = {
      uSize: { value: size },
      uDivisions: { value: divisions },
      uMajorEvery: { value: 10 },
      uColorMajor: { value: new THREE.Color(0x1e3a5f) },
      uColorMinor: { value: new THREE.Color(0x0f172a) },
      uOpacity: { value: 0.22 },
      uFadeInner: { value: size * 0.25 },
      uFadeOuter: { value: size * 0.5 },
    };
    return new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        void main() {
          vUv = uv;
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uSize;
        uniform float uDivisions;
        uniform float uMajorEvery;
        uniform vec3 uColorMajor;
        uniform vec3 uColorMinor;
        uniform float uOpacity;
        uniform float uFadeInner;
        uniform float uFadeOuter;
        varying vec2 vUv;

        float lineMask(float x, float w) {
          float a = abs(fract(x) - 0.5);
          return 1.0 - smoothstep(0.5 - w, 0.5, a);
        }

        void main() {
          vec2 p = (vUv - 0.5) * uSize;
          float dist = length(p);
          float fade = 1.0 - smoothstep(uFadeInner, uFadeOuter, dist);

          float s = uDivisions / uSize; // lines per unit
          float gx = p.x * s;
          float gz = p.y * s;

          float minorW = 0.04;
          float majorW = 0.10;

          float minor = max(lineMask(gx, minorW), lineMask(gz, minorW));

          float mx = gx / uMajorEvery;
          float mz = gz / uMajorEvery;
          float major = max(lineMask(mx, majorW), lineMask(mz, majorW));

          vec3 col = mix(uColorMinor, uColorMajor, major);
          float alpha = uOpacity * fade * max(minor, major);

          if (alpha <= 0.001) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
  }, [size, divisions]);

  useEffect(() => () => mat.dispose(), [mat]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} frustumCulled={false}>
      <planeGeometry args={[size, size, 1, 1]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}
