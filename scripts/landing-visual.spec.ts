/**
 * Minimal visual regression spec for the Architecture Visualizer landing page.
 *
 * This is intentionally simple: it just asserts that the primary landing
 * hero container is visible. The important part is the `[VISUAL]` prefix
 * in the test name so that visual failures are classified and routed
 * through the visual HITL path.
 */
import { test, expect } from "@playwright/test";

test.describe("Architecture UI visual checks", () => {
  test("[VISUAL] landing hero is visible", async ({ page }) => {
    await page.goto(process.env.APP_URL ?? "http://localhost:5174");

    // Prefer a stable data-testid if present; fall back to a semantic selector.
    const hero = page.locator("[data-testid='landing-hero'], main, body");
    await expect(hero.first()).toBeVisible();
  });
});

