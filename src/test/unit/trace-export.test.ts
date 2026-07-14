import { describe, expect, it } from "vitest";
import { createEngramTraceBundle, redactSensitiveJson } from "@/lib/traces/export";
import { importAgentTrace } from "@/lib/traces/import";
import type { NormalizedTrace } from "@/lib/traces/types";

describe("Engram trace export", () => {
  it("redacts sensitive fields and credential-shaped strings", () => {
    const trace: NormalizedTrace = {
      schemaVersion: 1,
      trace: {
        id: "trace-export",
        name: "Sensitive trace",
        source: { provider: "test", format: "normalized" },
        metadata: {
          api_key: "sk-test-secret-value-123456",
          nested: { authorization: "Bearer abc.def.ghi", safe: "visible" }
        }
      },
      steps: [{
        id: "step-1",
        index: 0,
        kind: "tool",
        name: "store_memory",
        status: "completed",
        input: { password: "do-not-export", note: "token sk-other-secret-123456" },
        memoryMappings: []
      }]
    };

    const bundle = createEngramTraceBundle(trace, "2026-07-13T12:00:00.000Z");
    const serialized = JSON.stringify(bundle);

    expect(bundle.redactions.count).toBe(4);
    expect(serialized).not.toContain("do-not-export");
    expect(serialized).not.toContain("abc.def.ghi");
    expect(serialized).not.toContain("sk-other-secret");
    expect(serialized).toContain("visible");
    expect(importAgentTrace(bundle).trace.trace.id).toBe(trace.trace.id);
  });

  it("leaves ordinary trace values unchanged", () => {
    expect(redactSensitiveJson({ color: "indigo", count: 3 })).toEqual({
      value: { color: "indigo", count: 3 },
      count: 0
    });
  });
});
