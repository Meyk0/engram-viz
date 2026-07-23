import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isStudioRuntimeReady, startStudio } from "@engramviz/studio";
import { importCaptureBundle } from "./import.js";
import {
  inspectEngramProject,
  projectNextSteps,
  projectSetupLines
} from "./project.js";
import {
  initializeEngramProject,
  localAgentEnvironment,
  localStudioEnvironment,
  readEngramConfig
} from "./config.js";
import {
  seedStaleLocationDemo,
  selectDemoStudio,
  STALE_LOCATION_DEMO,
  waitForStudio
} from "./demo.js";
import { formatShellEnvironment } from "./environment.js";
import { loadMemoryReplayExecutor, startMemoryExecutorServer } from "./executor.js";
import {
  discoverRegressionArtifacts,
  readEngramProjectConfig,
  resolveConfiguredExecutor
} from "./project-config.js";
import { scaffoldLangGraphProject } from "./scaffold.js";
import {
  formatRegressionReport,
  runRegressionFile,
  type CliRegressionFormat
} from "./regression.js";

export {
  initializeEngramProject,
  localAgentEnvironment,
  localStudioEnvironment,
  readEngramConfig
} from "./config.js";
export { formatShellEnvironment } from "./environment.js";
export { loadMemoryReplayExecutor, startMemoryExecutorServer } from "./executor.js";
export { discoverRegressionArtifacts, readEngramProjectConfig, resolveConfiguredExecutor } from "./project-config.js";
export { scaffoldLangGraphProject } from "./scaffold.js";
export { createStaleLocationCapture, seedStaleLocationDemo } from "./demo.js";
export { importCaptureBundle } from "./import.js";
export { inspectEngramProject, projectNextSteps, projectSetupLines } from "./project.js";
export { formatRegressionReport, runRegressionFile } from "./regression.js";

export async function runCli(args: string[]) {
  const command = args[0] ?? "help";
  const cwd = process.cwd();
  if (command === "init") {
    const result = await initializeEngramProject(cwd, stringFlag(args, "--project"));
    process.stdout.write(result.created
      ? `Initialized Engram project "${result.config.projectId}".\n`
      : `Engram is already initialized for "${result.config.projectId}".\n`);
    const framework = stringFlag(args, "--framework");
    if (framework && framework !== "langgraph") {
      throw new Error("--framework currently supports langgraph.");
    }
    if (framework === "langgraph") {
      const inspection = await inspectEngramProject(cwd);
      const scaffold = await scaffoldLangGraphProject(cwd, {
        packageManager: inspection.packageManager,
        projectId: result.config.projectId
      });
      scaffold.created.forEach((file) => process.stdout.write(`Created ${file}\n`));
      scaffold.preserved.forEach((file) => process.stdout.write(`Preserved ${file}\n`));
    }
    await printProjectSetup(cwd);
    return;
  }
  if (command === "doctor") {
    await doctor(cwd, args, numberFlag(args, "--port", 3100));
    return;
  }
  if (command === "dev") {
    await dev(cwd, args, numberFlag(args, "--port", 3100));
    return;
  }
  if (command === "env") {
    const config = await readEngramConfig(cwd);
    const environment = localAgentEnvironment(config, numberFlag(args, "--port", 3100));
    const format = stringFlag(args, "--format") ?? "shell";
    if (format === "json") process.stdout.write(`${JSON.stringify(environment, null, 2)}\n`);
    else if (format === "shell") process.stdout.write(formatShellEnvironment(environment));
    else throw new Error("--format must be shell or json.");
    return;
  }
  if (command === "run") {
    await runAgentCommand(cwd, args, numberFlag(args, "--port", 3100));
    return;
  }
  if (command === "demo") {
    await runDemo(cwd, args, numberFlag(args, "--port", 3100));
    return;
  }
  if (command === "import") {
    const file = args[1];
    if (!file || file.startsWith("--")) throw new Error("Usage: engram import <capture.json> [--port 3100]");
    const port = numberFlag(args, "--port", 3100);
    const config = await readEngramConfig(cwd);
    const result = await importCaptureBundle(path.resolve(file), {
      endpoint: `http://localhost:${port}`,
      config
    });
    process.stdout.write(`Imported ${result.telemetry} memory events and ${result.turns} turns.\n`);
    return;
  }
  if (command === "test") {
    await testRegressions(cwd, args);
    return;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(helpText());
    return;
  }
  throw new Error(`Unknown command "${command}". Run engram help.`);
}

