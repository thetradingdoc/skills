/**
 * Floating canvas chrome: home · page name · View/Edit · bell · save · share · export.
 */
import { test, expect, type Page } from "@playwright/test";

const API = process.env.API_URL ?? "http://localhost:4000";

async function enterScratch(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
  });
  await page.goto("/");
  await page.getByTestId("design-from-scratch").click();
  await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 15000 });
}

test.describe("blanko floating chrome bar", () => {
  test("backend health responds", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
  });

  test("floating pill: home, design chip, view/edit, icon actions — no search", async ({
    page,
  }) => {
    await enterScratch(page);

    const bar = page.getByTestId("blanko-chrome-bar");
    await expect(bar).toBeVisible();
    const pos = await bar.evaluate((el) => getComputedStyle(el).position);
    expect(pos).toBe("absolute");

    await expect(page.getByTestId("blanko-chrome-search")).toHaveCount(0);
    await expect(page.getByTestId("chrome-home")).toBeVisible();
    expect(await page.getByTestId("chrome-home").evaluate((el) => el.tagName)).toBe("SPAN");
    await expect(page.getByTestId("chrome-home")).toHaveCSS("pointer-events", "none");
    await expect(page.getByTestId("chrome-design-chip")).toContainText(/Design/i);
    await expect(page.getByTestId("blanko-chrome-interaction")).toBeVisible();
    await expect(page.getByTestId("blanko-chrome-edit")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("blanko-chrome-view").click();
    await expect(page.getByTestId("blanko-chrome-view")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("blanko-chrome-edit").click();
    await expect(page.getByTestId("blanko-chrome-edit")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("chrome-save")).toBeVisible();
    await expect(page.getByTestId("chrome-share")).toBeVisible();
    await expect(page.getByTestId("export-menu-toggle")).toBeVisible();

    await expect(page.getByRole("button", { name: "Overview", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deep Dive", exact: true })).toHaveCount(0);

    await page.getByTestId("export-menu-toggle").click();
    await expect(page.getByTestId("blanko-chrome-more-menu")).toBeVisible();
    await expect(page.getByTestId("blanko-chrome-export-svg")).toBeVisible();
  });
});
