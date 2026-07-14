import type { MemoryCheckpoint } from "@/lib/lab/types";
import type {
  MemoryFailureKind,
  MemoryIncident,
  MemoryIncidentDiagnosis,
  MemoryIncidentEvidence,
  MemoryIncidentEvidenceOrigins,
  MemoryIncidentStage,
  MemoryIncidentStageKind,
  MemoryIncidentStageStatus
} from "@/lib/incidents/types";
import type { EngramMemory, MemoryRetrievalTrace } from "@/types";

type BuildMemoryIncidentInput = {
  checkpoint: MemoryCheckpoint;
  evidenceOrigins?: MemoryIncidentEvidenceOrigins;
  expectedAnswer?: string;
  title?: string;
  id?: string;
};

type IncidentSignals = {
  retrievedIds: string[];
  loadedIds: string[];
  ignoredIds: string[];
  selectedMemories: EngramMemory[];
  ignoredMemories: EngramMemory[];
  newerIgnoredMemory?: EngramMemory;
  staleSelectedMemory?: EngramMemory;
  expectedMemory?: EngramMemory;
  retrieval?: MemoryRetrievalTrace;
};

export function buildMemoryIncident(input: BuildMemoryIncidentInput): MemoryIncident {
  const { checkpoint } = input;
  if (!checkpoint.turnRecord) {
    throw new Error("A memory incident requires a replayable turn record.");
  }

  const record = checkpoint.turnRecord;
  const memories = structuredClone(checkpoint.memories);
  const signals = collectSignals(checkpoint, input.expectedAnswer);
  const diagnosis = diagnoseMemoryIncident(
    signals,
    memories,
    checkpoint.answer,
    input.expectedAnswer,
    input.evidenceOrigins
  );
  const evidence = buildEvidence(
    checkpoint,
    signals,
    diagnosis,
    input.expectedAnswer,
    input.evidenceOrigins
  );
  const stages = buildStages(
    checkpoint,
    signals,
    diagnosis,
    evidence,
    input.expectedAnswer,
    input.evidenceOrigins
  );
  const title = input.title?.trim() || defaultIncidentTitle(diagnosis);

  return deepFreeze({
    kind: "engram.memory-incident",
    version: 1,
    id: input.id?.trim() || `incident-${checkpoint.id}`,
    title,
    status: diagnosis.kind === "unknown" ? "needs_review" : "open",
    occurredAt: checkpoint.createdAt,
    question: record.userMessage,
    observedAnswer: checkpoint.answer ?? record.originalAnswer,
    ...(input.expectedAnswer?.trim() ? { expectedAnswer: input.expectedAnswer.trim() } : {}),
    checkpoint: structuredClone(checkpoint),
    record: structuredClone(record),
    memories,
    stages,
    evidence,
    diagnosis
  });
}

function collectSignals(
  checkpoint: MemoryCheckpoint,
  expectedAnswer?: string
): IncidentSignals {
  const retrieval = checkpoint.turnRecord?.retrieval ?? checkpoint.retrieval;
  const retrievedIds = unique(
    checkpoint.turnRecord?.retrievedMemories.map((memory) => memory.id)
      ?? retrieval?.matches?.filter((match) => match.selected).map((match) => match.id)
      ?? []
  );
  const ignoredIds = unique(
    retrieval?.matches?.filter((match) => !match.selected && match.eligible !== false).map((match) => match.id)
      ?? []
  );
  const memoryById = new Map(checkpoint.memories.map((memory) => [memory.id, memory]));
  const selectedMemories = retrievedIds.flatMap((id) => {
    const memory = memoryById.get(id);
    return memory ? [memory] : [];
  });
  const ignoredMemories = ignoredIds.flatMap((id) => {
    const memory = memoryById.get(id);
    return memory ? [memory] : [];
  });
  const expectedMemory = expectedAnswer
    ? checkpoint.memories.find((memory) => containsNormalized(memory.text, expectedAnswer))
    : undefined;
  const pair = findStaleSelection(selectedMemories, ignoredMemories);

  return {
    retrievedIds,
    loadedIds: unique(checkpoint.loadedMemoryIds),
    ignoredIds,
    selectedMemories,
    ignoredMemories,
    newerIgnoredMemory: pair?.newer,
    staleSelectedMemory: pair?.stale,
    expectedMemory,
    retrieval
  };
}

