"use client";

import { useCallback, useMemo, useState } from "react";
import { Send } from "lucide-react";
import { fixtureEvents } from "@/lib/events/fixtures";
import { explainEvent } from "@/lib/explanations";
import { useChat } from "@/hooks/useChat";
import { useEventQueue } from "@/hooks/useEventQueue";
import { useFirstTimeEvents } from "@/hooks/useFirstTimeEvents";
import { Brain3D } from "@/components/Brain/Brain3D";
import { EventFeed } from "@/components/UI/EventFeed";
import type { StreamChunk } from "@/types";

export function EngramApp() {
  const [message, setMessage] = useState("");
  const [responseText, setResponseText] = useState("");
  const { events, pushEvent } = useEventQueue([fixtureEvents[0]]);
  const { caption, recordEvent } = useFirstTimeEvents();

  const onChunk = useCallback(
    (chunk: StreamChunk) => {
      if (chunk.kind === "text") {
        setResponseText((current) => current + chunk.delta);
      }
      if (chunk.kind === "event") {
        pushEvent(chunk.event);
        recordEvent(chunk.event);
      }
    },
    [pushEvent, recordEvent]
  );

  const { isStreaming, sendMessage } = useChat(useMemo(() => ({ onChunk }), [onChunk]));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = message;
    setMessage("");
    setResponseText("");
    await sendMessage(current);
  }

  return (
    <main className="engram-shell">
      <Brain3D events={events} />

      <header className="topbar">
        <h1 className="title">ENGRAM</h1>
        <div className="subtitle">Neural memory visualizer v0.1</div>
      </header>

      <aside className="status-panel" aria-label="System status">
        <div className="status-line">
          <span>CORTEX ONLINE</span>
          <span className="status-dot" />
        </div>
        <div className="status-line">
          <span>DEMO STREAM</span>
          <span className="status-dot" />
        </div>
        <div className="status-line">
          <span>{events.length} EVENTS</span>
          <span className="status-dot" />
        </div>
      </aside>

      {caption ? <div className="caption">{caption}</div> : null}

      <EventFeed events={events} explainEvent={explainEvent} />

      {responseText ? (
        <aside className="ai-response" aria-label="AI response">
          <div className="response-header">AI RESPONSE</div>
          <div className="response-body">{responseText}</div>
        </aside>
      ) : null}

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
        <button className="send-btn" type="submit" disabled={isStreaming || !message.trim()} aria-label="Send">
          <Send size={15} />
        </button>
      </form>
    </main>
  );
}