async function testRegressions(cwd: string, args: string[]) {
  const projectConfig = await readEngramProjectConfig(cwd);
  const explicitFile = args[1] && !args[1].startsWith("--") ? path.resolve(cwd, args[1]) : undefined;
  const files = explicitFile
    ? [explicitFile]
    : await discoverRegressionArtifacts(cwd, projectConfig?.regressions ?? ["regressions"]);
  if (files.length === 0) {
    throw new Error("No .engram-test.json artifacts found. Pass a file or configure regressions in engram.config.json.");
  }
  const observationFile = stringFlag(args, "--observation");
  if (observationFile && files.length > 1) {
    throw new Error("--observation can be used only when one regression artifact is selected.");
  }
  const executorFile = resolveConfiguredExecutor(cwd, projectConfig, stringFlag(args, "--executor"));
  if (!executorFile && !observationFile) {
    throw new Error("No replay executor configured. Set executor in engram.config.json or pass --executor <module>.");
  }
  const reports = [];
  const format = regressionFormat(stringFlag(args, "--format"));
  for (const file of files) {
    const report = await runRegressionFile(file, {
      cwd,
      ...(executorFile ? { executorFile } : {}),
      ...(observationFile ? { observationFile } : {})
    });
    reports.push(report);
    process.stdout.write(formatRegressionReport(report, format));
  }
  const output = stringFlag(args, "--output");
  if (output) {
    const outputPath = path.resolve(cwd, output);
    const reportOutput = reports.length === 1
      ? reports[0]
      : {
          format: "engram.regression-suite",
          version: 1,
          pass: reports.every((report) => report.pass),
          reports
        };
    await writeFile(outputPath, `${JSON.stringify(reportOutput, null, 2)}\n`, "utf8");
    process.stdout.write(`Report: ${outputPath}\n`);
  }
  const failed = reports.filter((report) => !report.pass);
  if (failed.length > 0) throw new Error(`${failed.length}/${reports.length} memory regressions failed.`);
}