function diagnoseMemoryIncident(
  signals: IncidentSignals,
  memories: EngramMemory[],
  answer: string | undefined,
  expectedAnswer: string | undefined,
  evidenceOrigins: MemoryIncidentEvidenceOrigins = {}
): MemoryIncidentDiagnosis {
  const evidenceIds: string[] = [];

  if (memories.length === 0 && evidenceOrigins.memory_state !== "unavailable") {
    return diagnosis("storage", "Memory was never stored", "The turn had no stored memory state to search.", 0.98, "memory_state", [], evidenceIds);
  }

  if (signals.staleSelectedMemory && signals.newerIgnoredMemory) {
    return diagnosis(
      "update",
      "A stale fact remained active",
      `The older memory “${signals.staleSelectedMemory.text}” remained eligible after the newer memory “${signals.newerIgnoredMemory.text}” was stored.`,
      0.94,
      "memory_state",
      [signals.staleSelectedMemory.id, signals.newerIgnoredMemory.id],
      evidenceIds
    );
  }

  if (
    signals.expectedMemory
    && evidenceOrigins.retrieval !== "unavailable"
    && !signals.retrievedIds.includes(signals.expectedMemory.id)
  ) {
    const wasCandidate = signals.ignoredIds.includes(signals.expectedMemory.id);
    return diagnosis(
      wasCandidate ? "ranking" : "retrieval",
      wasCandidate ? "The right memory ranked too low" : "The right memory was not retrieved",
      wasCandidate
        ? `The expected memory was eligible but excluded from the selected results.`
        : `The expected memory existed but did not appear in the retrieval candidates.`,
      wasCandidate ? 0.92 : 0.88,
      "retrieval",
      [signals.expectedMemory.id, ...signals.retrievedIds],
      evidenceIds
    );
  }

  const retrievedButNotLoaded = signals.retrievedIds.filter((id) => !signals.loadedIds.includes(id));
  if (retrievedButNotLoaded.length > 0 && evidenceOrigins.active_context !== "unavailable") {
    return diagnosis(
      "context",
      "Retrieved memory was not loaded",
      "At least one selected memory did not reach the model's active context.",
      0.96,
      "active_context",
      retrievedButNotLoaded,
      evidenceIds
    );
  }

  if (expectedAnswer && answer && !containsNormalized(answer, expectedAnswer) && signals.loadedIds.length > 0) {
    return diagnosis(
      "generation",
      "The answer ignored available memory",
      "Relevant memory reached the active context, but the observed answer did not contain the expected fact.",
      0.8,
      "answer",
      signals.loadedIds,
      evidenceIds
    );
  }

  const hasBlindSpot = Object.values(evidenceOrigins).includes("unavailable");
  return diagnosis(
    "unknown",
    hasBlindSpot ? "The trace has an instrumentation gap" : "No single memory failure is proven",
    hasBlindSpot
      ? "At least one lifecycle stage was not recorded, so Engram will not infer that an operation failed. Add the missing telemetry before intervening."
      : "The recorded evidence does not isolate one lifecycle stage. Review the supporting events before intervening.",
    hasBlindSpot ? 0.2 : 0.35,
    "answer",
    signals.loadedIds,
    evidenceIds,
    "inferred"
  );
}

function buildEvidence(
  checkpoint: MemoryCheckpoint,
  signals: IncidentSignals,
  diagnosis: MemoryIncidentDiagnosis,
  expectedAnswer?: string,
  evidenceOrigins: MemoryIncidentEvidenceOrigins = {}
): MemoryIncidentEvidence[] {
  const memoryState: MemoryIncidentEvidence = {
    id: `${checkpoint.id}-evidence-memory-state`,
    origin: evidenceOrigins.memory_state ?? "observed",
    stage: "memory_state",
    label: "Recorded memory state",
    detail: `${checkpoint.memories.length} memories existed before the answer; ${checkpoint.memories.filter((memory) => memory.status !== "superseded").length} were active.`,
    memoryIds: checkpoint.memories.map((memory) => memory.id),
    sourceEventTypes: ["init", "store", "consolidate"]
  };
  const retrieval: MemoryIncidentEvidence = {
    id: `${checkpoint.id}-evidence-retrieval`,
    origin: evidenceOrigins.retrieval ?? (signals.retrieval ? "observed" : "derived"),
    stage: "retrieval",
    label: "Retrieval decision",
    detail: signals.retrieval?.reason
      || `${signals.retrievedIds.length} memories were selected and ${signals.ignoredIds.length} eligible memories were ignored.`,
    memoryIds: unique([...signals.retrievedIds, ...signals.ignoredIds]),
    sourceEventTypes: ["retrieve"]
  };
  const context: MemoryIncidentEvidence = {
    id: `${checkpoint.id}-evidence-context`,
    origin: evidenceOrigins.active_context ?? "observed",
    stage: "active_context",
    label: "Active context",
    detail: `${signals.loadedIds.length} memories were inserted into the model's working context.`,
    memoryIds: signals.loadedIds,
    sourceEventTypes: ["load", "fire"]
  };
  const answer: MemoryIncidentEvidence = {
    id: `${checkpoint.id}-evidence-answer`,
    origin: evidenceOrigins.answer ?? "observed",
    stage: "answer",
    label: "Observed answer",
    detail: checkpoint.answer ?? checkpoint.turnRecord?.originalAnswer ?? "No answer was recorded.",
    memoryIds: signals.loadedIds,
    sourceEventTypes: ["turn_record"]
  };
  const diagnosisEvidence: MemoryIncidentEvidence = {
    id: `${checkpoint.id}-evidence-diagnosis`,
    origin: diagnosis.origin,
    stage: diagnosis.stage,
    label: diagnosis.label,
    detail: `${diagnosis.summary}${expectedAnswer ? ` Expected answer evidence: “${expectedAnswer}”.` : ""}`,
    memoryIds: diagnosis.memoryIds,
    sourceEventTypes: [],
    confidence: diagnosis.confidence
  };

  diagnosis.evidenceIds.push(diagnosisEvidence.id);
  return [memoryState, retrieval, context, answer, diagnosisEvidence];
}

