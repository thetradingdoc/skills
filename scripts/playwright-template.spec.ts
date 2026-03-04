/**
 * Base Playwright template for UI testing.
 * Copy and customize per module — the agent fills in the URL and assertions
 * based on the architecture graph.
 */
import { test, expect } from "@playwright/test";

test.describe("Architecture UI smoke test", () => {
  test("loads the app", async ({ page }) => {
    // Replace with your app URL — e.g. http://localhost:3000
    await page.goto(process.env.APP_URL ?? "http://localhost:5174");
    await expect(page).toHaveTitle(/.+/);
  });

  test("has expected structure", async ({ page }) => {
    await page.goto(process.env.APP_URL ?? "http://localhost:5174");
    // Add assertions based on graph — e.g. expect element by role
    const body = await page.locator("body");
    await expect(body).toBeVisible();
  });
});
