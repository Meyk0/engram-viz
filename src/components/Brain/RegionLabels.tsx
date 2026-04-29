"use client";

import { Html } from "@react-three/drei";
import { getRegionPulseStrength, regionBounds } from "@/lib/regions";
import type { BrainRegion, EngramEvent } from "@/types";

type RegionLabelsProps = {
  events: EngramEvent[];
};

export function RegionLabels({ events }: RegionLabelsProps) {
  return (
    <group scale={1.4} rotation={[0.08, 0, 0]}>
      {(Object.keys(regionBounds) as BrainRegion[]).map((region) => {
        const pulse = getRegionPulseStrength(events, region);
        const bounds = regionBounds[region];
        return (
          <Html
            key={region}
            position={[bounds.center[0], bounds.center[1] + bounds.size[1] * 0.82, bounds.center[2]]}
            center
            distanceFactor={4.2}
            className="region-label-3d"
            style={{
              color: pulse > 0.15 ? bounds.color : "rgba(140,165,255,0.46)",
              textShadow: pulse > 0.15 ? `0 0 14px ${bounds.color}` : "none"
            }}
          >
            <span>{bounds.label}</span>
          </Html>
        );
      })}
    </group>
  );
}
