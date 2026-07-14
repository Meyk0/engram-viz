import { z } from "zod";

export type ReplayJsonValue =
  | string
  | number
  | boolean
  | null
  | ReplayJsonValue[]
  | { [key: string]: ReplayJsonValue };

const replayJsonValueSchema: z.ZodType<ReplayJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(replayJsonValueSchema),
    z.record(z.string(), replayJsonValueSchema)
  ])
);

const evidenceProvenanceSchema = z.enum(["observed", "declared", "mapped", "unknown"]);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hex digest.");

/**
 * Evidence is explicit about whether Engram captured a replayable value, only an
 * identity hash, an attested absence, or no usable evidence at all.
 */
export const replayArtifactEvidenceSchema = z.discriminatedUnion("capture", [
  z.object({
    capture: z.literal("value"),
    value: replayJsonValueSchema,
    sha256: sha256Schema.optional(),
    provenance: evidenceProvenanceSchema
  }).strict(),
  z.object({
    capture: z.literal("hash"),
    algorithm: z.literal("sha256"),
    sha256: sha256Schema,
    provenance: evidenceProvenanceSchema
  }).strict(),
  z.object({
    capture: z.literal("absent"),
    reason: z.string().min(1),
    provenance: evidenceProvenanceSchema
  }).strict(),
  z.object({
    capture: z.literal("unavailable"),
    reason: z.string().min(1),
    provenance: evidenceProvenanceSchema
  }).strict()
]);

export const replayRuntimeManifestV2Schema = z.object({
  format: z.literal("engram.replay-runtime"),
  version: z.literal(2),
  id: z.string().min(1),
  capturedAt: z.string().datetime(),
  source: z.object({
    traceId: z.string().min(1).optional(),
    spanId: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    format: z.string().min(1).optional(),
    provenance: evidenceProvenanceSchema,
    captureMethod: z.enum(["native", "export", "adapter", "manual", "unknown"]),
    sourceHash: sha256Schema.optional()
  }).strict(),
  prompts: z.object({
    /** Complete provider-bound model input, including message roles and order. */
    input: replayArtifactEvidenceSchema,
    /** System instructions, or an explicit absent/hash record. */
    system: replayArtifactEvidenceSchema,
    /** Ordered developer instructions, usually captured as a JSON array. */
    developer: replayArtifactEvidenceSchema
  }).strict(),
  model: z.object({
    provider: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    parameters: replayArtifactEvidenceSchema,
    seed: replayArtifactEvidenceSchema,
    determinism: z.enum(["guaranteed", "best_effort", "not_guaranteed", "unknown"])
  }).strict(),
  tools: z.object({
    replayMode: z.enum(["not_used", "execute", "recorded_outputs", "unknown"]),
    definitions: z.array(z.object({
      name: z.string().min(1),
      definition: replayArtifactEvidenceSchema
    }).strict()),
    calls: z.array(z.object({
      callId: z.string().min(1),
      toolName: z.string().min(1),
      input: replayArtifactEvidenceSchema,
      output: replayArtifactEvidenceSchema,
      error: replayArtifactEvidenceSchema.optional()
    }).strict()),
    callsComplete: z.union([z.boolean(), z.literal("unknown")]),
    determinism: z.enum(["guaranteed", "best_effort", "not_guaranteed", "unknown"])
  }).strict(),
  retrieval: z.object({
    replayMode: z.enum(["not_used", "rerun", "recorded_outputs", "unknown"]),
    configuration: replayArtifactEvidenceSchema,
    corpus: z.object({
      version: z.string().min(1).optional(),
      hash: sha256Schema.optional()
    }).strict().optional(),
    output: replayArtifactEvidenceSchema,
    determinism: z.enum(["guaranteed", "best_effort", "not_guaranteed", "unknown"])
  }).strict(),
  environment: z.object({
    codeVersion: z.string().min(1).optional(),
    runtime: z.object({
      name: z.string().min(1),
      version: z.string().min(1)
    }).strict().optional(),
    dependencyLockHash: sha256Schema.optional(),
    configurationHash: sha256Schema.optional(),
    containerImageDigest: z.string().min(1).optional()
  }).strict(),
  sideEffects: z.object({
    isolation: z.enum(["none", "isolated", "recorded_and_stubbed", "live", "unknown"]),
    network: z.enum(["none", "blocked", "recorded_and_stubbed", "live", "unknown"]),
    filesystem: z.enum(["none", "sandboxed", "recorded_and_stubbed", "live", "unknown"]),
    externalServices: z.enum(["none", "stubbed", "recorded_and_stubbed", "live", "unknown"]),
    notes: z.array(z.string().min(1)).optional()
  }).strict()
}).strict();

