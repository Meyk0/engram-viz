import { access, readFile, readdir, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

export const ENGRAM_PROJECT_CONFIG_FILE = "engram.config.json";

export type EngramFramework = "langgraph" | "mem0" | "custom";

export type EngramProjectConfig = {
  version: 1;
  framework: EngramFramework;
  executor?: string;
  regressions: string[];
};

export async function readEngramProjectConfig(directory: string): Promise<EngramProjectConfig | undefined> {
  const root = path.resolve(directory);
  let raw: string;
  try {
    raw = await readFile(path.join(root, ENGRAM_PROJECT_CONFIG_FILE), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${ENGRAM_PROJECT_CONFIG_FILE} is not valid JSON: ${message(error)}`);
  }
  return parseEngramProjectConfig(value);
}

export async function writeEngramProjectConfig(directory: string, config: EngramProjectConfig) {
  const parsed = parseEngramProjectConfig(config);
  const file = path.join(path.resolve(directory), ENGRAM_PROJECT_CONFIG_FILE);
  await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return file;
}

export function resolveConfiguredExecutor(
  directory: string,
  config: EngramProjectConfig | undefined,
  explicit?: string
) {
  const value = explicit?.trim() || config?.executor;
  return value ? path.resolve(directory, value) : undefined;
}

export async function discoverRegressionArtifacts(
  directory: string,
  configuredPaths: readonly string[]
) {
  const root = path.resolve(directory);
  const files = new Set<string>();
  for (const configuredPath of configuredPaths) {
    const target = resolveInsideProject(root, configuredPath);
    try {
      const entries = await readdir(target, { withFileTypes: true });
      await collectRegressionFiles(target, entries, files);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOTDIR") {
        if (target.endsWith(".engram-test.json")) files.add(target);
        continue;
      }
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return [...files].sort();
}

export async function projectFileExists(directory: string, file: string) {
  try {
    await access(path.resolve(directory, file));
    return true;
  } catch {
    return false;
  }
}

function parseEngramProjectConfig(value: unknown): EngramProjectConfig {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error(`${ENGRAM_PROJECT_CONFIG_FILE} must use version 1.`);
  }
  if (value.framework !== "langgraph" && value.framework !== "mem0" && value.framework !== "custom") {
    throw new Error(`${ENGRAM_PROJECT_CONFIG_FILE} framework must be langgraph, mem0, or custom.`);
  }
  const executor = value.executor === undefined ? undefined : projectRelativePath(value.executor, "executor");
  if (!Array.isArray(value.regressions) || value.regressions.length === 0 || value.regressions.length > 20) {
    throw new Error(`${ENGRAM_PROJECT_CONFIG_FILE} regressions must contain 1-20 project-relative paths.`);
  }
  const regressions = value.regressions.map((item) => projectRelativePath(item, "regressions"));
  if (new Set(regressions).size !== regressions.length) {
    throw new Error(`${ENGRAM_PROJECT_CONFIG_FILE} regressions paths must be unique.`);
  }
  return {
    version: 1,
    framework: value.framework,
    ...(executor ? { executor } : {}),
    regressions
  };
}

function projectRelativePath(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || path.isAbsolute(value)) {
    throw new Error(`${ENGRAM_PROJECT_CONFIG_FILE} ${field} must be a project-relative path.`);
  }
  const normalized = path.normalize(value.trim());
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${ENGRAM_PROJECT_CONFIG_FILE} ${field} must stay inside the project.`);
  }
  return normalized;
}

function resolveInsideProject(root: string, value: string) {
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Configured path escapes the project: ${value}`);
  }
  return resolved;
}

async function collectRegressionFiles(
  directory: string,
  entries: Dirent[],
  files: Set<string>
) {
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectRegressionFiles(target, await readdir(target, { withFileTypes: true }), files);
    } else if (entry.isFile() && entry.name.endsWith(".engram-test.json")) {
      files.add(target);
    }
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
