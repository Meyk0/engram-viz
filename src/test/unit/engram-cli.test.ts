import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeEngramProject,
  localStudioEnvironment,
  readEngramConfig
} from "../../../packages/cli/src/config";
import { importCaptureBundle } from "../../../packages/cli/src/import";
import { runRegressionFile } from "../../../packages/cli/src/regression";

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
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "engram-cli-"));
  directories.push(directory);
  return directory;
}
