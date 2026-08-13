/**
 * Post-V1 — materialize design DAG to disk (UI smoke).
 *
 * Follows scripts/design-loop.spec.ts conventions: cache-busted source
 * routes and cleared storage per test. Path-derivation logic is covered by
 * scripts/test-design-materialize.ts; this proves the "Materialize" button
 * is wired into the design-mode toolbar and reachable once a design has
 * nodes on it.
 *
 * Signed-out is the default state in this harness (no Supabase test creds),
 * so clicking the button should prompt signup rather than call the API —
 * we assert that behavior rather than a real materialize round-trip.
 */
import { test, expect } from "@playwright/test";

test.use({ channel: "chrome-for-testing" });

test.describe("Post-V1 materialize design DAG", () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page, context }) => {
    await context.route("**/src/**", async (route) => {
      const url = route.request().url();
      if (!/\.(tsx|ts|jsx|js)(\?|$)/.test(url)) {
        await route.continue();
        return;
      }
      const base = url.split("?")[0];
      const res = await route.fetch({ url: `${base}?bust=${Date.now()}` });
      const body = await res.text();
      await route.fulfill({
        response: res,
        body,
        headers: { ...res.headers(), "cache-control": "no-store" },
      });
    });
    await page.goto("/");
    await page.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
    });
    await page.reload();
  });

  // e2e-materialize-btn-visible
  test("[E2E] Materialize button is visible in design mode with nodes on the canvas", async ({ page }) => {
    await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("chrome-design-mode")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("palette-api").click();
    await page.getByTestId("palette-db").click();
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(2, {
      timeout: 10000,
    });

    const btn = page.getByTestId("materialize-design-btn");
    await expect(btn).toBeVisible({ timeout: 10000 });
    await expect(btn).toBeEnabled();
  });

  // e2e-materialize-btn-hidden-outside-design-mode
  test("[E2E] Materialize button is absent outside design mode", async ({ page }) => {
    await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
    // Not entering design mode at all — chrome-analyze-mode is the default state.
    await expect(page.getByTestId("chrome-analyze-mode").or(page.getByTestId("design-from-scratch"))).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("materialize-design-btn")).toHaveCount(0);
  });

  // e2e-materialize-signed-out-prompts-signup
  test("[E2E] Clicking Materialize while signed out prompts signup instead of calling the API", async ({
    page,
  }) => {
    await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("chrome-design-mode")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("palette-frontend").click();
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(1, {
      timeout: 10000,
    });

    const btn = page.getByTestId("materialize-design-btn");
    await expect(btn).toBeVisible({ timeout: 10000 });
    await expect(btn).toBeEnabled();

    let apiCalled = false;
    await page.route("**/api/design-materialize", async (route) => {
      apiCalled = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await btn.click();

    await expect(page.getByTestId("onboarding-chat")).toBeVisible({ timeout: 10000 });
    expect(apiCalled).toBe(false);
  });
});
