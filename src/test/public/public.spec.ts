import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectNonblankCanvas(canvas: Locator) {
  await expect(canvas).toBeVisible();
  await expect
    .poll(
      async () =>
        canvas.evaluate((element) => {
          const source = element as HTMLCanvasElement;
          const probe = document.createElement("canvas");
          probe.width = 48;
          probe.height = 48;
          const context = probe.getContext("2d");
          if (!context) return 0;
          context.drawImage(source, 0, 0, probe.width, probe.height);
          const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
          let nonBlackPixels = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index] > 8 || pixels[index + 1] > 8 || pixels[index + 2] > 8) {
              nonBlackPixels += 1;
            }
          }
          return nonBlackPixels;
        }),
      { timeout: 20_000 }
    )
    .toBeGreaterThan(40);
}

test("presents the public product promise without Studio controls", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Replay and regression-test agent memory policies." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Run the guided incident" })).toHaveAttribute("href", "/demo");
  await expect(page.getByLabel("Guided demo command", { exact: true })).toContainText(
    "npx --yes @engramviz/cli demo stale-location"
  );
  await expect(page.getByText("Open source / local memory evidence")).toHaveCount(0);
  const incidentWorkflow = page.getByRole("navigation", { name: "Incident workflow" });
  await expect(incidentWorkflow.getByRole("button")).toHaveCount(4);
  await incidentWorkflow.getByRole("button", { name: "02 Intervene" }).click();
  await expect(page.getByRole("heading", { name: "Change the policy, not the trace." })).toBeVisible();
  await expect(page.getByLabel("Chat message")).toHaveCount(0);
  await expect(page.getByLabel("Engram mode")).toHaveCount(0);
  await expect(page.getByText("Import a recorded trace", { exact: true })).toHaveCount(0);
  await expect(page.locator('script[src*="googletagmanager.com/gtag/js?id=G-DQX8CR91QK"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Explain Working Memory" })).toHaveCount(0);
  await expectNonblankCanvas(page.locator("canvas").first());
});

test("keeps the command and visual signature clear on the mobile landing page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Replay and regression-test agent memory policies." })).toBeVisible();
  await expect(page.getByLabel("Guided demo command", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Run the guided incident" })).toBeVisible();
  await expectNonblankCanvas(page.locator("canvas").first());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("repairs the six-step fixture incident without calling an Engram API", async ({ page, context }) => {
  const applicationApiRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api" || pathname.startsWith("/api/")) applicationApiRequests.push(pathname);
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:3200"
  });

  await page.goto("/demo");
  const steps = page.getByRole("navigation", { name: "Guided demo steps" }).getByRole("button");
  await expect(steps).toHaveCount(6);
  for (const name of ["Store", "Correct", "Diagnose", "Intervene", "Replay", "Prove"]) {
    await expect(steps.filter({ hasText: name })).toHaveCount(1);
  }

  const next = page.getByRole("button", { name: /^Next/ });
  await next.click();
  await expect(page.locator(".public-demo")).toHaveAttribute("data-step", "correct");
  await next.click();
  await expect(page.locator(".public-demo")).toHaveAttribute("data-step", "diagnose");
  await expect(page.getByRole("heading", { name: "A stale fact remained active" })).toBeVisible();
  await next.click();
  await expect(page.locator(".public-demo")).toHaveAttribute("data-step", "intervene");
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "Run policy replay" }).click();
  await expect(page.getByRole("button", { name: "Replay complete" })).toBeDisabled();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.locator(".public-demo")).toHaveAttribute("data-step", "replay");
  await expect(page.getByText("Baseline reproduced; treatment passed")).toBeVisible();
  await expect(page.getByText("You live in Oakland.", { exact: true })).toBeVisible();
  await next.click();
  await expect(page.locator(".public-demo")).toHaveAttribute("data-step", "prove");
  await expect(page.getByText(/provider retrieval not rerun/i)).toBeVisible();
  const regressionDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download v2 regression contract" }).click();
  expect((await regressionDownload).suggestedFilename()).toBe("engram-stale-location-v2.engram-test.json");

  await page.getByRole("button", { name: "Copy local demo command" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    "npx --yes @engramviz/cli demo stale-location"
  );
  expect(applicationApiRequests).toEqual([]);
});

test("keeps the public deployment free of application API routes", async ({ request }) => {
  const replay = await request.post("/api/lab/replay", { data: {} });
  const ingest = await request.post("/api/local/traces", { data: {} });

  expect(replay.status()).toBe(404);
  expect(ingest.status()).toBe(404);
});

test("keeps the brain and demo controls usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");

  await expectNonblankCanvas(page.locator("canvas").first());
  await expect(page.getByRole("navigation", { name: "Guided demo steps" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Next/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explain Working Memory" })).toHaveCount(0);
  const sceneBox = await page.getByRole("region", { name: "Engram 3D brain scene" }).boundingBox();
  expect(sceneBox?.height).toBeGreaterThanOrEqual(280);
  for (const button of await page.locator(".public-demo-transport button, .public-demo-next button").all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  for (const button of await page.getByRole("navigation", { name: "Guided demo steps" }).getByRole("button").all()) {
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("keeps the intervention action reachable on a short mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto("/demo");

  const next = page.getByRole("button", { name: /^Next/ });
  await next.click();
  await next.click();
  await next.click();
  await expect(page.locator(".public-demo")).toHaveAttribute("data-step", "intervene");

  const action = page.getByRole("button", { name: "Run policy replay" });
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeVisible();
  const box = await action.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(54);
  expect(box!.y + box!.height).toBeLessThanOrEqual(667 - 154);
  await action.click();
  await expect(page.getByRole("button", { name: "Replay complete" })).toBeDisabled();
  await expect(next).toBeEnabled();
});
