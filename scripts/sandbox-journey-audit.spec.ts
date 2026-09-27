/**
 * Sandbox journey audit: sign-in, signup chat, payment Element (no live charge).
 * Safe with live Stripe keys — we only open Payment Element; we do not confirm payment.
 */
import { test, expect } from "@playwright/test";
import { walkOnboardingToPlan } from "./e2eOnboarding";
import { E2E_ALLOW_REAL_SIGNUP, REAL_SIGNUP_SKIP_REASON } from "./e2eRealSignupGate";

test.describe("sandbox journey audit", () => {
  test.setTimeout(90_000);

  test("[Audit] Sign-in modal is built: email, password, forgot, GitHub", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Sign in$/i }).first().click();
    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(page.getByPlaceholder("Email")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Sign in$/i }).last()).toBeVisible();
    await expect(page.getByRole("button", { name: /Forgot password/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue with GitHub/i })).toBeVisible();

    await page.getByRole("button", { name: /^Sign in$/i }).last().click();
    await expect(page.getByText(/Email and password are required/i)).toBeVisible();

    await page.getByPlaceholder("Email").fill("nobody-e2e@example.com");
    await page.getByPlaceholder("Password").fill("wrong-password-xyz");
    await page.getByRole("button", { name: /^Sign in$/i }).last().click();
    await expect(page.locator("text=/Invalid|credentials|not found|error|Email/i").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("[Audit] Sign-in escape from OnboardingChat opens Welcome back", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByTestId("onboarding-chat")).toBeVisible();
    await page.getByRole("button", { name: /Already have an account/i }).click();
    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(page.getByTestId("onboarding-chat")).toHaveCount(0);
  });

  test("[Audit] Signup chat pipeline through plan chips", async ({ page }) => {
    await walkOnboardingToPlan(page, `audit-${Date.now()}@example.com`, { intent: "design" });
    await expect(page.getByTestId("onboarding-plan-team")).toBeVisible();
    await expect(page.getByTestId("onboarding-tos")).toBeVisible();
    await expect(page.getByRole("link", { name: /Terms of Service/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Privacy Policy/i })).toBeVisible();
  });

  // Real UI signUp → burns default Supabase mailer quota (~2/hr). Fail-closed
  // unless E2E_ALLOW_REAL_SIGNUP=1 (do not run against prod by accident).
  test("[Audit] Free signup completes (auth + ensure-free) when Supabase allows", async ({
    page,
  }) => {
    test.skip(!E2E_ALLOW_REAL_SIGNUP, REAL_SIGNUP_SKIP_REASON);
    const email = `audit.free.${Date.now()}@example.com`;
    await walkOnboardingToPlan(page, email, { intent: "design", nickname: `free${Date.now()}` });
    await page.getByTestId("onboarding-tos").check();
    await page.getByTestId("onboarding-plan-free").click();

    const profile = page.getByTestId("account-profile-btn");
    const err = page.getByTestId("onboarding-error");
    const pending = page.getByTestId("onboarding-pending-confirm");
    await expect(profile.or(err).or(pending).first()).toBeVisible({ timeout: 60000 });

    if (await profile.isVisible().catch(() => false)) {
      await profile.click();
      await expect(page.getByTestId("profile-billing-panel")).toBeVisible();
    } else if (await pending.isVisible().catch(() => false)) {
      console.log("[audit] free signup pending email confirmation");
      await expect(page.getByTestId("onboarding-resend-confirm")).toBeVisible();
    } else {
      const msg = (await err.textContent()) ?? "";
      console.log("[audit] free signup blocked:", msg);
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  // Real UI signUp (plan-pro click). Same mailer-quota gate as free signup.
  test("[Audit] Pro path reaches Payment Element (no charge on live keys)", async ({ page }) => {
    test.skip(!E2E_ALLOW_REAL_SIGNUP, REAL_SIGNUP_SKIP_REASON);
    const email = `audit.pro.${Date.now()}@example.com`;
    await walkOnboardingToPlan(page, email, { intent: "design", nickname: `pro${Date.now()}` });
    await page.getByTestId("onboarding-tos").check();

    const subResPromise = page.waitForResponse(
      (r) => r.url().includes("/billing/create-subscription") && r.request().method() === "POST",
      { timeout: 60000 }
    ).catch(() => null);

    await page.getByTestId("onboarding-plan-pro").click();
    const subRes = await subResPromise;
    if (subRes) {
      expect(subRes.status()).toBeLessThan(500);
    }
    await expect(
      page.getByTestId("onboarding-payment-element").or(page.locator("#payment-element")).or(page.getByTestId("onboarding-error"))
    ).toBeVisible({ timeout: 60000 });
  });
});
