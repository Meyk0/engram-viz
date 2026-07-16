import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "LICENSE",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md"
];
const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8"
}).split("\0").filter(Boolean);
const secretPatterns = [
  /sk-(?:proj-)?[A-Za-z0-9_-]{40,}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /npm_[A-Za-z0-9]{30,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/
];
const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) failures.push(`missing required public file: ${file}`);
}

for (const file of trackedFiles) {
  if (isSensitivePath(file)) failures.push(`sensitive path is tracked: ${file}`);
  const absolute = path.join(root, file);
  if (statSync(absolute).size > 1_000_000 || isBinaryAsset(file)) continue;
  const value = readFileSync(absolute, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(value)) failures.push(`possible credential in tracked file: ${file}`);
  }
}

const notices = readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
for (const source of [
  "lobes-of-the-cerebrum-2d4eccc2e6624aed8b78c70a075c8ed6",
  "brain-areas-d64608a3978b47d8a39c5a15795ca8c4",
  "the-brain-007847f9d2b5481a882d8996c0fd1847"
]) {
  if (!notices.includes(source)) failures.push(`missing brain-model attribution: ${source}`);
}

if (failures.length > 0) {
  failures.forEach((failure) => process.stderr.write(`FAIL  ${failure}\n`));
  process.exitCode = 1;
} else {
  process.stdout.write(`PASS  ${trackedFiles.length} tracked files are ready for public release\n`);
  process.stdout.write("PASS  required community and security files are present\n");
  process.stdout.write("PASS  third-party brain assets retain CC BY 4.0 attribution\n");
}

function isSensitivePath(file) {
  const normalized = `/${file.toLowerCase()}`;
  if (file === ".env.example") return false;
  return /\/(\.env(?:\.|$)|\.engram\/config\.json$|\.engram\/data\/)/.test(normalized)
    || /\.(pem|key|p12|pfx|jks|keystore)$/i.test(file);
}

function isBinaryAsset(file) {
  return /\.(glb|gltf|png|jpe?g|gif|webp|ico|woff2?)$/i.test(file);
}
