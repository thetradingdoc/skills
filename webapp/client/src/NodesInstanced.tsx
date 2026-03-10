import { useRef, useMemo, useEffect } from "react";
import * as THREE from "three";
import type { ArchNode } from "./types";
import { LAYER_CFG } from "./layerPalette";

const CARD_W = 1.5;
const CARD_H = 0.9;
const CARD_D = 0.12;

interface NodesInstancedProps {
  nodes: Array<ArchNode & { isVirtual?: boolean; isVirtualError?: boolean }>;
  positions: Array<[number, number, number]>;
  selectedNode: string | null;
}

export function NodesInstanced({ nodes, positions, selectedNode }: NodesInstancedProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = nodes.length;

  const boxGeo = useMemo(() => new THREE.BoxGeometry(CARD_W, CARD_H, CARD_D), []);

  useEffect(() => {
    if (!ref.current || count === 0) return;
    const mesh = ref.current;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const center = new THREE.Vector3(0, 0, 0);
    let n = 0;
    for (let i = 0; i < count; i++) {
      const pos = positions[i];
      if (!pos) continue;
      center.x += pos[0];
      center.y += pos[1];
      center.z += pos[2] + CARD_D / 2;
      n++;
    }
    if (n > 0) center.multiplyScalar(1 / n);
    let radius = 0;
    for (let i = 0; i < count; i++) {
      const pos = positions[i];
      if (!pos) continue;
      const [x, y, z] = pos;
      const node = nodes[i];
      const isSelected = selectedNode === node.id;
      const sev = node.violationState?.highestSeverity;
      const vOff = sev === "critical" ? 0.4 : sev === "high" ? 0.2 : 0;
      const py = y + vOff + (isSelected ? 0.15 : 0);
      m.compose(new THREE.Vector3(x, py, z + CARD_D / 2), q, s);
      mesh.setMatrixAt(i, m);
      const cfg = LAYER_CFG[(node.layer ?? "Uncategorized") as string] ?? LAYER_CFG["Uncategorized"];
      mesh.setColorAt(i, new THREE.Color(cfg.color));
      const d = center.distanceTo(new THREE.Vector3(x, py, z + CARD_D / 2));
      if (d > radius) radius = d;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // P7-4: ensure frustum culling uses bounds that cover all instances.
    mesh.geometry.boundingSphere = new THREE.Sphere(center, radius + Math.max(CARD_W, CARD_H));
  }, [nodes, positions, selectedNode, count]);

  useEffect(() => () => boxGeo.dispose(), [boxGeo]);

  return (
    <instancedMesh ref={ref} args={[boxGeo, undefined, count]} castShadow receiveShadow frustumCulled>
      <meshStandardMaterial
        vertexColors
        roughness={0.35}
        metalness={0.25}
        color="#ffffff"
      />
    </instancedMesh>
  );
}