async function doctor(cwd: string, args: string[], port: number) {
  const inspection = await inspectEngramProject(cwd);
  const lines = projectSetupLines(inspection);
  const failures: string[] = [];
  let configLabel = ".engram config not found; run npx --yes @engramviz/cli init";
  try {
    const config = await readEngramConfig(cwd);
    configLabel = `.engram config (${config.projectId})`;
    lines.push(`PASS  ${configLabel}`);
  } catch {
    lines.push(`WARN  ${configLabel}`);
  }
  const projectConfig = await readEngramProjectConfig(cwd);
  const executorFile = resolveConfiguredExecutor(cwd, projectConfig, stringFlag(args, "--executor"));
  if (executorFile) {
    try {
      const source = await readFile(executorFile, "utf8");
      const executor = await loadMemoryReplayExecutor(executorFile, cwd);
      const frameworkMatches = !projectConfig || executor.manifest.framework.id === projectConfig.framework;
      lines.push(`PASS  replay executor ${path.relative(cwd, executorFile)}`);
      lines.push(`${frameworkMatches ? "PASS" : "FAIL"}  executor framework ${executor.manifest.framework.id}`);
      if (!frameworkMatches) failures.push("executor framework does not match engram.config.json");
      const safeSideEffects = executor.manifest.sideEffects.defaultMode !== "execute";
      lines.push(`${safeSideEffects ? "PASS" : "FAIL"}  replay side effects default to ${executor.manifest.sideEffects.defaultMode}`);
      if (!safeSideEffects) failures.push("replay side effects default to execute");
      const agentReplay = executor.manifest.capabilities.levels.includes("agent")
        && executor.manifest.capabilities.rerunsSelection
        && executor.manifest.capabilities.rerunsContextAssembly
        && executor.manifest.capabilities.rerunsGeneration;
      lines.push(`${agentReplay ? "PASS" : "WARN"}  ${agentReplay ? "agent replay covers selection, context, and answer" : "executor declares partial replay coverage"}`);
      const scaffoldPending = source.includes("ENGRAM_SCAFFOLD_PENDING = true");
      lines.push(`${scaffoldPending ? "WARN" : "PASS"}  ${scaffoldPending ? "executor scaffold still needs application wiring" : "executor scaffold marker removed"}`);
      lines.push("INFO  checkpoint and Store isolation are enforced when replay starts");
    } catch (error) {
      lines.push(`FAIL  replay executor could not load: ${errorMessage(error)}`);
      failures.push("replay executor could not load");
    }
  } else {
    lines.push("WARN  no replay executor configured");
  }
  const checkpointFound = await localReplayCheckpointExists(cwd);
  lines.push(`${checkpointFound ? "PASS" : "WARN"}  ${checkpointFound ? "captured LangGraph replay checkpoint found" : "no captured LangGraph replay checkpoint yet"}`);
  try {
    const response = await fetch(`http://localhost:${port}/api/local/traces`);
    lines.push(`${response.ok ? "PASS" : "WARN"}  Studio on port ${port}`);
    if (response.ok && executorFile) {
      const executorResponse = await fetch(`http://localhost:${port}/api/local/executor`);
      lines.push(`${executorResponse.ok ? "PASS" : "WARN"}  Studio executor bridge${executorResponse.ok ? " is connected" : " is unavailable"}`);
    }
  } catch {
    lines.push(`WARN  Studio on port ${port} is not running`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  if (!inspection.nodeSupported) failures.push("Node.js 20 or newer is required");
  if (failures.length > 0) {
    throw new Error(`Engram doctor found ${failures.length} blocking issue(s): ${failures.join("; ")}.`);
  }
}

async function printProjectSetup(cwd: string) {
  const inspection = await inspectEngramProject(cwd);
  process.stdout.write("\nProject scan\n");
  process.stdout.write(`${projectSetupLines(inspection).join("\n")}\n`);
  process.stdout.write("\nNext steps\n");
  projectNextSteps(inspection).forEach((step, index) => process.stdout.write(`${index + 1}. ${step}\n`));
}

async function dev(cwd: string, args: string[], port: number) {
  const { config } = await initializeEngramProject(cwd);
  const environment: Record<string, string> = localStudioEnvironment(config, cwd, port);
  const projectConfig = await readEngramProjectConfig(cwd);
  const executorFile = resolveConfiguredExecutor(cwd, projectConfig, stringFlag(args, "--executor"));
  const executorPort = numberFlag(args, "--executor-port", port + 1);
  const executorServer = executorFile
    ? await startMemoryExecutorServer({
        executor: await loadMemoryReplayExecutor(executorFile, cwd),
        token: config.token,
        port: executorPort
      })
    : undefined;
  if (executorServer) {
    environment.ENGRAM_EXECUTOR_URL = executorServer.url;
    environment.ENGRAM_EXECUTOR_TOKEN = config.token;
    process.stdout.write(`Replay executor: ${executorServer.url}\n`);
  }
  process.stdout.write(`Engram Studio: http://localhost:${port}/?mode=incidents\n`);
  process.stdout.write(`SDK: ENGRAM_URL=${environment.ENGRAM_URL} ENGRAM_PROJECT_ID=${config.projectId}\n`);
  try {
    if (await isStudioRuntimeReady()) {
      await startStudio({ port, environment });
      return;
    }

    const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
    await access(path.join(repositoryRoot, "next.config.mjs"));
    process.stdout.write("Studio runtime is not packed; using the source development server.\n");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
        cwd: repositoryRoot,
        env: { ...process.env, ...environment },
        stdio: "inherit"
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") resolve();
        else reject(new Error(`Studio exited with code ${code ?? signal}.`));
      });
    });
  } finally {
    await executorServer?.close();
  }
}

