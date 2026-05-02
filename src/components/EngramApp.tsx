"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { getActiveContextFill, getLatestRetrieveEvent, getLoadedMemoryIds } from "@/lib/memoryVisuals";
import { useChat } from "@/hooks/useChat";
import { useEventQueue } from "@/hooks/useEventQueue";
import { useMemoryExplanations } from "@/hooks/useMemoryExplanations";
import { useMemoryStore } from "@/hooks/useMemoryStore";
import { Brain3D } from "@/components/Brain/Brain3D";
import { ActiveContextPanel } from "@/components/UI/ActiveContextPanel";
import { ChatTranscript } from "@/components/UI/ChatTranscript";
import { CurrentEventBanner } from "@/components/UI/CurrentEventBanner";
import { ExplainabilityPanel } from "@/components/UI/ExplainabilityPanel";
import { MemoryInspector } from "@/components/UI/MemoryInspector";
import { OnboardingPanel } from "@/components/UI/OnboardingPanel";
import { RegionInspector } from "@/components/UI/RegionInspector";
import { SecondaryDock, type SecondaryPanel } from "@/components/UI/SecondaryDock";
import type { BrainRegion, StreamChunk } from "@/types";

const regionShortcuts: Array<{ label: string; region: BrainRegion }> = [
  { label: "New", region: "hippocampus" },
  { label: "Working", region: "prefrontal" },
  { label: "Stable", region: "temporal" }
];

export function EngramApp() {
  const [message, setMessage] = useState("");
  const [draftTurn, setDraftTurn] = useState<{ user: string; assistant: string } | null>(null);
  const [activePanel, setActivePanel] = useState<SecondaryPanel | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | undefined>(undefined);
  const [selectedRegion, setSelectedRegion] = useState<BrainRegion | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const { events, pushEvent } = useEventQueue();
  const memories = useMemoryStore(events);
  const explanations = useMemoryExplanations(events);
  const loadedMemoryIds = useMemo(() => getLoadedMemoryIds(events), [events]);
  const latestRetrieve = useMemo(() => getLatestRetrieveEvent(events), [events]);
  const activeContextFill = useMemo(() => getActiveContextFill(loadedMemoryIds), [loadedMemoryIds]);
  const activeContextMemories = useMemo(
    () =>
      loadedMemoryIds
        .map((id) => memories.find((memory) => memory.id === id))
        .filter((memory): memory is NonNullable<typeof memory> => Boolean(memory)),
    [loadedMemoryIds, memories]
  );
  const activeContextExplanations = useMemo(
    () => new Map(explanations.map((explanation) => [explanation.id, explanation])),
    [explanations]
  );
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

  const { history, isStreaming, error, sendMessage, cancel } = useChat(
    useMemo(() => ({ clientMemories: memories, onChunk }), [memories, onChunk])
  );
  const transcriptCount = useMemo(
    () => history.filter((turn) => turn.role === "user").length + (draftTurn ? 1 : 0),
    [draftTurn, history]
  );
  const memoryDetailCount = selectedMemory ? 1 : explanations.length;
  const regionDetailCount = selectedRegion ? 1 : 0;
  const showOnboarding = events.length === 0 && !onboardingDismissed;

  const onMemorySelect = useCallback((id: string) => {
    setSelectedMemoryId(id);
    setSelectedRegion(undefined);
    setActivePanel("memory");
  }, []);

  const closeSecondaryPanel = useCallback(() => {
    setSelectedRegion(undefined);
    setSelectedMemoryId(undefined);
    setActivePanel(null);
  }, []);

  const closeMemoryPanel = useCallback(() => {
    setSelectedMemoryId(undefined);
    setActivePanel(null);
  }, []);

  const closeRegionPanel = useCallback(() => {
    setSelectedRegion(undefined);
    setActivePanel(null);
  }, []);

  const openActiveContext = useCallback(() => {
    setSelectedMemoryId(undefined);
    setSelectedRegion(undefined);
    setActivePanel("context");
  }, []);

  const onRegionSelect = useCallback((region: BrainRegion) => {
    setSelectedMemoryId(undefined);
    setSelectedRegion(region);
    setActivePanel("region");
  }, []);

  const startOnboarding = useCallback(() => {
    setOnboardingDismissed(true);
    inputRef.current?.focus();
  }, []);

  const onDockSelect = useCallback(
    (panel: SecondaryPanel) => {
      const nextPanel = activePanel === panel ? null : panel;
      setActivePanel(nextPanel);
      if (nextPanel !== "memory") {
        setSelectedMemoryId(undefined);
      }
      if (nextPanel !== "region") {
        setSelectedRegion(undefined);
      }
    },
    [activePanel]
  );

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
        onActiveContextSelect={openActiveContext}
        onMemorySelect={onMemorySelect}
        onRegionSelect={onRegionSelect}
        responseActive={isStreaming}
        selectedMemoryId={selectedMemoryId}
      />

      <header className="topbar">
        <h1 className="title">ENGRAM</h1>
        <p className="tagline">Shows what the AI stores, recalls, and uses to answer.</p>
      </header>

      {!showOnboarding ? (
        <nav className="mobile-region-shortcuts" aria-label="Brain region shortcuts">
          {regionShortcuts.map((item) => (
            <button
              aria-label={`Open ${item.label} explanation`}
              data-region={item.region}
              key={item.region}
              onClick={() => onRegionSelect(item.region)}
              type="button"
            >
              <span aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}

      {showOnboarding ? (
        <OnboardingPanel onStart={startOnboarding} />
      ) : (
        <CurrentEventBanner
          draftAssistant={draftTurn?.assistant}
          events={events}
          streaming={isStreaming}
        />
      )}

      <ExplainabilityPanel
        explanations={explanations}
        onClose={closeSecondaryPanel}
        open={activePanel === "memory" && !selectedMemory}
      />
      <ActiveContextPanel
        capacity={activeContextFill.capacity}
        explanations={activeContextExplanations}
        memories={activeContextMemories}
        onClose={closeSecondaryPanel}
        open={activePanel === "context"}
        used={activeContextFill.used}
      />
      <MemoryInspector
        active={Boolean(selectedMemory && loadedMemoryIds.includes(selectedMemory.id))}
        latestQuery={
          selectedMemory && latestRetrieve?.ids.includes(selectedMemory.id) ? latestRetrieve.query : undefined
        }
        memory={selectedMemory}
        onClose={closeMemoryPanel}
        open={activePanel === "memory"}
      />
      <RegionInspector
        onClose={closeRegionPanel}
        open={activePanel === "region"}
        region={selectedRegion}
      />
      <ChatTranscript
        draftTurn={draftTurn}
        error={error}
        history={history}
        onClose={closeSecondaryPanel}
        open={activePanel === "transcript"}
      />
      <SecondaryDock
        activePanel={activePanel}
        hasActiveContext={activeContextFill.used > 0}
        hasMemoryDetails={memoryDetailCount > 0}
        activeContextCount={activeContextFill.used}
        memoryCount={memoryDetailCount}
        onSelect={onDockSelect}
        hasRegionDetails={regionDetailCount > 0}
        regionCount={regionDetailCount}
        transcriptCount={transcriptCount}
      />

      <form className="chat-bar" onSubmit={onSubmit}>
        <span className="chat-prefix">›</span>
        <input
          ref={inputRef}
          className="chat-input"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Tell me something about yourself..."
          aria-label="Chat message"
        />
        <span className="chat-status">
          {isStreaming ? (draftTurn?.assistant ? "RESPONDING" : "THINKING") : "READY"}
        </span>
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
