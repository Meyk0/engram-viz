"use client";

import { useCallback, useMemo, useState } from "react";
import { Send, Square } from "lucide-react";
import { explainEvent } from "@/lib/explanations";
import { useChat } from "@/hooks/useChat";
import { useEventQueue } from "@/hooks/useEventQueue";
import { useMemoryExplanations } from "@/hooks/useMemoryExplanations";
import { useMemoryStore } from "@/hooks/useMemoryStore";
import { Brain3D } from "@/components/Brain/Brain3D";
import { ChatTranscript } from "@/components/UI/ChatTranscript";
import { CurrentEventBanner } from "@/components/UI/CurrentEventBanner";
import { EventFeed } from "@/components/UI/EventFeed";
import { ExplainabilityPanel } from "@/components/UI/ExplainabilityPanel";
import { MemoryInspector } from "@/components/UI/MemoryInspector";
import type { StreamChunk } from "@/types";

export function EngramApp() {
  const [message, setMessage] = useState("");
  const [draftTurn, setDraftTurn] = useState<{ user: string; assistant: string } | null>(null);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | undefined>(undefined);
  const { events, pushEvent } = useEventQueue();
  const memories = useMemoryStore(events);
  const explanations = useMemoryExplanations(events);
  const selectedMemory = useMemo(
    () => memories.find((memory) => memory.id === selectedMemoryId),
    [memories, selectedMemoryId]
  );

  const onChunk = useCallback(
    (chunk: StreamChunk) => {
      if (chunk.kind === "text") {
        setDraftTurn((current) =>
          current ? { ...current, assistant: `${current.assistant}${chunk.delta}` } : current
        );
      }
      if (chunk.kind === "event") {
        pushEvent(chunk.event);
      }
    },
    [pushEvent]
  );

  const { history, isStreaming, error, sendMessage, cancel } = useChat(useMemo(() => ({ onChunk }), [onChunk]));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = message.trim();
    if (!current) return;

    setMessage("");
    setDraftTurn({ user: current, assistant: "" });

    try {
      await sendMessage(current);
      setDraftTurn(null);
    } catch {
      setDraftTurn((turn) => (turn ? { ...turn, assistant: turn.assistant || "No response received." } : turn));
    }
  }

  return (
    <main className="engram-shell">
      <Brain3D
        events={events}
        onMemorySelect={setSelectedMemoryId}
        responseActive={isStreaming}
        selectedMemoryId={selectedMemoryId}
      />

      <header className="topbar">
        <h1 className="title">ENGRAM</h1>
      </header>

      <CurrentEventBanner events={events} />

      <EventFeed events={events} explainEvent={explainEvent} />
      <ExplainabilityPanel explanations={explanations} />
      <MemoryInspector memory={selectedMemory} onClose={() => setSelectedMemoryId(undefined)} />
      <ChatTranscript history={history} draftTurn={draftTurn} error={error} />

      <form className="chat-bar" onSubmit={onSubmit}>
        <span className="chat-prefix">›</span>
        <input
          className="chat-input"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Tell me something about yourself..."
          aria-label="Chat message"
        />
        <span className="chat-status">{isStreaming ? "STREAMING" : "READY"}</span>
        {isStreaming ? (
          <button className="send-btn" type="button" onClick={cancel} aria-label="Cancel response">
            <Square size={13} />
          </button>
        ) : (
          <button className="send-btn" type="submit" disabled={!message.trim()} aria-label="Send">
            <Send size={15} />
          </button>
        )}
      </form>
    </main>
  );
}
