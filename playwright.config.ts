import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/test/smoke",
  fullyParallel: true,
  // Concurrent WebGL scenes compete heavily for CPU/GPU time in CI and make
  // animation-driven assertions flaky without improving coverage.
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry"
  },
  webServer: {
    command:
      "npm run build && ENGRAM_CHAT_PROVIDER=demo OPENAI_LIVE_ENABLED=false ENGRAM_MEMORY_PLANNER=deterministic OPENAI_MEMORY_PLANNER_ENABLED=false ENGRAM_CONSOLIDATION_PLANNER=deterministic OPENAI_CONSOLIDATION_PLANNER_ENABLED=false ENGRAM_DREAM_PLANNER=deterministic OPENAI_DREAM_PLANNER_ENABLED=false ENGRAM_RETRIEVAL_PROVIDER=lexical OPENAI_RETRIEVAL_ENABLED=false npm run start -- --port 3100",
    url: "http://127.0.0.1:3100",
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
