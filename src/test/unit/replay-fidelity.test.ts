import { describe, expect, it } from "vitest";
import {
  analyzeReplayFidelity,
  parseReplayRuntimeManifestV2,
  type ReplayArtifactEvidence,
  type ReplayJsonValue,
  type ReplayRuntimeManifestV2
} from "@/lib/evidence/replay-fidelity";

const HASH = "a".repeat(64);

describe("replay fidelity v2", () => {
  it("classifies only a fully attested runtime as exact", () => {
    const report = analyzeReplayFidelity(exactManifest());

    expect(report).toEqual({
      manifestId: "runtime-exact",
      level: "exact",
      deterministic: true,
      summary: "The manifest records reconstructable inputs, controlled boundaries, and explicit determinism attestations.",
      missingEvidence: [],
      caveats: []
    });
  });

  it("keeps a reconstructable seeded run controlled without a determinism guarantee", () => {
    const manifest = exactManifest();
    manifest.model.determinism = "best_effort";

    const report = analyzeReplayFidelity(manifest);

    expect(report.level).toBe("controlled");
    expect(report.deterministic).toBe(false);
    expect(report.missingEvidence).toContainEqual(expect.objectContaining({
      field: "model.determinism",
      impact: "prevents_exactness"
    }));
    expect(report.caveats).toContain("A recorded seed improves control but is not, by itself, a determinism guarantee.");
  });

  it("treats a hash-only model input as unreplayable content", () => {
    const manifest = exactManifest();
    manifest.prompts.input = hashEvidence();

    const report = analyzeReplayFidelity(manifest);

    expect(report.level).toBe("unreplayable");
    expect(report.missingEvidence).toContainEqual(expect.objectContaining({
      field: "prompts.input",
      impact: "blocks_replay",
      reason: expect.stringContaining("cannot reconstruct")
    }));
    expect(report.caveats).toContain("Hashes can verify supplied artifacts but cannot reconstruct the hashed content.");
  });

  it("reports tool, retrieval, environment, and provenance gaps without inventing control", () => {
    const manifest = exactManifest();
    manifest.source.provenance = "mapped";
    manifest.source.captureMethod = "adapter";
    manifest.environment.dependencyLockHash = undefined;
    manifest.tools = {
      replayMode: "recorded_outputs",
      definitions: [{ name: "lookup", definition: hashEvidence() }],
      calls: [{
        callId: "call-1",
        toolName: "lookup",
        input: valueEvidence({ query: "indigo" }),
        output: unavailableEvidence("Provider omitted the output.")
      }],
      callsComplete: "unknown",
      determinism: "unknown"
    };
    manifest.retrieval = {
      replayMode: "recorded_outputs",
      configuration: hashEvidence(),
      output: unavailableEvidence("Candidate list was not exported."),
      determinism: "unknown"
    };

    const report = analyzeReplayFidelity(manifest);
    const fields = report.missingEvidence.map((item) => item.field);

    expect(report.level).toBe("partial");
    expect(fields).toEqual(expect.arrayContaining([
      "source.provenance",
      "environment.dependencyLockHash",
      "tools.definitions",
      "tools.calls",
      "tools.outputs",
      "retrieval.configuration",
      "retrieval.corpus",
      "retrieval.output"
    ]));
  });

  it("blocks replay when any declared boundary still performs live side effects", () => {
    const manifest = exactManifest();
    manifest.sideEffects.network = "live";

    const report = analyzeReplayFidelity(manifest);

    expect(report.level).toBe("unreplayable");
    expect(report.missingEvidence).toContainEqual(expect.objectContaining({
      field: "sideEffects.isolation",
      impact: "blocks_replay"
    }));
  });

  it("requires explicit seed evidence even when determinism is claimed", () => {
    const manifest = exactManifest();
    manifest.model.seed = unavailableEvidence("The provider did not return it.");

    const report = analyzeReplayFidelity(manifest);

    expect(report.level).toBe("controlled");
    expect(report.deterministic).toBe(false);
    expect(report.missingEvidence).toContainEqual(expect.objectContaining({ field: "model.seed" }));
  });

  it("does not treat a seed hash as a usable random seed", () => {
    const manifest = exactManifest();
    manifest.model.seed = hashEvidence();

    const report = analyzeReplayFidelity(manifest);
    expect(report.level).toBe("controlled");
    expect(report.missingEvidence).toContainEqual(expect.objectContaining({
      field: "model.seed",
      impact: "prevents_exactness"
    }));
  });

  it("accepts an explicit absent seed when the runtime attests it is not applicable", () => {
    const manifest = exactManifest();
    manifest.model.seed = absentEvidence("The deterministic runtime has no sampling seed.");

    expect(analyzeReplayFidelity(manifest).level).toBe("exact");
  });

  it("does not promote mapped or unknown artifact evidence to exact replay", () => {
    const mapped = exactManifest();
    mapped.model.parameters = {
      ...valueEvidence({ temperature: 0 }),
      provenance: "mapped"
    };
    const unknown = exactManifest();
    unknown.prompts.system = {
      ...valueEvidence("Answer from memory evidence."),
      provenance: "unknown"
    };

    expect(analyzeReplayFidelity(mapped)).toMatchObject({ level: "controlled", deterministic: false });
    expect(analyzeReplayFidelity(unknown)).toMatchObject({ level: "partial", deterministic: false });
  });

  it("reports a called tool whose definition is absent", () => {
    const manifest = exactManifest();
    manifest.tools = {
      replayMode: "recorded_outputs",
      definitions: [{ name: "search", definition: valueEvidence({ type: "function" }) }],
      calls: [{
        callId: "call-1",
        toolName: "weather",
        input: valueEvidence({ city: "Oakland" }),
        output: valueEvidence({ temperature: 18 })
      }],
      callsComplete: true,
      determinism: "unknown"
    };

    const report = analyzeReplayFidelity(manifest);
    expect(report.level).toBe("partial");
    expect(report.missingEvidence).toContainEqual(expect.objectContaining({
      field: "tools.definitions",
      reason: expect.stringContaining("no matching definition")
    }));
  });

  it("validates strict versioned manifests and returns deterministic reports", () => {
    const manifest = exactManifest();
    const first = analyzeReplayFidelity(manifest);
    const second = analyzeReplayFidelity(structuredClone(manifest));

    expect(first).toEqual(second);
    expect(parseReplayRuntimeManifestV2(manifest).version).toBe(2);
    expect(() => parseReplayRuntimeManifestV2({ ...manifest, version: 1 })).toThrow();
    expect(() => parseReplayRuntimeManifestV2({ ...manifest, hiddenInference: true })).toThrow();
  });
});

