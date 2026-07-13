import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSemanticLayout } from "@/hooks/useSemanticLayout";
import type { SemanticLayoutSnapshot, SemanticMemoryDescriptor } from "@/lib/semantic/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSemanticLayout", () => {
  it("loads a validated snapshot and sends prior nodes on the next layout", async () => {
    const first = snapshot(["a"]);
    const second = snapshot(["a", "b"]);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(first))
      .mockResolvedValueOnce(Response.json(second));
    const memoryWithExtraFields = { ...memory("a"), embedding: [0.1, 0.2], importance: 0.8 };
    const initialMemories: SemanticMemoryDescriptor[] = [memoryWithExtraFields];
    const { result, rerender } = renderHook(
      ({ memories }: { memories: SemanticMemoryDescriptor[] }) => useSemanticLayout(memories),
      { initialProps: { memories: initialMemories } }
    );

    await waitFor(() => expect(result.current.layout?.nodes).toHaveLength(1));
    expect(result.current.error).toBeNull();

    rerender({ memories: [memory("b"), memory("a")] });
    await waitFor(() => expect(result.current.layout?.nodes).toHaveLength(2));

    const secondRequest = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(secondRequest.memories.map((item: SemanticMemoryDescriptor) => item.id)).toEqual(["a", "b"]);
    expect(secondRequest.previousNodes).toEqual(first.nodes);
    const firstRequest = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(firstRequest.memories[0]).not.toHaveProperty("embedding");
    expect(firstRequest.memories[0]).not.toHaveProperty("importance");
  });

  it("does not request a layout while disabled", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useSemanticLayout([memory("a")], { enabled: false }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});

function memory(id: string): SemanticMemoryDescriptor {
  return {
    id,
    text: `Memory ${id}`,
    region: "hippocampus",
    status: "active"
  };
}

function snapshot(ids: string[]): SemanticLayoutSnapshot {
  return {
    version: 1,
    signature: `signature-${ids.join("-")}`,
    provider: "lexical-fallback",
    algorithm: "similarity-force-v1",
    nodes: ids.map((id, index) => ({
      memoryId: id,
      position: [index, 0, 0],
      clusterId: `cluster-${id}`
    })),
    edges: [],
    clusters: ids.map((id) => ({ id: `cluster-${id}`, memberIds: [id] })),
    generatedAt: "2026-07-13T00:00:00.000Z"
  };
}
