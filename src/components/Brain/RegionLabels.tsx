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
        const labelPosition: [number, number, number] = [
          bounds.center[0] + bounds.labelOffset[0],
          bounds.center[1] + bounds.labelOffset[1],
          bounds.center[2] + bounds.labelOffset[2]
        ];
        return (
          <Html
            key={region}
            position={labelPosition}
            center
            distanceFactor={4.6}
            className="region-label-3d"
            style={{
              color: pulse > 0.15 ? bounds.color : "rgba(190,220,255,0.68)",
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
