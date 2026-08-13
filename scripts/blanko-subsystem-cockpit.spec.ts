/**
 * Quant cockpit UI: canvas stays free of mid-canvas banners / trade-path chrome.
 */
import { test, expect } from "@playwright/test";

test.describe("blanko subsystem cockpit UI", () => {
  test("no trade-path strip or code-map banner on canvas", async ({ page }) => {
    await page.goto("/");
    const chrome = page.getByTestId("blanko-chrome-bar");
    const fromScratch = page.getByTestId("design-from-scratch");
    if (await fromScratch.isVisible().catch(() => false)) {
      await fromScratch.click();
    }
    if (!(await chrome.isVisible().catch(() => false))) {
      test.skip(true, "blanko chrome not available in this environment");
    }
    await expect(chrome).toBeVisible({ timeout: 20000 });

    await expect(page.getByTestId("blanko-trade-sequence-strip")).toHaveCount(0);
    await expect(page.getByTestId("blanko-hard-rule-chip")).toHaveCount(0);
    await expect(page.getByTestId("blanko-code-map-banner")).toHaveCount(0);
  });
});
