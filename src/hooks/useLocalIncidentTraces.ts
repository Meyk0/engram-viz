import { useCallback, useEffect, useState } from "react";
import type { NormalizedTrace } from "@/lib/traces/types";

export type LocalIncidentTraceStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

export function useLocalIncidentTraces(enabled: boolean, intervalMs = 1_500) {
  const [traces, setTraces] = useState<NormalizedTrace[]>([]);
  const [status, setStatus] = useState<LocalIncidentTraceStatus>("idle");
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setStatus((current) => current === "ready" ? current : "loading");
    try {
      const response = await fetch("/api/local/traces", { signal, cache: "no-store" });
      if (response.status === 404) {
        setStatus("unavailable");
        setError(undefined);
        return false;
      }
      const payload = await response.json() as { traces?: NormalizedTrace[]; error?: string };
      if (!response.ok || !Array.isArray(payload.traces)) {
        throw new Error(payload.error ?? "Captured turns could not be loaded.");
      }
      setTraces(payload.traces);
      setStatus("ready");
      setError(undefined);
      return true;
    } catch (refreshError) {
      if (refreshError instanceof DOMException && refreshError.name === "AbortError") return false;
      setStatus("error");
      setError(refreshError instanceof Error ? refreshError.message : "Captured turns could not be loaded.");
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const poll = async () => {
      const available = await refresh(controller.signal);
      if (active && available) timeout = setTimeout(poll, intervalMs);
    };
    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timeout) clearTimeout(timeout);
    };
  }, [enabled, intervalMs, refresh]);

  return { error, refresh, status, traces };
}
