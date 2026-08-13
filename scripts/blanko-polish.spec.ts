/**
 * Polish gate — iconed n8n nodes, Bubbleboddy chrome, floating chat, readable rail.
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

test.describe("blanko polish — landing-seamless workspace", () => {
  test("backend health responds", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).ok).toBe(true);
  });

  test("chrome: pink brand in left rail, Explore, floating chat, readable rail", async ({ page }) => {
    await enterScratch(page);

    if (await page.getByTestId("blanko-scene-collapsed").isVisible().catch(() => false)) {
      await page.getByTestId("blanko-scene-expand").click();
    }
    await expect(page.getByTestId("blanko-left-brand")).toBeVisible();
    const brandFont = await page.getByTestId("blanko-left-brand").evaluate((el) => getComputedStyle(el).fontFamily);
    expect(brandFont.toLowerCase()).toMatch(/bubbleboddy/);
    const brandColor = await page.getByTestId("blanko-left-brand").evaluate((el) => getComputedStyle(el).color);
    expect(brandColor.replace(/\s/g, "")).toMatch(/rgb\(239,\s*50,\s*166\)/);
    await expect(page.getByTestId("blanko-chrome-brand")).toHaveCount(0);
    await expect(page.getByTestId("blanko-explore")).toBeVisible();

    await expect(page.getByRole("button", { name: "Overview", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deep Dive", exact: true })).toHaveCount(0);

    const chat = page.getByTestId("blanko-chat-bar");
    await expect(chat).toBeVisible();
    const pos = await chat.evaluate((el) => getComputedStyle(el).position);
    expect(pos).toBe("absolute");

    await expect(page.getByTestId("blanko-rail-build")).toContainText(/Components/i);
    await expect(page.getByTestId("blanko-rail-insights")).toContainText(/Insights/i);
    await expect(page.getByTestId("blanko-rail-agents")).toContainText(/Agents/i);
    await expect(page.getByTestId("blanko-rail-workspace")).toContainText(/System/i);
    await expect(page.getByTestId("blanko-rail-work")).toContainText(/Tasks/i);
    await expect(page.getByTestId("blanko-rail-code")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-ops")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-tasks")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-config")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-inspect")).toHaveCount(0);
  });

  test("n8n import → iconed blanko-arch-nodes", async ({ page }) => {
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
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15000 });

    const nodes = page.locator("[data-testid='blanko-arch-node']");
    await expect(nodes.first()).toBeVisible({ timeout: 20000 });
    expect(await nodes.count()).toBeGreaterThan(3);

    const icons = page.locator("[data-testid='blanko-arch-node'] [data-testid='blanko-node-icon']");
    await expect(icons.first()).toBeVisible();
    expect(await icons.count()).toBeGreaterThan(3);

    // At least some provider SVGs when labels map
    const providerIcons = page.locator("[data-testid='blanko-arch-node'] [data-testid='provider-icon']");
    expect(await providerIcons.count()).toBeGreaterThan(0);

    // No dark "Click to highlight" legend on light canvas
    await expect(page.getByText("Click to highlight")).toHaveCount(0);

    if (await page.getByTestId("blanko-scene-collapsed").isVisible().catch(() => false)) {
      await page.getByTestId("blanko-scene-expand").click();
    }
    await expect(page.getByTestId("blanko-scene")).toBeVisible();
  });
});
