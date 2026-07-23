import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeEngramProject,
  localAgentEnvironment,
  localStudioEnvironment,
  readEngramConfig
} from "../../../packages/cli/src/config";
import { formatShellEnvironment } from "../../../packages/cli/src/environment";
import { importCaptureBundle } from "../../../packages/cli/src/import";
import {
  createStaleLocationCapture,
  seedStaleLocationDemo,
  selectDemoStudio
} from "../../../packages/cli/src/demo";
import {
  formatRegressionReport,
  runRegressionFile
} from "../../../packages/cli/src/regression";
import { startMemoryExecutorServer } from "../../../packages/cli/src/executor";
import {
  discoverRegressionArtifacts,
  readEngramProjectConfig
} from "../../../packages/cli/src/project-config";
import { scaffoldLangGraphProject } from "../../../packages/cli/src/scaffold";
import {
  inspectEngramProject,
  projectNextSteps,
  projectSetupLines
} from "../../../packages/cli/src/project";
import {
  parseAgentTurnEnvelope,
  parseMemoryTelemetryEvent
} from "../../../packages/core/src/schema";
import { createStaleLocationPolicyReplay } from "@/lib/reliability/stale-location";

const directories: string[] = [];
const execFile = promisify(execFileCallback);

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("@engramviz/cli", () => {
  it("initializes an idempotent, git-ignored local project", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, ".gitignore"), "node_modules\n", "utf8");
    const first = await initializeEngramProject(root, "Location Agent");
    const second = await initializeEngramProject(root, "Ignored Name");

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.config.token).toBe(first.config.token);
    expect(await readEngramConfig(root)).toMatchObject({ projectId: "location-agent", tenantId: "local" });
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toContain(".engram/config.json");
    expect(await readFile(path.join(root, ".engram", ".gitignore"), "utf8")).toContain("data/");

    const environment = localStudioEnvironment(first.config, root, 3199);
    expect(environment).toMatchObject({
      ENGRAM_LOCAL_MODE: "true",
      ENGRAM_URL: "http://localhost:3199",
      ENGRAM_PROJECT_ID: "location-agent"
    });
    expect(JSON.parse(environment.ENGRAM_INGEST_KEYS_JSON)[0].tokenSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(localAgentEnvironment(first.config, 3199)).toEqual({
      ENGRAM_URL: "http://localhost:3199",
      ENGRAM_TOKEN: first.config.token,
      ENGRAM_PROJECT_ID: "location-agent"
    });
  });

  it("formats a sourceable local agent environment without leaking server-only variables", async () => {
    const root = await temporaryDirectory();
    const { config } = await initializeEngramProject(root, "Quoted Agent");
    const environment = localAgentEnvironment({ ...config, token: "value'with-quote" }, 3100);

    expect(formatShellEnvironment(environment)).toBe([
      "export ENGRAM_URL='http://localhost:3100'",
      "export ENGRAM_TOKEN='value'\"'\"'with-quote'",
      "export ENGRAM_PROJECT_ID='quoted-agent'",
      ""
    ].join("\n"));
    expect(formatShellEnvironment(environment)).not.toContain("ENGRAM_INGEST_KEYS_JSON");
  });

  it("detects the project package manager and recommends only missing integration packages", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      packageManager: "pnpm@10.0.0",
      dependencies: { mem0ai: "^2.0.0" },
      devDependencies: { typescript: "^6.0.0" }
    }), "utf8");
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await initializeEngramProject(root, "Memory Agent");

    const inspection = await inspectEngramProject(root);
    expect(inspection).toMatchObject({
      packageManager: "pnpm",
      packageJsonPresent: true,
      typescript: true,
      sdkInstalled: false,
      mem0Detected: true,
      mem0AdapterInstalled: false,
      captureIgnored: true
    });
    expect(projectSetupLines(inspection)).toContain("WARN  Mem0 detected; adapter not installed");
    expect(projectNextSteps(inspection)).toEqual([
      "pnpm add @engramviz/sdk @engramviz/adapter-mem0",
      "npx --yes @engramviz/cli doctor",
      "npx --yes @engramviz/cli dev"
    ]);
  });

  it("recommends the LangGraph adapter when a project uses LangGraph Store", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      dependencies: { "@langchain/langgraph": "^1.4.8" }
    }), "utf8");
    await initializeEngramProject(root, "LangGraph Agent");

    const inspection = await inspectEngramProject(root);
    expect(inspection).toMatchObject({
      packageManager: "npm",
      langGraphDetected: true,
      langGraphAdapterInstalled: false
    });
    expect(projectSetupLines(inspection)).toContain("WARN  LangGraph detected; adapter not installed");
    expect(projectNextSteps(inspection)).toEqual([
      "npm install @engramviz/sdk @engramviz/adapter-langgraph",
      "npx --yes @engramviz/cli init --framework langgraph",
      "npx --yes @engramviz/cli doctor",
      "npx --yes @engramviz/cli dev"
    ]);
  });

  it("scaffolds an idempotent LangGraph replay project and CI workflow", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      packageManager: "npm@11.0.0",
      dependencies: { "@langchain/langgraph": "^1.4.8" }
    }), "utf8");
    const first = await scaffoldLangGraphProject(root, {
      packageManager: "npm",
      projectId: "support-agent"
    });
    const second = await scaffoldLangGraphProject(root, {
      packageManager: "npm",
      projectId: "support-agent"
    });

    expect(first.created).toEqual([
      "engram.config.json",
      "engram.executor.mjs",
      path.join(".github", "workflows", "engram-memory-regressions.yml")
    ]);
    expect(second.preserved).toEqual(first.created);
    expect(await readEngramProjectConfig(root)).toEqual({
      version: 1,
      framework: "langgraph",
      executor: "engram.executor.mjs",
      regressions: ["regressions"]
    });
    expect(await readFile(path.join(root, "engram.executor.mjs"), "utf8"))
      .toContain("ENGRAM_SCAFFOLD_PENDING = true");
    expect(await readFile(path.join(root, ".github", "workflows", "engram-memory-regressions.yml"), "utf8"))
      .toContain("npx engram test --format github");
  });

  it("discovers configured regression artifacts recursively without leaving the project", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "one.engram-test.json"), "{}", "utf8");
    await writeFile(path.join(root, "ignored.json"), "{}", "utf8");
    await writeFile(path.join(root, "two.engram-test.json"), "{}", "utf8");

    await expect(discoverRegressionArtifacts(root, ["."])).resolves.toEqual([
      path.join(root, "one.engram-test.json"),
      path.join(root, "two.engram-test.json")
    ]);
    await writeFile(path.join(root, "engram.config.json"), JSON.stringify({
      version: 1,
      framework: "langgraph",
      executor: "../outside.mjs",
      regressions: ["regressions"]
    }), "utf8");
    await expect(readEngramProjectConfig(root)).rejects.toThrow("must stay inside the project");
  });

  it("prints an actionable setup scan after initialization", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "new-agent",
      private: true
    }), "utf8");
    const cli = path.join(process.cwd(), "packages", "cli", "bin", "engram.mjs");
    const { stdout } = await execFile(process.execPath, [cli, "init", "--project", "New Agent"], { cwd: root });

    expect(stdout).toContain('Initialized Engram project "new-agent".');
    expect(stdout).toContain("Project scan");
    expect(stdout).toContain("WARN  @engramviz/sdk not installed");
    expect(stdout).toContain("1. npm install @engramviz/sdk");
    expect(stdout).toContain("3. npx --yes @engramviz/cli dev");
  });

  it("runs an agent command with local capture variables injected", async () => {
    const root = await temporaryDirectory();
    await initializeEngramProject(root, "Run Agent");
    const cli = path.join(process.cwd(), "packages", "cli", "bin", "engram.mjs");
    const { stdout } = await execFile(process.execPath, [
      cli,
      "run",
      "--port",
      "3198",
      "--",
      process.execPath,
      "-e",
      "process.stdout.write([process.env.ENGRAM_URL, process.env.ENGRAM_PROJECT_ID, Boolean(process.env.ENGRAM_TOKEN)].join('|'))"
    ], { cwd: root });

    expect(stdout).toBe("http://localhost:3198|run-agent|true");
  });

  it("serves an authenticated loopback replay executor for Studio", async () => {
    const fixture = createStaleLocationPolicyReplay();
    const server = await startMemoryExecutorServer({
      port: 0,
      token: "executor-secret",
      executor: {
        manifest: {
          format: "engram.memory-executor",
          version: 1,
          id: "fixture-agent",
          name: "Fixture agent",
          executorVersion: "1.0.0",
          framework: { id: "langgraph", version: "1.4.8" },
          capabilities: fixture.capabilities,
          sideEffects: { defaultMode: "blocked", supportedModes: ["blocked"] }
        },
        replay: vi.fn(async () => ({
          ...fixture,
          executor: { id: "fixture-agent", version: "1.0.0", deterministic: true },
          baseline: {
            ...fixture.baseline,
            answer: { ...fixture.baseline.answer, provider: { id: "fixture-agent", model: "1.0.0" } }
          }
        }))
      }
    });

    try {
      expect((await fetch(`${server.url}/v1/manifest`)).status).toBe(401);
      const manifest = await fetch(`${server.url}/v1/manifest`, {
        headers: { Authorization: "Bearer executor-secret" }
      });
      expect(await manifest.json()).toMatchObject({ id: "fixture-agent", framework: { id: "langgraph" } });

      const replay = await fetch(`${server.url}/v1/replay`, {
        method: "POST",
        headers: {
          Authorization: "Bearer executor-secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          format: "engram.memory-executor-replay",
          version: 1,
          request: {
            baseline: fixture.source,
            intervention: fixture.intervention,
            answerAssertion: fixture.verification.assertion
          },
          sideEffectMode: "blocked"
        })
      });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ format: "engram.memory-policy-replay" });
    } finally {
      await server.close();
    }
  });

  it("imports validated telemetry before its associated turn", async () => {
    const root = await temporaryDirectory();
    const file = path.join(root, "capture.json");
    await writeFile(file, JSON.stringify({
      format: "engram.capture",
      version: 1,
      telemetry: [{
        schemaVersion: 2,
        eventId: "event-1",
        traceId: "trace-1",
        projectId: "location-agent",
        timestamp: "2026-07-14T10:00:00.000Z",
        sequence: 0,
        operation: "store",
        memory: { id: "memory-1", content: "User lives in Oakland.", tier: "episodic", scope: "user" },
        evidence: { level: "observed", adapter: "fixture" }
      }],
      turns: [{
        schemaVersion: 1,
        turnId: "turn-1",
        traceId: "trace-1",
        projectId: "location-agent",
        startedAt: "2026-07-14T10:00:00.000Z",
        completedAt: "2026-07-14T10:00:01.000Z",
        input: "Where do I live?",
        output: "Oakland.",
        status: "completed",
        provider: { id: "fixture" }
      }]
    }), "utf8");
    const calls: string[] = [];
    const result = await importCaptureBundle(file, {
      endpoint: "http://localhost:3100",
      config: {
        version: 1,
        projectId: "location-agent",
        tenantId: "local",
        keyId: "local-location-agent",
        token: "secret"
      },
      fetch: vi.fn(async (input) => {
        calls.push(String(input));
        return Response.json({}, { status: 202 });
      })
    });

    expect(result).toEqual({ telemetry: 1, turns: 1 });
    expect(calls.map((url) => new URL(url).pathname)).toEqual(["/api/telemetry/v2", "/api/turns/v1"]);
  });

  it("builds a deterministic stale-location incident with explicit retrieval and load evidence", () => {
    const capture = createStaleLocationCapture({
      projectId: "location-agent",
      runId: "test-run",
      now: new Date("2026-07-15T10:00:00.000Z")
    });

    expect(capture.telemetry.map(parseMemoryTelemetryEvent).map((event) => event.operation)).toEqual([
      "store",
      "store",
      "retrieve",
      "load"
    ]);
    const turns = capture.turns.map(parseAgentTurnEnvelope);
    expect(turns).toHaveLength(3);
    expect(turns[2]).toMatchObject({
      input: "What city do I live in now?",
      output: "You live in San Francisco.",
      projectId: "location-agent"
    });
    const retrieval = capture.telemetry[2];
    expect(retrieval).toMatchObject({
      retrieval: {
        selectedIds: ["memory-san-francisco"],
        candidates: [
          { memoryId: "memory-san-francisco", selected: true },
          { memoryId: "memory-oakland", selected: false }
        ]
      }
    });
  });

  it("seeds the packaged demo through authenticated ingestion", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const result = await seedStaleLocationDemo({
      endpoint: "http://localhost:3100",
      config: {
        version: 1,
        projectId: "location-agent",
        tenantId: "local",
        keyId: "local-location-agent",
        token: "secret"
      },
      runId: "test-run",
      now: new Date("2026-07-15T10:00:00.000Z"),
      fetch: vi.fn(async (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(input), authorization: headers.get("Authorization") });
        return Response.json({}, { status: 202 });
      })
    });

    expect(result).toEqual({ telemetry: 4, turns: 3 });
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/telemetry/v2",
      "/api/turns/v1",
      "/api/turns/v1",
      "/api/turns/v1"
    ]);
    expect(calls.every((call) => call.authorization === "Bearer secret")).toBe(true);
  });

  it("uses the requested demo port when it is available", async () => {
    const fetch = vi.fn();
    const result = await selectDemoStudio({
      requestedPort: 3100,
      explicitPort: false,
      config: localConfig(),
      fetch,
      portAvailable: vi.fn(async () => true)
    });

    expect(result).toEqual({ port: 3100, running: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reuses a running Studio only when its local token matches", async () => {
    const fetch = vi.fn(async (_input, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
      return Response.json({ events: [] });
    });
    const result = await selectDemoStudio({
      requestedPort: 3100,
      explicitPort: false,
      config: localConfig(),
      fetch,
      portAvailable: vi.fn(async () => false)
    });

    expect(result).toEqual({ port: 3100, running: true });
  });

  it("moves the demo to a free port when another project owns the default", async () => {
    const checkedPorts: number[] = [];
    const result = await selectDemoStudio({
      requestedPort: 3100,
      explicitPort: false,
      config: localConfig(),
      fetch: vi.fn(async () => Response.json({ error: "invalid" }, { status: 401 })),
      portAvailable: vi.fn(async (port) => {
        checkedPorts.push(port);
        return port === 3102;
      })
    });

    expect(result).toEqual({ port: 3102, running: false, displacedPort: 3100 });
    expect(checkedPorts).toEqual([3100, 3101, 3102]);
  });

  it("rejects an explicitly occupied demo port with recovery guidance", async () => {
    await expect(selectDemoStudio({
      requestedPort: 3199,
      explicitPort: true,
      config: localConfig(),
      fetch: vi.fn(async () => Response.json({ error: "invalid" }, { status: 401 })),
      portAvailable: vi.fn(async () => false)
    })).rejects.toThrow("Choose another with --port");
  });

  it("runs a portable regression against an external executor module", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "location.engram-test.json"), JSON.stringify({
      kind: "engram.memory-regression",
      version: 1,
      id: "location",
      title: "Prefer current location",
      fixture: { memories: [{ id: "oakland" }], input: { userMessage: "Where do I live?", history: [] } },
      evidence: { caveat: "This checks observable output, not hidden reasoning." },
      assertions: {
        retrieval: { mustRetrieve: ["oakland"], mustNotRetrieve: ["sf"], maxLoaded: 1 },
        answer: { contains: ["Oakland"], notContains: ["San Francisco"] }
      }
    }), "utf8");
    await writeFile(path.join(root, "executor.mjs"), `
      export default async function run(fixture) {
        return {
          answer: "You live in Oakland.",
          retrievedMemoryIds: [fixture.memories[0].id],
          loadedMemoryIds: [fixture.memories[0].id]
        };
      }
    `, "utf8");

    const cli = path.join(process.cwd(), "packages", "cli", "bin", "engram.mjs");
    const { stdout } = await execFile(process.execPath, [
      cli,
      "test",
      "location.engram-test.json",
      "--executor",
      "executor.mjs"
    ], { cwd: root });

    expect(stdout).toContain("PASS  Prefer current location");
    expect(stdout.match(/^PASS  /gm)).toHaveLength(6);
  });

  it("reports a failed captured observation without hiding the violated assertion", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "location.engram-test.json"), JSON.stringify({
      kind: "engram.memory-regression",
      version: 1,
      id: "location",
      title: "Prefer current location",
      fixture: {},
      evidence: { caveat: "Observable behavior only." },
      assertions: {
        retrieval: { mustRetrieve: ["oakland"], mustNotRetrieve: [], maxLoaded: 1 },
        answer: { contains: ["Oakland"], notContains: [] }
      }
    }), "utf8");
    await writeFile(path.join(root, "observation.json"), JSON.stringify({
      answer: "I do not know.",
      retrievedMemoryIds: [],
      loadedMemoryIds: []
    }), "utf8");

    const report = await runRegressionFile("location.engram-test.json", {
      cwd: root,
      observationFile: "observation.json"
    });

    expect(report.pass).toBe(false);
    expect(report.findings.filter((finding) => !finding.pass).map((finding) => finding.label)).toEqual([
      'retrieved required memory "oakland"',
      'answer contains "Oakland"'
    ]);
    expect(formatRegressionReport(report)).toContain([
      "FAIL  [retrieval.mustRetrieve] retrieved required memory \"oakland\"",
      "      expected: \"oakland\"",
      "      observed: []"
    ].join("\n"));
    expect(formatRegressionReport(report, "github")).toContain(
      "::error title=Engram retrieval.mustRetrieve::retrieved required memory \"oakland\". Expected \"oakland\"; observed []."
    );
    const jsonReport = JSON.parse(formatRegressionReport(report, "json"));
    expect(jsonReport).toMatchObject({
      pass: false,
      observation: { answer: "I do not know.", retrievedMemoryIds: [] }
    });
    expect(jsonReport.findings[0]).toMatchObject({
      category: "retrieval",
      assertion: "mustRetrieve",
      expected: "oakland"
    });
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "engram-cli-"));
  directories.push(directory);
  return directory;
}

function localConfig() {
  return {
    version: 1 as const,
    projectId: "location-agent",
    tenantId: "local",
    keyId: "local-location-agent",
    token: "secret"
  };
}
