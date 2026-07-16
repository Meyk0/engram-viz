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
  onRegionSelect?: (region: BrainRegion) => void;
  visible?: boolean;
};

export function RegionLabels({ animation, onRegionSelect, visible = true }: RegionLabelsProps) {
  if (!visible) return null;

  return (
    <>
      {(Object.keys(regionBounds) as BrainRegion[]).map((region) => {
        return (
          <RegionAnnotation
            animation={animation}
            key={region}
            onRegionSelect={onRegionSelect}
            region={region}
          />
        );
      })}
    </>
  );
}

function RegionAnnotation({
  animation,
  onRegionSelect,
  region
}: {
  animation: BrainAnimationState;
  onRegionSelect?: (region: BrainRegion) => void;
  region: BrainRegion;
}) {
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
  const eventActivity = Math.max(
    animation.hippocampusMarker,
    animation.transfer.strength,
    ...Object.values(animation.regions)
  );
  const labelFade = 1 - Math.min(0.32, eventActivity * 0.26);
  const opacity = baseOpacity * cameraOpacity * labelFade;

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
        opacity={opacity * 0.58}
        lineWidth={0.9}
        depthWrite={false}
        depthTest={false}
      />
      <group ref={anchorRef} position={anchor} />
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
        {onRegionSelect ? (
          <button
            aria-label={`Explain ${bounds.label}`}
            className="region-label-button"
            onClick={(event) => {
              event.stopPropagation();
              onRegionSelect(region);
            }}
            style={{ borderColor: `${bounds.color}55` }}
            title={`Explain ${bounds.label}`}
            type="button"
          >
            {bounds.label}
          </button>
        ) : (
          <span className="region-label-button" style={{ borderColor: `${bounds.color}55` }}>
            {bounds.label}
          </span>
        )}
      </Html>
    </group>
  );
}
