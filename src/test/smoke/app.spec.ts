import { expect, test } from "@playwright/test";

test("loads the Engram shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ENGRAM", exact: true })).toBeVisible();
  await expect(page.getByLabel("Engram memory model introduction")).toContainText("stores, retrieves, and uses");
  await expect(page.getByLabel("Secondary views")).toBeVisible();
  await expect(page.getByLabel("Chat transcript")).toBeHidden();
  await expect(page.getByLabel("Chat message")).toBeVisible();
});

test("starts onboarding without prefilled text", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByLabel("Engram memory model introduction")).toBeHidden();
  await expect(page.getByLabel("Chat message")).toHaveValue("");
});

test("exposes brain thumbnail metadata", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('link[rel="icon"][href$="/engram-icon.png"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:image"][content$="/engram-og.png"]')).toHaveCount(1);
  await expect(page.locator('meta[name="twitter:image"][content$="/engram-og.png"]')).toHaveCount(1);
});

test("opens transcript only from the dock", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Transcript" }).click();
  await expect(page.getByLabel("Chat transcript")).toBeVisible();
});

test("exposes brain label and reset controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Brain view controls")).toBeVisible();
  await page.getByLabel("Hide brain labels").click();
  await expect(page.getByLabel("Show brain labels")).toBeVisible();
  await page.getByLabel("Reset brain view").click();
});

test("opens region explanations from mobile shortcuts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Start", exact: true }).click();

  await expect(page.getByLabel("Brain region shortcuts")).toBeVisible();
  await page.getByRole("button", { name: "Open New explanation" }).click();
  const regionPanel = page.getByRole("complementary", { name: "New Memories explanation" });
  await expect(regionPanel).toBeVisible();
  await expect(regionPanel).toContainText("durable facts land");
});

test("keeps mobile memory controls visually separated", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Start", exact: true }).click();

  const topbar = await page.locator(".topbar").boundingBox();
  const shortcuts = await page.getByLabel("Brain region shortcuts").boundingBox();
  const receipt = await page.getByLabel("Current memory receipt").boundingBox();

  expect(topbar).not.toBeNull();
  expect(shortcuts).not.toBeNull();
  expect(receipt).not.toBeNull();
  expect(shortcuts!.y - (topbar!.y + topbar!.height)).toBeGreaterThan(10);
  expect(receipt!.y - (shortcuts!.y + shortcuts!.height)).toBeGreaterThan(20);
});

test("opens working memory details after retrieval", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Chat message").fill("I prefer deep red interfaces and dark dashboards.");
  await page.getByLabel("Send").click();
  await expect(page.getByRole("button", { name: /Memory/i })).toBeVisible({ timeout: 10_000 });

  await page.getByLabel("Chat message").fill("What interface colors do I prefer?");
  await page.getByLabel("Send").click();

  const workingMemory = page.getByRole("button", {
    name: /Open working memory details: ([1-9]|10) of 10 loaded/i
  });
  await expect(workingMemory).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /Context/i }).click();
  await expect(page.getByLabel("Active context panel")).toContainText("loaded into active context");
});

test("renders a nonblank brain canvas", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("canvas").first();
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
      { timeout: 15_000 }
    )
    .toBeGreaterThan(40);
});
