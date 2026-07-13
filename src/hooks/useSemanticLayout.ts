"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { canonicalizeSemanticMemories } from "@/lib/semantic/layout";
import { semanticLayoutSnapshotSchema } from "@/lib/semantic/schema";
import type { SemanticLayoutSnapshot, SemanticMemoryDescriptor } from "@/lib/semantic/types";

export type UseSemanticLayoutOptions = {
  enabled?: boolean;
  endpoint?: string;
};

export type UseSemanticLayoutResult = {
  error: string | null;
  isLoading: boolean;
  layout: SemanticLayoutSnapshot | null;
  refresh: () => void;
  snapshot: SemanticLayoutSnapshot | null;
};

type SemanticLayoutState = {
  error: string | null;
  layout: SemanticLayoutSnapshot | null;
  settledRequestKey: string | null;
};

export function useSemanticLayout(
  memories: readonly SemanticMemoryDescriptor[],
  options: UseSemanticLayoutOptions = {}
): UseSemanticLayoutResult {
  const { enabled = true, endpoint = "/api/semantic-layout" } = options;
  const [state, setState] = useState<SemanticLayoutState>({
    error: null,
    layout: null,
    settledRequestKey: null
  });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const latestLayout = useRef<SemanticLayoutSnapshot | null>(null);
  const canonicalMemoriesJson = JSON.stringify(canonicalizeSemanticMemories(memories));
  const hasMemories = canonicalMemoriesJson !== "[]";
  const requestKey = `${endpoint}\u0000${refreshVersion}\u0000${canonicalMemoriesJson}`;

  useEffect(() => {
    if (!enabled || !hasMemories) return;
    const canonicalMemories = JSON.parse(canonicalMemoriesJson) as SemanticMemoryDescriptor[];
    const controller = new AbortController();
    const memoryIds = new Set(canonicalMemories.map((memory) => memory.id));
    const previousNodes = latestLayout.current?.nodes.filter((node) => memoryIds.has(node.memoryId));

    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memories: canonicalMemories,
        ...(previousNodes?.length ? { previousNodes } : {})
      }),
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Semantic layout request returned HTTP ${response.status}.`);
        const parsed = semanticLayoutSnapshotSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Semantic layout response failed validation.");
        if (controller.signal.aborted) return;
        latestLayout.current = parsed.data;
        setState({ error: null, layout: parsed.data, settledRequestKey: requestKey });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          error: reason instanceof Error ? reason.message : "Semantic layout request failed.",
          settledRequestKey: requestKey
        }));
      });

    return () => controller.abort();
  }, [canonicalMemoriesJson, enabled, endpoint, hasMemories, requestKey]);

  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);
  const layout = hasMemories ? state.layout : null;
  const error = state.settledRequestKey === requestKey ? state.error : null;
  const isLoading = enabled && hasMemories && state.settledRequestKey !== requestKey;

  return { error, isLoading, layout, refresh, snapshot: layout };
}
