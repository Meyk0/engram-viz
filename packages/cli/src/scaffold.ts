import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EngramPackageManager } from "./project.js";
import {
  ENGRAM_PROJECT_CONFIG_FILE,
  readEngramProjectConfig,
  writeEngramProjectConfig
} from "./project-config.js";

export type EngramScaffoldResult = {
  created: string[];
  preserved: string[];
};

export async function scaffoldLangGraphProject(
  directory: string,
  options: { packageManager: EngramPackageManager; projectId: string }
): Promise<EngramScaffoldResult> {
  const root = path.resolve(directory);
  const created: string[] = [];
  const preserved: string[] = [];
  const currentConfig = await readEngramProjectConfig(root);
  if (currentConfig) {
    if (currentConfig.framework !== "langgraph") {
      throw new Error(`${ENGRAM_PROJECT_CONFIG_FILE} already configures ${currentConfig.framework}.`);
    }
    preserved.push(ENGRAM_PROJECT_CONFIG_FILE);
  } else {
    await writeEngramProjectConfig(root, {
      version: 1,
      framework: "langgraph",
      executor: "engram.executor.mjs",
      regressions: ["regressions"]
    });
    created.push(ENGRAM_PROJECT_CONFIG_FILE);
  }

  await writeIfMissing(root, "engram.executor.mjs", executorTemplate(options.projectId), created, preserved);
  await mkdir(path.join(root, "regressions"), { recursive: true });
  await writeIfMissing(
    root,
    path.join(".github", "workflows", "engram-memory-regressions.yml"),
    workflowTemplate(options.packageManager),
    created,
    preserved
  );
  return { created, preserved };
}

async function writeIfMissing(
  root: string,
  relative: string,
  contents: string,
  created: string[],
  preserved: string[]
) {
  const file = path.join(root, relative);
  try {
    await readFile(file, "utf8");
    preserved.push(relative);
    return;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents, { encoding: "utf8", flag: "wx" });
  created.push(relative);
}

function executorTemplate(projectId: string) {
  return `import { defineLangGraphExecutor } from "@engramviz/adapter-langgraph";

// Replace the three marked functions with your graph's replay-safe boundaries.
// The module is shared by Engram Studio and \`engram test\` in CI.
export const ENGRAM_SCAFFOLD_PENDING = true;

export default defineLangGraphExecutor({
  id: "${projectId}-langgraph",
  name: "${projectId} LangGraph agent",
  version: "1.0.0",
  deterministic: false,
  supportedSideEffectModes: ["blocked"],
  async createRuntime() {
    throw new Error("TODO: return a fresh graph, checkpointer, and Store for each replay variant.");
  },
  async applyIntervention() {
    throw new Error("TODO: apply the Engram intervention to the isolated graph state or Store.");
  },
  async observe() {
    throw new Error("TODO: map the completed graph state to a MemoryDecisionRunV3.");
  }
});
`;
}

function workflowTemplate(packageManager: EngramPackageManager) {
  const setup = packageManager === "pnpm"
    ? `      - uses: pnpm/action-setup@v4\n      - uses: actions/setup-node@v7\n        with:\n          node-version: 22\n          cache: pnpm\n      - run: pnpm install --frozen-lockfile\n      - run: pnpm exec engram test --format github --output engram-regression-report.json`
    : packageManager === "yarn"
      ? `      - uses: actions/setup-node@v7\n        with:\n          node-version: 22\n          cache: yarn\n      - run: corepack enable\n      - run: yarn install --immutable\n      - run: yarn exec engram test --format github --output engram-regression-report.json`
      : packageManager === "bun"
        ? `      - uses: oven-sh/setup-bun@v2\n      - run: bun install --frozen-lockfile\n      - run: bunx engram test --format github --output engram-regression-report.json`
        : `      - uses: actions/setup-node@v7\n        with:\n          node-version: 22\n          cache: npm\n      - run: npm ci\n      - run: npx engram test --format github --output engram-regression-report.json`;
  return `name: Engram memory regressions

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  memory-regressions:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
${setup}
      - if: always()
        uses: actions/upload-artifact@v7
        with:
          name: engram-memory-regressions
          path: engram-regression-report.json
          if-no-files-found: warn
          retention-days: 14
`;
}
