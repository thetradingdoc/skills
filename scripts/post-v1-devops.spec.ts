/**
 * Post-V1 DevOps health — E2E smoke spec.
 *
 * Covers: design mode → DevOps tab is visible and clickable → the
 * devops-health root renders. Follows scripts/management-rollup.spec.ts /
 * scripts/llmops-manage.spec.ts conventions: chrome-for-testing channel,
 * cache-busted source routes, and cleared storage per test.
 */
import { test, expect, type Page } from "@playwright/test";

async function startDesignFromScratch(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("design-from-scratch").click();
  await expect(page.getByTestId("chrome-design-mode")).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => typeof (window as any).__llGetDesignGraph === "function", null, {
    timeout: 15000,
  });
}

test.use({ channel: "chrome-for-testing" });

test.describe("Post-V1 DevOps health", () => {
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

  // e2e-devops-tab-visible
  test("[E2E] Design mode shows a DevOps tab that opens the devops-health view", async ({ page }) => {
    await startDesignFromScratch(page);

    await expect(page.getByTestId("chrome-tab-devops")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("chrome-tab-devops").click();
    await expect(page.getByTestId("devops-health")).toBeVisible({ timeout: 10000 });
  });

  // e2e-devops-nodes-and-filters
  test("[E2E] Adding nodes surfaces rows in DevOps health with working filters", async ({ page }) => {
    await startDesignFromScratch(page);
    await page.getByTestId("palette-auth").click();
    await page.getByTestId("palette-api").click();
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(2, {
      timeout: 10000,
    });

    await page.getByTestId("chrome-tab-devops").click();
    await expect(page.getByTestId("devops-health")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("devops-node-row").first()).toBeVisible({ timeout: 10000 });
    expect(await page.getByTestId("devops-node-row").count()).toBeGreaterThanOrEqual(2);

    await page.getByTestId("devops-filter-all").click();
    expect(await page.getByTestId("devops-node-row").count()).toBeGreaterThanOrEqual(2);

    // Nodes fresh off the palette have no CI/env signal yet, so hotspots is
    // empty and "no rows" empty-state is expected rather than a crash.
    await page.getByTestId("devops-filter-hotspots").click();
    await expect(page.getByTestId("devops-health")).toBeVisible();

    await page.getByTestId("devops-filter-missing-env").click();
    await expect(page.getByTestId("devops-health")).toBeVisible();
  });
});
