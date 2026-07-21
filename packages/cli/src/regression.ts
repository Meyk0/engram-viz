import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyMemoryRegressionPerturbationsV2,
  evaluateMemoryRegressionMatrixV2,
  memoryRegressionObservationFromRunV2,
  parseMemoryExecutorReplayResult,
  parseMemoryRegressionArtifactV2,
  parseMemoryRegressionMatrixObservationsV2,
  parseMemoryRegressionObservationV2,
  type MemoryRegressionArtifactV2,
  type MemoryRegressionMatrixReportV2,
  type MemoryRegressionObservationV2,
  type MemoryAnswerAssertion,
  type MemoryDecisionRunV3,
  type MemoryInterventionV2,
  type MemoryReplayExecutor,
  type MemoryRegressionPerturbationV2
} from "@engramviz/core";

type RegressionArtifact = {
  kind: "engram.memory-regression";
  version: 1;
  id: string;
  title: string;
  fixture: unknown;
  evidence: { caveat: string };
  assertions: {
    retrieval: {
      mustRetrieve: string[];
      mustNotRetrieve: string[];
      maxLoaded?: number;
    };
    answer: {
      contains: string[];
      notContains: string[];
    };
  };
};

export type CliRegressionObservation = {
  answer: string;
  retrievedMemoryIds: string[];
  loadedMemoryIds: string[];
};

export type CliRegressionFinding = {
  label: string;
  pass: boolean;
  category: "retrieval" | "context" | "answer" | "lifecycle" | "matrix";
  assertion: string;
  expected: unknown;
  observed: unknown;
  variantId?: string;
};

export type CliRegressionReport = {
  artifact: { id: string; title: string; version?: 1 | 2 };
  pass: boolean;
  findings: CliRegressionFinding[];
  observation: CliRegressionObservation | readonly MemoryRegressionObservationV2[];
  caveat: string;
  matrix?: MemoryRegressionMatrixReportV2;
};

export type CliRegressionFormat = "pretty" | "json" | "github";

export async function runRegressionFile(
  artifactFile: string,
  options: {
    cwd?: string;
    executorFile?: string;
    observationFile?: string;
  }
): Promise<CliRegressionReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (Boolean(options.executorFile) === Boolean(options.observationFile)) {
    throw new Error("Choose exactly one regression input: --executor <module> or --observation <json>.");
  }

  const rawArtifact = await readJson(path.resolve(cwd, artifactFile), "regression artifact");
  if (isV2Artifact(rawArtifact)) {
    return runRegressionV2(rawArtifact, {
      cwd,
      executorFile: options.executorFile,
      observationFile: options.observationFile
    });
  }
  if (!isV1Artifact(rawArtifact)) {
    throw new Error(
      "Unsupported regression artifact. Expected engram.memory-regression version 1 or 2."
    );
  }

  const artifact = parseArtifact(rawArtifact);

  const rawObservation = options.observationFile
    ? await readJson(path.resolve(cwd, options.observationFile), "regression observation")
    : await executeModule(path.resolve(cwd, options.executorFile!), artifact.fixture);
  const observation = parseObservation(rawObservation);
  const findings = evaluate(artifact, observation);

  return {
    artifact: { id: artifact.id, title: artifact.title },
    pass: findings.every((finding) => finding.pass),
    findings,
    observation,
    caveat: artifact.evidence.caveat
  };
}

export function formatRegressionReport(
  report: CliRegressionReport,
  format: CliRegressionFormat = "pretty"
) {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (report.matrix) {
    return format === "github"
      ? formatGitHubMatrixReport(report)
      : formatPrettyMatrixReport(report);
  }
  if (format === "github") return formatGitHubReport(report);
  return formatPrettyReport(report);
}

