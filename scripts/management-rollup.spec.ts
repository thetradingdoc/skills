/**
 * P7 management rollup — E2E smoke specs.
 *
 * Covers: rollup tab renders sections for a from-scratch design, the
 * Unowned filter keeps rows visible (design nodes start unowned since
 * there's no workspace/claims backing them), and adding an Auth node
 * surfaces a Safety-ish section in the rollup.
 *
 * Follows scripts/llmops-manage.spec.ts / collab-export.spec.ts
 * conventions: chrome-for-testing channel, cache-busted source routes,
 * and cleared storage per test.
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

test.describe("P7 management rollup", () => {
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

  // e2e-rollup-design-sections
  test("[E2E] Design from scratch shows management rollup sections", async ({ page }) => {
    await startDesignFromScratch(page);
    await page.getByTestId("palette-auth").click();
    await page.getByTestId("palette-api").click();
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(2, {
      timeout: 10000,
    });

    await page.getByTestId("chrome-tab-rollup").click();
    await expect(page.getByTestId("management-rollup")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("rollup-section-row").first()).toBeVisible({ timeout: 10000 });
    expect(await page.getByTestId("rollup-section-row").count()).toBeGreaterThanOrEqual(1);
  });

  // e2e-rollup-filter-unowned
  test("[E2E] Unowned filter keeps section rows visible for a fresh design", async ({ page }) => {
    await startDesignFromScratch(page);
    await page.getByTestId("palette-auth").click();
    await page.getByTestId("palette-api").click();
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(2, {
      timeout: 10000,
    });

    await page.getByTestId("chrome-tab-rollup").click();
    await expect(page.getByTestId("management-rollup")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("rollup-section-row").first()).toBeVisible({ timeout: 10000 });

    await page.getByTestId("rollup-filter-unowned").click();
    await expect(page.getByTestId("rollup-section-row").first()).toBeVisible({ timeout: 10000 });
    expect(await page.getByTestId("rollup-section-row").count()).toBeGreaterThanOrEqual(1);
  });

  // e2e-rollup-auth-section
  test("[E2E] Adding an Auth node surfaces a matching section in the rollup", async ({ page }) => {
    await startDesignFromScratch(page);
    await page.getByTestId("palette-auth").click();
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(1, {
      timeout: 10000,
    });

    const graph = await page.evaluate(() => (window as any).__llGetDesignGraph());
    const authNode = graph.nodeList.find((n: { label: string }) => n.label === "Auth");
    expect(authNode).toBeTruthy();

    await page.getByTestId("chrome-tab-rollup").click();
    await expect(page.getByTestId("management-rollup")).toBeVisible({ timeout: 10000 });

    const rows = page.getByTestId("rollup-section-row");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const sectionNames = await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-section-name") || "")
    );
    const matchesAuthLayer =
      authNode?.layer && sectionNames.some((n) => n === authNode.layer);
    const matchesAuthName = sectionNames.some((n) => /Safety|auth|Auth/i.test(n));
    expect(matchesAuthLayer || matchesAuthName).toBe(true);
  });
});
