import { expect, test } from "@playwright/test";

test("loads the Engram shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ENGRAM" })).toBeVisible();
  await expect(page.getByLabel("Current memory event")).toContainText("Ready for a memory");
  await expect(page.getByLabel("Secondary views")).toBeVisible();
  await expect(page.getByLabel("Chat transcript")).toBeHidden();
  await expect(page.getByLabel("Chat message")).toBeVisible();
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

test("renders a nonblank brain canvas", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();

  await expect
    .poll(async () =>
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
      })
    )
    .toBeGreaterThan(40);
});
