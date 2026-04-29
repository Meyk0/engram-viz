"use client";

import { AdditiveBlending } from "three";
import { getRegionPulseStrength, regionBounds } from "@/lib/regions";
import type { BrainRegion, EngramEvent } from "@/types";

type RegionHighlightsProps = {
  events: EngramEvent[];
};

export function RegionHighlights({ events }: RegionHighlightsProps) {
  return (
    <group scale={1.55} rotation={[0.02, -1.05, 0]}>
      {(Object.keys(regionBounds) as BrainRegion[]).map((region) => {
        const bounds = regionBounds[region];
        const pulse = getRegionPulseStrength(events, region);
        return (
          <group key={region} position={bounds.center}>
            <mesh scale={bounds.size}>
              <sphereGeometry args={[1, 36, 20]} />
              <meshBasicMaterial
                color={bounds.color}
                transparent
                opacity={0.18 + pulse * 0.2}
                depthWrite={false}
                depthTest={false}
                blending={AdditiveBlending}
              />
            </mesh>
            <mesh scale={[bounds.size[0] * 1.05, bounds.size[1] * 1.05, bounds.size[2] * 1.05]}>
              <sphereGeometry args={[1, 24, 14]} />
              <meshBasicMaterial
                color={bounds.color}
                wireframe
                transparent
                opacity={0.26 + pulse * 0.18}
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
