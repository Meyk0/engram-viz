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
import { useCausalXRay } from "@/hooks/useCausalXRay";
import { useEventQueue } from "@/hooks/useEventQueue";
import { useMemoryExplanations } from "@/hooks/useMemoryExplanations";
import { useMemoryStore } from "@/hooks/useMemoryStore";
import { useSemanticLayout } from "@/hooks/useSemanticLayout";
import { useTracePlayback } from "@/hooks/useTracePlayback";
import { Brain3D } from "@/components/Brain/Brain3D";
import { ActiveContextPanel } from "@/components/UI/ActiveContextPanel";
import { CausalXRayPanel } from "@/components/UI/CausalXRayPanel";
import { CurrentEventBanner } from "@/components/UI/CurrentEventBanner";
import { DemoPromptGuide } from "@/components/UI/DemoPromptGuide";
import { DreamReviewPanel } from "@/components/UI/DreamReviewPanel";
import { MemoryLibraryPanel } from "@/components/UI/MemoryLibraryPanel";
import { MemoryLineagePanel } from "@/components/UI/MemoryLineagePanel";
import { HowItWorksPanel } from "@/components/UI/HowItWorksPanel";
import { MemoryTimelinePanel } from "@/components/UI/MemoryTimelinePanel";
import { MemoryTimeMachinePanel } from "@/components/UI/MemoryTimeMachinePanel";
import { MemoryInspector } from "@/components/UI/MemoryInspector";
import { ProductModeControl } from "@/components/UI/ProductModeControl";
import { RealityModeControl } from "@/components/UI/RealityModeControl";
import { RegionInspector } from "@/components/UI/RegionInspector";
import { RetrievalMRIPanel } from "@/components/UI/RetrievalMRIPanel";
import { SemanticModeHUD } from "@/components/UI/SemanticModeHUD";
import { SecondaryDock, type SecondaryPanel } from "@/components/UI/SecondaryDock";
import { TraceImportDialog } from "@/components/UI/TraceImportDialog";
import { TraceInspectorPanel } from "@/components/UI/TraceInspectorPanel";
import { TracePlaybackBar } from "@/components/UI/TracePlaybackBar";
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
import type { EngramViewMode } from "@/lib/semantic/types";
import type { TurnRecord } from "@/lib/evidence/types";
import type { EngramProductMode } from "@/lib/lab/types";
import { buildTimelineCheckpoints, buildTraceCheckpoints } from "@/lib/lab/checkpoints";
import { buildMemoryLineage } from "@/lib/lineage/build";
import { importAgentTrace } from "@/lib/traces/import";
import { sampleAgentTrace } from "@/lib/traces/sample";
import { traceEventsThrough, type NormalizedTrace } from "@/lib/traces/types";
import type { BrainRegion, DreamProposal, EngramEvent, EngramMemory, StreamChunk } from "@/types";

const regionShortcuts: Array<{ label: string; region: BrainRegion }> = [
  { label: "New", region: "hippocampus" },
  { label: "Working", region: "prefrontal" },
  { label: "Stable", region: "temporal" }
];

