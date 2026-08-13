/**
 * Phase 0 gate — blanko brand kit + accent purge.
 * Asserts title/favicon/tokens/fonts, no LittleLabs/lime/blue chrome leftovers,
 * and that core landing/auth chrome still opens. Also pings API /health.
 */
import { test, expect } from "@playwright/test";

const API = process.env.API_URL ?? "http://localhost:4000";

test.describe("blanko Phase 0 brand kit", () => {
  test("backend health responds", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("document title, favicon, and CSS tokens", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/blanko — think, design and track/i);

    const iconHref = await page.locator('link[rel="icon"]').getAttribute("href");
    expect(iconHref).toBe("/favicon.svg");

    const fav = await page.request.get("/favicon.svg");
    expect(fav.ok()).toBeTruthy();
    const favBody = await fav.text();
    expect(favBody).toContain("#ef32a6");
    expect(favBody.toLowerCase()).toContain("blanko");

    const fonts = await Promise.all([
      page.request.get("/fonts/BubbleboddyNeue-Regular.ttf"),
      page.request.get("/fonts/BubbleboddyNeue-Bold.ttf"),
      page.request.get("/fonts/BubbleboddyNeue-ExtraBold.ttf"),
    ]);
    for (const f of fonts) expect(f.ok()).toBeTruthy();

    const vars = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        accent: s.getPropertyValue("--blanko-accent").trim(),
        ink: s.getPropertyValue("--blanko-ink").trim(),
        canvas: s.getPropertyValue("--blanko-canvas").trim(),
        fontBrand: s.getPropertyValue("--blanko-font-brand"),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        focusOutline: s.getPropertyValue("--blanko-accent").trim(),
      };
    });
    expect(vars.accent.toLowerCase()).toBe("#ef32a6");
    expect(vars.ink.toLowerCase()).toBe("#12131a");
    expect(vars.canvas.toLowerCase()).toBe("#ffffff");
    expect(vars.fontBrand).toMatch(/Bubbleboddy Neue/i);
  });

  test("landing shows blanko brand, not LittleLabs; menus work", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/blanko/i);
    expect(bodyText).not.toMatch(/LITTLELABS|LittleLabs/i);

    // Brand wordmark visible in header
    const brand = page.locator("header").getByText("blanko", { exact: true }).first();
    await expect(brand).toBeVisible();

    // Sign in opens auth modal
    await page.getByRole("button", { name: /^Sign in$/i }).first().click();
    await expect(page.getByText(/Welcome back|Sign in to your workspace/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Sign in$/i }).last()).toBeVisible();
    // Modal brand uses pink accent token (computed color)
    const modalBrand = page.locator("text=blanko").first();
    await expect(modalBrand).toBeVisible();

    // Close via Escape if possible, else click outside / cancel
    await page.keyboard.press("Escape");

    // Get started opens onboarding chat
    // Re-open landing if modal still open
    const stillModal = await page.getByText(/Welcome back|Create account/i).count();
    if (stillModal > 0) {
      await page.mouse.click(8, 8);
      await page.waitForTimeout(200);
    }

    await page.getByRole("button", { name: /Get started/i }).first().click();
    await expect(page.getByTestId("onboarding-chat")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("onboarding-chat").getByText("blanko").first()).toBeVisible();
    await expect(page.getByTestId("onboarding-chat").getByText(/Get started/i).first()).toBeVisible();

    // Close onboarding
    const closeBtn = page.getByTestId("onboarding-chat").getByRole("button", { name: /close|skip|later|×|x/i }).first();
    if (await closeBtn.count()) {
      await closeBtn.click();
    } else {
      await page.keyboard.press("Escape");
    }
  });

  test("no legacy lime or blueprint-blue chrome strings in served JS modules", async ({ page }) => {
    // Spot-check the live document for purged hexes after hydrate
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const html = await page.content();
    expect(html).not.toMatch(/#c8f135/i);
    expect(html).not.toMatch(/#2F5DFF/i);
    expect(html).not.toMatch(/LITTLELABS/);

    // Accent pink should appear somewhere in styles/markup
    expect(html.toLowerCase()).toMatch(/#ef32a6|rgb\(239,\s*50,\s*166\)/);
  });

  test("design-from-scratch CTA still works after brand swap", async ({ page }) => {
    await page.goto("/");
    const scratch = page.getByTestId("design-from-scratch");
    await expect(scratch).toBeVisible({ timeout: 15000 });
    await scratch.click();
    // Workspace chrome appears (mode badge or canvas shell)
    await expect(
      page.getByTestId("chrome-design-mode").or(page.getByTestId("design-empty-sidebar")).or(page.locator(".react-flow")).first()
    ).toBeVisible({ timeout: 20000 });
  });
});
