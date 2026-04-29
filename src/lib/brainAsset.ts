import type { BrainRegion } from "@/types";

export const BRAIN_BASE_ASSET_PATH = "/brain.glb";
export const BRAIN_REGION_ASSET_PATH = "/engram_brain.glb";

export const regionMeshNames: Record<BrainRegion, string> = {
  prefrontal: "prefrontal_region",
  hippocampus: "hippocampus_region",
  temporal: "temporal_region"
};

const meshNameToRegion = new Map<string, BrainRegion>(
  Object.entries(regionMeshNames).map(([region, meshName]) => [meshName, region as BrainRegion])
);

export function getRegionFromMeshName(meshName: string): BrainRegion | undefined {
  const normalized = meshName.replace(/\.\d+$/, "");
  return meshNameToRegion.get(normalized);
}
