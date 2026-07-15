import { spawnSync } from "node:child_process";

const [workspace, version] = process.argv.slice(2);

if (!workspace || !version) {
  console.error("Usage: node scripts/publish-package.mjs <workspace> <version>");
  process.exit(1);
}

const packageVersion = `${workspace}@${version}`;
const lookup = spawnSync("npm", ["view", packageVersion, "version", "--json"], {
  encoding: "utf8",
});

if (lookup.status === 0) {
  console.log(`SKIP  ${packageVersion} is already published`);
  process.exit(0);
}

const lookupOutput = `${lookup.stdout ?? ""}\n${lookup.stderr ?? ""}`;
if (!lookupOutput.includes("E404")) {
  process.stderr.write(lookupOutput);
  process.exit(lookup.status ?? 1);
}

const publish = spawnSync(
  "npm",
  [
    "publish",
    "--workspace",
    workspace,
    "--access",
    "public",
    "--provenance",
  ],
  { stdio: "inherit" },
);

process.exit(publish.status ?? 1);
