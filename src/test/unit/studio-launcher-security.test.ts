import { describe, expect, it } from "vitest";
// @ts-expect-error The published Studio launcher is intentionally plain ESM.
import { assertLoopbackHostname } from "../../../packages/studio/launcher.mjs";

describe("Studio launcher network boundary", () => {
  it.each(["localhost", "127.0.0.1", "::1", "[::1]"])("accepts %s", (hostname) => {
    expect(() => assertLoopbackHostname(hostname)).not.toThrow();
  });

  it.each(["0.0.0.0", "192.168.1.10", "studio.example.com", ""])("rejects %s", (hostname) => {
    expect(() => assertLoopbackHostname(hostname)).toThrow(/loopback hostname/i);
  });
});
