import { defineConfig, devices } from "@playwright/test";

const isCi = process.env.CI === "true";
const studioPort = process.env.PLAYWRIGHT_STUDIO_PORT ?? "3100";
const studioUrl = `http://127.0.0.1:${studioPort}`;

export default defineConfig({
  testDir: "./src/test/smoke",
  fullyParallel: true,
  timeout: isCi ? 180_000 : 120_000,
  expect: {
    timeout: isCi ? 30_000 : 10_000
  },
  // Hosted runners use one WebGL context per shard; local machines can safely
  // exercise two browser workers for a faster feedback loop.
  workers: isCi ? 1 : 2,
  reporter: "list",
  use: {
    baseURL: studioUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command:
      `npm run build && ENGRAM_CHAT_PROVIDER=demo OPENAI_LIVE_ENABLED=false ENGRAM_MEMORY_PLANNER=deterministic OPENAI_MEMORY_PLANNER_ENABLED=false ENGRAM_CONSOLIDATION_PLANNER=deterministic OPENAI_CONSOLIDATION_PLANNER_ENABLED=false ENGRAM_DREAM_PLANNER=deterministic OPENAI_DREAM_PLANNER_ENABLED=false ENGRAM_RETRIEVAL_PROVIDER=lexical OPENAI_RETRIEVAL_ENABLED=false PORT=${studioPort} HOSTNAME=127.0.0.1 npm run start`,
    env: {
      NEXT_PUBLIC_ENGRAM_TEST_SCENE_STATIC: "true"
    },
    url: studioUrl,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
