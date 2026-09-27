/**
 * Left rail — Explore/Import + My workspace + Profile footer.
 * Control wall: Components · Insights · Terminal (panels closed by default).
 */
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const API = process.env.API_URL ?? "http://localhost:4000";

async function enterScratch(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
  });
  await page.goto("/");
  await page.getByTestId("design-from-scratch").click();
  await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 15000 });
}

async function expandLeft(page: Page) {
  if (await page.getByTestId("blanko-scene-collapsed").isVisible().catch(() => false)) {
    await page.getByTestId("blanko-scene-expand").click();
  }
  await expect(page.getByTestId("blanko-left-brand")).toBeVisible();
}

test.describe("blanko left rail Explore + My workspace", () => {
  test("backend health responds", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).ok).toBe(true);
  });

  test("scratch → pink brand; Explore/Import only; workspace switcher; profile footer", async ({ page }) => {
    await enterScratch(page);
    await expandLeft(page);

    const brand = page.getByTestId("blanko-left-brand");
    await expect(brand).toBeVisible();
    const brandColor = await brand.evaluate((el) => getComputedStyle(el).color);
    expect(brandColor.replace(/\s/g, "")).toMatch(/rgb\(239,\s*50,\s*166\)/);

    await expect(page.getByTestId("blanko-explore")).toBeVisible();
    await expect(page.getByTestId("blanko-explore-import")).toBeVisible();
    await expect(page.getByTestId("blanko-import-n8n")).toBeVisible();

    await expect(page.getByTestId("blanko-explore-design")).toHaveCount(0);
    await expect(page.getByTestId("blanko-left-search")).toHaveCount(0);

    await expect(page.getByText(/My workspace/i).first()).toBeVisible();
    await expect(page.getByTestId("blanko-left-workspace")).toBeVisible();
    await expect(page.getByTestId("blanko-left-new-workspace")).toBeVisible();

    await page.getByTestId("blanko-left-workspace").click();
    await expect(page.getByTestId("blanko-ws-menu")).toBeVisible();
    await expect(page.getByTestId("blanko-ws-menu-new")).toBeVisible();

    const profileOrSignIn = page.getByTestId("blanko-left-signin").or(page.getByTestId("blanko-left-profile"));
    await expect(profileOrSignIn).toBeVisible();

    // Control panel closed by default
    await expect(page.getByTestId("blanko-dock")).toHaveCount(0);
  });

  test("right Components places a node; chat + opens Components", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-rail-build").click();
    await page.locator('[data-testid="blanko-dock"] [data-testid^="blanko-build-item-"]').first().click();
    await expect(page.locator("[data-testid='blanko-arch-node']").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-dock-mode", "insights");
    await expect(page.getByTestId("design-inspect")).toBeVisible();

    await page.getByTestId("blanko-chat-plus").click();
    await page.getByTestId("blanko-chat-plus-menu").getByText(/Open Components/i).click();
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-dock-mode", "build");
  });

  test("n8n import → workspace; Insights on demand", async ({ page }) => {
    const fixture = [
      path.resolve("fixtures/n8n/calendar-AEST.json"),
      path.resolve("fixtures/n8n/calendar-EST.json"),
    ].find((f) => fs.existsSync(f));
    test.skip(!fixture, "No n8n fixture available");

    await page.goto("/");
    await page.getByTestId("landing-import-toggle").click();
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("landing-import-n8n").click(),
    ]);
    await fileChooser.setFiles(fixture!);

    await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("blanko-dock")).toHaveCount(0);
    await expandLeft(page);
    await expect(page.getByTestId("blanko-explore-import")).toBeVisible();
  });

  test("side-rail Upload n8n opens file picker; Import GitHub opens modal", async ({ page }) => {
    await enterScratch(page);
    await expandLeft(page);

    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("blanko-import-n8n").click(),
    ]);
    expect(chooser).toBeTruthy();
    await chooser.cancel().catch(() => undefined);

    await page.getByTestId("blanko-import-github").click();
    await expect(page.getByTestId("blanko-import-github-modal")).toBeVisible();
    await expect(page.getByTestId("blanko-import-github-url")).toBeVisible();
    await page.getByTestId("blanko-import-github-cancel").click();
    await expect(page.getByTestId("blanko-import-github-modal")).toHaveCount(0);
  });
});