async function runRegressionV2(
  artifactInput: unknown,
  options: {
    cwd: string;
    executorFile?: string;
    observationFile?: string;
  }
): Promise<CliRegressionReport> {
  let artifact: MemoryRegressionArtifactV2;
  try {
    artifact = parseMemoryRegressionArtifactV2(artifactInput);
  } catch (error) {
    throw new Error(`Invalid Memory Regression v2 artifact: ${errorMessage(error)}`);
  }

  let observations: readonly MemoryRegressionObservationV2[];
  if (options.observationFile) {
    const raw = await readJson(
      path.resolve(options.cwd, options.observationFile),
      "Memory Regression v2 observations"
    );
    try {
      observations = parseMemoryRegressionMatrixObservationsV2(raw);
    } catch (error) {
      throw new Error(`Invalid Memory Regression v2 observation matrix: ${errorMessage(error)}`);
    }
  } else {
    observations = await executeMatrixModule(
      path.resolve(options.cwd, options.executorFile!),
      artifact
    );
  }

  let matrix: MemoryRegressionMatrixReportV2;
  try {
    matrix = evaluateMemoryRegressionMatrixV2(artifact, observations);
  } catch (error) {
    throw new Error(`Could not evaluate Memory Regression v2: ${errorMessage(error)}`);
  }

  const findings = matrix.variants.flatMap<CliRegressionFinding>((variant) => {
    if (variant.status === "missing") {
      return [{
        label: `missing observation for variant "${variant.label}"`,
        pass: false,
        category: "matrix" as const,
        assertion: "variantPresent",
        expected: variant.id,
        observed: null,
        variantId: variant.id
      }];
    }
    return variant.findings.map((finding) => ({
      label: finding.message,
      pass: finding.pass,
      category: finding.category,
      assertion: finding.assertion,
      expected: finding.expected,
      observed: finding.observed,
      variantId: variant.id
    }));
  });

  return {
    artifact: { id: artifact.id, title: artifact.title, version: 2 },
    pass: matrix.pass,
    findings,
    observation: observations,
    caveat: artifact.sourceReplay.fidelity.caveats.join(" "),
    matrix
  };
}

async function executeModule(file: string, fixture: unknown): Promise<unknown> {
  const imported = await import(/* @vite-ignore */ pathToFileURL(file).href);
  const executor = imported.default ?? imported.run;
  if (typeof executor !== "function") {
    throw new Error("Regression executor must export a default function or a function named run.");
  }
  return executor(structuredClone(fixture));
}

async function executeMatrixModule(
  file: string,
  artifact: MemoryRegressionArtifactV2
): Promise<readonly MemoryRegressionObservationV2[]> {
  const imported = await import(/* @vite-ignore */ pathToFileURL(file).href);
  const executor = imported.executor ?? imported.default ?? imported.run;
  if (isMemoryReplayExecutor(executor)) {
    return executeReplayMatrix(executor, artifact);
  }
  if (typeof executor !== "function") {
    throw new Error("Regression executor must export a MemoryReplayExecutor or a default/run function.");
  }

  const observations: MemoryRegressionObservationV2[] = [];
  for (const variant of artifact.matrix.variants) {
    const source = applyMemoryRegressionPerturbationsV2(
      artifact.sourceReplay.result.source as MemoryDecisionRunV3,
      variant.id,
      variant.perturbations
    );
    let raw: unknown;
    try {
      raw = await executor({
        artifact: structuredClone(artifact),
        variant: structuredClone(variant),
        source
      });
    } catch (error) {
      throw new Error(
        `Memory Regression v2 executor failed for variant "${variant.id}": ${errorMessage(error)}`
      );
    }
    let observation: MemoryRegressionObservationV2;
    try {
      observation = parseMemoryRegressionObservationV2(raw);
    } catch (error) {
      throw new Error(
        `Memory Regression v2 executor returned an invalid observation for variant "${variant.id}": ${errorMessage(error)}`
      );
    }
    if (observation.variantId !== variant.id) {
      throw new Error(
        `Memory Regression v2 executor returned variant "${observation.variantId}" while running "${variant.id}".`
      );
    }
    observations.push(observation);
  }
  return observations;
}