function buildStages(
  checkpoint: MemoryCheckpoint,
  signals: IncidentSignals,
  diagnosis: MemoryIncidentDiagnosis,
  evidence: MemoryIncidentEvidence[],
  expectedAnswer?: string,
  evidenceOrigins: MemoryIncidentEvidenceOrigins = {}
): MemoryIncidentStage[] {
  const evidenceByStage = new Map<MemoryIncidentStageKind, string[]>();
  for (const item of evidence) {
    evidenceByStage.set(item.stage, [...(evidenceByStage.get(item.stage) ?? []), item.id]);
  }
  const answer = checkpoint.answer ?? checkpoint.turnRecord?.originalAnswer ?? "";
  const failedStage = diagnosis.kind === "unknown" ? undefined : diagnosis.stage;
  const statusFor = (stage: MemoryIncidentStageKind, fallback: MemoryIncidentStageStatus) =>
    failedStage === stage ? "failed" : fallback;

  return [
    {
      id: `${checkpoint.id}-stage-memory-state`,
      kind: "memory_state",
      label: "Memory state",
      status: statusFor(
        "memory_state",
        evidenceOrigins.memory_state === "unavailable"
          ? "unknown"
          : checkpoint.memories.length > 0 ? "passed" : "warning"
      ),
      summary: `${checkpoint.memories.length} stored memories before this turn.`,
      memoryIds: checkpoint.memories.map((memory) => memory.id),
      evidenceIds: evidenceByStage.get("memory_state") ?? []
    },
    {
      id: `${checkpoint.id}-stage-retrieval`,
      kind: "retrieval",
      label: "Retrieval",
      status: statusFor(
        "retrieval",
        evidenceOrigins.retrieval === "unavailable"
          ? "unknown"
          : signals.retrievedIds.length > 0 ? "passed" : "warning"
      ),
      summary: signals.retrievedIds.length > 0
        ? `${signals.retrievedIds.length} selected; ${signals.ignoredIds.length} eligible but not selected.`
        : "No memory was selected.",
      memoryIds: unique([...signals.retrievedIds, ...signals.ignoredIds]),
      evidenceIds: evidenceByStage.get("retrieval") ?? []
    },
    {
      id: `${checkpoint.id}-stage-active-context`,
      kind: "active_context",
      label: "Active context",
      status: statusFor(
        "active_context",
        evidenceOrigins.active_context === "unavailable"
          ? "unknown"
          : signals.loadedIds.length > 0 ? "passed" : "warning"
      ),
      summary: `${signals.loadedIds.length} memories reached the model.`,
      memoryIds: signals.loadedIds,
      evidenceIds: evidenceByStage.get("active_context") ?? []
    },
    {
      id: `${checkpoint.id}-stage-answer`,
      kind: "answer",
      label: "Answer",
      status: statusFor(
        "answer",
        expectedAnswer ? containsNormalized(answer, expectedAnswer) ? "passed" : "failed" : "unknown"
      ),
      summary: answer || "No answer was recorded.",
      memoryIds: signals.loadedIds,
      evidenceIds: evidenceByStage.get("answer") ?? []
    }
  ];
}

function diagnosis(
  kind: MemoryFailureKind,
  label: string,
  summary: string,
  confidence: number,
  stage: MemoryIncidentStageKind,
  memoryIds: string[],
  evidenceIds: string[],
  origin: MemoryIncidentDiagnosis["origin"] = "derived"
): MemoryIncidentDiagnosis {
  return { kind, label, summary, confidence, origin, stage, memoryIds: unique(memoryIds), evidenceIds };
}

function findStaleSelection(selected: EngramMemory[], ignored: EngramMemory[]) {
  for (const stale of selected) {
    const newer = ignored
      .filter((candidate) => sameMemorySubject(stale, candidate))
      .filter((candidate) => Date.parse(candidate.created_at) > Date.parse(stale.created_at))
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];
    if (newer) return { stale, newer };
  }
  return undefined;
}

function sameMemorySubject(left: EngramMemory, right: EngramMemory): boolean {
  const leftTopic = normalize(left.topic ?? left.kind ?? "");
  const rightTopic = normalize(right.topic ?? right.kind ?? "");
  return Boolean(leftTopic && rightTopic && leftTopic === rightTopic);
}

function defaultIncidentTitle(diagnosis: MemoryIncidentDiagnosis): string {
  return diagnosis.kind === "unknown" ? "Memory behavior needs review" : diagnosis.label;
}

function containsNormalized(value: string, expected: string): boolean {
  return normalize(value).includes(normalize(expected));
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