export type ReplayArtifactEvidence = z.infer<typeof replayArtifactEvidenceSchema>;
export type ReplayRuntimeManifestV2 = z.infer<typeof replayRuntimeManifestV2Schema>;
export type ReplayFidelityLevel = "exact" | "controlled" | "partial" | "unreplayable";
export type ReplayEvidenceImpact = "blocks_replay" | "reduces_control" | "prevents_exactness";

export type ReplayMissingEvidence = {
  field: string;
  label: string;
  impact: ReplayEvidenceImpact;
  reason: string;
};

export type ReplayFidelityReport = {
  manifestId: string;
  level: ReplayFidelityLevel;
  deterministic: boolean;
  summary: string;
  missingEvidence: ReplayMissingEvidence[];
  caveats: string[];
};

export function parseReplayRuntimeManifestV2(input: unknown): ReplayRuntimeManifestV2 {
  return replayRuntimeManifestV2Schema.parse(input);
}

/**
 * Grades only recorded evidence. It never treats a seed, matching hash, or
 * successful prior run as proof that a provider will reproduce an output.
 */
export function analyzeReplayFidelity(input: unknown): ReplayFidelityReport {
  const manifest = parseReplayRuntimeManifestV2(input);
  const missing: ReplayMissingEvidence[] = [];
  const caveats = new Set<string>();

  const add = (
    field: string,
    label: string,
    impact: ReplayEvidenceImpact,
    reason: string
  ) => {
    if (missing.some((item) => item.field === field && item.impact === impact)) return;
    missing.push({ field, label, impact, reason });
  };

  if (!manifest.model.provider) {
    add("model.provider", "Model provider", "blocks_replay", "The model provider was not recorded.");
  }
  if (!manifest.model.name) {
    add("model.name", "Model name", "blocks_replay", "The model name or deployment was not recorded.");
  }
  if (!hasCapturedValue(manifest.prompts.input)) {
    add(
      "prompts.input",
      "Complete model input",
      "blocks_replay",
      hashReason(manifest.prompts.input, "The complete ordered model input")
    );
  }
  if (!isReconstructable(manifest.model.parameters)) {
    add(
      "model.parameters",
      "Model parameters",
      "reduces_control",
      hashReason(manifest.model.parameters, "Model parameters")
    );
  }

  if (!isKnown(manifest.prompts.system) || !isKnown(manifest.prompts.developer)) {
    add(
      "prompts.instructions",
      "Instruction provenance",
      "prevents_exactness",
      "System and developer instructions were not individually captured or explicitly declared absent."
    );
  }

  analyzeSource(manifest, add);
  analyzeArtifactProvenance(manifest, add);
  analyzeEnvironment(manifest, add);
  analyzeTools(manifest, add);
  analyzeRetrieval(manifest, add);
  analyzeSideEffects(manifest, add);

  if (manifest.model.determinism !== "guaranteed") {
    add(
      "model.determinism",
      "Model determinism attestation",
      "prevents_exactness",
      manifest.model.determinism === "unknown"
        ? "No provider or runtime determinism guarantee was captured."
        : `The model runtime is declared ${manifest.model.determinism.replace("_", " ")}, not deterministic.`
    );
  }
  if (!isReconstructable(manifest.model.seed) || manifest.model.seed.provenance === "unknown") {
    add(
      "model.seed",
      "Random seed evidence",
      "prevents_exactness",
      "The runtime did not record a seed or explicitly attest that a seed was not applicable."
    );
  }

  const hasBlocking = missing.some((item) => item.impact === "blocks_replay");
  const hasControlGaps = missing.some((item) => item.impact === "reduces_control");
  const hasExactnessGaps = missing.some((item) => item.impact === "prevents_exactness");
  const level: ReplayFidelityLevel = hasBlocking
    ? "unreplayable"
    : hasControlGaps
      ? "partial"
      : hasExactnessGaps
        ? "controlled"
        : "exact";

  if (level !== "exact") {
    caveats.add("This manifest does not establish deterministic output reproduction.");
  }
  if (manifest.model.seed.capture === "value" && manifest.model.determinism !== "guaranteed") {
    caveats.add("A recorded seed improves control but is not, by itself, a determinism guarantee.");
  }
  if (hasHashOnlyEvidence(manifest)) {
    caveats.add("Hashes can verify supplied artifacts but cannot reconstruct the hashed content.");
  }

  return {
    manifestId: manifest.id,
    level,
    deterministic: level === "exact",
    summary: summaryFor(level),
    missingEvidence: missing,
    caveats: [...caveats]
  };
}

type AddMissing = (
  field: string,
  label: string,
  impact: ReplayEvidenceImpact,
  reason: string
) => void;