async function executeReplayMatrix(
  executor: MemoryReplayExecutor,
  artifact: MemoryRegressionArtifactV2
) {
  const sourceReplay = artifact.sourceReplay.result;
  if (executor.manifest.id !== sourceReplay.executor.id
    || executor.manifest.executorVersion !== sourceReplay.executor.version) {
    throw new Error(
      `Regression executor ${executor.manifest.id}@${executor.manifest.executorVersion} does not match `
      + `${sourceReplay.executor.id}@${sourceReplay.executor.version}.`
    );
  }
  const observations: MemoryRegressionObservationV2[] = [];
  for (const variant of artifact.matrix.variants) {
    const source = applyMemoryRegressionPerturbationsV2(
      sourceReplay.source as MemoryDecisionRunV3,
      variant.id,
      variant.perturbations
    );
    const sourceIntervention = sourceReplay.intervention as MemoryInterventionV2;
    const intervention: MemoryInterventionV2 = {
      ...structuredClone(sourceIntervention),
      id: `${sourceReplay.intervention.id}-${variant.id}`,
      targetRunId: source.id,
      createdAt: source.completedAt
    };
    const replay = parseMemoryExecutorReplayResult(await executor.replay({
      baseline: source,
      intervention,
      ...(sourceReplay.verification.assertion ? {
        answerAssertion: transformAnswerAssertion(
          sourceReplay.verification.assertion,
          variant.perturbations
        )
      } : {})
    }, { sideEffectMode: executor.manifest.sideEffects.defaultMode }));
    if (!replay.reproduction.reproduced) {
      throw new Error(
        `Memory Regression v2 executor did not reproduce variant "${variant.id}": `
        + replay.verification.failures.join(" ")
      );
    }
    observations.push(memoryRegressionObservationFromRunV2(variant.id, replay.treatment));
  }
  return observations;
}

function transformAnswerAssertion(
  assertion: MemoryAnswerAssertion,
  perturbations: readonly MemoryRegressionPerturbationV2[]
): MemoryAnswerAssertion {
  const result = structuredClone(assertion);
  for (const perturbation of perturbations) {
    if (perturbation.type !== "entity_substitution") continue;
    if (result.type === "exact") {
      result.value = replaceText(result.value, perturbation.from, perturbation.to);
    } else {
      result.values = result.values.map((value) => replaceText(value, perturbation.from, perturbation.to));
      result.forbidden = result.forbidden?.map((value) => replaceText(value, perturbation.from, perturbation.to));
    }
  }
  return result;
}

function replaceText(value: string, from: string, to: string) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), to);
}

function isMemoryReplayExecutor(value: unknown): value is MemoryReplayExecutor {
  return isRecord(value)
    && isRecord(value.manifest)
    && typeof value.replay === "function";
}

function evaluate(artifact: RegressionArtifact, observation: CliRegressionObservation) {
  const retrieved = new Set(observation.retrievedMemoryIds);
  const answer = observation.answer.toLocaleLowerCase();
  const findings: CliRegressionFinding[] = [];

  artifact.assertions.retrieval.mustRetrieve.forEach((id) => findings.push({
    label: `retrieved required memory "${id}"`,
    pass: retrieved.has(id),
    category: "retrieval",
    assertion: "mustRetrieve",
    expected: id,
    observed: observation.retrievedMemoryIds
  }));
  artifact.assertions.retrieval.mustNotRetrieve.forEach((id) => findings.push({
    label: `did not retrieve forbidden memory "${id}"`,
    pass: !retrieved.has(id),
    category: "retrieval",
    assertion: "mustNotRetrieve",
    expected: id,
    observed: observation.retrievedMemoryIds
  }));
  if (artifact.assertions.retrieval.maxLoaded !== undefined) {
    findings.push({
      label: `loaded at most ${artifact.assertions.retrieval.maxLoaded} memories`,
      pass: observation.loadedMemoryIds.length <= artifact.assertions.retrieval.maxLoaded,
      category: "context",
      assertion: "maxLoaded",
      expected: artifact.assertions.retrieval.maxLoaded,
      observed: observation.loadedMemoryIds.length
    });
  }
  artifact.assertions.answer.contains.forEach((text) => findings.push({
    label: `answer contains "${text}"`,
    pass: answer.includes(text.toLocaleLowerCase()),
    category: "answer",
    assertion: "contains",
    expected: text,
    observed: observation.answer
  }));
  artifact.assertions.answer.notContains.forEach((text) => findings.push({
    label: `answer omits "${text}"`,
    pass: !answer.includes(text.toLocaleLowerCase()),
    category: "answer",
    assertion: "notContains",
    expected: text,
    observed: observation.answer
  }));

  return findings;
}

