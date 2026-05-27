"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import {
  getActiveContextFill,
  getDreamEligibleMemories,
  getLatestRetrieveEvent,
  getLoadedMemoryIds
} from "@/lib/memoryVisuals";
import { useChat } from "@/hooks/useChat";
import { useEventQueue } from "@/hooks/useEventQueue";
import { useMemoryExplanations } from "@/hooks/useMemoryExplanations";
import { useMemoryStore } from "@/hooks/useMemoryStore";
import { Brain3D } from "@/components/Brain/Brain3D";
import { ActiveContextPanel } from "@/components/UI/ActiveContextPanel";
import { AnswerProvenancePill } from "@/components/UI/AnswerProvenancePill";
import { BrainActionCaption } from "@/components/UI/BrainActionCaption";
import { ChatTranscript } from "@/components/UI/ChatTranscript";
import { CurrentEventBanner } from "@/components/UI/CurrentEventBanner";
import { DemoPromptGuide } from "@/components/UI/DemoPromptGuide";
import { DreamReviewPanel } from "@/components/UI/DreamReviewPanel";
import { ExplainabilityPanel } from "@/components/UI/ExplainabilityPanel";
import { HowItWorksPanel } from "@/components/UI/HowItWorksPanel";
import { MemoryTimelinePanel } from "@/components/UI/MemoryTimelinePanel";
import { MemoryInspector } from "@/components/UI/MemoryInspector";
import { RegionInspector } from "@/components/UI/RegionInspector";
import { SecondaryDock, type SecondaryPanel } from "@/components/UI/SecondaryDock";
import {
  appendTimelineAssistantText,
  appendTimelineEvent,
  buildDreamTimelineEvents,
  completeTimelineEntry,
  createConversationTimelineEntry,
  createDreamTimelineEntry,
  dreamTimelineEntryId,
  getTimelineFocus,
  timelineDemoPrompts,
  type MemoryTimelineEntry
} from "@/lib/timeline";
import type { BrainRegion, DreamProposal, EngramEvent, EngramMemory, StreamChunk } from "@/types";

const regionShortcuts: Array<{ label: string; region: BrainRegion }> = [
  { label: "New", region: "hippocampus" },
  { label: "Working", region: "prefrontal" },
  { label: "Stable", region: "temporal" }
];

type EngramAppProps = {
  recordingMode?: boolean;
};

