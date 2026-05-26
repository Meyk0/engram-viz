"use client";

import { AdditiveBlending } from "three";
import type { BrainAnimationState } from "@/lib/animations";
import { regionBounds } from "@/lib/regions";
import type { BrainRegion } from "@/types";

type RegionHighlightsProps = {
  animation: BrainAnimationState;
  focusedRegions?: BrainRegion[];
  focusPulseKey?: string;
};

const highlightScaleByRegion: Record<BrainRegion, number> = {
  prefrontal: 0.52,
  hippocampus: 1,
  temporal: 1
};

export function RegionHighlights({ animation, focusedRegions = [], focusPulseKey }: RegionHighlightsProps) {
  const focused = new Set(focusedRegions);

  return (
    <group>
      {(Object.keys(regionBounds) as BrainRegion[]).map((region) => {
        const bounds = regionBounds[region];
        const highlightScale = highlightScaleByRegion[region];
        const focusPulse = focused.has(region) ? 0.78 : 0;
        const pulse = Math.max(animation.regions[region], focusPulse);
        const fade = animation.decayDimming * 0.18;
        const visiblePulse = Math.max(0, pulse - 0.05);
        return (
          <group key={`${region}-${focusPulseKey ?? "live"}`} position={bounds.center}>
            <mesh
              renderOrder={4}
              scale={[
                bounds.size[0] * highlightScale * (1 + pulse * 0.12),
                bounds.size[1] * highlightScale * (1 + pulse * 0.12),
                bounds.size[2] * highlightScale * (1 + pulse * 0.12)
              ]}
            >
              <sphereGeometry args={[1, 36, 20]} />
              <meshBasicMaterial
                color={bounds.color}
                transparent
                opacity={Math.max(0, visiblePulse * 0.11 - fade)}
                depthWrite={false}
                depthTest={false}
                blending={AdditiveBlending}
              />
            </mesh>
            <mesh
              renderOrder={5}
              scale={[
                bounds.size[0] * highlightScale * 1.05,
                bounds.size[1] * highlightScale * 1.05,
                bounds.size[2] * highlightScale * 1.05
              ]}
            >
              <sphereGeometry args={[1, 24, 14]} />
              <meshBasicMaterial
                color={bounds.color}
                wireframe
                transparent
                opacity={Math.max(0, visiblePulse * 0.16 - fade)}
                depthWrite={false}
                depthTest={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
