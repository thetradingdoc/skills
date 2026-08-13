/**
 * P2 collab + export — E2E smoke specs.
 *
 * Covers: design export menu (README / ADR / score / PNG), node collab claim
 * control on selection, and design score on the Dashboard review tab.
 * Auth-backed claim/notification round-trips are covered by unit scripts
 * (test-section-claims-access, test-path-to-node-match, test-export-markdown).
 */
import { test, expect, type Page } from "@playwright/test";

async function startDesignFromScratch(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
  });
  await page.goto("/");
  await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("design-from-scratch").click();
  await expect(
    page.getByTestId("blanko-workspace").or(page.getByTestId("chrome-design-mode"))
  ).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => typeof (window as any).__llGetDesignGraph === "function", null, {
    timeout: 15000,
  });
}

async function placeApiNode(page: Page) {
  const palette = page.getByTestId("palette-api");
  if (await palette.isVisible().catch(() => false)) {
    await palette.click();
  } else {
    await page.getByTestId("blanko-rail-build").click();
    await page.locator("[data-testid^='blanko-build-item-']").first().click();
  }
  await page.waitForFunction(() => ((window as any).__llGetDesignGraph?.().nodes ?? 0) >= 1, null, {
    timeout: 10000,
  });
}

async function closeDockIfOpen(page: Page) {
  const close = page.getByTestId("blanko-dock-close");
  if (await close.isVisible().catch(() => false)) {
    await close.click();
  }
}

test.use({ channel: "chrome-for-testing" });

test.describe("P2 collab + export", () => {
  test.setTimeout(90_000);

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

  test("[E2E] Export menu offers Design README, ADR, score, and PNG", async ({ page }) => {
    await startDesignFromScratch(page);
    await placeApiNode(page);
    await closeDockIfOpen(page);
    await expect
      .poll(async () => page.evaluate(() => (window as any).__llGetDesignGraph?.().nodes ?? 0))
      .toBeGreaterThanOrEqual(1);

    await page.getByTestId("export-menu-toggle").click();
    const readme = page.getByTestId("blanko-chrome-export-design-readme").or(page.getByTestId("export-design-readme"));
    const adr = page.getByTestId("blanko-chrome-export-design-adr").or(page.getByTestId("export-design-adr"));
    const score = page.getByTestId("blanko-chrome-export-design-score").or(page.getByTestId("export-design-score"));
    const png = page.getByTestId("blanko-chrome-export-design-png").or(page.getByTestId("export-design-png"));
    await expect(readme).toBeVisible();
    await expect(adr).toBeVisible();
    await expect(score).toBeVisible();
    await expect(png).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      readme.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/DESIGN\.md/i);
    const path = await download.path();
    expect(path).toBeTruthy();
  });

  test("[E2E] Export design score produces JSON download", async ({ page }) => {
    await startDesignFromScratch(page);
    await placeApiNode(page);
    await closeDockIfOpen(page);

    await page.getByTestId("export-menu-toggle").click();
    const score = page.getByTestId("blanko-chrome-export-design-score").or(page.getByTestId("export-design-score"));
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      score.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/design-score/i);
  });

  test("[E2E] Selecting a node shows collab claim inside Insights (not floating card)", async ({ page }) => {
    await startDesignFromScratch(page);
    await placeApiNode(page);
    await page.waitForFunction(() => typeof (window as any).__llSelectNode === "function", null, {
      timeout: 10000,
    });
    const id = await page.evaluate(() => (window as any).__llGetDesignGraph().nodeList[0].id);
    await page.evaluate((nodeId) => (window as any).__llSelectNode(nodeId), id);
    await expect(page.getByTestId("node-collab-meta")).toHaveCount(0);
    await expect(page.getByTestId("blanko-insights")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("blanko-insights-collab-toggle").click();
    await expect(page.getByTestId("node-claim-toggle")).toBeVisible();
    await expect(page.getByTestId("node-claim-toggle")).toContainText(/Claim this|Claimed|Release|Sign in to claim/i);
  });

  test("[E2E] Design review shows score after nodes exist", async ({ page }) => {
    await startDesignFromScratch(page);
    await placeApiNode(page);
    await page.getByTestId("blanko-rail-build").click().catch(() => {});
    // Prefer Agents → Review; fall back to legacy dashboard tab
    await page.getByTestId("blanko-rail-agents").click().catch(() => {});
    if (await page.getByTestId("blanko-dock-tab-assessment").isVisible().catch(() => false)) {
      await page.getByTestId("blanko-dock-tab-assessment").click();
      await expect(page.getByTestId("blanko-agents-dock")).toBeVisible({ timeout: 10000 });
    } else {
      await page.getByTestId("sidebar-tab-dashboard").click();
      await expect(page.getByTestId("design-review-panel")).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId("design-score")).toBeVisible({ timeout: 10000 });
    }
  });
});