export function EngramApp({ recordingMode = false }: EngramAppProps) {
  const [message, setMessage] = useState("");
  const [draftTurn, setDraftTurn] = useState<{ user: string; assistant: string } | null>(null);
  const [activePanel, setActivePanel] = useState<SecondaryPanel | null>(null);
  const [cleanDemoMode, setCleanDemoMode] = useState(recordingMode);
  const [demoPlaybackActive, setDemoPlaybackActive] = useState(false);
  const [demoStagedPrompt, setDemoStagedPrompt] = useState<string | null>(null);
  const [provenancePulseKey, setProvenancePulseKey] = useState(0);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | undefined>(undefined);
  const [selectedRegion, setSelectedRegion] = useState<BrainRegion | undefined>(undefined);
  const [dreamProposal, setDreamProposal] = useState<DreamProposal | null>(null);
  const [dreamMemorySnapshot, setDreamMemorySnapshot] = useState<EngramMemory[]>([]);
  const [dreamPending, setDreamPending] = useState(false);
  const [dreamError, setDreamError] = useState<string | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<MemoryTimelineEntry[]>([]);
  const [focusedTimelineId, setFocusedTimelineId] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeTimelineEntryId = useRef<string | undefined>(undefined);
  const turnInFlight = useRef(false);
  const { events, pushEvent, clearEvents } = useEventQueue();
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
  const focusedTimelineEntry = useMemo(
    () => timelineEntries.find((entry) => entry.id === focusedTimelineId),
    [focusedTimelineId, timelineEntries]
  );
  const timelineFocus = useMemo(() => getTimelineFocus(focusedTimelineEntry), [focusedTimelineEntry]);
  const timelineFocusPulseKey = focusedTimelineEntry
    ? `${focusedTimelineEntry.id}-${focusedTimelineEntry.events.length}-${focusedTimelineEntry.status}`
    : undefined;
  const activeMemories = useMemo(
    () => memories.filter((memory) => memory.status !== "superseded"),
    [memories]
  );
  const dreamEligibleMemories = useMemo(
    () => getDreamEligibleMemories(events, activeMemories),
    [activeMemories, events]
  );
  const dreamReviewReady = Boolean(dreamProposal && dreamProposal.status === "proposed");

  const onChunk = useCallback(
    (chunk: StreamChunk) => {
      if (chunk.kind === "text") {
        setDraftTurn((current) =>
          current ? { ...current, assistant: `${current.assistant}${chunk.delta}` } : current
        );
        const timelineEntryId = activeTimelineEntryId.current;
        if (timelineEntryId) {
          setTimelineEntries((current) =>
            appendTimelineAssistantText(current, timelineEntryId, chunk.delta)
          );
        }
      }
      if (chunk.kind === "event") {
        pushEvent(chunk.event);
        const timelineEntryId = activeTimelineEntryId.current;
        if (timelineEntryId) {
          setTimelineEntries((current) =>
            appendTimelineEvent(current, timelineEntryId, chunk.event)
          );
        }
      }
    },
    [pushEvent]
  );

  const { history, isStreaming, error, sendMessage, cancel, resetSession } = useChat(
    useMemo(() => ({ clientMemories: memories, onChunk }), [memories, onChunk])
  );
  const transcriptCount = useMemo(
    () => history.filter((turn) => turn.role === "user").length + (draftTurn ? 1 : 0),
    [draftTurn, history]
  );
  const conversationTimelineCount = useMemo(
    () => timelineEntries.filter((entry) => entry.kind === "conversation").length,
    [timelineEntries]
  );
  const remainingDemoSteps = Math.max(0, timelineDemoPrompts.length - conversationTimelineCount);
  const showInitialState = events.length === 0;
  const memoryDetailCount = selectedMemory ? 1 : explanations.length;
  const regionDetailCount = selectedRegion ? 1 : 0;
  const shouldShowProvenance = loadedMemoryIds.length > 0 && !activePanel;
  const effectiveTimelineFocus = focusedTimelineEntry ? timelineFocus : undefined;
  const brainFocusMemoryIds = effectiveTimelineFocus
    ? effectiveTimelineFocus.memoryIds
    : activePanel === "context"
      ? loadedMemoryIds
      : [];
  const brainFocusRegions = effectiveTimelineFocus
    ? effectiveTimelineFocus.regions
    : activePanel === "context" && loadedMemoryIds.length > 0
      ? (["prefrontal"] satisfies BrainRegion[])
      : [];
  const brainFocusPulseKey = effectiveTimelineFocus
    ? timelineFocusPulseKey
    : activePanel === "context" && loadedMemoryIds.length > 0
      ? `context-${provenancePulseKey}-${loadedMemoryIds.join(".")}`
      : undefined;

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

  const pushDreamEvents = useCallback(
    (proposal: DreamProposal) => {
      const dreamEvents = buildDreamTimelineEvents(proposal);
      dreamEvents.forEach(pushEvent);
      setTimelineEntries((current) => [
        ...current,
        createDreamTimelineEntry({
          events: dreamEvents,
          proposal,
          startedAt: new Date().toISOString()
        })
      ]);
    },
    [pushEvent]
  );

  const runDreamReview = useCallback(async () => {
    if (dreamPending || isStreaming) return;

    setDreamPending(true);
    setDreamError(null);
    setDreamProposal(null);
    setDreamMemorySnapshot(dreamEligibleMemories);
    setSelectedMemoryId(undefined);
    setSelectedRegion(undefined);
    setActivePanel("dream");

    try {
      const response = await fetch("/api/dream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientMemories: dreamEligibleMemories })
      });
      const payload = (await response.json()) as { proposal?: DreamProposal; error?: string };

      if (!response.ok || !payload.proposal) {
        throw new Error(payload.error ?? "Dream review failed.");
      }

      setDreamProposal(payload.proposal);
      pushDreamEvents(payload.proposal);
    } catch (error) {
      setDreamError(error instanceof Error ? error.message : "Dream review failed.");
    } finally {
      setDreamPending(false);
    }
  }, [dreamEligibleMemories, dreamPending, isStreaming, pushDreamEvents]);

  const applyDreamProposal = useCallback(
    (proposal: DreamProposal) => {
      const event: EngramEvent = { type: "dream_apply", proposal };
      const entryId = dreamTimelineEntryId(proposal.id);
      pushEvent(event);
      setTimelineEntries((current) =>
        completeTimelineEntry(appendTimelineEvent(current, entryId, event), entryId, {
          completedAt: new Date().toISOString(),
          status: "applied"
        })
      );
      setDreamProposal(null);
      setActivePanel(null);
    },
    [pushEvent]
  );

  const dismissDreamProposal = useCallback(
    (proposal: DreamProposal) => {
      const event: EngramEvent = { type: "dream_dismiss", proposal };
      const entryId = dreamTimelineEntryId(proposal.id);
      pushEvent(event);
      setTimelineEntries((current) =>
        completeTimelineEntry(appendTimelineEvent(current, entryId, event), entryId, {
          completedAt: new Date().toISOString(),
          status: "dismissed"
        })
      );
      setDreamProposal(null);
      setActivePanel(null);
    },
    [pushEvent]
  );

  const openActiveContext = useCallback(() => {
    setSelectedMemoryId(undefined);
    setSelectedRegion(undefined);
    setActivePanel("context");
  }, []);

  const onTimelineSelect = useCallback((entry: MemoryTimelineEntry) => {
    setFocusedTimelineId(entry.id);
    setSelectedMemoryId(undefined);
    setSelectedRegion(undefined);
  }, []);

  const clearTimelineFocus = useCallback(() => {
    setFocusedTimelineId(undefined);
  }, []);

  const sendTurn = useCallback(
    async (value: string) => {
      const current = value.trim();
      if (!current || isStreaming || turnInFlight.current) return;

      turnInFlight.current = true;
      setMessage("");
      setDraftTurn({ user: current, assistant: "" });
      const timelineEntryId = `timeline-turn-${crypto.randomUUID()}`;
      activeTimelineEntryId.current = timelineEntryId;
      setTimelineEntries((entries) => [
        ...entries,
        createConversationTimelineEntry({
          id: timelineEntryId,
          startedAt: new Date().toISOString(),
          userText: current
        })
      ]);

      try {
        await sendMessage(current);
        setDraftTurn(null);
        setTimelineEntries((entries) =>
          completeTimelineEntry(entries, timelineEntryId, {
            completedAt: new Date().toISOString()
          })
        );
      } catch {
        setDraftTurn((turn) =>
          turn ? { ...turn, assistant: turn.assistant || "No response received." } : turn
        );
        setTimelineEntries((entries) =>
          completeTimelineEntry(entries, timelineEntryId, {
            completedAt: new Date().toISOString(),
            status: "error"
          })
        );
      } finally {
        turnInFlight.current = false;
        activeTimelineEntryId.current = undefined;
      }
    },
    [isStreaming, sendMessage]
  );

  const runDemoPlayback = useCallback(() => {
    setActivePanel(null);
    setSelectedMemoryId(undefined);
    setSelectedRegion(undefined);
    setFocusedTimelineId(undefined);
    setDemoStagedPrompt(null);
    setDemoPlaybackActive(true);
  }, []);

  const stopDemoPlayback = useCallback(() => {
    if (demoStagedPrompt && message === demoStagedPrompt) {
      setMessage("");
    }
    setDemoStagedPrompt(null);
    setDemoPlaybackActive(false);
  }, [demoStagedPrompt, message]);

  useEffect(() => {
    if (!demoPlaybackActive) return;
    if (isStreaming) return;
    if (turnInFlight.current) return;

    const prompt = timelineDemoPrompts[conversationTimelineCount];
    if (!prompt) {
      const timer = window.setTimeout(() => setDemoPlaybackActive(false), 0);
      return () => window.clearTimeout(timer);
    }

    if (message.trim() && message !== prompt) return;

    if (demoStagedPrompt === prompt) {
      const sendTimer = window.setTimeout(() => {
        setDemoStagedPrompt(null);
        void sendTurn(prompt);
      }, 2200);
      return () => window.clearTimeout(sendTimer);
    }

    const delay = conversationTimelineCount === 0 ? 700 : 2600;
    const timer = window.setTimeout(() => {
      setMessage(prompt);
      setDemoStagedPrompt(prompt);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [conversationTimelineCount, demoPlaybackActive, demoStagedPrompt, isStreaming, message, sendTurn]);

  const onRegionSelect = useCallback((region: BrainRegion) => {
    setSelectedMemoryId(undefined);
    setSelectedRegion(region);
    setActivePanel("region");
  }, []);

  const resetDemoSession = useCallback(() => {
    const confirmed = window.confirm("Reset this demo session and clear all memories?");
    if (!confirmed) return;

    resetSession();
    turnInFlight.current = false;
    activeTimelineEntryId.current = undefined;
    clearEvents();
    setDraftTurn(null);
    setMessage("");
    setSelectedMemoryId(undefined);
    setSelectedRegion(undefined);
    setActivePanel(null);
    setDreamProposal(null);
    setDreamMemorySnapshot([]);
    setDreamPending(false);
    setDreamError(null);
    setTimelineEntries([]);
    setFocusedTimelineId(undefined);
    setDemoStagedPrompt(null);
    setDemoPlaybackActive(false);
    setProvenancePulseKey((current) => current + 1);
  }, [clearEvents, resetSession]);

  const onDockSelect = useCallback(
    (panel: SecondaryPanel) => {
      if (panel === "dream") {
        if (activePanel === "dream") {
          setActivePanel(null);
          return;
        }
        if (dreamProposal) {
          setSelectedMemoryId(undefined);
          setSelectedRegion(undefined);
          setActivePanel("dream");
          return;
        }
        void runDreamReview();
        return;
      }

      const nextPanel = activePanel === panel ? null : panel;
      setActivePanel(nextPanel);
      if (nextPanel !== "memory") {
        setSelectedMemoryId(undefined);
      }
      if (nextPanel !== "region") {
        setSelectedRegion(undefined);
      }
    },
    [activePanel, dreamProposal, runDreamReview]
  );

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDemoStagedPrompt(null);
    setDemoPlaybackActive(false);
    void sendTurn(message);
  }

  const openHowItWorks = useCallback(() => {
    setSelectedMemoryId(undefined);
    setSelectedRegion(undefined);
    setActivePanel("help");
  }, []);

  const openAnswerProvenance = useCallback(() => {
    setFocusedTimelineId(undefined);
    setSelectedMemoryId(undefined);
    setSelectedRegion(undefined);
    setProvenancePulseKey((current) => current + 1);
    setActivePanel("context");
  }, []);

  const toggleRecordingMode = useCallback(() => {
    setActivePanel(null);
    setCleanDemoMode((current) => !current);
  }, []);

  const chatStatus = demoStagedPrompt
    ? "DEMO LINE"
    : isStreaming
      ? draftTurn?.assistant
        ? "RESPONDING"
        : "THINKING"
      : "READY";

  return (
    <main className="engram-shell" data-recording={cleanDemoMode}>
      <Brain3D
        events={events}
        recordingMode={cleanDemoMode}
        onActiveContextSelect={openActiveContext}
        onHelpSelect={openHowItWorks}
        onMemorySelect={onMemorySelect}
        onRegionSelect={onRegionSelect}
        onResetSession={resetDemoSession}
        onRecordingModeToggle={toggleRecordingMode}
        responseActive={isStreaming}
        selectedMemoryId={selectedMemoryId}
        focusedMemoryIds={brainFocusMemoryIds}
        focusedRegions={brainFocusRegions}
        focusPulseKey={brainFocusPulseKey}
        dreamReviewActive={activePanel === "dream" && (dreamPending || Boolean(dreamProposal) || Boolean(dreamError))}
      />

      <header className="topbar">
        <h1 className="title">ENGRAM</h1>
        <p className="tagline">Shows what the AI stores, recalls, and uses to answer.</p>
      </header>

      {!cleanDemoMode ? (
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

      {!cleanDemoMode && !showInitialState ? (
        <CurrentEventBanner
          compact={Boolean(activePanel)}
          draftAssistant={draftTurn?.assistant}
          events={events}
          streaming={isStreaming}
        />
      ) : null}

      <BrainActionCaption demoPlaying={demoPlaybackActive} events={events} streaming={isStreaming} />

      {shouldShowProvenance ? (
        <AnswerProvenancePill count={loadedMemoryIds.length} onSelect={openAnswerProvenance} />
      ) : null}

      <DemoPromptGuide
        currentPrompt={demoStagedPrompt ?? (demoPlaybackActive ? draftTurn?.user : undefined)}
        onRunDemo={runDemoPlayback}
        onStopDemo={stopDemoPlayback}
        remainingCount={remainingDemoSteps}
        running={demoPlaybackActive}
      />

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
      <MemoryTimelinePanel
        activeEntryId={focusedTimelineId}
        entries={timelineEntries}
        onClearFocus={clearTimelineFocus}
        onClose={closeSecondaryPanel}
        onSelectEntry={onTimelineSelect}
        open={activePanel === "timeline"}
      />
      <HowItWorksPanel onClose={closeSecondaryPanel} open={activePanel === "help"} />
      <DreamReviewPanel
        beforeMemories={dreamMemorySnapshot.length > 0 ? dreamMemorySnapshot : dreamEligibleMemories}
        error={dreamError}
        onApply={applyDreamProposal}
        onClose={closeSecondaryPanel}
        onDismiss={dismissDreamProposal}
        open={activePanel === "dream"}
        pending={dreamPending}
        proposal={dreamProposal}
      />
      {!cleanDemoMode ? (
        <SecondaryDock
          activePanel={activePanel}
          hasActiveContext={activeContextFill.used > 0}
          dreamCount={dreamReviewReady ? dreamProposal?.operations.length ?? 0 : dreamEligibleMemories.length}
          dreamReady={dreamEligibleMemories.length >= 3 && !isStreaming}
          hasDreamReview={dreamReviewReady || dreamPending}
          hasMemoryDetails={memoryDetailCount > 0}
          activeContextCount={activeContextFill.used}
          timelineCount={timelineEntries.length}
          memoryCount={memoryDetailCount}
          onSelect={onDockSelect}
          hasRegionDetails={regionDetailCount > 0}
          regionCount={regionDetailCount}
          transcriptCount={transcriptCount}
        />
      ) : null}

      <form className="chat-bar" data-demo-preview={Boolean(demoStagedPrompt)} onSubmit={onSubmit}>
        <span className="chat-prefix">›</span>
        <input
          ref={inputRef}
          className="chat-input"
          suppressHydrationWarning
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Tell me something about yourself..."
          aria-label="Chat message"
        />
        <span className="chat-status">{chatStatus}</span>
        {isStreaming ? (
          <button
            className="send-btn"
            type="button"
            onClick={() => {
              stopDemoPlayback();
              turnInFlight.current = false;
              cancel();
            }}
            aria-label="Cancel response"
          >
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
