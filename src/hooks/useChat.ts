"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessage, EngramMemory, StreamChunk } from "@/types";

export function useChat(options: { clientMemories?: EngramMemory[]; onChunk: (chunk: StreamChunk) => void }) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionId = useRef(getStoredSessionId());
  const abortController = useRef<AbortController | null>(null);
  const streamReader = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const canceled = useRef(false);

  const cancel = useCallback(() => {
    if (!abortController.current) return;
    canceled.current = true;
    setError("Response canceled.");
    abortController.current?.abort();
    void streamReader.current?.cancel();
  }, []);

  const sendMessage = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || isStreaming) return;

      const controller = new AbortController();
      abortController.current = controller;
      canceled.current = false;
      setError(null);
      setIsStreaming(true);
      let assistantText = "";

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionId.current,
            message: trimmed,
            history,
            clientMemories: options.clientMemories ?? []
          }),
          signal: controller.signal
        });

        if (!response.ok || !response.body) {
          throw new Error("Chat stream failed to start");
        }

        const reader = response.body.getReader();
        streamReader.current = reader;
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";

          blocks.filter(Boolean).forEach((block) => {
            const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
            if (!dataLine) return;
            const chunk = JSON.parse(dataLine.slice("data: ".length)) as StreamChunk;
            if (chunk.kind === "text") {
              assistantText += chunk.delta;
            }
            if (chunk.kind === "error") {
              setError(chunk.message);
            }
            options.onChunk(chunk);
          });
        }

        if (canceled.current) return;

        setHistory((current) => [
          ...current,
          { role: "user", content: trimmed },
          ...(assistantText ? ([{ role: "assistant", content: assistantText }] satisfies ChatMessage[]) : [])
        ]);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setError("Response canceled.");
          return;
        }

        setError(error instanceof Error ? error.message : "Chat stream failed.");
        throw error;
      } finally {
        abortController.current = null;
        streamReader.current = null;
        canceled.current = false;
        setIsStreaming(false);
      }
    },
    [history, isStreaming, options]
  );

  return { history, isStreaming, error, sendMessage, cancel };
}

function getStoredSessionId() {
  const nextId = () => `engram-${crypto.randomUUID()}`;

  if (typeof window === "undefined") return nextId();

  const existing = window.localStorage.getItem("engram-session-id");
  if (existing) return existing;

  const next = nextId();
  window.localStorage.setItem("engram-session-id", next);
  return next;
}
