"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { liveTraceSnapshotSchema } from "@/lib/traces/schema";
import type { LiveTraceSnapshot } from "@/lib/traces/types";

export type LiveRecorderStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "live"
  | "reconnecting"
  | "error";

export function useLiveTraceRecorder(onSnapshot: (snapshot: LiveTraceSnapshot) => void) {
  const [channelId, setChannelId] = useState<string>();
  const [status, setStatus] = useState<LiveRecorderStatus>("idle");
  const [error, setError] = useState<string>();
  const [itemCount, setItemCount] = useState(0);
  const eventSourceRef = useRef<EventSource | undefined>(undefined);
  const onSnapshotRef = useRef(onSnapshot);

  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  }, [onSnapshot]);

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = undefined;
    setChannelId(undefined);
    setStatus("idle");
    setError(undefined);
    setItemCount(0);
  }, []);

  const connect = useCallback(() => {
    eventSourceRef.current?.close();
    const nextChannelId = `live-${crypto.randomUUID()}`;
    const source = new EventSource(`/api/traces/live?channel=${encodeURIComponent(nextChannelId)}`);
    eventSourceRef.current = source;
    setChannelId(nextChannelId);
    setStatus("connecting");
    setError(undefined);
    setItemCount(0);

    source.onopen = () => setStatus((current) => current === "live" ? current : "listening");
    source.addEventListener("trace", (event) => {
      try {
        const snapshot = liveTraceSnapshotSchema.parse(JSON.parse((event as MessageEvent<string>).data)) as LiveTraceSnapshot;
        setStatus("live");
        setItemCount(snapshot.itemCount);
        setError(undefined);
        onSnapshotRef.current(snapshot);
      } catch {
        setStatus("error");
        setError("Engram received an invalid live trace update.");
      }
    });
    source.onerror = () => {
      setStatus((current) => current === "connecting" ? "error" : "reconnecting");
      setError("The recorder connection was interrupted. Engram will keep retrying.");
    };
    return nextChannelId;
  }, []);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  return { channelId, connect, disconnect, error, itemCount, status };
}
