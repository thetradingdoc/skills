/**
 * P3 AI-layer understanding — light E2E smoke.
 *
 * Full detectors need a scanned repo; this covers chrome that is always
 * reachable: Layers tab copy for agent-scoped Safety/Observability, and
 * Assessment tab mounting (system layers panel or scan prompt).
 */
import { test, expect } from "@playwright/test";

test.use({ channel: "chrome-for-testing" });

test.describe("P3 AI-layer understanding chrome", () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page, context }) => {
    await context.route("**/src/**", async (route) => {
      const url = route.request().url();
      if (!/\.(tsx|ts|jsx|js)(\?|$)/.test(url)) {
        await route.continue();
        return;
      }
      const base = url.split("?")[0];
      try {
        const res = await route.fetch({ url: `${base}?bust=${Date.now()}` });
        const body = await res.text();
        await route.fulfill({
          response: res,
          body,
          headers: { ...res.headers(), "cache-control": "no-store" },
        });
      } catch {
        await route.continue();
      }
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

  test("[E2E] Design mode still boots after P3 client changes", async ({ page }) => {
    await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("chrome-design-mode")).toBeVisible({ timeout: 15000 });
  });
});
