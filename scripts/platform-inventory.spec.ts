/**
 * P4 platform inventory — E2E smoke (Blanko shell).
 */
import { test, expect } from "@playwright/test";

test.describe("P4 platform inventory", () => {
  test.setTimeout(90_000);

  test("[E2E] Provider icons are served as SVG", async ({ request }) => {
    for (const id of ["openai", "anthropic", "langchain", "stripe", "aws", "generic"]) {
      const r = await request.get(`/provider-icons/${id}.svg`);
      expect(r.status(), id).toBe(200);
      expect(r.headers()["content-type"] || "").toMatch(/svg|xml/i);
      const body = await r.text();
      expect(body).toMatch(/<svg/i);
    }
  });

  test("[E2E] Platforms dock shows inventory + live trading strip", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("export-menu-toggle").click();
    await page.getByText(/Apply trading agent spine/i).click();
    await expect(page.getByText("Policy engine").first()).toBeVisible({ timeout: 15000 });
    await page.getByTestId("blanko-rail-workspace").click();
    await page.getByTestId("blanko-dock-tab-platforms").click();
    await expect(page.getByTestId("platform-inventory")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("trading-runtime-strip")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("trading-vendor-credits")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("provider-icon").first()).toBeVisible();
  });
});
