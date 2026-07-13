"use client";

import { useCallback, useState } from "react";
import { causalAblationResultSchema } from "@/lib/events/schema";
import type { CausalAblationResult, TurnRecord } from "@/lib/evidence/types";

export function useCausalXRay() {
  const [result, setResult] = useState<CausalAblationResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (record: TurnRecord, excludedMemoryId: string) => {
    setPending(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/causal-xray", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record, excludedMemoryIds: [excludedMemoryId] })
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Causal X-Ray could not complete this replay.";
        throw new Error(message);
      }

      const parsed = causalAblationResultSchema.safeParse(payload);
      if (!parsed.success) throw new Error("Causal X-Ray returned an invalid comparison.");
      setResult(parsed.data);
      return parsed.data;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Causal X-Ray could not complete this replay.");
      return null;
    } finally {
      setPending(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setPending(false);
  }, []);

  return { error, pending, reset, result, run };
}