function formatPrettyReport(report: CliRegressionReport) {
  const lines = [`${report.pass ? "PASS" : "FAIL"}  ${report.artifact.title}`];
  report.findings.forEach((finding) => {
    lines.push(`${finding.pass ? "PASS" : "FAIL"}  [${finding.category}.${finding.assertion}] ${finding.label}`);
    if (!finding.pass) {
      lines.push(`      expected: ${formatValue(finding.expected)}`);
      lines.push(`      observed: ${formatValue(finding.observed)}`);
    }
  });
  const passed = report.findings.filter((finding) => finding.pass).length;
  lines.push(`Summary: ${passed}/${report.findings.length} assertions passed`);
  lines.push(`Evidence limit: ${report.caveat}`);
  return `${lines.join("\n")}\n`;
}

function formatGitHubReport(report: CliRegressionReport) {
  const lines = [`${report.pass ? "PASS" : "FAIL"}  ${report.artifact.title}`];
  report.findings.filter((finding) => !finding.pass).forEach((finding) => {
    const title = githubEscape(`Engram ${finding.category}.${finding.assertion}`, true);
    const message = githubEscape(
      `${finding.label}. Expected ${formatValue(finding.expected)}; observed ${formatValue(finding.observed)}.`,
      false
    );
    lines.push(`::error title=${title}::${message}`);
  });
  const passed = report.findings.filter((finding) => finding.pass).length;
  lines.push(`Summary: ${passed}/${report.findings.length} assertions passed`);
  lines.push(`Evidence limit: ${report.caveat}`);
  return `${lines.join("\n")}\n`;
}

function formatPrettyMatrixReport(report: CliRegressionReport) {
  const matrix = report.matrix!;
  const lines = [`${report.pass ? "PASS" : "FAIL"}  ${report.artifact.title} (Memory Regression v2)`];
  matrix.variants.forEach((variant) => {
    const status = variant.status === "missing" ? "MISSING" : variant.pass ? "PASS" : "FAIL";
    lines.push(`${status}  [variant.${variant.id}] ${variant.label}`);
    variant.findings.forEach((finding) => {
      lines.push(`  ${finding.pass ? "PASS" : "FAIL"}  [${finding.category}.${finding.assertion}] ${finding.message}`);
      if (!finding.pass) {
        lines.push(`        expected: ${formatValue(finding.expected)}`);
        lines.push(`        observed: ${formatValue(finding.observed)}`);
      }
    });
    if (variant.status === "missing") {
      lines.push("        expected: one observation for this matrix variant");
      lines.push("        observed: no observation");
    }
  });
  lines.push(
    `Summary: ${matrix.summary.variants.passed}/${matrix.summary.variants.total} variants passed; `
      + `${matrix.summary.findings.passed}/${matrix.summary.findings.total} assertions passed`
  );
  lines.push(`Evidence limit: ${report.caveat}`);
  return `${lines.join("\n")}\n`;
}

