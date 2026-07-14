export type BrainCameraProfile = {
  key: "desktop" | "reference" | "mobile";
  position: [number, number, number];
  minDistance: number;
  maxDistance: number;
  fog: [number, number];
};

export const brainCameraProfiles = {
  desktop: {
    key: "desktop",
    position: [0, 0.12, 5.25],
    minDistance: 3.1,
    maxDistance: 6.8,
    fog: [5, 9]
  },
  reference: {
    key: "reference",
    position: [0, 0.12, 5.9],
    minDistance: 3.5,
    maxDistance: 7.4,
    fog: [5.5, 10]
  },
  mobile: {
    key: "mobile",
    position: [0, 0.1, 11.5],
    minDistance: 3.4,
    maxDistance: 11.5,
    fog: [9, 16]
  }
} satisfies Record<BrainCameraProfile["key"], BrainCameraProfile>;

export function getBrainCameraProfile(
  width: number,
  height: number,
  compactReference = false
): BrainCameraProfile {
  if (compactReference) return brainCameraProfiles.reference;
  const aspectRatio = height > 0 ? width / height : 1;
  return width <= 700 || aspectRatio < 0.72 ? brainCameraProfiles.mobile : brainCameraProfiles.desktop;
}
