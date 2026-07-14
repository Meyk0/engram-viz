import { describe, expect, it } from "vitest";
import {
  authenticateTelemetryRequest,
  hashTelemetryIngestToken,
  parseTelemetryIngestKeys,
  TelemetryIngestAuthConfigurationError
} from "@/lib/ingest/auth";

describe("telemetry ingest authentication", () => {
  const token = "engram_test_secret";
  const keys = [{
    keyId: "test-key",
    tenantId: "tenant-a",
    projectId: "project-a",
    tokenSha256: hashTelemetryIngestToken(token)
  }];

  it("maps a bearer token to a fixed tenant and project", () => {
    const request = new Request("https://engram.test/api/telemetry/v2", {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(authenticateTelemetryRequest(request, keys)).toEqual({
      keyId: "test-key",
      tenantId: "tenant-a",
      projectId: "project-a"
    });
  });

  it("rejects missing and invalid tokens without revealing configured keys", () => {
    expect(authenticateTelemetryRequest(new Request("https://engram.test"), keys)).toBeUndefined();
    expect(authenticateTelemetryRequest(new Request("https://engram.test", {
      headers: { Authorization: "Bearer wrong" }
    }), keys)).toBeUndefined();
  });

  it("validates the hashed environment configuration", () => {
    expect(parseTelemetryIngestKeys(JSON.stringify(keys))).toEqual(keys);
    expect(() => parseTelemetryIngestKeys("not-json")).toThrow(TelemetryIngestAuthConfigurationError);
    expect(() => parseTelemetryIngestKeys(JSON.stringify([{ ...keys[0], tokenSha256: token }]))).toThrow(/SHA-256/);
    expect(() => parseTelemetryIngestKeys(JSON.stringify([...keys, keys[0]]))).toThrow(/Duplicate/);
  });
});
