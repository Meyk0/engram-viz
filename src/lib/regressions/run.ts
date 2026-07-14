import { memoryRegressionArtifactSchema } from "@/lib/regressions/schema";
import type { MemoryRegressionArtifact } from "@/lib/regressions/types";
import type { ChatMessage, EngramMemory } from "@/types";

export const MEMORY_REGRESSION_RUN_CAVEAT =
  "This report evaluates observable answers and memory IDs against explicit assertions. It does not reproduce hidden model state or establish that a memory caused an answer.";

type ObservationMetadataValue = string | number | boolean | null;

export type MemoryRegressionExecutionFixture = Readonly<{
  memories: readonly Readonly<EngramMemory>[];
  input: Readonly<{
    userMessage: string;
    history: readonly Readonly<ChatMessage>[];
  }>;
}>;

export type MemoryRegressionExecutionObservation = Readonly<{
  answer: string;
  retrievedMemoryIds: readonly string[];
  loadedMemoryIds: readonly string[];
  provider?: Readonly<{
    id: string;
    model?: string;
    metadata?: Readonly<Record<string, ObservationMetadataValue>>;
  }>;
  runtime?: Readonly<{
    name: string;
    version?: string;
    metadata?: Readonly<Record<string, ObservationMetadataValue>>;
  }>;
}>;

export type MemoryRegressionExecutor = (
  fixture: MemoryRegressionExecutionFixture
) => MemoryRegressionExecutionObservation | Promise<MemoryRegressionExecutionObservation>;

export type MemoryRegressionAssertionFinding = Readonly<{
  id: string;
  category: "retrieval" | "answer";
  assertion: "mustRetrieve" | "mustNotRetrieve" | "maxLoaded" | "contains" | "notContains";
  pass: boolean;
  evaluated: boolean;
  expected: string | number;
  observed: readonly string[] | string | number | null;
  message: string;
}>;

export type MemoryRegressionRunReport = Readonly<{
  artifact: Readonly<{
    id: string | null;
    title: string | null;
    version: number | null;
  }>;
  pass: boolean;
  status: "passed" | "failed";
  execution: Readonly<{
    status: "completed" | "invalid-artifact" | "invalid-observation" | "executor-error";
    durationMs: number;
    error?: Readonly<{
      name: string;
      message: string;
    }>;
  }>;
  observation?: MemoryRegressionExecutionObservation;
  findings: readonly MemoryRegressionAssertionFinding[];
  summary: Readonly<{
    total: number;
    passed: number;
    failed: number;
    notEvaluated: number;
  }>;
  contract: Readonly<{
    claim: "behavioral-observation";
    causalClaim: false;
    caveats: readonly string[];
  }>;
}>;

type EvaluationOptions = {
  durationMs?: number;
};

type RunOptions = {
  now?: () => number;
};

export async function runMemoryRegressionArtifact(
  artifact: unknown,
  executor: MemoryRegressionExecutor,
  options: RunOptions = {}
): Promise<MemoryRegressionRunReport> {
  const now = options.now ?? defaultClock;
  const startedAt = now();
  const parsed = memoryRegressionArtifactSchema.safeParse(artifact);

  if (!parsed.success) {
    return invalidReport(
      artifactIdentity(artifact),
      "invalid-artifact",
      elapsed(startedAt, now()),
      new Error(`Invalid memory regression artifact: ${parsed.error.issues.map((issue) => issue.message).join(" ")}`)
    );
  }

  const validArtifact = parsed.data;
  const fixture = deepFreeze(structuredClone(validArtifact.fixture));

  try {
    const result = await executor(fixture);
    return evaluateMemoryRegressionObservation(validArtifact, result, {
      durationMs: elapsed(startedAt, now())
    });
  } catch (error) {
    const durationMs = elapsed(startedAt, now());
    return failedExecutionReport(validArtifact, "executor-error", durationMs, error);
  }
}

export function evaluateMemoryRegressionObservation(
  artifact: unknown,
  observation: unknown,
  options: EvaluationOptions = {}
): MemoryRegressionRunReport {
  const parsed = memoryRegressionArtifactSchema.safeParse(artifact);
  if (!parsed.success) {
    return invalidReport(
      artifactIdentity(artifact),
      "invalid-artifact",
      normalizeDuration(options.durationMs),
      new Error(`Invalid memory regression artifact: ${parsed.error.issues.map((issue) => issue.message).join(" ")}`)
    );
  }

  let normalized: MemoryRegressionExecutionObservation;
  try {
    normalized = normalizeObservation(observation);
  } catch (error) {
    return failedExecutionReport(
      parsed.data,
      "invalid-observation",
      normalizeDuration(options.durationMs),
      error
    );
  }

  const findings = evaluateAssertions(parsed.data, normalized);
  const summary = summarize(findings);
  const pass = summary.failed === 0 && summary.notEvaluated === 0;

  return deepFreeze({
    artifact: artifactIdentity(parsed.data),
    pass,
    status: pass ? "passed" : "failed",
    execution: {
      status: "completed",
      durationMs: normalizeDuration(options.durationMs)
    },
    observation: normalized,
    findings,
    summary,
    contract: contractFor(parsed.data)
  });
}