const DEMO_FIRST_LINE_DELAY_MS = 1_100;
const DEMO_INTER_TURN_HOLD_MS = 4_200;
const DEMO_STAGED_LINE_HOLD_MS = 3_000;

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
  const [viewMode, setViewMode] = useState<EngramViewMode>("anatomical");
  const [productMode, setProductMode] = useState<EngramProductMode>("learn");
  const [turnRecordsByTimelineId, setTurnRecordsByTimelineId] = useState<Record<string, TurnRecord>>({});
  const [causalMemoryId, setCausalMemoryId] = useState<string | undefined>(undefined);
  const [lineageMemoryId, setLineageMemoryId] = useState<string | undefined>(undefined);
  const [importedTrace, setImportedTrace] = useState<NormalizedTrace | undefined>(undefined);
  const [traceImportOpen, setTraceImportOpen] = useState(false);
  const [traceImportError, setTraceImportError] = useState<string | null>(null);
  const [traceSceneEpoch, setTraceSceneEpoch] = useState(0);
  const [timeMachineFocusMemoryIds, setTimeMachineFocusMemoryIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeTimelineEntryId = useRef<string | undefined>(undefined);
  const turnInFlight = useRef(false);
  const {
    error: causalError,
    pending: causalPending,
    reset: resetCausalXRay,
    result: causalResult,
    run: runCausalXRay
  } = useCausalXRay();
  const tracePlayback = useTracePlayback(importedTrace);
  const {
    events: queuedEvents,
    eventHistory: queuedEventHistory,
    pushEvent,
    clearEvents
  } = useEventQueue();
  const traceChronologicalEvents = useMemo(
    () => importedTrace ? traceEventsThrough(importedTrace, tracePlayback.stepIndex) : [],
    [importedTrace, tracePlayback.stepIndex]
  );
  const traceNewestFirstEvents = useMemo(
    () => traceChronologicalEvents.slice().reverse(),
    [traceChronologicalEvents]
  );
  const events = importedTrace ? traceNewestFirstEvents.slice(0, 50) : queuedEvents;
  const eventHistory = importedTrace ? traceNewestFirstEvents : queuedEventHistory;
  const memories = useMemoryStore(eventHistory);
  const explanations = useMemoryExplanations(events);
  const loadedMemoryIds = useMemo(() => getLoadedMemoryIds(events), [events]);
  const latestRetrieve = useMemo(() => getLatestRetrieveEvent(events), [events]);
  const retrievalCandidateIds = useMemo(
    () => latestRetrieve?.retrieval?.matches
      ?.filter((match) => match.selected)
      .map((match) => match.id) ?? latestRetrieve?.ids ?? [],
    [latestRetrieve]
  );
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
  const semanticLayout = useSemanticLayout(activeMemories, {
    enabled: viewMode === "semantic" && activeMemories.length > 0
  });
  const latestEvidence = useMemo(
    () =>
      [...timelineEntries]
        .reverse()
        .map((entry) => turnRecordsByTimelineId[entry.id])
        .find((record): record is TurnRecord => Boolean(record?.retrievedMemories.length)),
    [timelineEntries, turnRecordsByTimelineId]
  );
  const causalMemory = useMemo(
    () => latestEvidence?.retrievedMemories.find((memory) => memory.id === causalMemoryId),
    [causalMemoryId, latestEvidence]
  );
  const turnRecords = useMemo(() => Object.values(turnRecordsByTimelineId), [turnRecordsByTimelineId]);
  const memoryCheckpoints = useMemo(
    () => importedTrace
      ? buildTraceCheckpoints(importedTrace)
      : buildTimelineCheckpoints(timelineEntries, turnRecordsByTimelineId),
    [importedTrace, timelineEntries, turnRecordsByTimelineId]
  );
  const lineageGraph = useMemo(
    () =>
      lineageMemoryId
        ? buildMemoryLineage({
            focusMemoryId: lineageMemoryId,
            memories,
            turnRecords,
            events: eventHistory
          })
        : undefined,
    [eventHistory, lineageMemoryId, memories, turnRecords]
  );
  const dreamEligibleMemories = useMemo(
    () => getDreamEligibleMemories(eventHistory, activeMemories),
    [activeMemories, eventHistory]
  );

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
      if (chunk.kind === "turn_record") {
        const timelineEntryId = activeTimelineEntryId.current;
        if (timelineEntryId) {
          setTurnRecordsByTimelineId((current) => ({
            ...current,
            [timelineEntryId]: chunk.record
          }));
        }
      }
    },
    [pushEvent]
  );

  const { isStreaming, sendMessage, cancel, resetSession } = useChat(
    useMemo(() => ({ clientMemories: memories, onChunk }), [memories, onChunk])
  );
  const conversationTimelineCount = useMemo(
    () => timelineEntries.filter((entry) => entry.kind === "conversation").length,
    [timelineEntries]
  );
  const remainingDemoSteps = Math.max(0, timelineDemoPrompts.length - conversationTimelineCount);
  const showInitialState = events.length === 0;
  const memoryDetailCount = activeMemories.length;
  const regionDetailCount = selectedRegion ? 1 : 0;
  const effectiveTimelineFocus = focusedTimelineEntry ? timelineFocus : undefined;
  const brainFocusMemoryIds = effectiveTimelineFocus
    ? effectiveTimelineFocus.memoryIds
    : activePanel === "timeMachine"
      ? timeMachineFocusMemoryIds
    : activePanel === "lineage" && lineageGraph
      ? lineageGraph.relatedMemoryIds
    : activePanel === "xray" && causalMemoryId
      ? [causalMemoryId]
    : activePanel === "retrieval"
      ? retrievalCandidateIds
    : activePanel === "context"
      ? loadedMemoryIds
      : [];
  const brainFocusRegions = effectiveTimelineFocus
    ? effectiveTimelineFocus.regions
    : activePanel === "timeMachine" && timeMachineFocusMemoryIds.length > 0
      ? [...new Set(timeMachineFocusMemoryIds
          .map((id) => memories.find((memory) => memory.id === id)?.region)
          .filter((region): region is BrainRegion => Boolean(region)))]
    : activePanel === "lineage" && lineageGraph
      ? [...new Set(lineageGraph.nodes.flatMap((node) => node.region ?? []))]
    : activePanel === "xray"
      ? (["prefrontal"] satisfies BrainRegion[])
    : activePanel === "retrieval" && retrievalCandidateIds.length > 0
      ? (["prefrontal"] satisfies BrainRegion[])
    : activePanel === "context" && loadedMemoryIds.length > 0
      ? (["prefrontal"] satisfies BrainRegion[])
      : [];
  const brainFocusPulseKey = effectiveTimelineFocus
    ? timelineFocusPulseKey
    : activePanel === "timeMachine" && timeMachineFocusMemoryIds.length > 0
      ? `time-machine-${timeMachineFocusMemoryIds.join(".")}`
    : activePanel === "lineage" && lineageMemoryId
      ? `lineage-${lineageMemoryId}`
    : activePanel === "xray" && causalMemoryId
      ? `xray-${causalMemoryId}`
    : activePanel === "retrieval" && latestRetrieve
      ? `retrieval-${latestRetrieve.query}-${retrievalCandidateIds.join(".")}`
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
    setCausalMemoryId(undefined);
    setLineageMemoryId(undefined);
    setTimeMachineFocusMemoryIds([]);
    resetCausalXRay();
    if (productMode === "investigate") setProductMode("learn");
  }, [productMode, resetCausalXRay]);

  const openCausalXRay = useCallback(
    (memoryId: string) => {
      if (!latestEvidence?.retrievedMemories.some((memory) => memory.id === memoryId)) return;
      setCausalMemoryId(memoryId);
      setSelectedMemoryId(undefined);
      setSelectedRegion(undefined);
      resetCausalXRay();
      setActivePanel("xray");
    },
    [latestEvidence, resetCausalXRay]
  );

  const openMemoryLineage = useCallback((memoryId: string) => {
    setLineageMemoryId(memoryId);
    setSelectedMemoryId(undefined);
    setSelectedRegion(undefined);
    setFocusedTimelineId(undefined);
    setActivePanel("lineage");
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
    setProductMode("learn");
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
    setViewMode("anatomical");
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
      }, DEMO_STAGED_LINE_HOLD_MS);
      return () => window.clearTimeout(sendTimer);
    }

    const delay = conversationTimelineCount === 0
      ? DEMO_FIRST_LINE_DELAY_MS
      : DEMO_INTER_TURN_HOLD_MS;
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

  const clearConversationState = useCallback(() => {
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
    setViewMode("anatomical");
    setProductMode("learn");
    setTurnRecordsByTimelineId({});
    setCausalMemoryId(undefined);
    setLineageMemoryId(undefined);
    setTimeMachineFocusMemoryIds([]);
    resetCausalXRay();
    setProvenancePulseKey((current) => current + 1);
  }, [clearEvents, resetCausalXRay, resetSession]);

  const resetDemoSession = useCallback(() => {
    const confirmed = window.confirm("Reset this demo session and clear all memories?");
    if (!confirmed) return;

    clearConversationState();
    tracePlayback.restart();
    setImportedTrace(undefined);
    setTraceImportError(null);
    setTraceSceneEpoch((current) => current + 1);
  }, [clearConversationState, tracePlayback]);

  const importTrace = useCallback(
    (raw: unknown | string) => {
      try {
        const result = importAgentTrace(raw);
        if (isStreaming) cancel();
        clearConversationState();
        tracePlayback.restart();
      setImportedTrace(result.trace);
      setProductMode("observe");
      setActivePanel("trace");
      setTraceImportError(null);
        setTraceImportOpen(false);
        setTraceSceneEpoch((current) => current + 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The trace could not be imported.";
        setTraceImportError(message);
        throw error;
      }
    },
    [cancel, clearConversationState, isStreaming, tracePlayback]
  );

  const exitTracePlayback = useCallback(() => {
    clearConversationState();
    tracePlayback.restart();
    setImportedTrace(undefined);
    setProductMode("learn");
    setTraceImportError(null);
    setTraceSceneEpoch((current) => current + 1);
  }, [clearConversationState, tracePlayback]);

  const closeTraceImport = useCallback(() => {
    setTraceImportOpen(false);
    if (productMode === "observe" && !importedTrace) setProductMode("learn");
  }, [importedTrace, productMode]);

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

  const openTraceImport = useCallback(() => {
    setTraceImportError(null);
    setTraceImportOpen(true);
  }, []);

  const changeProductMode = useCallback(
    (mode: EngramProductMode) => {
      setProductMode(mode);
      setFocusedTimelineId(undefined);
      setSelectedMemoryId(undefined);
      setSelectedRegion(undefined);

      if (mode === "learn") {
        setActivePanel(null);
        return;
      }

      if (mode === "observe") {
        if (importedTrace) {
          setActivePanel("trace");
        } else {
          setTraceImportError(null);
          setTraceImportOpen(true);
        }
        return;
      }

      setActivePanel("timeMachine");
    },
    [importedTrace]
  );

  const openTraceInspector = useCallback(() => {
    setSelectedMemoryId(undefined);
    setSelectedRegion(undefined);
    setActivePanel("trace");
  }, []);

  const playOrPauseTrace = useCallback(() => {
    if (tracePlayback.playing) {
      tracePlayback.pause();
      return;
    }
    if (tracePlayback.stepIndex >= tracePlayback.stepCount - 1) {
      setTraceSceneEpoch((current) => current + 1);
    }
    tracePlayback.play();
  }, [tracePlayback]);

  const seekTrace = useCallback(
    (index: number) => {
      if (index <= tracePlayback.stepIndex) setTraceSceneEpoch((current) => current + 1);
      tracePlayback.seek(index);
    },
    [tracePlayback]
  );

  const previousTraceStep = useCallback(() => {
    setTraceSceneEpoch((current) => current + 1);
    tracePlayback.previous();
  }, [tracePlayback]);

  const restartTrace = useCallback(() => {
    setTraceSceneEpoch((current) => current + 1);
    tracePlayback.restart();
  }, [tracePlayback]);

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
    <main
      className="engram-shell"
      data-product-mode={productMode}
      data-recording={cleanDemoMode}
      data-workbench-open={Boolean(activePanel)}
      data-workbench-wide={activePanel === "timeMachine"}
    >
      <Brain3D
        events={events}
        memories={activeMemories}
        loadedMemoryIds={loadedMemoryIds}
        retrievedMemoryIds={latestRetrieve?.ids ?? []}
        semanticLayout={semanticLayout.layout}
        viewMode={viewMode}
        recordingMode={cleanDemoMode}
        onActiveContextSelect={openActiveContext}
        onHelpSelect={openHowItWorks}
        onMemorySelect={onMemorySelect}
        onRegionSelect={onRegionSelect}
        onResetSession={resetDemoSession}
        onRecordingModeToggle={toggleRecordingMode}
        onTraceImport={openTraceImport}
        responseActive={isStreaming}
        sceneEpoch={traceSceneEpoch}
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
        <ProductModeControl mode={productMode} onModeChange={changeProductMode} />
      ) : null}

      {!cleanDemoMode && !activePanel ? (
        <RealityModeControl
          memoryCount={activeMemories.length}
          mode={viewMode}
          onModeChange={setViewMode}
        />
      ) : null}

      {viewMode === "semantic" && semanticLayout.layout ? (
        <SemanticModeHUD snapshot={semanticLayout.layout} />
      ) : null}

      {!cleanDemoMode && viewMode === "anatomical" ? (
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

      {!cleanDemoMode && !showInitialState && !activePanel ? (
        <CurrentEventBanner
          compact={Boolean(activePanel)}
          draftAssistant={draftTurn?.assistant}
          events={events}
          onInspectUsedMemories={openAnswerProvenance}
          streaming={isStreaming}
          usedMemoryCount={loadedMemoryIds.length}
        />
      ) : null}

      {!activePanel && !importedTrace ? (
        <DemoPromptGuide
          currentPrompt={demoStagedPrompt ?? (demoPlaybackActive ? draftTurn?.user : undefined)}
          onRunDemo={runDemoPlayback}
          onStopDemo={stopDemoPlayback}
          remainingCount={remainingDemoSteps}
          running={demoPlaybackActive}
        />
      ) : null}

      <MemoryLibraryPanel
        loadedMemoryIds={loadedMemoryIds}
        memories={memories}
        onClose={closeSecondaryPanel}
        onSelectMemory={onMemorySelect}
        open={activePanel === "memory" && !selectedMemory}
      />
      <ActiveContextPanel
        capacity={activeContextFill.capacity}
        explanations={activeContextExplanations}
        memories={activeContextMemories}
        onClose={closeSecondaryPanel}
        onTestWithoutMemory={latestEvidence ? openCausalXRay : undefined}
        open={activePanel === "context"}
        used={activeContextFill.used}
      />
      {activePanel === "retrieval" && latestRetrieve ? (
        <RetrievalMRIPanel
          loadedMemoryIds={loadedMemoryIds}
          memories={memories}
          onClose={closeSecondaryPanel}
          retrieve={latestRetrieve}
        />
      ) : null}
      {activePanel === "xray" && latestEvidence && causalMemory ? (
        <CausalXRayPanel
          error={causalError}
          memory={causalMemory}
          onClose={closeSecondaryPanel}
          onRun={() => void runCausalXRay(latestEvidence, causalMemory.id)}
          pending={causalPending}
          record={latestEvidence}
          result={causalResult ?? undefined}
        />
      ) : null}
      <MemoryInspector
        active={Boolean(selectedMemory && loadedMemoryIds.includes(selectedMemory.id))}
        latestQuery={
          selectedMemory && latestRetrieve?.ids.includes(selectedMemory.id) ? latestRetrieve.query : undefined
        }
        memory={selectedMemory}
        onClose={closeMemoryPanel}
        onOpenLineage={openMemoryLineage}
        open={activePanel === "memory"}
      />
      <MemoryLineagePanel
        graph={lineageGraph}
        onClose={closeSecondaryPanel}
        onSelectMemory={setLineageMemoryId}
        open={activePanel === "lineage"}
      />
      <RegionInspector
        onClose={closeRegionPanel}
        open={activePanel === "region"}
        region={selectedRegion}
      />
      <MemoryTimelinePanel
        activeEntryId={focusedTimelineId}
        entries={timelineEntries}
        onClearFocus={clearTimelineFocus}
        onClose={closeSecondaryPanel}
        onSelectEntry={onTimelineSelect}
        open={activePanel === "timeline"}
      />
      {activePanel === "timeMachine" ? (
        <MemoryTimeMachinePanel
          checkpoints={memoryCheckpoints}
          onClose={closeSecondaryPanel}
          onFocusMemoryIds={setTimeMachineFocusMemoryIds}
        />
      ) : null}
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
      {importedTrace ? (
        <TraceInspectorPanel
          currentStepIndex={tracePlayback.stepIndex}
          onClose={closeSecondaryPanel}
          onSelectStep={seekTrace}
          open={activePanel === "trace"}
          trace={importedTrace}
        />
      ) : null}
      {traceImportOpen ? (
        <TraceImportDialog
          error={traceImportError}
          onCancel={closeTraceImport}
          onImport={importTrace}
          onLoadSample={() => importTrace(sampleAgentTrace)}
          open
        />
      ) : null}
      {!cleanDemoMode && !importedTrace ? (
        <SecondaryDock
          activePanel={activePanel}
          hasActiveContext={activeContextFill.used > 0}
          dreamCount={dreamProposal?.operations.length ?? 0}
          dreamReady={dreamEligibleMemories.length >= 3 && !isStreaming && !dreamProposal}
          hasDreamReview={Boolean(dreamProposal) || dreamPending}
          hasMemoryDetails={memories.length > 0}
          activeContextCount={activeContextFill.used}
          timelineCount={timelineEntries.length}
          memoryCount={memoryDetailCount}
          onSelect={onDockSelect}
          hasRegionDetails={regionDetailCount > 0}
          hasRetrieval={Boolean(latestRetrieve)}
          regionCount={regionDetailCount}
          retrievalCount={latestRetrieve?.retrieval?.candidateCount ?? latestRetrieve?.ids.length ?? 0}
          checkpointCount={memoryCheckpoints.length}
        />
      ) : null}

      {importedTrace ? (
        <TracePlaybackBar
          currentStepIndex={tracePlayback.stepIndex}
          onExit={exitTracePlayback}
          onInspect={openTraceInspector}
          onNext={tracePlayback.next}
          onPlayPause={playOrPauseTrace}
          onPrevious={previousTraceStep}
          onRestart={restartTrace}
          onSeek={seekTrace}
          onSpeedChange={tracePlayback.setSpeed}
          playing={tracePlayback.playing}
          speed={tracePlayback.speed}
          trace={importedTrace}
        />
      ) : (
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
      )}
    </main>
  );
}
