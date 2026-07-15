import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeEngramProject,
  localStudioEnvironment,
  readEngramConfig
} from "../../../packages/cli/src/config";
import { importCaptureBundle } from "../../../packages/cli/src/import";

const directories: string[] = [];

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
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "engram-cli-"));
  directories.push(directory);
  return directory;
}
