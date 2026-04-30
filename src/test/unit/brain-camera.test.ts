import { describe, expect, it } from "vitest";
import { brainCameraProfiles, getBrainCameraProfile } from "@/lib/brainCamera";

describe("brain camera profiles", () => {
  it("keeps desktop at the normal hero distance", () => {
    expect(getBrainCameraProfile(1440, 900)).toEqual(brainCameraProfiles.desktop);
  });

  it("starts mobile at its maximum zoomed-out distance", () => {
    const mobile = getBrainCameraProfile(390, 844);

    expect(mobile).toEqual(brainCameraProfiles.mobile);
    expect(mobile.position[2]).toBe(mobile.maxDistance);
    expect(mobile.position[2]).toBeGreaterThan(brainCameraProfiles.desktop.position[2]);
    expect(mobile.fog[1]).toBeGreaterThan(mobile.position[2]);
  });

  it("uses mobile framing for narrow portrait-like containers", () => {
    expect(getBrainCameraProfile(720, 1100)).toEqual(brainCameraProfiles.mobile);
  });
});
