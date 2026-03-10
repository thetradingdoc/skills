import { useRef, useLayoutEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

type FrameCallback = (state: { elapsed: number; delta: number }) => void;

const callbacks = new Set<FrameCallback>();
let elapsedGlobal = 0;

export function useSceneAnimation(cb: FrameCallback) {
  const ref = useRef(cb);
  ref.current = cb;
  useLayoutEffect(() => {
    const fn = (s: { elapsed: number; delta: number }) => ref.current(s);
    callbacks.add(fn);
    return () => {
      callbacks.delete(fn);
    };
  }, []);
}

export function SceneAnimations() {
  useFrame((state, delta) => {
    elapsedGlobal += delta;
    for (const fn of callbacks) fn({ elapsed: elapsedGlobal, delta });
  });
  return null;
}
