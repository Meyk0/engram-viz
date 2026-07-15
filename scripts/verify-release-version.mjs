import { readFile } from "node:fs/promises";
import path from "node:path";

const expected = process.argv[2];
if (!expected) throw new Error("Usage: verify-release-version.mjs <version>");

const manifests = [
  "packages/core/package.json",
  "packages/sdk/package.json",
  "packages/adapter-mem0/package.json",
  "packages/studio/package.json",
  "packages/cli/package.json"
];
const mismatches = [];
for (const manifest of manifests) {
  const value = JSON.parse(await readFile(path.resolve(manifest), "utf8"));
  if (value.version !== expected) mismatches.push(`${manifest}: ${value.version}`);
}

if (mismatches.length > 0) {
  throw new Error(`Release tag ${expected} does not match package versions:\n${mismatches.join("\n")}`);
}
process.stdout.write(`All Engram packages match v${expected}.\n`);
