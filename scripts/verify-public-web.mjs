import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = import.meta.url.startsWith("file:") ? fileURLToPath(import.meta.url) : undefined;
const repositoryRoot = modulePath ? path.dirname(path.dirname(modulePath)) : process.cwd();
const defaultWebRoot = path.join(repositoryRoot, "apps", "web");
const secretEnvironmentNames = [
  "OPENAI_API_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ENGRAM_INGEST_KEYS_JSON",
  "ENGRAM_LOCAL_DATA_DIR",
  "ENGRAM_TOKEN"
];

export async function verifyPublicWeb({ webRoot = defaultWebRoot, environment = process.env } = {}) {
  const failures = [];
  const manifestPath = path.join(webRoot, ".next", "routes-manifest.json");
  let routes = [];

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    routes = [...(manifest.staticRoutes ?? []), ...(manifest.dynamicRoutes ?? [])]
      .map((route) => route.page)
      .filter((route) => typeof route === "string");
  } catch (error) {
    failures.push(`could not read public route manifest: ${errorMessage(error)}`);
  }

  for (const requiredRoute of ["/", "/demo"]) {
    if (!routes.includes(requiredRoute)) failures.push(`public route manifest is missing ${requiredRoute}`);
  }
  for (const route of routes) {
    if (route === "/api" || route.startsWith("/api/")) {
      failures.push(`public route manifest contains server route ${route}`);
    }
  }

  const outputRoots = [
    path.join(webRoot, ".next", "static"),
    path.join(webRoot, ".next", "server", "app"),
    path.join(webRoot, "out")
  ];
  const outputFiles = [];
  for (const outputRoot of outputRoots) outputFiles.push(...await walkFiles(outputRoot));
  if (outputFiles.length === 0) failures.push("public build output is missing");

  const markers = secretEnvironmentNames.map((name) => ({ label: name, value: name }));
  for (const name of secretEnvironmentNames) {
    const value = environment[name];
    if (typeof value === "string" && value.length >= 8) markers.push({ label: `${name} value`, value });
  }

  for (const file of outputFiles) {
    if (!await isScannable(file)) continue;
    const content = await readFile(file, "utf8");
    for (const marker of markers) {
      if (content.includes(marker.value)) {
        failures.push(`public output contains server-secret marker ${marker.label}: ${relative(webRoot, file)}`);
      }
    }
  }

  return {
    failures: [...new Set(failures)],
    routes: [...new Set(routes)].sort(),
    scannedFiles: outputFiles.length
  };
}

if (modulePath && process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const result = await verifyPublicWeb();
  if (result.failures.length > 0) {
    result.failures.forEach((failure) => process.stderr.write(`FAIL  ${failure}\n`));
    process.exitCode = 1;
  } else {
    process.stdout.write(`PASS  public route manifest contains / and /demo with no API routes\n`);
    process.stdout.write(`PASS  ${result.scannedFiles} public output files contain no server-secret markers\n`);
  }
}

async function walkFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute));
    if (entry.isFile()) files.push(absolute);
  }
  return files;
}

async function isScannable(file) {
  const metadata = await stat(file);
  if (metadata.size > 10_000_000) return false;
  const extension = path.extname(file).toLowerCase();
  return ![".avif", ".gif", ".glb", ".ico", ".jpeg", ".jpg", ".png", ".webp", ".woff", ".woff2"].includes(extension);
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
