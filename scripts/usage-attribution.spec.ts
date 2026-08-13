/**
 * P5 usage attribution — E2E smoke.
 */
import { test, expect } from "@playwright/test";

test.use({ channel: "chrome-for-testing" });

test.describe("P5 usage attribution", () => {
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

  test("[E2E] Usage tab is reachable from design mode", async ({ page }) => {
    await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-workspace").or(page.getByTestId("chrome-design-mode"))).toBeVisible({
      timeout: 15000,
    });
    const usageChrome = page.getByTestId("chrome-tab-usage");
    if (await usageChrome.isVisible().catch(() => false)) {
      await usageChrome.click();
      await expect(page.getByTestId("usage-view")).toBeVisible({ timeout: 10000 });
    } else {
      await page.getByTestId("blanko-rail-agents").click();
      await page.getByTestId("blanko-dock-tab-usage").click();
      await expect(page.getByTestId("blanko-agents-dock")).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByTestId("usage-view").or(page.getByText(/Sign in to see usage/i))
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test("[E2E] Selecting a node shows usage burn block", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
    });
    await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-workspace").or(page.getByTestId("chrome-design-mode"))).toBeVisible({
      timeout: 15000,
    });
    await page.getByTestId("palette-api").click().catch(async () => {
      await page.getByTestId("blanko-rail-build").click();
      await page.locator("[data-testid^='blanko-build-item-']").first().click();
    });
    await page.waitForFunction(() => ((window as any).__llGetDesignGraph?.().nodes ?? 0) >= 1, null, {
      timeout: 10000,
    });
    await page.waitForFunction(() => typeof (window as any).__llSelectNode === "function");
    const id = await page.evaluate(() => (window as any).__llGetDesignGraph().nodeList[0].id);
    await page.evaluate((nodeId) => (window as any).__llSelectNode(nodeId), id);
    await expect(page.getByTestId("node-collab-meta")).toHaveCount(0);
    await expect(page.getByTestId("blanko-insights")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("blanko-insights-collab-toggle").click();
    await expect(page.getByTestId("node-usage-burn")).toBeVisible();
  });
});
