/**
 * Apply trading spine from scan canvas; Rescan stays in bell (not top bar).
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
    await expect(page.getByText("Payment (paper wallet)")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Policy engine")).toBeVisible();
    await expect(page.getByText("Risk engine")).toBeVisible();
    await expect(page.getByText("Execution service")).toBeVisible();
    await expect(page.getByText(/Alpaca/i).first()).toBeVisible();
  });

  test("Export Apply trading agent spine places Payment/Policy/Risk/Execution", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible({ timeout: 20000 });
    // Top-bar Rescan must stay hidden in blanko shell.
    await expect(page.getByTestId("blanko-staleness-rescan")).toHaveCount(0);
    await page.getByTestId("export-menu-toggle").click();
    await expect(page.getByText(/Apply trading agent spine/i)).toBeVisible();
    await page.getByText(/Apply trading agent spine/i).click();
    await expect(page.getByText("Payment (paper wallet)")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Policy engine")).toBeVisible();
    await expect(page.getByText("Risk engine")).toBeVisible();
    await expect(page.getByText("Execution service")).toBeVisible();
  });
});
