/**
 * Gates 1–5: Insights owns node context; no floating Claim card; Continue in chat.
 */
import { test, expect, type Page } from "@playwright/test";

async function enterScratch(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
  });
  await page.goto("/");
  await page.getByTestId("design-from-scratch").click();
  await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 15000 });
}

async function placeFirstComponent(page: Page) {
  await page.getByTestId("blanko-rail-build").click();
  await page.locator("[data-testid^='blanko-build-item-']").first().click();
  await expect(page.locator("[data-testid='blanko-arch-node']").first()).toBeVisible({ timeout: 10000 });
}

test.describe("blanko Insights journey (Gates 1–5)", () => {
  test("Gate 1: no floating Claim card on select", async ({ page }) => {
    await enterScratch(page);
    await placeFirstComponent(page);
    await expect(page.getByTestId("node-collab-meta")).toHaveCount(0);
    await expect(page.getByText("Claim this")).toHaveCount(0);
  });

  test("Gate 2: place/select opens Insights node context", async ({ page }) => {
    await enterScratch(page);
    await placeFirstComponent(page);
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-dock-mode", "insights");
    await expect(page.getByTestId("blanko-insights-node")).toBeVisible();
    await expect(page.getByTestId("blanko-insights")).toContainText(/Selected piece|Findings on this piece/i);
  });

  test("Gate 2b: select keeps canvas (2d); does not open Files view", async ({ page }) => {
    await enterScratch(page);
    await placeFirstComponent(page);
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-dock-mode", "insights");
    await expect(page.getByTestId("blanko-view-shell")).toHaveCount(0);
    await expect(page.locator(".react-flow")).toBeVisible();
    await expect(page.getByTestId("blanko-rail-config")).toHaveCount(0);
  });

  test("Gate 3: Continue in chat + Edit details", async ({ page }) => {
    await enterScratch(page);
    await placeFirstComponent(page);
    await expect(page.getByTestId("design-inspect")).toBeVisible();
    await page.getByTestId("blanko-insights-edit-toggle").click();
    await expect(page.getByTestId("blanko-insights-edit")).toHaveCount(0);

    await page.getByTestId("blanko-insights-continue-chat").click();
    const input = page.getByTestId("blanko-chat-input");
    await expect(input).toBeVisible({ timeout: 5000 });
    await expect(input).toHaveValue(/Looking at/i);
  });

  test("Gate 5: Collab claim lives under Insights expander", async ({ page }) => {
    await enterScratch(page);
    await placeFirstComponent(page);
    await expect(page.getByTestId("blanko-insights-collab")).toBeVisible();
    await expect(page.getByTestId("node-claim-toggle")).toHaveCount(0);
    await page.getByTestId("blanko-insights-collab-toggle").click();
    await expect(page.getByTestId("node-claim-toggle")).toBeVisible();
    await expect(page.getByTestId("node-claim-toggle")).toContainText(/Claim this|Sign in to claim/i);
    await expect(page.getByTestId("node-usage-burn")).toContainText(/No usage attributed yet/i);
  });
});
