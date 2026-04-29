"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { BrainAnimationState } from "@/lib/animations";
import { regionBounds } from "@/lib/regions";
import type { BrainRegion } from "@/types";

type AxonsProps = {
  animation: BrainAnimationState;
};

export function Axons({ animation }: AxonsProps) {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const tracer = useRef<THREE.Mesh>(null);
  const { transfer } = animation;
  const curve = useMemo(() => getTransferCurve(transfer.to), [transfer.to]);
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 48, 0.006, 8, false), [curve]);

  useFrame(({ clock }) => {
    if (material.current) {
      material.current.opacity = transfer.active ? 0.1 + transfer.strength * 0.48 : 0;
    }

    if (!tracer.current) return;
    const progress = transfer.active ? (clock.elapsedTime * 0.72) % 1 : 0;
    const position = curve.getPoint(progress);
    tracer.current.position.copy(position);
    tracer.current.visible = transfer.active && transfer.strength > 0.08;
    tracer.current.scale.setScalar(0.55 + transfer.strength * 0.9);
  });

  return (
    <group renderOrder={4}>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          ref={material}
          color={regionBounds[transfer.to].color}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={tracer} visible={false}>
        <sphereGeometry args={[0.028, 16, 10]} />
        <meshBasicMaterial
          color={regionBounds[transfer.to].color}
          transparent
          opacity={0.72}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function getTransferCurve(to: BrainRegion) {
  const fromCenter = regionBounds.hippocampus.center;
  const toCenter = regionBounds[to].center;
  const from = new THREE.Vector3(...fromCenter);
  const target = new THREE.Vector3(...toCenter);
  const midpoint = from.clone().lerp(target, 0.5);
  midpoint.y += 0.22;
  midpoint.z += 0.12;
  return new THREE.CatmullRomCurve3([from, midpoint, target]);
}
