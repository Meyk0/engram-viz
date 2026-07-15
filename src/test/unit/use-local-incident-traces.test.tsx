import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocalIncidentTraces } from "@/hooks/useLocalIncidentTraces";

afterEach(() => vi.restoreAllMocks());

describe("useLocalIncidentTraces", () => {
  it("loads captured traces when local Studio is enabled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      traces: [{
        schemaVersion: 1,
        trace: { id: "trace-1", name: "Bad answer", source: { provider: "fixture", format: "engram.telemetry.v2" } },
        steps: []
      }]
    }));
    const { result } = renderHook(() => useLocalIncidentTraces(true, 60_000));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.traces.map((trace) => trace.trace.id)).toEqual(["trace-1"]);
  });

  it("keeps hosted mode quiet when the local endpoint is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "disabled" }, { status: 404 }));
    const { result } = renderHook(() => useLocalIncidentTraces(true, 60_000));

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.traces).toEqual([]);
  });
});