function formatGitHubMatrixReport(report: CliRegressionReport) {
  const matrix = report.matrix!;
  const lines = [`${report.pass ? "PASS" : "FAIL"}  ${report.artifact.title} (Memory Regression v2)`];
  matrix.variants.forEach((variant) => {
    if (variant.status === "missing") {
      lines.push(
        `::error title=${githubEscape(`Engram variant ${variant.id}`, true)}::`
          + githubEscape(`Missing observation for matrix variant "${variant.label}".`, false)
      );
      return;
    }
    variant.findings.filter((finding) => !finding.pass).forEach((finding) => {
      const title = githubEscape(
        `Engram ${variant.id} ${finding.category}.${finding.assertion}`,
        true
      );
      const message = githubEscape(
        `${finding.message} Expected ${formatValue(finding.expected)}; observed ${formatValue(finding.observed)}.`,
        false
      );
      lines.push(`::error title=${title}::${message}`);
    });
  });
  lines.push(
    `Summary: ${matrix.summary.variants.passed}/${matrix.summary.variants.total} variants passed; `
      + `${matrix.summary.findings.passed}/${matrix.summary.findings.total} assertions passed`
  );
  lines.push(`Evidence limit: ${report.caveat}`);
  return `${lines.join("\n")}\n`;
}

function formatValue(value: unknown) {
  return JSON.stringify(value);
}

function githubEscape(value: string, property: boolean) {
  const escaped = value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return property ? escaped.replaceAll(":", "%3A").replaceAll(",", "%2C") : escaped;
}

function parseArtifact(value: unknown): RegressionArtifact {
  if (!isRecord(value) || value.kind !== "engram.memory-regression" || value.version !== 1) {
    throw new Error("Regression artifact must use the engram.memory-regression v1 format.");
  }
  if (typeof value.id !== "string" || !value.id.trim() || typeof value.title !== "string" || !value.title.trim()) {
    throw new Error("Regression artifact must include an id and title.");
  }
  if (!isRecord(value.assertions) || !isRecord(value.assertions.retrieval) || !isRecord(value.assertions.answer)) {
    throw new Error("Regression artifact is missing retrieval or answer assertions.");
  }
  if (!isRecord(value.evidence) || typeof value.evidence.caveat !== "string" || !value.evidence.caveat.trim()) {
    throw new Error("Regression artifact must retain its evidence caveat.");
  }

  const maxLoaded = value.assertions.retrieval.maxLoaded;
  if (maxLoaded !== undefined && (!Number.isInteger(maxLoaded) || (maxLoaded as number) < 0)) {
    throw new Error("Regression maxLoaded must be a non-negative integer.");
  }

  return {
    kind: value.kind,
    version: value.version,
    id: value.id,
    title: value.title,
    fixture: value.fixture,
    evidence: { caveat: value.evidence.caveat },
    assertions: {
      retrieval: {
        mustRetrieve: stringArray(value.assertions.retrieval.mustRetrieve, "mustRetrieve"),
        mustNotRetrieve: stringArray(value.assertions.retrieval.mustNotRetrieve, "mustNotRetrieve"),
        ...(typeof maxLoaded === "number" ? { maxLoaded } : {})
      },
      answer: {
        contains: stringArray(value.assertions.answer.contains, "contains"),
        notContains: stringArray(value.assertions.answer.notContains, "notContains")
      }
    }
  };
}

function isV1Artifact(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.kind === "engram.memory-regression" && value.version === 1;
}

function isV2Artifact(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.format === "engram.memory-regression" && value.version === 2;
}

function parseObservation(value: unknown): CliRegressionObservation {
  if (!isRecord(value) || typeof value.answer !== "string") {
    throw new Error("Regression observation must include an answer string.");
  }
  return {
    answer: value.answer,
    retrievedMemoryIds: stringArray(value.retrievedMemoryIds, "retrievedMemoryIds"),
    loadedMemoryIds: stringArray(value.loadedMemoryIds, "loadedMemoryIds")
  };
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return [...new Set(value as string[])];
}

async function readJson(file: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Could not read ${label} at ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