async function runAgentCommand(cwd: string, args: string[], port: number) {
  const separator = args.indexOf("--");
  const commandFlags = separator >= 0 ? args.slice(0, separator) : args;
  const command = separator >= 0 ? args[separator + 1] : undefined;
  const commandArgs = separator >= 0 ? args.slice(separator + 2) : [];
  if (!command) throw new Error("Usage: engram run [--port 3100] -- <command> [args...]");
  const config = await readEngramConfig(cwd);
  const environment = localAgentEnvironment(config, port);
  const endpoint = `http://localhost:${port}`;
  const before = await localTraceIds(endpoint);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, ...environment },
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Agent command exited with code ${code ?? signal}.`));
    });
  });
  const trace = (await localTraces(endpoint)).filter((candidate) => !before.has(candidate.trace.id)).at(-1);
  if (trace) {
    const url = new URL("/", endpoint);
    url.searchParams.set("mode", "incidents");
    url.searchParams.set("trace", trace.trace.id);
    const expected = stringFlag(commandFlags, "--expected");
    if (expected) url.searchParams.set("expected", expected);
    process.stdout.write(`${expected ? "Open captured incident" : "Open captured turn"}: ${url}\n`);
  }
}

async function runDemo(cwd: string, args: string[], port: number) {
  const demo = args[1]?.startsWith("--") ? STALE_LOCATION_DEMO : (args[1] ?? STALE_LOCATION_DEMO);
  if (demo !== STALE_LOCATION_DEMO) {
    throw new Error(`Unknown demo "${demo}". Available: ${STALE_LOCATION_DEMO}.`);
  }
  const { config } = await initializeEngramProject(cwd, "engram-demo");
  const noStart = args.includes("--no-start");
  const studio = await selectDemoStudio({
    requestedPort: port,
    explicitPort: args.includes("--port") || noStart,
    config
  });
  const endpoint = `http://127.0.0.1:${studio.port}`;
  let child: ReturnType<typeof spawn> | undefined;

  try {
    if (studio.displacedPort !== undefined) {
      process.stdout.write(
        `Port ${studio.displacedPort} belongs to another local service or Engram project; using ${studio.port} for this demo.\n`
      );
    }
    if (!studio.running && noStart) throw new Error(`Engram Studio is not running at ${endpoint}.`);
    if (!studio.running) child = spawnStudio(cwd, studio.port);
    await waitForStudio({ endpoint, ...(child ? { child } : {}) });
    const result = await seedStaleLocationDemo({ endpoint, config });
    const url = `${endpoint}/?mode=incidents`;
    process.stdout.write(`Captured ${result.turns} turns and ${result.telemetry} memory events.\n`);
    process.stdout.write(`Open the stale-location incident: ${url}\n`);
    process.stdout.write("Expected diagnosis: stale retrieval selected San Francisco instead of current Oakland.\n");
    if (!args.includes("--no-open")) openUrl(url);
    if (child) {
      process.stdout.write("Engram Studio is running. Press Ctrl+C to stop.\n");
      await waitForChild(child);
    }
  } catch (error) {
    if (child?.exitCode === null) child.kill("SIGTERM");
    throw error;
  }
}

