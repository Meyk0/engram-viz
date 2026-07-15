import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
};

export type CliRegressionReport = {
  artifact: { id: string; title: string };
  pass: boolean;
  findings: CliRegressionFinding[];
  caveat: string;
};

export async function runRegressionFile(
  artifactFile: string,
  options: {
    cwd?: string;
    executorFile?: string;
    observationFile?: string;
  }
): Promise<CliRegressionReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const artifact = parseArtifact(await readJson(path.resolve(cwd, artifactFile), "regression artifact"));
  if (Boolean(options.executorFile) === Boolean(options.observationFile)) {
    throw new Error("Choose exactly one regression input: --executor <module> or --observation <json>.");
  }

  const rawObservation = options.observationFile
    ? await readJson(path.resolve(cwd, options.observationFile), "regression observation")
    : await executeModule(path.resolve(cwd, options.executorFile!), artifact.fixture);
  const observation = parseObservation(rawObservation);
  const findings = evaluate(artifact, observation);

  return {
    artifact: { id: artifact.id, title: artifact.title },
    pass: findings.every((finding) => finding.pass),
    findings,
    caveat: artifact.evidence.caveat
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

function evaluate(artifact: RegressionArtifact, observation: CliRegressionObservation) {
  const retrieved = new Set(observation.retrievedMemoryIds);
  const answer = observation.answer.toLocaleLowerCase();
  const findings: CliRegressionFinding[] = [];

  artifact.assertions.retrieval.mustRetrieve.forEach((id) => findings.push({
    label: `retrieved required memory "${id}"`,
    pass: retrieved.has(id)
  }));
  artifact.assertions.retrieval.mustNotRetrieve.forEach((id) => findings.push({
    label: `did not retrieve forbidden memory "${id}"`,
    pass: !retrieved.has(id)
  }));
  if (artifact.assertions.retrieval.maxLoaded !== undefined) {
    findings.push({
      label: `loaded at most ${artifact.assertions.retrieval.maxLoaded} memories`,
      pass: observation.loadedMemoryIds.length <= artifact.assertions.retrieval.maxLoaded
    });
  }
  artifact.assertions.answer.contains.forEach((text) => findings.push({
    label: `answer contains "${text}"`,
    pass: answer.includes(text.toLocaleLowerCase())
  }));
  artifact.assertions.answer.notContains.forEach((text) => findings.push({
    label: `answer omits "${text}"`,
    pass: !answer.includes(text.toLocaleLowerCase())
  }));

  return findings;
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
