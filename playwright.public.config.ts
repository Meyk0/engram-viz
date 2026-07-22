import { defineConfig, devices } from "@playwright/test";

const isCi = process.env.CI === "true";
const publicPort = process.env.PLAYWRIGHT_PUBLIC_PORT ?? "3200";
const publicUrl = `http://127.0.0.1:${publicPort}`;

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
    baseURL: publicUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command:
      `npm run build:public && npm run start --workspace @engramviz/web -- --hostname 127.0.0.1 --port ${publicPort}`,
    env: {
      NEXT_PUBLIC_ENGRAM_TEST_SCENE_STATIC: "true"
    },
    url: publicUrl,
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
