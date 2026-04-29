import type { BrainRegion } from "@/types";

export type RegionBounds = {
  center: [number, number, number];
  size: [number, number, number];
  color: string;
};

export const regionBounds: Record<BrainRegion, RegionBounds> = {
  prefrontal: {
    center: [0, 0.36, 0.72],
    size: [0.9, 0.45, 0.38],
    color: "#00d4ff"
  },
  hippocampus: {
    center: [0, -0.28, 0.08],
    size: [0.58, 0.28, 0.46],
    color: "#a855f7"
  },
  temporal: {
    center: [0.58, -0.08, -0.1],
    size: [0.5, 0.48, 0.54],
    color: "#3b82f6"
  }
};

export function getRegionColor(region: BrainRegion): string {
  return regionBounds[region].color;
}
