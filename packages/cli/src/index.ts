import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importCaptureBundle } from "./import.js";
import { initializeEngramProject, localStudioEnvironment, readEngramConfig } from "./config.js";
import { runRegressionFile } from "./regression.js";

export { initializeEngramProject, localStudioEnvironment, readEngramConfig } from "./config.js";
export { importCaptureBundle } from "./import.js";
export { runRegressionFile } from "./regression.js";

export async function runCli(args: string[]) {
  const command = args[0] ?? "help";
  const cwd = process.cwd();
  if (command === "init") {
    const result = await initializeEngramProject(cwd, stringFlag(args, "--project"));
    process.stdout.write(result.created
      ? `Initialized Engram project "${result.config.projectId}".\nRun: npm run engram -- dev\n`
      : `Engram is already initialized for "${result.config.projectId}".\n`);
    return;
  }
  if (command === "doctor") {
    await doctor(cwd, numberFlag(args, "--port", 3100));
    return;
  }
  if (command === "dev") {
    await dev(cwd, numberFlag(args, "--port", 3100));
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
    process.stdout.write(`${report.pass ? "PASS" : "FAIL"}  ${report.artifact.title}\n`);
    report.findings.forEach((finding) => {
      process.stdout.write(`${finding.pass ? "PASS" : "FAIL"}  ${finding.label}\n`);
    });
    process.stdout.write(`Evidence limit: ${report.caveat}\n`);
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
  const config = await readEngramConfig(cwd);
  const checks: Array<readonly [string, boolean]> = [
    [`Node ${process.versions.node}`, Number(process.versions.node.split(".")[0]) >= 20],
    [`.engram config (${config.projectId})`, true]
  ];
  try {
    const response = await fetch(`http://localhost:${port}/api/local/traces`);
    checks.push([`Studio on port ${port}`, response.ok]);
  } catch {
    checks.push([`Studio on port ${port} (not running)`, false]);
  }
  for (const [label, pass] of checks) process.stdout.write(`${pass ? "PASS" : "WARN"}  ${label}\n`);
  if (!checks[0][1]) throw new Error("Engram requires Node.js 20 or newer.");
}

async function dev(cwd: string, port: number) {
  const { config } = await initializeEngramProject(cwd);
  const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  await access(path.join(repositoryRoot, "package.json"));
  const environment = localStudioEnvironment(config, cwd, port);
  process.stdout.write(`Engram Studio: http://localhost:${port}/?mode=incidents\n`);
  process.stdout.write(`SDK: ENGRAM_URL=${environment.ENGRAM_URL} ENGRAM_PROJECT_ID=${config.projectId}\n`);
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

function helpText() {
  return `Engram — local memory reliability for AI agents\n\nCommands:\n  engram init [--project name]       Initialize local capture\n  engram dev [--port 3100]           Start Engram Studio\n  engram doctor [--port 3100]        Check local setup\n  engram import <capture.json>        Import an engram.capture bundle\n  engram test <artifact> --executor <module>\n                                       Run a memory regression against an agent\n  engram test <artifact> --observation <json>\n                                       Check a captured agent observation\n`;
}
