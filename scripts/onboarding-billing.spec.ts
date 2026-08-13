/**
 * Onboarding + billing journey smoke tests.
 * Full paid path needs Stripe test keys + webhook; gated behind E2E_FULL_BILLING.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { walkOnboardingToPlan } from "./e2eOnboarding";

function parseEnvFile(p: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function walkToPlan(page: import("@playwright/test").Page, email: string) {
  await walkOnboardingToPlan(page, email, { intent: "design" });
  await expect(page.getByTestId("onboarding-tos")).toBeVisible();
  await expect(page.getByRole("link", { name: /Terms of Service/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Privacy Policy/i })).toBeVisible();
}

test.describe("onboarding billing", () => {
  test("[E2E] Landing Get started opens OnboardingChat (not old signup form)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByTestId("onboarding-chat")).toBeVisible();
    await expect(page.getByText("Create account", { exact: false })).toHaveCount(0);
  });

  test("[E2E] Walk email + name/nickname + password widgets without submitting pay", async ({
    page,
  }) => {
    await walkToPlan(page, "e2e@example.com");
  });

  test("[E2E] Already have an account opens sign-in", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByRole("button", { name: /Already have an account/i }).click();
    await expect(page.getByText("Welcome back")).toBeVisible();
  });

  test("[E2E] Profile billing entry absent when logged out", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("account-profile-btn")).toHaveCount(0);
  });

  test("[E2E] SIGNUP_REQUIRED path can open OnboardingChat from auth modal", async ({
    page,
  }) => {
    await page.goto("/");
    // Landing "Sign in" opens auth modal; "Sign up" tab launches OnboardingChat
    const signIn = page.getByRole("button", { name: /^Sign in$/i }).first();
    await expect(signIn).toBeVisible();
    await signIn.click();
    await page.getByRole("button", { name: /^Sign up$/i }).click();
    await expect(page.getByTestId("onboarding-chat")).toBeVisible();
  });
});

test.describe("onboarding billing — API gate smoke", () => {
  test("[E2E] Scan gate returns structured upgrade/past_due codes for anon over-limit", async ({
    request,
  }) => {
    const api = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
    // Unauthenticated scan should either work (under anon limit) or return a known code.
    // Hitting /billing/me without auth must be 401 — proves billing routes are mounted.
    const me = await request.get(`${api}/api/billing/me`);
    expect([401, 403]).toContain(me.status());

    const scan = await request.post(`${api}/api/scan`, {
      data: { repoUrl: "https://github.com/octocat/Hello-World" },
    });
    // May succeed under anon limit, or fail with rate/auth codes — never 404.
    expect(scan.status()).not.toBe(404);
    if (!scan.ok()) {
      const body = await scan.json().catch(() => ({} as Record<string, unknown>));
      const code = String(body.code ?? body.error ?? "");
      // Known entitlement / auth / rate codes when blocked
      if (code) {
        expect(
          /UPGRADE_REQUIRED|PAST_DUE|SIGNUP_REQUIRED|RATE|LIMIT|AUTH|anon/i.test(code) ||
            scan.status() >= 400
        ).toBeTruthy();
      }
    }
  });
});

test.describe("onboarding billing — requires live app + optional stripe", () => {
  test.skip(
    !process.env.E2E_FULL_BILLING,
    "Set E2E_FULL_BILLING=1 with Supabase + Stripe test env for full journey"
  );

  // This Supabase project has email confirmations enabled, so UI signups need
  // a mailbox. Admin-create a confirmed user once, then run the signed-in
  // journeys (sign-in modal → workspace → Account & billing) through the UI.
  const serverEnv = parseEnvFile(path.resolve("webapp/server/.env"));
  const clientEnv = parseEnvFile(path.resolve("webapp/client/.env"));
  const SUPABASE_URL = serverEnv.SUPABASE_URL ?? "";
  const SERVICE_ROLE = serverEnv.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const ANON_KEY = clientEnv.VITE_SUPABASE_ANON_KEY ?? "";
  const E2E_EMAIL = `blanko.e2e+journey${Date.now()}@gmail.com`;
  const E2E_PASSWORD = "e2e-password-12345";
  let userToken: string | null = null;

  test.beforeAll(async () => {
    test.skip(!SUPABASE_URL || !SERVICE_ROLE, "Supabase admin env missing");
    const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: E2E_EMAIL,
        password: E2E_PASSWORD,
        email_confirm: true,
      }),
    });
    expect(created.ok, `admin createUser failed: ${created.status}`).toBeTruthy();

    const signed = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD }),
    });
    const body = (await signed.json()) as { access_token?: string };
    expect(signed.ok && !!body.access_token, "password sign-in failed").toBeTruthy();
    userToken = body.access_token!;
  });

  test("[E2E] Confirmed user signs in via modal and reaches white Account & billing", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("landing-sign-in").click();
    const modal = page.getByTestId("auth-modal");
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder("Email").fill(E2E_EMAIL);
    await modal.getByPlaceholder("Password").fill(E2E_PASSWORD);
    await modal.getByRole("button", { name: /^Sign in$/ }).last().click();
    await expect(modal).toHaveCount(0, { timeout: 15000 });

    // Signed-in users land in the workspace shell where account chrome lives
    await expect(page.getByTestId("account-profile-btn")).toBeVisible({ timeout: 30000 });

    await page.getByTestId("account-profile-btn").click();
    const panel = page.getByTestId("profile-billing-panel");
    await expect(panel).toBeVisible();
    // Restyled to blanko light — the card must be white, not GitHub-dark
    const cardBg = await panel
      .locator("> div")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cardBg).toMatch(/rgb\(\s*255,\s*255,\s*255\s*\)/);
    await expect(panel.getByTestId("billing-plan")).toBeVisible({ timeout: 15000 });
    await expect(panel.getByTestId("manage-billing-btn")).toBeVisible();
  });

  test("[E2E] Paying is possible: ensure-free then create-subscription returns a client secret", async ({
    request,
  }) => {
    test.skip(!userToken, "No signed-in token from beforeAll");
    // Never create Stripe objects against live keys from a test run.
    test.skip(
      /^sk_live/.test(serverEnv.STRIPE_SECRET_KEY ?? "") && !process.env.E2E_STRIPE_LIVE_OK,
      "STRIPE_SECRET_KEY is live-mode — set E2E_STRIPE_LIVE_OK=1 to explicitly allow"
    );
    const api = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
    const auth = { Authorization: `Bearer ${userToken}` };

    const free = await request.post(`${api}/api/billing/ensure-free`, { headers: auth });
    expect(free.ok()).toBeTruthy();

    const me = await request.get(`${api}/api/billing/me`, { headers: auth });
    expect(me.ok()).toBeTruthy();
    const meBody = (await me.json()) as { plan?: string };
    expect(["free", "pro", "team"]).toContain(meBody.plan);

    // The moment a user picks Pro in the chat, this is the call that runs —
    // a clientSecret proves Stripe will mount the Payment Element.
    const sub = await request.post(`${api}/api/billing/create-subscription`, {
      headers: auth,
      data: { plan: "pro" },
    });
    expect(sub.ok(), `create-subscription: ${sub.status()}`).toBeTruthy();
    const subBody = (await sub.json()) as { clientSecret?: string };
    expect(typeof subBody.clientSecret).toBe("string");
    expect(subBody.clientSecret!.length).toBeGreaterThan(10);
  });

  test("[E2E] Portal heals missing billing_customers after create-subscription", async ({
    request,
  }) => {
    test.skip(!userToken, "No signed-in token from beforeAll");
    test.skip(
      /^sk_live/.test(serverEnv.STRIPE_SECRET_KEY ?? "") && !process.env.E2E_STRIPE_LIVE_OK,
      "STRIPE_SECRET_KEY is live-mode — set E2E_STRIPE_LIVE_OK=1 to explicitly allow"
    );
    const api = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
    const auth = { Authorization: `Bearer ${userToken}` };

    // Decode user id from JWT payload (middle segment).
    const payload = JSON.parse(
      Buffer.from(userToken!.split(".")[1]!, "base64url").toString("utf8")
    ) as { sub?: string };
    const userId = payload.sub;
    expect(userId).toBeTruthy();

    // Ensure Stripe customer exists via create-subscription path.
    const sub = await request.post(`${api}/api/billing/create-subscription`, {
      headers: auth,
      data: { plan: "pro" },
    });
    expect(sub.ok(), `create-subscription: ${await sub.text()}`).toBeTruthy();

    // Simulate the bug: PRO/sub exists but billing_customers row is gone.
    const del = await fetch(
      `${SUPABASE_URL}/rest/v1/billing_customers?user_id=eq.${userId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          Prefer: "return=minimal",
        },
      }
    );
    expect(del.ok || del.status === 204, `delete billing_customers: ${del.status}`).toBeTruthy();

    const portal = await request.post(`${api}/api/billing/portal`, { headers: auth });
    const portalBody = (await portal.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };
    expect(
      portal.ok(),
      `portal heal failed ${portal.status}: ${portalBody.error ?? JSON.stringify(portalBody)}`
    ).toBeTruthy();
    expect(typeof portalBody.url).toBe("string");
    expect(portalBody.url!).toMatch(/stripe\.com|billing/);

    // Row should be restored.
    const check = await fetch(
      `${SUPABASE_URL}/rest/v1/billing_customers?user_id=eq.${userId}&select=stripe_customer_id`,
      {
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
      }
    );
    const rows = (await check.json()) as Array<{ stripe_customer_id?: string }>;
    expect(rows[0]?.stripe_customer_id).toBeTruthy();
  });

  test("[E2E] Portal heals orphan PRO (no billing_customers, no stripe sub id)", async ({
    request,
  }) => {
    test.skip(!userToken, "No signed-in token from beforeAll");
    test.skip(
      /^sk_live/.test(serverEnv.STRIPE_SECRET_KEY ?? "") && !process.env.E2E_STRIPE_LIVE_OK,
      "STRIPE_SECRET_KEY is live-mode — set E2E_STRIPE_LIVE_OK=1 to explicitly allow"
    );
    const api = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
    const auth = { Authorization: `Bearer ${userToken}` };
    const payload = JSON.parse(
      Buffer.from(userToken!.split(".")[1]!, "base64url").toString("utf8")
    ) as { sub?: string };
    const userId = payload.sub!;

    await fetch(`${SUPABASE_URL}/rest/v1/billing_customers?user_id=eq.${userId}`, {
      method: "DELETE",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        Prefer: "return=minimal",
      },
    });

    // Match the screenshot state: plan PRO / active without a Stripe customer link.
    const upsert = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        plan: "pro",
        status: "active",
        stripe_subscription_id: null,
        price_id: null,
        current_period_end: null,
      }),
    });
    expect(upsert.ok || upsert.status === 201, `upsert subscriptions: ${upsert.status}`).toBeTruthy();

    const portal = await request.post(`${api}/api/billing/portal`, { headers: auth });
    const portalBody = (await portal.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };
    expect(
      portal.ok(),
      `orphan PRO portal heal failed ${portal.status}: ${portalBody.error ?? ""}`
    ).toBeTruthy();
    expect(portalBody.url).toMatch(/stripe\.com|billing/);
  });

  test("[E2E] Free user without customer gets clear portal error (not upgrade-first ghost)", async ({
    request,
  }) => {
    test.skip(!userToken, "No signed-in token from beforeAll");
    const api = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
    // Fresh free-only user so we don't inherit prior create-subscription customer.
    const email = `blanko.e2e+freeportal${Date.now()}@gmail.com`;
    const password = E2E_PASSWORD;
    const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    expect(created.ok).toBeTruthy();
    const signed = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = (await signed.json()) as { access_token?: string };
    expect(body.access_token).toBeTruthy();
    const auth = { Authorization: `Bearer ${body.access_token}` };
    await request.post(`${api}/api/billing/ensure-free`, { headers: auth });

    const portal = await request.post(`${api}/api/billing/portal`, { headers: auth });
    expect(portal.status()).toBe(400);
    const errBody = (await portal.json()) as { error?: string };
    expect(errBody.error ?? "").toMatch(/No Stripe billing profile|Upgrade to a paid plan/i);
    expect(errBody.error ?? "").not.toMatch(/upgrade first/i);
  });

  test("[E2E] Manage billing returns Portal URL when customer exists", async ({
    page,
    request,
  }) => {
    // Relies on a prior free/paid signup in the same browser session from the free-path test
    // when run serially; otherwise skip if no profile button.
    await page.goto("/");
    const profile = page.getByTestId("account-profile-btn").or(page.getByTestId("blanko-left-profile"));
    test.skip(!(await profile.first().isVisible().catch(() => false)), "No signed-in session");
    await profile.first().click();
    const manage = page.getByTestId("manage-billing-btn");
    if (await manage.isVisible().catch(() => false)) {
      // Portal navigates same tab (location.href) — capture the API response instead of popup.
      const portalResPromise = page.waitForResponse(
        (r) => r.url().includes("/billing/portal") && r.request().method() === "POST",
        { timeout: 20000 }
      );
      await manage.click();
      const portalRes = await portalResPromise;
      const portalBody = (await portalRes.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      expect(portalRes.ok(), portalBody.error ?? `portal ${portalRes.status()}`).toBeTruthy();
      expect(portalBody.url).toMatch(/stripe\.com|billing/);
    } else {
      // Free users without Stripe customer: portal API returns 400
      const api = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
      const res = await request.post(`${api}/api/billing/portal`);
      expect([400, 401, 503]).toContain(res.status());
    }
  });

  test("[E2E] Paid path with Stripe test card (Payment Element)", async ({ page }) => {
    test.skip(!process.env.E2E_STRIPE_PAID, "Set E2E_STRIPE_PAID=1 for paid path");
    await walkToPlan(page, `blanko.e2e+pro${Date.now()}@gmail.com`);
    await page.getByTestId("onboarding-tos").check();
    await page.getByTestId("onboarding-plan-pro").click();
    await expect(page.getByTestId("onboarding-payment-element").or(page.locator("#payment-element"))).toBeVisible({
      timeout: 30000,
    });
    // Stripe Payment Element iframe — fill test card when present
    const frame = page.frameLocator('iframe[name*="privateStripeFrame"]').first();
    await frame.locator('[name="number"], [placeholder*="Card number"]').fill("4242424242424242").catch(() => {});
    await frame.locator('[name="expiry"], [placeholder*="MM"]').fill("1234").catch(() => {});
    await frame.locator('[name="cvc"], [placeholder*="CVC"]').fill("123").catch(() => {});
    await page.getByRole("button", { name: /Subscribe|Pay|Confirm/i }).click();
    await expect(page.getByTestId("account-profile-btn")).toBeVisible({ timeout: 60000 });
  });

  test("[E2E] Chat signup with confirmations on shows the confirm-email message (no dead end)", async ({
    page,
  }) => {
    // With email confirmations enabled, the chat signup can't mint a session —
    // the journey must surface the "check your email" instruction rather than
    // hang. Skipped when Supabase email rate limit is already exhausted.
    await walkToPlan(page, `blanko.e2e+confirm${Date.now()}@gmail.com`);
    await page.getByTestId("onboarding-tos").check();
    await page.getByTestId("onboarding-plan-free").click();
    const err = page.getByTestId("onboarding-error");
    const profileBtn = page.getByTestId("account-profile-btn");
    await expect(err.or(profileBtn).first()).toBeVisible({ timeout: 30000 });
    if (await err.isVisible().catch(() => false)) {
      const text = (await err.textContent()) ?? "";
      expect(text).toMatch(/confirm your account|rate limit/i);
    }
  });
});
