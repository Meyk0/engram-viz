"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { getRegionPulseStrength, regionBounds } from "@/lib/regions";
import type { BrainRegion, EngramEvent } from "@/types";

type NeuronsProps = {
  events: EngramEvent[];
};

const neuronOffsets: Record<BrainRegion, [number, number, number][]> = {
  prefrontal: [
    [-0.1, 0.04, 0.02],
    [0.02, 0.0, 0.04],
    [0.12, -0.04, -0.02],
    [-0.02, -0.08, 0.0]
  ],
  hippocampus: [
    [-0.05, 0.02, 0.02],
    [0.04, -0.02, -0.03],
    [0.06, 0.02, 0.04],
    [-0.02, -0.04, -0.02]
  ],
  temporal: [
    [-0.12, 0.05, 0.04],
    [0.08, -0.04, -0.02],
    [0.16, 0.02, 0.05],
    [-0.04, -0.08, -0.06]
  ]
};

export function Neurons({ events }: NeuronsProps) {
  return (
    <group scale={1.55} rotation={[0.02, -1.05, 0]}>
      {(Object.keys(regionBounds) as BrainRegion[]).map((region) => (
        <RegionNeuronCluster key={region} region={region} pulse={getRegionPulseStrength(events, region)} />
      ))}
    </group>
  );
}

function RegionNeuronCluster({ region, pulse }: { region: BrainRegion; pulse: number }) {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const shimmer = 1 + Math.sin(clock.elapsedTime * 3.2) * 0.045;
    group.current.scale.setScalar(shimmer + pulse * 0.38);
  });

  return (
    <group ref={group}>
      {neuronOffsets[region].map((offset, index) => (
        <mesh
          key={`${region}-${index}`}
          position={[
            regionBounds[region].center[0] + offset[0],
            regionBounds[region].center[1] + offset[1],
            regionBounds[region].center[2] + offset[2]
          ]}
        >
          <sphereGeometry args={[0.025 + index * 0.003, 12, 8]} />
          <meshBasicMaterial color={regionBounds[region].color} transparent opacity={0.34 + pulse * 0.5} depthWrite={false} />
        </mesh>
      ))}
      <mesh position={regionBounds[region].center}>
        <sphereGeometry args={[0.08 + pulse * 0.04, 24, 16]} />
        <meshBasicMaterial color={regionBounds[region].color} transparent opacity={0.1 + pulse * 0.18} depthWrite={false} />
      </mesh>
    </group>
  );
}
