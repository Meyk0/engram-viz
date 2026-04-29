"use client";

import { AdditiveBlending } from "three";
import type { BrainAnimationState } from "@/lib/animations";
import { regionBounds } from "@/lib/regions";
import type { BrainRegion } from "@/types";

type RegionHighlightsProps = {
  animation: BrainAnimationState;
};

export function RegionHighlights({ animation }: RegionHighlightsProps) {
  return (
    <group>
      {(Object.keys(regionBounds) as BrainRegion[]).map((region) => {
        const bounds = regionBounds[region];
        const pulse = animation.regions[region];
        const fade = animation.decayDimming * 0.18;
        const visiblePulse = Math.max(0, pulse - 0.08);
        return (
          <group key={region} position={bounds.center}>
            <mesh scale={[bounds.size[0] * (1 + pulse * 0.12), bounds.size[1] * (1 + pulse * 0.12), bounds.size[2] * (1 + pulse * 0.12)]}>
              <sphereGeometry args={[1, 36, 20]} />
              <meshBasicMaterial
                color={bounds.color}
                transparent
                opacity={Math.max(0, visiblePulse * 0.045 - fade)}
                depthWrite={false}
                depthTest
                blending={AdditiveBlending}
              />
            </mesh>
            <mesh scale={[bounds.size[0] * 1.05, bounds.size[1] * 1.05, bounds.size[2] * 1.05]}>
              <sphereGeometry args={[1, 24, 14]} />
              <meshBasicMaterial
                color={bounds.color}
                wireframe
                transparent
                opacity={Math.max(0, visiblePulse * 0.065 - fade)}
                depthWrite={false}
                depthTest
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
