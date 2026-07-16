import { defineConfig, devices } from "@playwright/test";

const isCi = process.env.CI === "true";

export default defineConfig({
  testDir: "./src/test/public",
  fullyParallel: true,
  timeout: isCi ? 120_000 : 90_000,
  expect: {
    timeout: isCi ? 30_000 : 15_000
  },
  workers: isCi ? 1 : 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "on-first-retry"
  },
  webServer: {
    command:
      "npm run build:public && npm run start --workspace @engramviz/web -- --hostname 127.0.0.1 --port 3200",
    env: {
      NEXT_PUBLIC_ENGRAM_TEST_SCENE_STATIC: "true"
    },
    url: "http://127.0.0.1:3200",
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
