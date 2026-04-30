"use client";

import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BrainAnimationState } from "@/lib/animations";
import { regionBounds } from "@/lib/regions";
import type { BrainRegion } from "@/types";

type RegionLabelsProps = {
  animation: BrainAnimationState;
  visible?: boolean;
};

export function RegionLabels({ animation, visible = true }: RegionLabelsProps) {
  if (!visible) return null;

  return (
    <>
      {(Object.keys(regionBounds) as BrainRegion[]).map((region) => {
        return (
          <RegionAnnotation
            animation={animation}
            key={region}
            region={region}
          />
        );
      })}
    </>
  );
}

function RegionAnnotation({ animation, region }: { animation: BrainAnimationState; region: BrainRegion }) {
  const anchorRef = useRef<THREE.Group>(null);
  const [cameraOpacity, setCameraOpacity] = useState(1);
  const bounds = regionBounds[region];
  const pulse = animation.regions[region];
  const anchor = bounds.labelAnchor;
  const labelPosition = useMemo<[number, number, number]>(
    () => [
      anchor[0] + bounds.labelOffset[0],
      anchor[1] + bounds.labelOffset[1],
      anchor[2] + bounds.labelOffset[2]
    ],
    [anchor, bounds.labelOffset]
  );
  const baseOpacity = Math.max(0.76, 0.96 + pulse * 0.16 - animation.decayDimming * 0.2);
  const opacity = baseOpacity * cameraOpacity;
  const pinScale = 0.02 + pulse * 0.006;

  useFrame(({ camera }) => {
    if (!anchorRef.current) return;

    const anchorWorld = new THREE.Vector3();
    const centerWorld = new THREE.Vector3();
    anchorRef.current.getWorldPosition(anchorWorld);
    anchorRef.current.parent?.getWorldPosition(centerWorld);

    const outward = anchorWorld.clone().sub(centerWorld).normalize();
    const toCamera = camera.position.clone().sub(centerWorld).normalize();
    const facing = THREE.MathUtils.clamp((outward.dot(toCamera) + 0.08) / 0.74, 0, 1);
    const nextOpacity = 0.74 + facing * 0.26;

    setCameraOpacity((current) => (Math.abs(current - nextOpacity) > 0.04 ? nextOpacity : current));
  });

  return (
    <group>
      <Line
        points={[anchor, labelPosition]}
        color={bounds.color}
        transparent
        opacity={opacity * 0.64}
        lineWidth={0.85}
        depthWrite={false}
        depthTest={false}
      />
      <group ref={anchorRef} position={anchor}>
        <mesh scale={pinScale}>
          <sphereGeometry args={[1, 18, 12]} />
          <meshBasicMaterial
            color={bounds.color}
            transparent
            opacity={Math.min(1, opacity * 1.08)}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <mesh scale={pinScale * 2.2}>
          <sphereGeometry args={[1, 18, 10]} />
          <meshBasicMaterial
            color={bounds.color}
            transparent
            opacity={opacity * 0.22}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>
      <Html
        position={labelPosition}
        center
        distanceFactor={4.6}
        zIndexRange={[12, 12]}
        className="region-label-3d"
        style={{
          color: bounds.color,
          opacity,
          transform: `scale(${1 + pulse * 0.08})`,
          textShadow: `0 0 10px ${bounds.color}, 0 1px 4px rgba(0,0,0,0.9)`
        }}
      >
        <span style={{ borderColor: `${bounds.color}55` }}>{bounds.label}</span>
      </Html>
    </group>
  );
}
