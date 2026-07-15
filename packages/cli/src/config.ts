import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type EngramLocalConfig = {
  version: 1;
  projectId: string;
  tenantId: string;
  keyId: string;
  token: string;
};

export async function initializeEngramProject(directory: string, projectName?: string) {
  const root = path.resolve(directory);
  const engramDirectory = path.join(root, ".engram");
  const configPath = path.join(engramDirectory, "config.json");
  try {
    return { config: await readEngramConfig(root), created: false, configPath };
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const token = `engram_local_${randomBytes(24).toString("base64url")}`;
  const projectId = slug(projectName ?? path.basename(root)) || "engram-project";
  const config: EngramLocalConfig = {
    version: 1,
    projectId,
    tenantId: "local",
    keyId: `local-${projectId}`,
    token
  };
  await mkdir(engramDirectory, { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(path.join(engramDirectory, ".gitignore"), "config.json\ndata/\n", "utf8");
  await ensureRootIgnore(root);
  return { config, created: true, configPath };
}

export async function readEngramConfig(directory: string): Promise<EngramLocalConfig> {
  const value = JSON.parse(await readFile(path.join(path.resolve(directory), ".engram", "config.json"), "utf8")) as unknown;
  if (!isRecord(value) || value.version !== 1) throw new Error(".engram/config.json has an unsupported format.");
  for (const field of ["projectId", "tenantId", "keyId", "token"] as const) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw new Error(`.engram/config.json is missing ${field}.`);
    }
  }
  return value as EngramLocalConfig;
}

export function localAgentEnvironment(config: EngramLocalConfig, port: number) {
  return {
    ENGRAM_URL: `http://localhost:${port}`,
    ENGRAM_TOKEN: config.token,
    ENGRAM_PROJECT_ID: config.projectId
  };
}

export function localStudioEnvironment(config: EngramLocalConfig, root: string, port: number) {
  return {
    ...localAgentEnvironment(config, port),
    ENGRAM_LOCAL_MODE: "true",
    ENGRAM_LOCAL_DATA_DIR: path.join(path.resolve(root), ".engram", "data"),
    ENGRAM_INGEST_KEYS_JSON: JSON.stringify([{
      keyId: config.keyId,
      tenantId: config.tenantId,
      projectId: config.projectId,
      tokenSha256: createHash("sha256").update(config.token).digest("hex")
    }])
  };
}

async function ensureRootIgnore(root: string) {
  const gitignore = path.join(root, ".gitignore");
  let value = "";
  try {
    value = await readFile(gitignore, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (value.split(/\r?\n/).includes(".engram/config.json")) return;
  const prefix = value && !value.endsWith("\n") ? "\n" : "";
  await appendFile(gitignore, `${prefix}.engram/config.json\n.engram/data/\n`, "utf8");
}

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
