import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
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
import { seedStaleLocationDemo, STALE_LOCATION_DEMO, waitForStudio } from "./demo.js";
import { formatShellEnvironment } from "./environment.js";
import { loadMemoryReplayExecutor, startMemoryExecutorServer } from "./executor.js";
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
    await printProjectSetup(cwd);
    return;
  }
  if (command === "doctor") {
    await doctor(cwd, numberFlag(args, "--port", 3100));
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
    const file = args[1];
    if (!file || file.startsWith("--")) {
      throw new Error("Usage: engram test <artifact.engram-test.json> (--executor <module> | --observation <json>)");
    }
    const report = await runRegressionFile(file, {
      cwd,
      executorFile: stringFlag(args, "--executor"),
      observationFile: stringFlag(args, "--observation")
    });
    const format = regressionFormat(stringFlag(args, "--format"));
    process.stdout.write(formatRegressionReport(report, format));
    const output = stringFlag(args, "--output");
    if (output) {
      const outputPath = path.resolve(cwd, output);
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      process.stdout.write(`Report: ${outputPath}\n`);
    }
    if (!report.pass) throw new Error(`Regression "${report.artifact.id}" failed.`);
    return;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(helpText());
    return;
  }
  throw new Error(`Unknown command "${command}". Run engram help.`);
}

async function doctor(cwd: string, port: number) {
  const inspection = await inspectEngramProject(cwd);
  const lines = projectSetupLines(inspection);
  let configLabel = ".engram config not found; run npx --yes @engramviz/cli init";
  try {
    const config = await readEngramConfig(cwd);
    configLabel = `.engram config (${config.projectId})`;
    lines.push(`PASS  ${configLabel}`);
  } catch {
    lines.push(`WARN  ${configLabel}`);
  }
  try {
    const response = await fetch(`http://localhost:${port}/api/local/traces`);
    lines.push(`${response.ok ? "PASS" : "WARN"}  Studio on port ${port}`);
  } catch {
    lines.push(`WARN  Studio on port ${port} is not running`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  if (!inspection.nodeSupported) throw new Error("Engram requires Node.js 20 or newer.");
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
  const executorFile = stringFlag(args, "--executor");
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
  const command = separator >= 0 ? args[separator + 1] : undefined;
  const commandArgs = separator >= 0 ? args.slice(separator + 2) : [];
  if (!command) throw new Error("Usage: engram run [--port 3100] -- <command> [args...]");
  const config = await readEngramConfig(cwd);
  const environment = localAgentEnvironment(config, port);

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
}

async function runDemo(cwd: string, args: string[], port: number) {
  const demo = args[1]?.startsWith("--") ? STALE_LOCATION_DEMO : (args[1] ?? STALE_LOCATION_DEMO);
  if (demo !== STALE_LOCATION_DEMO) {
    throw new Error(`Unknown demo "${demo}". Available: ${STALE_LOCATION_DEMO}.`);
  }
  const endpoint = `http://127.0.0.1:${port}`;
  const { config } = await initializeEngramProject(cwd, "engram-demo");
  const noStart = args.includes("--no-start");
  let child: ReturnType<typeof spawn> | undefined;

  try {
    const running = await studioIsReady(endpoint);
    if (!running && noStart) throw new Error(`Engram Studio is not running at ${endpoint}.`);
    if (!running) child = spawnStudio(cwd, port);
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

async function studioIsReady(endpoint: string) {
  try {
    return (await fetch(new URL("/api/local/traces", endpoint))).ok;
  } catch {
    return false;
  }
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
  return `Engram — local memory reliability for AI agents\n\nCommands:\n  engram init [--project name]       Initialize local capture\n  engram dev [--port 3100] [--executor module]\n                                       Start Studio with an optional real replay executor\n  engram demo stale-location        Run the flagship incident end to end\n  engram env [--format shell|json]   Print agent capture environment\n  engram run -- <command> [args...]  Run an agent with capture configured\n  engram doctor [--port 3100]        Check local setup\n  engram import <capture.json>        Import an engram.capture bundle\n  engram test <artifact> --executor <module>\n                                       Run a memory regression against an agent\n  engram test <artifact> --observation <json>\n                                       Check a captured agent observation\n\nRegression options:\n  --format pretty|json|github        Select human or CI output\n  --output <report.json>             Save the structured execution report\n`;
}
