/**
 * Shared onboarding helpers for Playwright journey specs.
 */
import { expect, type Page } from "@playwright/test";

/** Walk from landing Get started through intent → email → profile → password → plan chips. */
export async function walkOnboardingToPlan(
  page: Page,
  email: string,
  opts?: { intent?: "design" | "explore" | "save" | "collaborate"; nickname?: string }
) {
  const intent = opts?.intent ?? "design";
  const nickname = opts?.nickname ?? `e2e${Date.now()}`;

  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.getByTestId("onboarding-chat")).toBeVisible();

  const intentBtn = page.getByTestId(`onboarding-intent-${intent}`);
  if (await intentBtn.isVisible().catch(() => false)) {
    await intentBtn.click();
  }

  await expect(page.getByTestId("onboarding-email")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("onboarding-email").fill(email);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByTestId("onboarding-first-name")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("onboarding-first-name").fill("E2E");
  await page.getByTestId("onboarding-last-name").fill("Tester");
  await page.getByTestId("onboarding-nickname").fill(nickname);
  await page.getByRole("button", { name: "Continue" }).first().click();

  await expect(page.getByTestId("onboarding-password")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("onboarding-password").fill("password12345");
  await page.getByTestId("onboarding-password-confirm").fill("password12345");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByTestId("onboarding-plan-free")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("onboarding-plan-pro")).toBeVisible();
}