function evaluateAssertions(
  artifact: MemoryRegressionArtifact,
  observation: MemoryRegressionExecutionObservation
): MemoryRegressionAssertionFinding[] {
  const findings: MemoryRegressionAssertionFinding[] = [];
  const retrieved = new Set(observation.retrievedMemoryIds);
  const loaded = observation.loadedMemoryIds;
  const normalizedAnswer = observation.answer.toLocaleLowerCase();

  for (const id of artifact.assertions.retrieval.mustRetrieve) {
    const pass = retrieved.has(id);
    findings.push({
      id: `retrieval.mustRetrieve:${id}`,
      category: "retrieval",
      assertion: "mustRetrieve",
      pass,
      evaluated: true,
      expected: id,
      observed: observation.retrievedMemoryIds,
      message: pass
        ? `Required memory "${id}" was retrieved.`
        : `Required memory "${id}" was not retrieved.`
    });
  }

  for (const id of artifact.assertions.retrieval.mustNotRetrieve) {
    const pass = !retrieved.has(id);
    findings.push({
      id: `retrieval.mustNotRetrieve:${id}`,
      category: "retrieval",
      assertion: "mustNotRetrieve",
      pass,
      evaluated: true,
      expected: id,
      observed: observation.retrievedMemoryIds,
      message: pass
        ? `Forbidden memory "${id}" was not retrieved.`
        : `Forbidden memory "${id}" was retrieved.`
    });
  }

  const maxLoaded = artifact.assertions.retrieval.maxLoaded;
  if (maxLoaded !== undefined) {
    const pass = loaded.length <= maxLoaded;
    findings.push({
      id: "retrieval.maxLoaded",
      category: "retrieval",
      assertion: "maxLoaded",
      pass,
      evaluated: true,
      expected: maxLoaded,
      observed: loaded.length,
      message: pass
        ? `${loaded.length} memories were loaded, within the limit of ${maxLoaded}.`
        : `${loaded.length} memories were loaded, exceeding the limit of ${maxLoaded}.`
    });
  }

  for (const phrase of artifact.assertions.answer.contains) {
    const pass = normalizedAnswer.includes(phrase.toLocaleLowerCase());
    findings.push({
      id: `answer.contains:${phrase}`,
      category: "answer",
      assertion: "contains",
      pass,
      evaluated: true,
      expected: phrase,
      observed: observation.answer,
      message: pass
        ? `Answer contains required text "${phrase}".`
        : `Answer does not contain required text "${phrase}".`
    });
  }

  for (const phrase of artifact.assertions.answer.notContains) {
    const pass = !normalizedAnswer.includes(phrase.toLocaleLowerCase());
    findings.push({
      id: `answer.notContains:${phrase}`,
      category: "answer",
      assertion: "notContains",
      pass,
      evaluated: true,
      expected: phrase,
      observed: observation.answer,
      message: pass
        ? `Answer omits forbidden text "${phrase}".`
        : `Answer contains forbidden text "${phrase}".`
    });
  }

  return findings;
}

function failedExecutionReport(
  artifact: MemoryRegressionArtifact,
  status: "invalid-observation" | "executor-error",
  durationMs: number,
  error: unknown
): MemoryRegressionRunReport {
  const failure = errorDetails(error);
  const findings = unevaluatedAssertions(artifact, failure.message);

  return deepFreeze({
    artifact: artifactIdentity(artifact),
    pass: false,
    status: "failed",
    execution: { status, durationMs, error: failure },
    findings,
    summary: summarize(findings),
    contract: contractFor(artifact)
  });
}

function invalidReport(
  identity: MemoryRegressionRunReport["artifact"],
  status: "invalid-artifact",
  durationMs: number,
  error: unknown
): MemoryRegressionRunReport {
  return deepFreeze({
    artifact: identity,
    pass: false,
    status: "failed",
    execution: { status, durationMs, error: errorDetails(error) },
    findings: [],
    summary: { total: 0, passed: 0, failed: 0, notEvaluated: 0 },
    contract: {
      claim: "behavioral-observation",
      causalClaim: false,
      caveats: [MEMORY_REGRESSION_RUN_CAVEAT]
    }
  });
}

