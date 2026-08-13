/**
 * Apply trading spine from scan canvas; Rescan stays in bell (not top bar).
 * Leaving spine: chrome ← Code map (or Insights / ⋮).
 */
import { test, expect } from "@playwright/test";

test.describe("trading spine board", () => {
  test("fork Trading agent blueprint shows locked spine", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByTestId("design-blueprint-gallery-toggle");
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
    }
    await expect(page.getByTestId("design-blueprint-trading-agent")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("design-blueprint-fork-trading-agent").click();
    await expect(page.getByText(/Telegram \/ Trading Chat/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Policy engine").first()).toBeVisible();
    await expect(page.getByText("Risk engine").first()).toBeVisible();
    await expect(page.getByText("Execution service").first()).toBeVisible();
    await expect(page.getByText(/Alpaca/i).first()).toBeVisible();
  });

  test("after Apply spine, Insights offers Show code scan to leave the board", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("export-menu-toggle").click();
    await page.getByText(/Apply trading agent spine/i).click();
    await expect(page.getByText("Policy engine").first()).toBeVisible({ timeout: 10000 });
    // Apply spine opens Insights — open via rail only if closed (do not toggle closed).
    const insights = page.getByTestId("blanko-insights");
    if (!(await insights.isVisible().catch(() => false))) {
      await page.getByTestId("blanko-rail-insights").click();
    }
    await expect(insights).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("blanko-show-code-scan-cta")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("blanko-show-code-scan")).toBeVisible();
    await expect(page.getByText(/money-path board/i)).toBeVisible();
    await expect(page.getByTestId("chrome-back-code-map")).toBeVisible();
  });

  test("Export Apply trading agent spine places Payment/Policy/Risk/Execution", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("blanko-staleness-rescan")).toHaveCount(0);
    await page.getByTestId("export-menu-toggle").click();
    await expect(page.getByText(/Apply trading agent spine/i)).toBeVisible();
    await page.getByText(/Apply trading agent spine/i).click();
    await expect(page.getByText("Payment (paper wallet)").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Policy engine").first()).toBeVisible();
    await expect(page.getByText("Risk engine").first()).toBeVisible();
    await expect(page.getByText("Execution service").first()).toBeVisible();
  });

  test("chrome ← Code map leaves spine after Apply", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("export-menu-toggle").click();
    await page.getByText(/Apply trading agent spine/i).click();
    await expect(page.getByText("Policy engine").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("chrome-money-path-chip")).toBeVisible();
    const back = page.getByTestId("chrome-back-code-map");
    await expect(back).toBeVisible({ timeout: 5000 });
    await back.click();
    // Stash restore (scratch nodes) or rescan/Import — spine chrome Back must go away.
    await expect(page.getByTestId("chrome-back-code-map")).toHaveCount(0, { timeout: 30000 });
    await expect(page.getByTestId("chrome-money-path-chip")).toHaveCount(0);
  });
});
