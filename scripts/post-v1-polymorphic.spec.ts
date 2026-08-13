/**
 * Post-V1 polymorphic property/schema panel — E2E smoke.
 *
 * Covers: adding a Postgres node from the palette in a from-scratch design,
 * selecting it, and confirming the inspect panel's Properties section
 * renders a connection-related field driven by nodePropertySchemas.
 *
 * Follows scripts/management-rollup.spec.ts / greenfield-canvas.spec.ts
 * conventions: chrome-for-testing channel, cache-busted source routes,
 * cleared storage per test, and the __llGetDesignGraph escape hatch when
 * palette testids alone aren't enough to pin down a node.
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

test.describe("Post-V1 polymorphic property/schema panel", () => {
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

  // e2e-polymorphic-postgres-properties
  test("[E2E] Postgres node from palette shows a connection-related properties field", async ({ page }) => {
    await startDesignFromScratch(page);

    await page.getByTestId("palette-postgres").click();
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(1, {
      timeout: 10000,
    });

    // The freshly placed node is auto-selected and opens the inspect panel;
    // fall back to clicking it on canvas via the design graph SoT if not.
    if ((await page.getByTestId("design-inspect").count()) === 0) {
      const graph = await page.evaluate(() => (window as any).__llGetDesignGraph());
      const postgresNode = graph.nodeList.find((n: { label: string }) => n.label === "Postgres");
      expect(postgresNode).toBeTruthy();
      await page.locator(`.react-flow__node[data-id="${postgresNode.id}"]`).click();
    }

    await expect(page.getByTestId("design-inspect")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("design-inspect-properties")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("design-inspect-prop-connectionString")).toBeVisible();

    // Editing the field round-trips through node.properties (design graph SoT).
    await page.getByTestId("design-inspect-prop-connectionString").fill("postgres://localhost:5432/app");
    await expect(page.getByTestId("design-inspect-prop-connectionString")).toHaveValue(
      "postgres://localhost:5432/app"
    );
  });

  // e2e-polymorphic-api-authtype
  test("[E2E] API node shows an authType enum field", async ({ page }) => {
    await startDesignFromScratch(page);

    await page.getByTestId("palette-api").click();
    await expect(page.getByTestId("design-inspect")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("design-inspect-properties")).toBeVisible({ timeout: 10000 });
    const authType = page.getByTestId("design-inspect-prop-authType");
    await expect(authType).toBeVisible();
    await expect(authType).toHaveValue("none");
    await authType.selectOption("jwt");
    await expect(authType).toHaveValue("jwt");
  });

  // e2e-polymorphic-unknown-no-properties
  test("[E2E] An unmapped component (CDN) shows no Properties section", async ({ page }) => {
    await startDesignFromScratch(page);

    await page.getByTestId("palette-cdn").click();
    await expect(page.getByTestId("design-inspect")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("design-inspect-properties")).toHaveCount(0);
  });
});