function unevaluatedAssertions(
  artifact: MemoryRegressionArtifact,
  reason: string
): MemoryRegressionAssertionFinding[] {
  const findings: MemoryRegressionAssertionFinding[] = [];
  const add = (
    id: string,
    category: MemoryRegressionAssertionFinding["category"],
    assertion: MemoryRegressionAssertionFinding["assertion"],
    expected: string | number
  ) => findings.push({
    id,
    category,
    assertion,
    pass: false,
    evaluated: false,
    expected,
    observed: null,
    message: `Not evaluated because execution failed: ${reason}`
  });

  artifact.assertions.retrieval.mustRetrieve.forEach((id) =>
    add(`retrieval.mustRetrieve:${id}`, "retrieval", "mustRetrieve", id));
  artifact.assertions.retrieval.mustNotRetrieve.forEach((id) =>
    add(`retrieval.mustNotRetrieve:${id}`, "retrieval", "mustNotRetrieve", id));
  if (artifact.assertions.retrieval.maxLoaded !== undefined) {
    add("retrieval.maxLoaded", "retrieval", "maxLoaded", artifact.assertions.retrieval.maxLoaded);
  }
  artifact.assertions.answer.contains.forEach((phrase) =>
    add(`answer.contains:${phrase}`, "answer", "contains", phrase));
  artifact.assertions.answer.notContains.forEach((phrase) =>
    add(`answer.notContains:${phrase}`, "answer", "notContains", phrase));

  return findings;
}

function normalizeObservation(value: unknown): MemoryRegressionExecutionObservation {
  if (!isRecord(value)) throw new TypeError("Executor observation must be an object.");
  if (typeof value.answer !== "string") throw new TypeError("Executor observation answer must be a string.");

  const observation = {
    answer: value.answer,
    retrievedMemoryIds: normalizeIdArray(value.retrievedMemoryIds, "retrievedMemoryIds"),
    loadedMemoryIds: normalizeIdArray(value.loadedMemoryIds, "loadedMemoryIds"),
    ...(value.provider === undefined ? {} : { provider: normalizeIdentity(value.provider, "provider") }),
    ...(value.runtime === undefined ? {} : { runtime: normalizeRuntime(value.runtime) })
  };

  return deepFreeze(observation);
}

function normalizeIdentity(value: unknown, label: string) {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    throw new TypeError(`Executor observation ${label}.id must be a non-empty string.`);
  }
  if (value.model !== undefined && (typeof value.model !== "string" || !value.model.trim())) {
    throw new TypeError(`Executor observation ${label}.model must be a non-empty string when provided.`);
  }
  return {
    id: value.id.trim(),
    ...(typeof value.model === "string" ? { model: value.model.trim() } : {}),
    ...(value.metadata === undefined ? {} : { metadata: normalizeMetadata(value.metadata, `${label}.metadata`) })
  };
}

function normalizeRuntime(value: unknown) {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) {
    throw new TypeError("Executor observation runtime.name must be a non-empty string.");
  }
  if (value.version !== undefined && (typeof value.version !== "string" || !value.version.trim())) {
    throw new TypeError("Executor observation runtime.version must be a non-empty string when provided.");
  }
  return {
    name: value.name.trim(),
    ...(typeof value.version === "string" ? { version: value.version.trim() } : {}),
    ...(value.metadata === undefined ? {} : { metadata: normalizeMetadata(value.metadata, "runtime.metadata") })
  };
}

function normalizeMetadata(value: unknown, label: string): Record<string, ObservationMetadataValue> {
  if (!isRecord(value)) throw new TypeError(`Executor observation ${label} must be an object.`);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (!key.trim()) throw new TypeError(`Executor observation ${label} keys must be non-empty.`);
    if (entry !== null && !["string", "number", "boolean"].includes(typeof entry)) {
      throw new TypeError(`Executor observation ${label}.${key} must be scalar metadata.`);
    }
    return [key, entry as ObservationMetadataValue];
  }));
}

function normalizeIdArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`Executor observation ${label} must be an array.`);
  const ids = value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new TypeError(`Executor observation ${label} must contain non-empty strings.`);
    }
    return entry.trim();
  });
  return [...new Set(ids)];
}

function summarize(findings: readonly MemoryRegressionAssertionFinding[]) {
  return {
    total: findings.length,
    passed: findings.filter((finding) => finding.pass).length,
    failed: findings.filter((finding) => finding.evaluated && !finding.pass).length,
    notEvaluated: findings.filter((finding) => !finding.evaluated).length
  };
}

function contractFor(artifact: MemoryRegressionArtifact) {
  return {
    claim: "behavioral-observation" as const,
    causalClaim: false as const,
    caveats: [...new Set([artifact.evidence.caveat, MEMORY_REGRESSION_RUN_CAVEAT])]
  };
}

function artifactIdentity(value: unknown): MemoryRegressionRunReport["artifact"] {
  if (!isRecord(value)) return { id: null, title: null, version: null };
  return {
    id: typeof value.id === "string" ? value.id : null,
    title: typeof value.title === "string" ? value.title : null,
    version: typeof value.version === "number" ? value.version : null
  };
}

function errorDetails(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: typeof error === "string" ? error : "Unknown executor error." };
}

function elapsed(start: number, end: number): number {
  return normalizeDuration(end - start);
}

function normalizeDuration(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function defaultClock(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
