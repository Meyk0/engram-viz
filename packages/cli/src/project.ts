import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  readEngramProjectConfig,
  resolveConfiguredExecutor,
  type EngramFramework
} from "./project-config.js";

export type EngramPackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type EngramProjectInspection = {
  root: string;
  nodeVersion: string;
  nodeSupported: boolean;
  packageManager: EngramPackageManager;
  packageJsonPresent: boolean;
  typescript: boolean;
  sdkInstalled: boolean;
  mem0Detected: boolean;
  mem0AdapterInstalled: boolean;
  openAiAgentsDetected: boolean;
  langGraphDetected: boolean;
  langGraphAdapterInstalled: boolean;
  captureIgnored: boolean;
  projectConfigPresent: boolean;
  configuredFramework?: EngramFramework;
  executorConfigured: boolean;
  executorExists: boolean;
};

export async function inspectEngramProject(directory: string): Promise<EngramProjectInspection> {
  const root = path.resolve(directory);
  const packageJson = await readPackageJson(root);
  const dependencies = dependencyNames(packageJson);
  const gitignore = await optionalText(path.join(root, ".gitignore"));
  const nodeVersion = process.versions.node;
  const engramConfig = await readEngramProjectConfig(root);
  const executor = resolveConfiguredExecutor(root, engramConfig);

  return {
    root,
    nodeVersion,
    nodeSupported: Number(nodeVersion.split(".")[0]) >= 20,
    packageManager: await detectPackageManager(root, packageJson),
    packageJsonPresent: packageJson !== undefined,
    typescript: dependencies.has("typescript") || await exists(path.join(root, "tsconfig.json")),
    sdkInstalled: dependencies.has("@engramviz/sdk"),
    mem0Detected: dependencies.has("mem0ai") || dependencies.has("mem0ai/oss"),
    mem0AdapterInstalled: dependencies.has("@engramviz/adapter-mem0"),
    openAiAgentsDetected: dependencies.has("@openai/agents"),
    langGraphDetected: dependencies.has("@langchain/langgraph"),
    langGraphAdapterInstalled: dependencies.has("@engramviz/adapter-langgraph"),
    captureIgnored: ignoresLocalCapture(gitignore),
    projectConfigPresent: Boolean(engramConfig),
    ...(engramConfig ? { configuredFramework: engramConfig.framework } : {}),
    executorConfigured: Boolean(executor),
    executorExists: executor ? await exists(executor) : false
  };
}

export function projectSetupLines(inspection: EngramProjectInspection): string[] {
  const lines = [
    `${inspection.nodeSupported ? "PASS" : "FAIL"}  Node ${inspection.nodeVersion}${inspection.nodeSupported ? "" : " (requires 20+)"}`,
    `${inspection.packageJsonPresent ? "PASS" : "WARN"}  ${inspection.packageJsonPresent ? `${inspection.packageManager} project detected` : "No package.json found"}`,
    `${inspection.sdkInstalled ? "PASS" : "WARN"}  @engramviz/sdk${inspection.sdkInstalled ? " installed" : " not installed"}`,
    `${inspection.captureIgnored ? "PASS" : "WARN"}  local capture data${inspection.captureIgnored ? " is git-ignored" : " is not fully git-ignored"}`
  ];

  if (inspection.mem0Detected) {
    lines.push(`${inspection.mem0AdapterInstalled ? "PASS" : "WARN"}  Mem0 detected${inspection.mem0AdapterInstalled ? " with the Engram adapter" : "; adapter not installed"}`);
  }
  if (inspection.openAiAgentsDetected) lines.push("INFO  OpenAI Agents SDK detected; instrument its memory boundary with @engramviz/sdk");
  if (inspection.langGraphDetected) {
    lines.push(`${inspection.langGraphAdapterInstalled ? "PASS" : "WARN"}  LangGraph detected${inspection.langGraphAdapterInstalled ? " with the Engram adapter" : "; adapter not installed"}`);
  }
  if (inspection.projectConfigPresent) {
    lines.push(`PASS  engram.config.json (${inspection.configuredFramework})`);
    lines.push(`${inspection.executorExists ? "PASS" : "FAIL"}  replay executor${inspection.executorExists ? " found" : " is missing"}`);
  }
  return lines;
}

export function projectNextSteps(inspection: EngramProjectInspection): string[] {
  const steps: string[] = [];
  if (!inspection.packageJsonPresent) steps.push(packageManagerCommand(inspection.packageManager, "init"));
  const packages = [
    ...(inspection.sdkInstalled ? [] : ["@engramviz/sdk"]),
    ...(inspection.mem0Detected && !inspection.mem0AdapterInstalled ? ["@engramviz/adapter-mem0"] : []),
    ...(inspection.langGraphDetected && !inspection.langGraphAdapterInstalled ? ["@engramviz/adapter-langgraph"] : [])
  ];
  if (packages.length > 0) steps.push(packageManagerCommand(inspection.packageManager, "add", packages));
  if (inspection.sdkInstalled) steps.push("Instrument one agent turn and report retrieve() and load() separately.");
  if (inspection.langGraphDetected && !inspection.projectConfigPresent) {
    steps.push("npx --yes @engramviz/cli init --framework langgraph");
  }
  steps.push("npx --yes @engramviz/cli doctor");
  steps.push("npx --yes @engramviz/cli dev");
  return steps;
}

function packageManagerCommand(
  packageManager: EngramPackageManager,
  action: "init" | "add",
  packages: string[] = []
) {
  if (action === "init") {
    if (packageManager === "npm") return "npm init -y";
    if (packageManager === "yarn") return "yarn init -y";
    return `${packageManager} init`;
  }
  const names = packages.join(" ");
  if (packageManager === "npm") return `npm install ${names}`;
  return `${packageManager} add ${names}`;
}

async function detectPackageManager(
  root: string,
  packageJson: Record<string, unknown> | undefined
): Promise<EngramPackageManager> {
  if (typeof packageJson?.packageManager === "string") {
    const declared = packageJson.packageManager.split("@")[0];
    if (declared === "npm" || declared === "pnpm" || declared === "yarn" || declared === "bun") return declared;
  }
  if (await exists(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(root, "yarn.lock"))) return "yarn";
  if (await exists(path.join(root, "bun.lock")) || await exists(path.join(root, "bun.lockb"))) return "bun";
  return "npm";
}

function dependencyNames(packageJson: Record<string, unknown> | undefined) {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const value = packageJson?.[field];
    if (isRecord(value)) Object.keys(value).forEach((name) => names.add(name));
  }
  return names;
}

async function readPackageJson(root: string): Promise<Record<string, unknown> | undefined> {
  const value = await optionalText(path.join(root, "package.json"));
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) throw new Error("package.json must contain an object.");
    return parsed;
  } catch (error) {
    throw new Error(`Could not inspect package.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function ignoresLocalCapture(value: string | undefined) {
  if (!value) return false;
  const entries = new Set(value.split(/\r?\n/).map((line) => line.trim()));
  return entries.has(".engram/config.json") && entries.has(".engram/data/");
}

async function optionalText(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
