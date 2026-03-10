import { useRef, useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useSpring } from "@react-spring/web";
import * as THREE from "three";
import { useSceneAnimation } from "./SceneAnimations";

export const DEFAULT_CAM_POS: [number, number, number] = [0, 14, 22];
export const DEFAULT_TARGET: [number, number, number] = [0, 7, 0];
const MIN_DISTANCE = 4;
const MAX_DISTANCE = 60;
const MIN_POLAR = 0.1;
const MAX_POLAR = Math.PI - 0.1;

export type ViewPreset = "top" | "front" | "side" | "iso";

export function presetToPosTarget(preset: ViewPreset): { pos: [number, number, number]; target: [number, number, number] } {
  const t: [number, number, number] = [0, 7, 0];
  switch (preset) {
    case "top":
      return { pos: [0, 25, 0.1], target: t };
    case "front":
      return { pos: [0, 7, 22], target: t };
    case "side":
      return { pos: [22, 7, 0], target: t };
    case "iso":
    default:
      return { pos: DEFAULT_CAM_POS, target: DEFAULT_TARGET };
  }
}

interface CameraControls3DProps {
  selectedNodePos: { x: number; y: number; z: number } | null;
  snapPreset: ViewPreset | null;
  onSnapComplete: () => void;
}

export function CameraControls3D({ selectedNodePos, snapPreset, onSnapComplete }: CameraControls3DProps) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const targetRef = useRef(new THREE.Vector3(...DEFAULT_TARGET));
  const [animating, setAnimating] = useState(false);

  const [spring, api] = useSpring(() => ({
    posX: DEFAULT_CAM_POS[0],
    posY: DEFAULT_CAM_POS[1],
    posZ: DEFAULT_CAM_POS[2],
    tgtX: DEFAULT_TARGET[0],
    tgtY: DEFAULT_TARGET[1],
    tgtZ: DEFAULT_TARGET[2],
    config: { tension: 80, friction: 20 },
  }));

  useEffect(() => {
    if (selectedNodePos) {
      const tgt = [selectedNodePos.x, selectedNodePos.y, selectedNodePos.z] as [number, number, number];
      const dist = 12;
      const dir = new THREE.Vector3(0.4, 0.6, 0.7).normalize();
      const pos: [number, number, number] = [
        tgt[0] + dir.x * dist,
        tgt[1] + dir.y * dist,
        tgt[2] + dir.z * dist,
      ];
      setAnimating(true);
      api.start({
        from: {
          posX: camera.position.x,
          posY: camera.position.y,
          posZ: camera.position.z,
          tgtX: controlsRef.current?.target?.x ?? targetRef.current.x,
          tgtY: controlsRef.current?.target?.y ?? targetRef.current.y,
          tgtZ: controlsRef.current?.target?.z ?? targetRef.current.z,
        },
        to: { posX: pos[0], posY: pos[1], posZ: pos[2], tgtX: tgt[0], tgtY: tgt[1], tgtZ: tgt[2] },
        onRest: () => setAnimating(false),
      });
    }
  }, [selectedNodePos, api]);

  useEffect(() => {
    if (!snapPreset) return;
    const { pos, target } = presetToPosTarget(snapPreset);
    setAnimating(true);
    api.start({
      from: {
        posX: camera.position.x,
        posY: camera.position.y,
        posZ: camera.position.z,
        tgtX: controlsRef.current?.target?.x ?? targetRef.current.x,
        tgtY: controlsRef.current?.target?.y ?? targetRef.current.y,
        tgtZ: controlsRef.current?.target?.z ?? targetRef.current.z,
      },
      to: {
        posX: pos[0],
        posY: pos[1],
        posZ: pos[2],
        tgtX: target[0],
        tgtY: target[1],
        tgtZ: target[2],
      },
      onRest: () => {
        setAnimating(false);
        onSnapComplete();
      },
    });
  }, [snapPreset, api, onSnapComplete]);

  useSceneAnimation(() => {
    if (!animating) return;
    const px = spring.posX.get();
    const py = spring.posY.get();
    const pz = spring.posZ.get();
    const tx = spring.tgtX.get();
    const ty = spring.tgtY.get();
    const tz = spring.tgtZ.get();
    camera.position.set(px, py, pz);
    targetRef.current.set(tx, ty, tz);
    if (controlsRef.current) {
      controlsRef.current.target.copy(targetRef.current);
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan
      enableZoom
      enableRotate
      enableDamping
      dampingFactor={0.08}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      minPolarAngle={MIN_POLAR}
      maxPolarAngle={MAX_POLAR}
      target={targetRef.current}
      enabled={!animating}
      touches={{
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }}
    />
  );
}

interface SnapButtons3DProps {
  onSnap: (preset: ViewPreset) => void;
  onExport?: () => void;
}

export function SnapButtons3D({ onSnap, onExport }: SnapButtons3DProps) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 20,
        display: "flex",
        gap: 4,
        background: "rgba(6,12,26,0.92)",
        border: "1px solid #1e2d45",
        borderRadius: 8,
        padding: 4,
        backdropFilter: "blur(12px)",
      }}
    >
      {(["top", "front", "side", "iso"] as ViewPreset[]).map((p) => (
        <button
          key={p}
          type="button"
          title={`${p} view`}
          onClick={() => onSnap(p)}
          style={{
            padding: "6px 10px",
            fontSize: 10,
            fontFamily: "monospace",
            textTransform: "capitalize",
            border: "1px solid transparent",
            borderRadius: 6,
            background: "transparent",
            color: "#94a3b8",
            cursor: "pointer",
          }}
        >
          {p}
        </button>
      ))}
      {onExport && (
        <button
          type="button"
          title="Export as PNG"
          onClick={onExport}
          style={{
            padding: "6px 10px",
            fontSize: 10,
            fontFamily: "monospace",
            border: "1px solid transparent",
            borderRadius: 6,
            background: "transparent",
            color: "#94a3b8",
            cursor: "pointer",
          }}
        >
          PNG
        </button>
      )}
    </div>
  );
}
