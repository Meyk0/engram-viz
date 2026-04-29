"use client";

import { Html } from "@react-three/drei";
import { getRegionPulseStrength, regionBounds } from "@/lib/regions";
import type { BrainRegion, EngramEvent } from "@/types";

type RegionLabelsProps = {
  events: EngramEvent[];
};

export function RegionLabels({ events }: RegionLabelsProps) {
  return (
    <>
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
              color: bounds.color,
              opacity: 0.78 + pulse * 0.22,
              textShadow: `0 0 10px ${bounds.color}, 0 1px 4px rgba(0,0,0,0.9)`
            }}
          >
            <span>{bounds.label}</span>
          </Html>
        );
      })}
    </>
  );
}