function analyzeSource(manifest: ReplayRuntimeManifestV2, add: AddMissing) {
  if (!manifest.source.traceId) {
    add("source.traceId", "Source trace", "reduces_control", "No source trace identifier links this runtime to observed execution.");
  }
  if (manifest.source.provenance === "unknown" || manifest.source.captureMethod === "unknown") {
    add("source.provenance", "Source provenance", "reduces_control", "The source trace capture method or provenance is unknown.");
  } else if (manifest.source.provenance !== "observed") {
    add("source.provenance", "Observed source provenance", "prevents_exactness", "The manifest was declared or mapped rather than captured directly from execution.");
  }
  if (manifest.source.captureMethod === "adapter" || manifest.source.captureMethod === "manual") {
    add("source.captureMethod", "Native source capture", "prevents_exactness", "Adapter or manual capture can support a controlled replay but is not native execution evidence.");
  }
  if (!manifest.source.sourceHash) {
    add("source.sourceHash", "Source trace fingerprint", "prevents_exactness", "The source trace content was not fingerprinted against later mutation.");
  }
}

function analyzeEnvironment(manifest: ReplayRuntimeManifestV2, add: AddMissing) {
  if (!manifest.environment.codeVersion) {
    add("environment.codeVersion", "Code version", "reduces_control", "The executing code version was not recorded.");
  }
  if (!manifest.environment.runtime) {
    add("environment.runtime", "Runtime version", "reduces_control", "The runtime name and version were not recorded.");
  }
  if (!manifest.environment.dependencyLockHash) {
    add("environment.dependencyLockHash", "Dependency lock", "reduces_control", "The resolved dependency set was not fingerprinted.");
  }
  if (!manifest.environment.configurationHash) {
    add("environment.configurationHash", "Environment configuration", "reduces_control", "The non-secret runtime configuration was not fingerprinted.");
  }
  if (!manifest.environment.containerImageDigest) {
    add("environment.containerImageDigest", "Runtime image identity", "prevents_exactness", "No immutable runtime image or equivalent system identity was recorded.");
  }
}

function analyzeArtifactProvenance(manifest: ReplayRuntimeManifestV2, add: AddMissing) {
  const artifacts: Array<readonly [string, ReplayArtifactEvidence]> = [
    ["prompts.input", manifest.prompts.input],
    ["prompts.system", manifest.prompts.system],
    ["prompts.developer", manifest.prompts.developer],
    ["model.parameters", manifest.model.parameters],
    ["model.seed", manifest.model.seed],
    ["retrieval.configuration", manifest.retrieval.configuration],
    ["retrieval.output", manifest.retrieval.output],
    ...manifest.tools.definitions.map((tool) => [`tools.definitions.${tool.name}`, tool.definition] as const),
    ...manifest.tools.calls.flatMap((call) => [
      [`tools.calls.${call.callId}.input`, call.input] as const,
      [`tools.calls.${call.callId}.output`, call.output] as const
    ])
  ];

  for (const [field, evidence] of artifacts) {
    if (evidence.capture === "unavailable") continue;
    if (evidence.provenance === "unknown") {
      add(field, "Artifact provenance", "reduces_control", `${field} has content or identity evidence, but its provenance is unknown.`);
    } else if (
      evidence.provenance === "mapped" ||
      (evidence.provenance === "declared" && evidence.capture !== "absent")
    ) {
      add(field, "Observed artifact provenance", "prevents_exactness", `${field} was declared or reconstructed rather than observed directly.`);
    }
  }
}

function analyzeTools(manifest: ReplayRuntimeManifestV2, add: AddMissing) {
  const tools = manifest.tools;
  if (tools.replayMode === "not_used") return;
  if (tools.replayMode === "unknown") {
    add("tools.replayMode", "Tool replay mode", "reduces_control", "It is unknown whether tool calls must be executed or played back.");
    return;
  }
  if (tools.definitions.length === 0 || tools.definitions.some((tool) => !hasCapturedValue(tool.definition))) {
    add("tools.definitions", "Tool definitions", "reduces_control", "One or more tool definitions are missing or hash-only.");
  }
  const definitionNames = new Set(tools.definitions.map((tool) => tool.name));
  if (tools.calls.some((call) => !definitionNames.has(call.toolName))) {
    add("tools.definitions", "Tool definitions", "reduces_control", "At least one recorded tool call has no matching definition.");
  }
  if (tools.callsComplete !== true) {
    add("tools.calls", "Complete tool call ledger", "reduces_control", "The manifest does not attest a complete list of tool calls.");
  }
  if (tools.calls.some((call) => !isReconstructable(call.input))) {
    add("tools.inputs", "Tool call inputs", "reduces_control", "One or more tool inputs cannot be reconstructed.");
  }
  if (tools.replayMode === "recorded_outputs" && tools.calls.some((call) => !isReconstructable(call.output))) {
    add("tools.outputs", "Recorded tool outputs", "reduces_control", "Recorded-output replay requires every tool output value.");
  }
  if (tools.replayMode === "execute") {
    if (tools.calls.some((call) => !isKnown(call.output))) {
      add("tools.outputs", "Tool output evidence", "prevents_exactness", "Executed tools lack complete output evidence for comparison.");
    }
    if (tools.determinism !== "guaranteed") {
      add("tools.determinism", "Tool determinism attestation", "prevents_exactness", "Re-executed tools are not explicitly guaranteed deterministic.");
    }
  }
}

