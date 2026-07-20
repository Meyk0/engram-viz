import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { MemoryDecisionMemory } from "@engramviz/core";
import {
  deriveMemoryRegressionReplayFidelityV2,
  evaluateMemoryRegressionMatrixV2,
  parseMemoryRegressionArtifactV2,
  type MemoryRegressionArtifactV2,
  type MemoryRegressionObservationV2,
  type MemoryRegressionVariantV2
} from "../../../packages/core/src/regression-v2";
import {
  formatRegressionReport,
  runRegressionFile
} from "../../../packages/cli/src/regression";
import { createStaleLocationPolicyReplay } from "@/lib/reliability/stale-location";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const execFile = promisify(execFileCallback);

afterEach(async () => {
  await Promise.all(directories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true })
  ));
});

describe("portable Memory Regression v2", () => {
  it("exports a canonical package contract with semantic selector and negation-aware evaluation", () => {
    const artifact = regressionArtifact();
    const passing = observation("source", "Oakland", "You live in Oakland.");
    const failing = observation("source", "Oakland", "You do not live in Oakland.");

    expect(parseMemoryRegressionArtifactV2(artifact)).toEqual(artifact);
    expect(evaluateMemoryRegressionMatrixV2(artifact, [passing])).toMatchObject({
      pass: true,
      summary: { variants: { passed: 1, failed: 0, missing: 0 } }
    });
    const failed = evaluateMemoryRegressionMatrixV2(artifact, [failing]);
    expect(failed.pass).toBe(false);
    expect(failed.variants[0]?.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ assertion: "mustSelect", pass: true }),
      expect.objectContaining({ assertion: "contains", pass: false })
    ]));
  });

  it("transforms semantic selectors and answer assertions for entity variants", () => {
    const artifact = regressionArtifact([{
      id: "entity-lisbon",
      label: "Equivalent location with another entity",
      perturbations: [{
        type: "entity_substitution",
        target: currentLocationSelector("Oakland"),
        from: "Oakland",
        to: "Lisbon"
      }]
    }]);

    const report = evaluateMemoryRegressionMatrixV2(artifact, [
      observation("source", "Oakland", "You live in Oakland."),
      observation("entity-lisbon", "Lisbon", "You live in Lisbon.")
    ]);

    expect(report.pass).toBe(true);
    expect(report.summary.variants).toEqual({ total: 2, passed: 2, failed: 0, missing: 0 });
  });

  it("keeps exact answer assertions exact instead of weakening them to substring checks", () => {
    const input = structuredClone(regressionArtifact());
    input.assertions.answer = {
      match: "normalized-exact",
      equals: "You live in Oakland.",
      contains: [],
      notContains: []
    };
    const artifact = parseMemoryRegressionArtifactV2(input);

    expect(evaluateMemoryRegressionMatrixV2(artifact, [
      observation("source", "Oakland", "You live in Oakland")
    ]).pass).toBe(true);
    expect(evaluateMemoryRegressionMatrixV2(artifact, [
      observation("source", "Oakland", "I think you live in Oakland")
    ])).toMatchObject({
      pass: false,
      variants: [{
        findings: expect.arrayContaining([
          expect.objectContaining({ assertion: "equals", pass: false })
        ])
      }]
    });
  });

  it("marks absent matrix observations as missing instead of silently passing", () => {
    const artifact = regressionArtifact([{
      id: "paraphrase",
      label: "Paraphrased query",
      perturbations: [{ type: "query_paraphrase", query: "Which city is home now?" }]
    }]);

    const report = evaluateMemoryRegressionMatrixV2(artifact, [
      observation("source", "Oakland", "You live in Oakland.")
    ]);

    expect(report.pass).toBe(false);
    expect(report.summary.variants.missing).toBe(1);
    expect(report.variants[1]).toMatchObject({ id: "paraphrase", status: "missing", pass: false });
  });

  it("runs a project executor exactly once per v2 matrix variant with explicit input", async () => {
    const root = await temporaryDirectory();
    const artifact = regressionArtifact([
      {
        id: "paraphrase",
        label: "Paraphrased query",
        perturbations: [{ type: "query_paraphrase", query: "Where is home?" }]
      },
      {
        id: "entity-lisbon",
        label: "Entity substitution",
        perturbations: [{
          type: "entity_substitution",
          target: currentLocationSelector("Oakland"),
          from: "Oakland",
          to: "Lisbon"
        }]
      }
    ]);
    await writeFile(path.join(root, "regression.json"), JSON.stringify(artifact), "utf8");
    await writeFile(path.join(root, "executor.mjs"), `
      import { appendFile } from "node:fs/promises";
      export default async function execute(input) {
        await appendFile(new URL("./calls.jsonl", import.meta.url), JSON.stringify({
          artifactId: input.artifact.id,
          variantId: input.variant.id,
          perturbations: input.variant.perturbations.length,
          query: input.source.input
        }) + "\\n");
        const value = input.variant.id === "entity-lisbon" ? "Lisbon" : "Oakland";
        const id = "memory-" + input.variant.id;
        return {
          variantId: input.variant.id,
          memories: [{
            id,
            content: "User lives in " + value + ".",
            subject: "current_location",
            value,
            status: "active",
            tier: "semantic",
            scope: "user",
            evidence: "observed"
          }],
          selectedMemoryIds: [id],
          loadedMemoryIds: [id],
          answer: "You live in " + value + "."
        };
      }
    `, "utf8");

    const cli = path.join(process.cwd(), "packages", "cli", "bin", "engram.mjs");
    const { stdout } = await execFile(process.execPath, [
      cli,
      "test",
      "regression.json",
      "--executor",
      "executor.mjs"
    ], { cwd: root });
    const calls = (await readFile(path.join(root, "calls.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));

    expect(stdout).toContain("PASS  Prefer current location (Memory Regression v2)");
    expect(calls).toEqual([
      { artifactId: artifact.id, variantId: "source", perturbations: 0, query: "What city do I live in now?" },
      { artifactId: artifact.id, variantId: "paraphrase", perturbations: 1, query: "Where is home?" },
      { artifactId: artifact.id, variantId: "entity-lisbon", perturbations: 1, query: "What city do I live in now?" }
    ]);
  });

  it("accepts observation matrices and formats failed and missing variants honestly", async () => {
    const root = await temporaryDirectory();
    const artifact = regressionArtifact([
      {
        id: "near-tie",
        label: "Near score tie",
        perturbations: [{
          type: "score_margin",
          leader: currentLocationSelector("Oakland"),
          challenger: { subject: "current_location", valueContains: "San Francisco" },
          margin: 0.001
        }]
      },
      {
        id: "paraphrase",
        label: "Paraphrased query",
        perturbations: [{ type: "query_paraphrase", query: "Where is home?" }]
      }
    ]);
    await writeFile(path.join(root, "regression.json"), JSON.stringify(artifact), "utf8");
    await writeFile(path.join(root, "observations.json"), JSON.stringify([
      observation("source", "Oakland", "You live in Oakland."),
      observation("near-tie", "San Francisco", "You live in San Francisco.")
    ]), "utf8");

    const report = await runRegressionFile("regression.json", {
      cwd: root,
      observationFile: "observations.json"
    });
    const pretty = formatRegressionReport(report);
    const github = formatRegressionReport(report, "github");
    const json = JSON.parse(formatRegressionReport(report, "json"));

    expect(report.pass).toBe(false);
    expect(pretty).toContain("FAIL  Prefer current location (Memory Regression v2)");
    expect(pretty).toContain("FAIL  [variant.near-tie] Near score tie");
    expect(pretty).toContain("MISSING  [variant.paraphrase] Paraphrased query");
    expect(github).toContain("::error title=Engram near-tie lifecycle.mustSelect::");
    expect(github).toContain("::error title=Engram variant paraphrase::Missing observation");
    expect(json.matrix.summary.variants).toEqual({ total: 3, passed: 1, failed: 2, missing: 1 });
  });
});

function regressionArtifact(
  variants: readonly MemoryRegressionVariantV2[] = []
): MemoryRegressionArtifactV2 {
  const replay = createStaleLocationPolicyReplay();
  return parseMemoryRegressionArtifactV2({
    format: "engram.memory-regression",
    version: 2,
    id: "prefer-current-location-v2",
    title: "Prefer current location",
    createdAt: "2026-07-20T12:00:00.000Z",
    sourceReplay: {
      result: replay,
      fidelity: deriveMemoryRegressionReplayFidelityV2(replay)
    },
    assertions: {
      lifecycle: {
        mustSelect: [currentLocationSelector("Oakland")],
        mustNotSelect: [{
          subject: "current_location",
          status: "superseded",
          valueContains: "San Francisco"
        }],
        mustLoad: [currentLocationSelector("Oakland")],
        mustNotLoad: []
      },
      answer: {
        match: "normalized-phrase-with-negation-guard",
        contains: ["Oakland"],
        notContains: ["San Francisco"]
      }
    },
    matrix: {
      aggregation: "all-variants",
      variants: [
        { id: "source", label: "Source replay", perturbations: [] },
        ...variants
      ]
    }
  });
}

function observation(
  variantId: string,
  value: string,
  answer: string
): MemoryRegressionObservationV2 {
  const current = decisionMemory(`memory-${variantId}`, value);
  return {
    variantId,
    memories: [current],
    selectedMemoryIds: [current.id],
    loadedMemoryIds: [current.id],
    forcedMemoryIds: [],
    answer
  };
}

function decisionMemory(id: string, value: string): MemoryDecisionMemory {
  return {
    id,
    content: `User lives in ${value}.`,
    subject: "current_location",
    value,
    status: "active",
    tier: "semantic",
    scope: "user",
    evidence: "observed"
  };
}

function currentLocationSelector(value: string) {
  return {
    subject: "current_location",
    status: "active" as const,
    valueContains: value
  };
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "engram-v2-cli-"));
  directories.push(directory);
  return directory;
}
