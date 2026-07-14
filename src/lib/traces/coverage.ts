import type {
  NormalizedTrace,
  NormalizedTraceStep,
  TraceMemoryMapping
} from "@/lib/traces/types";

export type InstrumentationCoverageStatus =
  | "observed"
  | "mapped"
  | "partial"
  | "unavailable";

export type InstrumentationCapabilityId =
  | "agent_spans"
  | "model_calls"
  | "tool_calls"
  | "memory_operations"
  | "retrieval_candidates"
  | "loaded_context"
  | "memory_scope"
  | "replayability";

export type InstrumentationCoverageEvidence = {
  detail: string;
  stepId?: string;
  sourcePath?: string;
};

export type InstrumentationCapabilityCoverage = {
  id: InstrumentationCapabilityId;
  label: string;
  status: InstrumentationCoverageStatus;
  reason: string;
  evidence: InstrumentationCoverageEvidence[];
};

export type InstrumentationCoverageReport = {
  traceId: string;
  capabilities: InstrumentationCapabilityCoverage[];
  summary: Record<InstrumentationCoverageStatus, number>;
  caveat: string;
};

type RecordedMapping = {
  mapping: Extract<TraceMemoryMapping, { provenance: "observed" | "mapped" }>;
  step: NormalizedTraceStep;
};

const LABELS: Record<InstrumentationCapabilityId, string> = {
  agent_spans: "Agent spans",
  model_calls: "Model calls",
  tool_calls: "Tool calls",
  memory_operations: "Explicit memory operations",
  retrieval_candidates: "Retrieval candidates",
  loaded_context: "Loaded context",
  memory_scope: "Memory scope",
  replayability: "Replayability"
};

export function analyzeInstrumentationCoverage(
  trace: NormalizedTrace
): InstrumentationCoverageReport {
  const mappings = recordedMappings(trace);
  const capabilities = [
    stepCoverage(trace, "agent_spans", "agent"),
    stepCoverage(trace, "model_calls", "model"),
    stepCoverage(trace, "tool_calls", "tool"),
    memoryOperationCoverage(mappings),
    retrievalCandidateCoverage(mappings),
    loadedContextCoverage(mappings),
    memoryScopeCoverage(mappings),
    replayabilityCoverage(trace)
  ];

  return {
    traceId: trace.trace.id,
    capabilities,
    summary: capabilities.reduce<Record<InstrumentationCoverageStatus, number>>(
      (summary, capability) => {
        summary[capability.status] += 1;
        return summary;
      },
      { observed: 0, mapped: 0, partial: 0, unavailable: 0 }
    ),
    caveat:
      "Coverage describes evidence present in this normalized trace. Missing telemetry is a blind spot, not proof that an operation did not happen."
  };
}

function stepCoverage(
  trace: NormalizedTrace,
  id: "agent_spans" | "model_calls" | "tool_calls",
  kind: "agent" | "model" | "tool"
): InstrumentationCapabilityCoverage {
  const steps = trace.steps.filter((step) => step.kind === kind);
  if (steps.length === 0) {
    return capability(
      id,
      "unavailable",
      `No ${LABELS[id].toLowerCase()} were recorded. This does not prove that none occurred.`
    );
  }

  return capability(
    id,
    "observed",
    `${steps.length} ${plural(steps.length, LABELS[id].toLowerCase().replace(/s$/, ""))} recorded as execution steps.`,
    steps.map((step) => stepEvidence(step, `${step.name} (${formatStepStatus(step.status)})`))
  );
}

function memoryOperationCoverage(
  mappings: RecordedMapping[]
): InstrumentationCapabilityCoverage {
  if (mappings.length === 0) {
    return capability(
      "memory_operations",
      "unavailable",
      "No explicit or recognized memory operation was recorded. Ordinary tool or model spans do not prove hidden memory activity."
    );
  }

  const observed = mappings.filter(({ mapping }) => mapping.provenance === "observed");
  const mapped = mappings.filter(({ mapping }) => mapping.provenance === "mapped");
  const status = provenanceStatus(observed.length, mapped.length);
  const reason = status === "observed"
    ? `${observed.length} native memory ${plural(observed.length, "event")} recorded explicitly.`
    : status === "mapped"
      ? `${mapped.length} memory ${plural(mapped.length, "operation")} mapped from recognized tool calls; no native memory event was recorded.`
      : `${observed.length} native and ${mapped.length} mapped memory ${plural(mappings.length, "operation")} provide mixed provenance.`;

  return capability(
    "memory_operations",
    status,
    reason,
    mappings.map(mappingEvidence)
  );
}

