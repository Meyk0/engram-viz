import { expect, test } from "@playwright/test";

test("loads the Engram shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ENGRAM" })).toBeVisible();
  await expect(page.getByLabel("Memory event stream")).toBeVisible();
  await expect(page.getByLabel("Chat message")).toBeVisible();
});