function analyzeRetrieval(manifest: ReplayRuntimeManifestV2, add: AddMissing) {
  const retrieval = manifest.retrieval;
  if (retrieval.replayMode === "not_used") return;
  if (retrieval.replayMode === "unknown") {
    add("retrieval.replayMode", "Retrieval replay mode", "reduces_control", "It is unknown whether retrieval must be rerun or played back.");
    return;
  }
  if (!hasCapturedValue(retrieval.configuration)) {
    add("retrieval.configuration", "Retrieval configuration", "reduces_control", "Retrieval settings are missing or hash-only.");
  }
  if (!retrieval.corpus?.version && !retrieval.corpus?.hash) {
    add("retrieval.corpus", "Corpus identity", "reduces_control", "No retrieval corpus version or content hash was recorded.");
  }
  if (retrieval.replayMode === "recorded_outputs" && !isReconstructable(retrieval.output)) {
    add("retrieval.output", "Recorded retrieval output", "reduces_control", "Recorded-output replay requires the retrieved candidates and scores.");
  }
  if (retrieval.replayMode === "rerun") {
    if (!isKnown(retrieval.output)) {
      add("retrieval.output", "Retrieval output evidence", "prevents_exactness", "The original retrieval output is unavailable for comparison.");
    }
    if (retrieval.determinism !== "guaranteed") {
      add("retrieval.determinism", "Retrieval determinism attestation", "prevents_exactness", "Rerun retrieval is not explicitly guaranteed deterministic.");
    }
  }
}

function analyzeSideEffects(manifest: ReplayRuntimeManifestV2, add: AddMissing) {
  const effects = manifest.sideEffects;
  const channels = [effects.network, effects.filesystem, effects.externalServices];
  if (effects.isolation === "live" || channels.includes("live")) {
    add("sideEffects.isolation", "Side-effect isolation", "blocks_replay", "Live side effects cannot be replayed safely or treated as controlled evidence.");
    return;
  }
  if (effects.isolation === "unknown" || channels.includes("unknown")) {
    add("sideEffects.isolation", "Side-effect isolation", "reduces_control", "One or more side-effect boundaries have unknown isolation.");
  }
}

function isReconstructable(evidence: ReplayArtifactEvidence) {
  return evidence.capture === "value" || evidence.capture === "absent";
}

function hasCapturedValue(evidence: ReplayArtifactEvidence) {
  return evidence.capture === "value";
}

function isKnown(evidence: ReplayArtifactEvidence) {
  return evidence.capture !== "unavailable" && evidence.provenance !== "unknown";
}

function hashReason(evidence: ReplayArtifactEvidence, subject: string) {
  return evidence.capture === "hash"
    ? `${subject} is hash-only; a digest can verify supplied content but cannot reconstruct it.`
    : `${subject} was not captured as a reconstructable value.`;
}

function hasHashOnlyEvidence(manifest: ReplayRuntimeManifestV2) {
  return [
    manifest.prompts.input,
    manifest.prompts.system,
    manifest.prompts.developer,
    manifest.model.parameters,
    manifest.model.seed,
    manifest.retrieval.configuration,
    manifest.retrieval.output,
    ...manifest.tools.definitions.map((tool) => tool.definition),
    ...manifest.tools.calls.flatMap((call) => [call.input, call.output])
  ].some((evidence) => evidence.capture === "hash");
}

function summaryFor(level: ReplayFidelityLevel) {
  switch (level) {
    case "exact":
      return "The manifest records reconstructable inputs, controlled boundaries, and explicit determinism attestations.";
    case "controlled":
      return "The runtime can be recreated under controlled inputs, but output identity is not guaranteed.";
    case "partial":
      return "A replay can be attempted, but missing runtime evidence leaves uncontrolled differences.";
    case "unreplayable":
      return "Critical inputs are missing or live side effects make a safe, evidence-backed replay unavailable.";
  }
}
