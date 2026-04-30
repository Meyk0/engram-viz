"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessage, StreamChunk } from "@/types";

export function useChat(options: { onChunk: (chunk: StreamChunk) => void }) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const sessionId = useRef(`engram-${crypto.randomUUID()}`);

  const sendMessage = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || isStreaming) return;

      setIsStreaming(true);
      let assistantText = "";

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId.current, message: trimmed, history })
        });

        if (!response.ok || !response.body) {
          throw new Error("Chat stream failed to start");
        }

        const reader = response.body.getReader();
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
            options.onChunk(chunk);
          });
        }

        setHistory((current) => [
          ...current,
          { role: "user", content: trimmed },
          ...(assistantText ? ([{ role: "assistant", content: assistantText }] satisfies ChatMessage[]) : [])
        ]);
      } catch (error) {
        setIsStreaming(false);
        throw error;
      }

      setIsStreaming(false);
    },
    [history, isStreaming, options]
  );

  return { history, isStreaming, sendMessage };
}