function exactManifest(): ReplayRuntimeManifestV2 {
  return {
    format: "engram.replay-runtime",
    version: 2,
    id: "runtime-exact",
    capturedAt: "2026-07-14T12:00:00.000Z",
    source: {
      traceId: "trace-1",
      spanId: "span-model-1",
      provider: "openai",
      format: "responses",
      provenance: "observed",
      captureMethod: "native",
      sourceHash: HASH
    },
    prompts: {
      input: valueEvidence([
        { role: "system", content: "Answer from memory evidence." },
        { role: "user", content: "What color do I love?" }
      ]),
      system: valueEvidence("Answer from memory evidence."),
      developer: absentEvidence("No developer instruction was supplied.")
    },
    model: {
      provider: "openai",
      name: "gpt-test",
      parameters: valueEvidence({ temperature: 0, top_p: 1 }),
      seed: valueEvidence(42),
      determinism: "guaranteed"
    },
    tools: {
      replayMode: "not_used",
      definitions: [],
      calls: [],
      callsComplete: true,
      determinism: "guaranteed"
    },
    retrieval: {
      replayMode: "recorded_outputs",
      configuration: valueEvidence({ topK: 4, metric: "cosine" }),
      corpus: { version: "memory-snapshot-17", hash: HASH },
      output: valueEvidence({ candidates: [{ id: "memory-indigo", score: 0.94 }] }),
      determinism: "guaranteed"
    },
    environment: {
      codeVersion: "git:abc1234",
      runtime: { name: "node", version: "24.1.0" },
      dependencyLockHash: HASH,
      configurationHash: HASH,
      containerImageDigest: "sha256:container"
    },
    sideEffects: {
      isolation: "recorded_and_stubbed",
      network: "recorded_and_stubbed",
      filesystem: "sandboxed",
      externalServices: "recorded_and_stubbed"
    }
  };
}

function valueEvidence(value: ReplayJsonValue): ReplayArtifactEvidence {
  return { capture: "value", value, provenance: "observed" };
}

function hashEvidence(): ReplayArtifactEvidence {
  return { capture: "hash", algorithm: "sha256", sha256: HASH, provenance: "observed" };
}

function absentEvidence(reason: string): ReplayArtifactEvidence {
  return { capture: "absent", reason, provenance: "observed" };
}

function unavailableEvidence(reason: string): ReplayArtifactEvidence {
  return { capture: "unavailable", reason, provenance: "unknown" };
}
