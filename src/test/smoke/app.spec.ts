import { expect, test } from "@playwright/test";

test("loads the Engram shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ENGRAM", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "How Engram works" })).toHaveCount(0);
  await expect(page.getByLabel("Secondary views")).toBeVisible();
  await expect(page.getByLabel("Demo controls")).toBeVisible();
  await expect(page.getByLabel("Chat message")).toBeVisible();
});

test("starts directly without an onboarding gate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Open how Engram works")).toBeVisible();
  await expect(page.getByLabel("Chat message")).toHaveValue("");
});

test("keeps the initial guide compact over the active brain", async ({ page }) => {
  await page.goto("/");

  const guide = await page.getByLabel("Demo controls").boundingBox();

  await expect(page.getByLabel("Current memory receipt")).toHaveCount(0);
  expect(guide).not.toBeNull();
  expect(guide!.height).toBeLessThan(62);
  expect(guide!.y).toBeGreaterThan(500);
});

test("opens a clean recording demo route", async ({ page }) => {
  await page.goto("/demo");

  await expect(page.getByRole("heading", { name: "ENGRAM", exact: true })).toBeVisible();
  await expect(page.getByLabel("Secondary views")).toHaveCount(0);
  await expect(page.getByLabel("Current memory receipt")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Exit recording mode" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run demo" })).toBeVisible();
});

test("exposes brain thumbnail metadata", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('link[rel="icon"][href$="/engram-icon.png"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:image"][content$="/engram-og.png"]')).toHaveCount(1);
  await expect(page.locator('meta[name="twitter:image"][content$="/engram-og.png"]')).toHaveCount(1);
  await expect(page.locator('script[src*="googletagmanager.com/gtag/js?id=G-DQX8CR91QK"]')).toHaveCount(1);
  await expect
    .poll(() => page.locator("script#google-analytics").evaluate((element) => element.textContent ?? ""), {
      timeout: 15_000
    })
    .toContain("G-DQX8CR91QK");
});

test("opens the combined conversation and memory story from the dock", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Story" }).click();
  await expect(page.getByRole("complementary", { name: "Memory story" })).toBeVisible();
});

test("runs the demo and focuses completed memory story turns", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");

  await page.getByRole("button", { name: "Run demo" }).click();
  await expect(page.getByRole("button", { name: "Stop demo" })).toBeVisible();
  await expect(page.locator(".chat-status")).toContainText("DEMO LINE", { timeout: 8_000 });
  await expect(page.getByLabel("Chat message")).toHaveValue("I love the color indigo.");
  await expect(page.getByLabel("Demo controls")).toContainText("I love the color indigo.");
  await expect(page.locator(".chat-status")).toContainText("READY", { timeout: 20_000 });
  await page.getByRole("button", { name: "Stop demo" }).click();
  await expect(page.getByLabel("Current memory receipt")).toContainText(/Stored|Preparing memory/i, { timeout: 12_000 });
  await page.getByRole("button", { name: "Story" }).click({ force: true });
  const timeline = page.getByRole("complementary", { name: "Memory story" });
  await expect(timeline).toBeVisible();
  await expect(page.getByLabel("Timeline turn 1")).toBeVisible({ timeout: 12_000 });
  await page.getByLabel("Timeline turn 1").locator("button").first().click({ force: true });
  await expect(page.getByLabel("Timeline turn 1")).toHaveAttribute("data-active", "true");
  await expect(timeline).toContainText("Stored new memory", { timeout: 12_000 });
  await page.getByRole("button", { name: "Clear focus" }).click();
  await page.getByLabel("Close memory story").click();

  await page.getByRole("button", { name: "Run demo" }).click();
  await expect(page.getByRole("button", { name: "Story 2" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Stop demo" }).click();
  await page.getByRole("button", { name: "Story" }).click({ force: true });
  await expect(page.getByLabel("Timeline turn 2")).toBeVisible({ timeout: 12_000 });
});

test("exposes brain label and reset controls", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/");
  await expect(page.getByLabel("Brain view controls")).toBeVisible();
  await page.getByLabel("Open how Engram works").click();
  await expect(page.getByRole("complementary", { name: "How Engram works" })).toBeVisible();
  await page.getByLabel("Close how Engram works").click();
  await page.getByLabel("Hide brain labels").click();
  await expect(page.getByLabel("Show brain labels")).toBeVisible();
  await expect(page.getByLabel("Reset brain view")).toBeVisible();
  await expect(page.getByLabel("Reset demo session")).toBeVisible();
});

test("resets the demo session from the brain controls", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Chat message").fill("I love the color indigo.");
  await page.getByLabel("Send").click();
  await expect(page.getByRole("button", { name: /^Memories [1-9]/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".chat-status")).toContainText("READY", { timeout: 12_000 });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Reset demo session").evaluate((element) => {
    (element as HTMLButtonElement).click();
  });

  await expect(page.getByLabel("Demo controls")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Memories [1-9]/ })).toHaveCount(0);
  await expect(page.getByLabel("Chat message")).toHaveValue("");
});