function retrievalCandidateCoverage(
  mappings: RecordedMapping[]
): InstrumentationCapabilityCoverage {
  const retrievals = mappings.filter(({ mapping }) => mapping.event.type === "retrieve");
  if (retrievals.length === 0) {
    return capability(
      "retrieval_candidates",
      "unavailable",
      "No retrieval event was recorded, so candidate ranking and filtering cannot be inspected."
    );
  }

  const withCandidateLists = retrievals.filter(({ mapping }) =>
    mapping.event.type === "retrieve" && Array.isArray(mapping.event.retrieval?.matches)
  );

  if (withCandidateLists.length === 0) {
    return capability(
      "retrieval_candidates",
      "partial",
      `${retrievals.length} retrieval ${plural(retrievals.length, "outcome")} recorded selected IDs, but no candidate lists, ranks, or filter decisions.`,
      retrievals.map(mappingEvidence)
    );
  }

  const completeCandidateLists = withCandidateLists.filter(({ mapping }) => {
    if (mapping.event.type !== "retrieve") return false;
    const matches = mapping.event.retrieval?.matches;
    const declaredCount = mapping.event.retrieval?.candidateCount;
    return Array.isArray(matches) && declaredCount !== undefined && matches.length >= declaredCount;
  });

  if (completeCandidateLists.length < retrievals.length) {
    return capability(
      "retrieval_candidates",
      "partial",
      `${completeCandidateLists.length} of ${retrievals.length} retrievals include a candidate list with a matching declared total; the remaining retrievals expose selected outcomes or unverified candidate lists.`,
      retrievals.map(mappingEvidence)
    );
  }

  const observedCount = completeCandidateLists.filter(({ mapping }) => mapping.provenance === "observed").length;
  const mappedCount = completeCandidateLists.length - observedCount;
  const status = provenanceStatus(observedCount, mappedCount);
  const candidateCount = completeCandidateLists.reduce((count, { mapping }) => {
    if (mapping.event.type !== "retrieve") return count;
    return count + (mapping.event.retrieval?.matches?.length ?? 0);
  }, 0);

  return capability(
    "retrieval_candidates",
    status,
    `${candidateCount} candidate ${plural(candidateCount, "record")} include ranking or filtering evidence across ${completeCandidateLists.length} ${plural(completeCandidateLists.length, "retrieval")}.`,
    completeCandidateLists.map(mappingEvidence)
  );
}

function loadedContextCoverage(
  mappings: RecordedMapping[]
): InstrumentationCapabilityCoverage {
  const loads = mappings.filter(({ mapping }) => mapping.event.type === "load");
  if (loads.length === 0) {
    const retrievalCount = mappings.filter(({ mapping }) => mapping.event.type === "retrieve").length;
    return capability(
      "loaded_context",
      "unavailable",
      retrievalCount > 0
        ? `${retrievalCount} retrieval ${plural(retrievalCount, "result")} recorded, but retrieval does not prove that memory entered the model context.`
        : "No explicit context-load event was recorded. Model input alone is not treated as proof of memory injection."
    );
  }

  const observedCount = loads.filter(({ mapping }) => mapping.provenance === "observed").length;
  const mappedCount = loads.length - observedCount;
  const status = provenanceStatus(observedCount, mappedCount);
  const loadedIds = new Set(
    loads.flatMap(({ mapping }) => mapping.event.type === "load" ? mapping.event.ids : [])
  );

  return capability(
    "loaded_context",
    status,
    `${loads.length} context-load ${plural(loads.length, "event")} identify ${loadedIds.size} unique loaded memory ${plural(loadedIds.size, "id")}.`,
    loads.map(mappingEvidence)
  );
}

function memoryScopeCoverage(
  mappings: RecordedMapping[]
): InstrumentationCapabilityCoverage {
  if (mappings.length === 0) {
    return capability(
      "memory_scope",
      "unavailable",
      "No memory operations were recorded, so user, agent, run, or shared scope cannot be assessed."
    );
  }

  const known = mappings.filter(({ step }) =>
    step.topology?.memory &&
    step.topology.memory.scope !== "unknown" &&
    step.topology.memory.provenance !== "unknown"
  );

  if (known.length === 0) {
    return capability(
      "memory_scope",
      "unavailable",
      `${mappings.length} memory ${plural(mappings.length, "operation")} recorded without a known user, agent, run, or shared scope.`,
      mappings.map(({ step }) => stepEvidence(step, "Memory operation has unknown scope."))
    );
  }

  if (known.length < mappings.length) {
    return capability(
      "memory_scope",
      "partial",
      `${known.length} of ${mappings.length} memory operations record a known scope; ${mappings.length - known.length} remain blind spots.`,
      mappings.map(({ step }) => scopeEvidence(step))
    );
  }

  const observedCount = known.filter(({ step }) => step.topology?.memory?.provenance === "observed").length;
  const mappedCount = known.filter(({ step }) => step.topology?.memory?.provenance === "mapped").length;
  const status = provenanceStatus(observedCount, mappedCount);
  const scopes = new Set(known.map(({ step }) => step.topology?.memory?.scope));

  return capability(
    "memory_scope",
    status,
    `All ${known.length} memory operations identify scope (${[...scopes].join(", ")}).`,
    known.map(({ step }) => scopeEvidence(step))
  );
}