function spawnStudio(cwd: string, port: number) {
  const cli = fileURLToPath(new URL("../bin/engram.mjs", import.meta.url));
  return spawn(process.execPath, [cli, "dev", "--port", String(port)], {
    cwd,
    env: process.env,
    stdio: "inherit"
  });
}

async function waitForChild(child: ReturnType<typeof spawn>) {
  await new Promise<void>((resolve, reject) => {
    const terminate = () => child.kill("SIGTERM");
    process.once("SIGINT", terminate);
    process.once("SIGTERM", terminate);
    const cleanup = () => {
      process.off("SIGINT", terminate);
      process.off("SIGTERM", terminate);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") resolve();
      else reject(new Error(`Engram Studio exited with code ${code ?? signal}.`));
    });
  });
}

function openUrl(url: string) {
  const [command, commandArgs] = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const opener = spawn(command, commandArgs, { detached: true, stdio: "ignore" });
  opener.once("error", () => undefined);
  opener.unref();
}

function stringFlag(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberFlag(args: string[], name: string, fallback: number) {
  const value = stringFlag(args, name);
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(`${name} must be a valid port.`);
  return number;
}

function regressionFormat(value: string | undefined): CliRegressionFormat {
  if (value === undefined || value === "pretty") return "pretty";
  if (value === "json" || value === "github") return value;
  throw new Error("--format must be pretty, json, or github.");
}

function helpText() {
  return `Engram — local memory reliability for AI agents\n\nCommands:\n  engram init [--project name] [--framework langgraph]\n                                       Initialize capture and optionally scaffold replay\n  engram dev [--port 3100] [--executor module]\n                                       Start Studio with the configured replay executor\n  engram demo stale-location        Run the flagship incident end to end\n  engram env [--format shell|json]   Print agent capture environment\n  engram run [--expected text] -- <command> [args...]\n                                       Capture an agent and print its direct Studio link\n  engram doctor [--port 3100]        Check capture, executor, isolation, and Studio\n  engram import <capture.json>        Import an engram.capture bundle\n  engram test [artifact] [--executor module]\n                                       Run one or all configured memory regressions\n  engram test <artifact> --observation <json>\n                                       Check a captured agent observation\n\nRegression options:\n  --format pretty|json|github        Select human or CI output\n  --output <report.json>             Save the structured execution report or suite\n`;
}

async function localReplayCheckpointExists(cwd: string) {
  try {
    const content = await readFile(path.join(cwd, ".engram", "data", "agent-turns.ndjson"), "utf8");
    return content.split(/\r?\n/).some((line) => {
      if (!line.trim()) return false;
      try {
        return hasReplayCheckpoint(JSON.parse(line) as unknown);
      } catch {
        return false;
      }
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function hasReplayCheckpoint(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasReplayCheckpoint);
  const record = value as Record<string, unknown>;
  if (record.langgraph && typeof record.langgraph === "object") {
    const replayCheckpoint = (record.langgraph as Record<string, unknown>).replayCheckpoint;
    if (replayCheckpoint && typeof replayCheckpoint === "object") return true;
  }
  return Object.values(record).some(hasReplayCheckpoint);
}

async function localTraceIds(endpoint: string) {
  return new Set((await localTraces(endpoint)).map((trace) => trace.trace.id));
}

async function localTraces(endpoint: string): Promise<Array<{ trace: { id: string } }>> {
  try {
    const response = await fetch(new URL("/api/local/traces", endpoint));
    if (!response.ok) return [];
    const payload = await response.json() as unknown;
    if (!payload || typeof payload !== "object" || !("traces" in payload) || !Array.isArray(payload.traces)) return [];
    return payload.traces.filter((item): item is { trace: { id: string } } => (
      Boolean(item)
      && typeof item === "object"
      && "trace" in item
      && Boolean(item.trace)
      && typeof item.trace === "object"
      && "id" in item.trace
      && typeof item.trace.id === "string"
    ));
  } catch {
    return [];
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