test("counts and browses the complete active memory library", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/");

  for (const [index, message] of ["I love the color indigo.", "I spend weekends climbing."].entries()) {
    await page.getByLabel("Chat message").fill(message);
    await page.getByLabel("Send").click();
    await expect(page.getByRole("button", { name: `Memories ${index + 1}` })).toBeVisible({ timeout: 12_000 });
    await expect(page.locator(".chat-status")).toContainText("READY", { timeout: 12_000 });
  }

  const memories = page.getByRole("button", { name: "Memories 2" });
  await expect(memories).toBeVisible();
  await memories.click();
  const library = page.getByRole("complementary", { name: "Memory library" });
  await expect(library).toContainText("2 active");
  await expect(library).toContainText("indigo");
  await expect(library).toContainText("climbing");
});

test("opens region explanations from mobile shortcuts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByLabel("Brain region shortcuts")).toBeVisible();
  await page.getByRole("button", { name: "Open New explanation" }).click();
  const regionPanel = page.getByRole("complementary", { name: "New Memories explanation" });
  await expect(regionPanel).toBeVisible();
  await expect(regionPanel).toContainText("durable facts land");
});

test("keeps mobile memory controls visually separated", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const topbar = await page.locator(".topbar").boundingBox();
  const shortcuts = await page.getByLabel("Brain region shortcuts").boundingBox();
  const guide = await page.getByLabel("Demo controls").boundingBox();

  expect(topbar).not.toBeNull();
  expect(shortcuts).not.toBeNull();
  expect(guide).not.toBeNull();
  expect(shortcuts!.y - (topbar!.y + topbar!.height)).toBeGreaterThan(10);
  expect(guide!.y - (shortcuts!.y + shortcuts!.height)).toBeGreaterThan(420);
  expect(guide!.height).toBeLessThan(54);
});

test("collapses secondary brain controls on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByLabel("Open brain controls")).toBeVisible();
  await expect(page.getByLabel("Reset demo session")).toBeHidden();
  await page.getByLabel("Open brain controls").click();
  await expect(page.getByLabel("Reset demo session")).toBeVisible();
  await expect(page.getByLabel("Close brain controls")).toBeVisible();
});

test("opens working memory details after retrieval", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");

  await page.getByLabel("Chat message").fill("I prefer deep red interfaces and dark dashboards.");
  await page.getByLabel("Send").click();
  await expect(page.getByRole("button", { name: /^Memories [1-9]/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".chat-status")).toContainText("READY", { timeout: 20_000 });

  await page.getByLabel("Chat message").fill("What interface colors do I prefer?");
  await page.getByLabel("Send").click();

  const workingMemory = page.getByRole("button", {
    name: /Open working memory details: ([1-9]|10) of 10 loaded/i
  });
  await expect(workingMemory).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Inspect [1-9] used memor/i })).toBeVisible();
  await page.getByRole("button", { name: /Inspect [1-9] used memor/i }).click();
  await expect(page.getByLabel("Active context panel")).toContainText("loaded into active context");
  await page.getByLabel("Close active context").click();
  await page.getByRole("button", { name: /^Working [1-9]/ }).click({ force: true });
  await expect(page.getByLabel("Active context panel")).toContainText("loaded into active context");
});

test("switches between the anatomical brain and semantic memory map without changing memory state", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/");

  await page.getByLabel("Chat message").fill("I love the color indigo.");
  await page.getByLabel("Send").click();
  await expect(page.getByRole("button", { name: "Memories 1" })).toBeVisible({ timeout: 12_000 });
  await expect(page.locator(".chat-status")).toContainText("READY", { timeout: 12_000 });

  const semanticMap = page.getByRole("radio", { name: "Semantic map" });
  await expect(semanticMap).toBeVisible();
  await semanticMap.click();

  await expect(semanticMap).toBeChecked();
  await expect(page.getByRole("complementary", { name: "Semantic map details" })).toContainText(
    "Distance approximates semantic similarity."
  );
  await expect(page.getByText("I love the color indigo.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Memories 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explain New Memories" })).toHaveCount(0);

  await page.getByRole("radio", { name: "Brain model" }).click();
  await expect(page.getByRole("radio", { name: "Brain model" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Explain New Memories" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Memories 1" })).toBeVisible();
});

test("opens and dismisses Dream Mode after enough memories", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");

  for (const message of [
    "I love California beaches.",
    "I love California redwood hikes.",
    "I love California road trips."
  ]) {
    await page.getByLabel("Chat message").fill(message);
    await page.getByLabel("Send").click();
    await expect(page.getByRole("button", { name: /^Memories [1-9]/ })).toBeVisible({ timeout: 12_000 });
    await expect(page.locator(".chat-status")).toContainText("READY", { timeout: 12_000 });
  }

  const dream = page.getByRole("button", { name: /Dream Ready/i });
  await expect(dream).toBeVisible({ timeout: 12_000 });
  await dream.click();

  const dreamPanel = page.getByRole("complementary", { name: "Dream review" });
  await expect(dreamPanel).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText(/Dream review complete|Model-reviewed memories/)).toBeVisible();
  await expect(dreamPanel).toContainText("Nothing changes until you apply it");
  await expect(page.getByLabel("Current memory receipt")).toContainText(/Dream|Review/i);
  await expect(page.getByRole("button", { name: "Apply dream" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep current memories" })).toBeVisible();

  await page.getByRole("button", { name: "Keep current memories" }).click();
  await expect(dreamPanel).toBeHidden();
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
