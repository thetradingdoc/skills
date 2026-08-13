/**
 * V1 launch gate — free design vs Pro analysis (UI smoke).
 * Gate logic is covered by scripts/test-free-tier-design.ts;
 * this smoke proves design chrome remains public and Free/Pro plans are offered.
 */
import { test, expect } from "@playwright/test";

test.use({ channel: "chrome-for-testing" });

test.describe("V1 free-tier design launch gate", () => {
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
          status: res.status(),
          headers: { ...res.headers(), "Cache-Control": "no-store" },
          body,
        });
      } catch {
        await route.continue();
      }
    });
    await context.clearCookies();
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
    });
  });

  test("[E2E] Design from scratch opens design chrome without Pro", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("chrome-design-mode")).toBeVisible({ timeout: 15000 });
  });

  test("[E2E] Onboarding offers Free and Pro after design intent", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByTestId("onboarding-chat")).toBeVisible();
    await expect(page.getByTestId("onboarding-intent-design")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("onboarding-intent-design").click();
    await expect(page.getByTestId("onboarding-email")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("onboarding-email").fill(`launch-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("onboarding-first-name")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("onboarding-first-name").fill("Launch");
    await page.getByTestId("onboarding-last-name").fill("Gate");
    await page.getByTestId("onboarding-nickname").fill(`lg${Date.now()}`);
    await page.getByRole("button", { name: "Continue" }).first().click();
    await expect(page.getByTestId("onboarding-password")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("onboarding-password").fill("password12345");
    await page.getByTestId("onboarding-password-confirm").fill("password12345");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("onboarding-plan-free")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("onboarding-plan-pro")).toBeVisible();
    await expect(page.getByText(/Design chat allowance/i)).toBeVisible();
  });
});