function replayabilityCoverage(trace: NormalizedTrace): InstrumentationCapabilityCoverage {
  const modelSteps = trace.steps.filter((step) => step.kind === "model");
  if (modelSteps.length === 0) {
    return capability(
      "replayability",
      "unavailable",
      "No model call was recorded, so there is no generation boundary to replay."
    );
  }

  const modelInputs = modelSteps.filter((step) => step.input !== undefined);
  const modelOutputs = modelSteps.filter((step) => step.output !== undefined);
  const toolSteps = trace.steps.filter((step) => step.kind === "tool");
  const toolOutputs = toolSteps.filter((step) => step.output !== undefined);
  const allModelIo = modelInputs.length === modelSteps.length && modelOutputs.length === modelSteps.length;
  const allToolOutputs = toolOutputs.length === toolSteps.length;

  if (!allModelIo || !allToolOutputs) {
    const missing = [
      modelInputs.length < modelSteps.length ? "model input" : null,
      modelOutputs.length < modelSteps.length ? "model output" : null,
      toolOutputs.length < toolSteps.length ? "tool output" : null
    ].filter((item): item is string => Boolean(item));
    return capability(
      "replayability",
      "unavailable",
      `Replay evidence is incomplete: missing ${formatList(missing)}. The analyzer will not assume omitted values can be reconstructed.`,
      [...modelSteps, ...toolSteps].map((step) => stepEvidence(
        step,
        `Input ${step.input === undefined ? "missing" : "recorded"}; output ${step.output === undefined ? "missing" : "recorded"}.`
      ))
    );
  }

  return capability(
    "replayability",
    "partial",
    "Model inputs and outputs plus tool outputs are recorded, but NormalizedTrace v1 does not attest complete instructions, tool definitions, model parameters, retrieval corpus, or side-effect isolation.",
    [...modelSteps, ...toolSteps].map((step) => stepEvidence(step, "Recorded input and output are available."))
  );
}

function recordedMappings(trace: NormalizedTrace): RecordedMapping[] {
  return trace.steps.flatMap((step) =>
    step.memoryMappings.flatMap((mapping) =>
      mapping.event && (mapping.provenance === "observed" || mapping.provenance === "mapped")
        ? [{ step, mapping }]
        : []
    )
  );
}

function provenanceStatus(
  observedCount: number,
  mappedCount: number
): Exclude<InstrumentationCoverageStatus, "unavailable"> {
  if (observedCount > 0 && mappedCount === 0) return "observed";
  if (mappedCount > 0 && observedCount === 0) return "mapped";
  return "partial";
}

function capability(
  id: InstrumentationCapabilityId,
  status: InstrumentationCoverageStatus,
  reason: string,
  evidence: InstrumentationCoverageEvidence[] = []
): InstrumentationCapabilityCoverage {
  return { id, label: LABELS[id], status, reason, evidence };
}

function stepEvidence(
  step: NormalizedTraceStep,
  detail: string
): InstrumentationCoverageEvidence {
  return { stepId: step.id, detail };
}

function mappingEvidence({ mapping, step }: RecordedMapping): InstrumentationCoverageEvidence {
  return {
    stepId: step.id,
    sourcePath: mapping.sourcePath,
    detail: `${mapping.event.type}: ${mapping.note}`
  };
}

function scopeEvidence(step: NormalizedTraceStep): InstrumentationCoverageEvidence {
  const scope = step.topology?.memory;
  return {
    stepId: step.id,
    ...(scope?.sourcePath ? { sourcePath: scope.sourcePath } : {}),
    detail: scope && scope.scope !== "unknown"
      ? `${scope.scope}: ${scope.note}`
      : "Memory operation has unknown scope."
  };
}

function formatStepStatus(status: NormalizedTraceStep["status"]): string {
  return status === "in_progress" ? "in progress" : status;
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "required replay fields";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
