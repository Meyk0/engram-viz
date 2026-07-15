import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "engram-distribution-"));
const packs = path.join(temporaryRoot, "packs");
const consumer = path.join(temporaryRoot, "consumer");
const packageNames = [
  "@engramviz/core",
  "@engramviz/sdk",
  "@engramviz/adapter-mem0",
  "@engramviz/studio",
  "@engramviz/cli"
];
let studio;

try {
  await mkdir(packs, { recursive: true });
  await mkdir(consumer, { recursive: true });
  const tarballs = [];
  for (const packageName of packageNames) {
    const packed = await execute("npm", [
      "pack",
      "--workspace",
      packageName,
      "--pack-destination",
      packs,
      "--json"
    ], root);
    const result = JSON.parse(packed.stdout);
    tarballs.push(path.join(packs, result[0].filename));
  }

  await writeFile(path.join(consumer, "package.json"), JSON.stringify({
    name: "engram-clean-room",
    version: "1.0.0",
    private: true,
    type: "module"
  }, null, 2));
  await execute("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs], consumer);

  const cli = path.join(consumer, "node_modules", ".bin", process.platform === "win32" ? "engram.cmd" : "engram");
  await execute(cli, ["init", "--project", "clean-room-agent"], consumer);
  const environmentResult = await execute(cli, ["env", "--format", "json"], consumer);
  const agentEnvironment = JSON.parse(environmentResult.stdout);
  if (agentEnvironment.ENGRAM_PROJECT_ID !== "clean-room-agent") {
    throw new Error("Packed CLI emitted the wrong project environment.");
  }

  const port = await availablePort();
  studio = spawn(cli, ["dev", "--port", String(port)], {
    cwd: consumer,
    env: { ...process.env, NEXT_PUBLIC_ENGRAM_TEST_SCENE_STATIC: "true" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let studioOutput = "";
  studio.stdout.on("data", (chunk) => { studioOutput += chunk; });
  studio.stderr.on("data", (chunk) => { studioOutput += chunk; });
  await waitForStudio(port, () => studioOutput);

  const brain = await fetch(`http://127.0.0.1:${port}/brain.glb`);
  const brainBytes = brain.ok ? (await brain.arrayBuffer()).byteLength : 0;
  if (!brain.ok || brainBytes < 100_000) {
    throw new Error("Packed Studio did not serve the brain asset.");
  }

  await writeFile(path.join(consumer, "agent.mjs"), `
    import { EngramClient } from "@engramviz/sdk";
    const engram = new EngramClient({ adapter: "clean-room" });
    await engram.withTurn({ input: "Where do I live?", provider: { id: "fixture-agent" } }, async (turn) => {
      await turn.store({ id: "memory-oakland", content: "User lives in Oakland.", tier: "episodic", scope: "user" });
      await turn.retrieve({ query: "Where do I live?", selectedIds: ["memory-oakland"] });
      await turn.load(["memory-oakland"]);
      return "You live in Oakland.";
    });
  `);
  await execute(cli, ["run", "--port", String(port), "--", process.execPath, "agent.mjs"], consumer);

  const tracesResponse = await fetch(`http://127.0.0.1:${port}/api/local/traces`);
  const traces = await tracesResponse.json();
  if (!tracesResponse.ok || !Array.isArray(traces.traces) || traces.traces.length !== 1) {
    throw new Error(`Packed SDK capture was not visible in Studio: ${JSON.stringify(traces)}`);
  }

  await writeRegressionFixture(consumer);
  const regression = await execute(cli, [
    "test",
    "location.engram-test.json",
    "--executor",
    "regression-executor.mjs"
  ], consumer);
  if (!regression.stdout.includes("PASS  Prefer the current city memory")) {
    throw new Error("Packed CLI did not pass the clean-room regression.");
  }

  process.stdout.write("PASS  packed packages install in a clean project\n");
  process.stdout.write("PASS  standalone Studio serves application and brain assets\n");
  process.stdout.write("PASS  SDK captures a turn through the packed CLI environment\n");
  process.stdout.write("PASS  portable regression runs from the installed package\n");
} finally {
  if (studio && studio.exitCode === null) {
    studio.kill("SIGTERM");
    await new Promise((resolve) => studio.once("exit", resolve));
  }
  if (process.env.ENGRAM_KEEP_DISTRIBUTION_TEMP !== "true") {
    await rm(temporaryRoot, { recursive: true, force: true });
  } else {
    process.stdout.write(`Kept clean-room project at ${temporaryRoot}\n`);
  }
}

async function waitForStudio(port, output) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (studio.exitCode !== null) throw new Error(`Packed Studio exited early.\n${output()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/local/traces`);
      if (response.ok) return;
    } catch {
      // The standalone server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for packed Studio.\n${output()}`);
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function execute(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}.\n${stdout}${stderr}`));
    });
  });
}

async function writeRegressionFixture(directory) {
  const source = JSON.parse(await readFile(path.join(root, "regressions", "current-city.engram-test.json"), "utf8"));
  await writeFile(path.join(directory, "location.engram-test.json"), `${JSON.stringify(source, null, 2)}\n`);
  await writeFile(path.join(directory, "regression-executor.mjs"), `
    export default async function run({ memories }) {
      const current = memories.find((memory) => memory.status !== "superseded");
      return {
        answer: current ? current.text : "No current location.",
        retrievedMemoryIds: current ? [current.id] : [],
        loadedMemoryIds: current ? [current.id] : []
      };
    }
  `);
}
