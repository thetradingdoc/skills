/**
 * blanko Insights value: brokers, workflow edges, node briefing — not SaaS spam.
 */
import { test, expect } from "@playwright/test";

async function openInsights(page: import("@playwright/test").Page) {
  const panel = page.getByTestId("blanko-insights");
  if (await panel.isVisible().catch(() => false)) return;
  await page.getByTestId("blanko-rail-insights").click();
  await expect(panel).toBeVisible({ timeout: 10000 });
}

test.describe("blanko insights value", () => {
  test("Apply spine → Insights shows Alpaca/Kraken, money path, connected hops", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible({ timeout: 20000 });

    await page.getByTestId("export-menu-toggle").click();
    await page.getByText(/Apply trading agent spine/i).click();
    await expect(page.getByText(/Telegram \/ Trading Chat/i).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Policy engine").first()).toBeVisible();
    await expect(page.getByText("Alpaca").first()).toBeVisible();

    // Apply opens Insights — do not toggle the rail closed.
    await openInsights(page);

    await expect(page.getByTestId("blanko-insights-summary")).toContainText(/Money path/i);
    await expect(page.getByTestId("blanko-insights-workflow")).toBeVisible();
    await expect(page.getByTestId("blanko-workflow-hop-bp-ta-telegram")).toContainText(/edge/i);
    await expect(page.getByTestId("blanko-workflow-hop-bp-ta-alpaca")).toBeVisible();

    await expect(page.getByTestId("blanko-platform-alpaca")).toBeVisible();
    await expect(page.getByTestId("blanko-platform-kraken")).toBeVisible();
    await expect(page.getByTestId("blanko-platform-stripe")).toHaveCount(0);
    await expect(page.getByTestId("blanko-platform-openai")).toHaveCount(0);

    await expect(page.getByTestId("blanko-insights-open-flow")).toBeVisible();
    await expect(page.getByTestId("blanko-insights-usage")).toBeVisible();
  });

  test("Selecting Payment shows role briefing and connections", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
    });
    await page.goto("/");
    const toggle = page.getByTestId("design-blueprint-gallery-toggle");
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
    await page.getByTestId("design-blueprint-fork-trading-agent").click();
    await expect(page.getByTestId("rf__node-bp-ta-payment")).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => {
      (window as unknown as { __llSelectNode?: (id: string) => void }).__llSelectNode?.(
        "bp-ta-payment"
      );
    });
    await openInsights(page);
    await expect(page.getByTestId("blanko-insights-node")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("blanko-insights-node")).toContainText(/Payment/i);
    await expect(page.getByTestId("blanko-insights-node-role")).toContainText(/wallet|cash|paper/i);
    await expect(page.getByTestId("blanko-insights-config-hints")).toContainText(/Flow/i);

    await page.evaluate(() => {
      (window as unknown as { __llSelectNode?: (id: string) => void }).__llSelectNode?.(
        "bp-ta-alpaca"
      );
    });
    await expect(page.getByTestId("blanko-insights-node-role")).toContainText(/broker/i);
  });

  test("Forked spine ingress is labeled with Trading Chat and edged", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByTestId("design-blueprint-gallery-toggle");
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
    await page.getByTestId("design-blueprint-fork-trading-agent").click();
    await expect(page.getByText(/Telegram \/ Trading Chat/i).first()).toBeVisible({
      timeout: 15000,
    });
    await openInsights(page);
    // Clear node selection so board-level workflow shows (click canvas pane).
    await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 }, force: true });
    await openInsights(page);
    await expect(page.getByTestId("blanko-workflow-hop-bp-ta-telegram")).toContainText(/edge/i);
    await expect(page.getByTestId("blanko-workflow-hop-bp-ta-telegram")).not.toContainText("no edges");
  });
});
