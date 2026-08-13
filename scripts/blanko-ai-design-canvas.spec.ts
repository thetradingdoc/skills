/**
 * Phase 5 AI design canvas — Gates 0–10 acceptance.
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

test.describe("Phase 5 — AI design canvas", () => {
  test("backend health responds", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
  });

  test("Gate 1+2: quiet chrome, no status bar, no swimlanes by default", async ({ page }) => {
    await enterScratch(page);

    await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible();
    await expect(page.getByTestId("blanko-chat-bar")).toBeVisible();
    await expect(page.getByTestId("blanko-chat-history")).toHaveCount(0);
    await expect(page.getByTestId("blanko-chat-input")).toHaveAttribute(
      "placeholder",
      /Brainstorm or ask something/i
    );
    await expect(page.getByTestId("blanko-status-bar")).toHaveCount(0);
    await expect(page.getByTestId("blanko-staleness")).toHaveCount(0);

    await expect(page.getByText("PRESENTATION", { exact: true })).toHaveCount(0);
    await expect(page.getByText("BUSINESS LOGIC", { exact: true })).toHaveCount(0);

    await expect(page.getByText(/AI design canvas/i).first()).toBeVisible();
    await expect(page.getByTestId("design-empty-open-build")).toContainText(/Components/i);
  });

  test("Gate 3: Components recommends agent starters", async ({ page }) => {
    await enterScratch(page);
    // Scratch opens Components by default — reopen if the rail toggle closed it
    if (!(await page.getByTestId("blanko-build").isVisible().catch(() => false))) {
      await page.getByTestId("blanko-rail-build").click();
    }
    await expect(page.getByTestId("blanko-build")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("blanko-build-intro")).toContainText(/AI design canvas/i);
    await expect(page.getByTestId("blanko-build-recommended")).toBeVisible();
    await expect(page.getByTestId("blanko-build")).toContainText(/Agent/i);
    await expect(page.getByTestId("blanko-build")).toContainText(/RAG|Vector|Strategy|Retell|Voice/i);

    await page.getByTestId("blanko-build-item-agent").click();
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1, { timeout: 10000 });
    // Node may sit under the dock until fitView — assert in DOM + role badge present
    await expect(page.getByTestId("blanko-node-role").first()).toBeAttached();
  });

  test("Gate 5: Trading agent blueprint forks without swimlanes", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("design-blueprint-gallery-toggle").click();
    await expect(page.getByTestId("design-blueprint-trading-agent")).toBeVisible();
    await page.getByTestId("design-blueprint-fork-trading-agent").click();
    await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("PRESENTATION", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-testid='blanko-arch-node']").first()).toBeVisible({ timeout: 15000 });
    const labels = await page.locator("[data-testid='blanko-arch-node']").allTextContents();
    const joined = labels.join(" ");
    expect(joined).toMatch(/Agent|Trading/i);
    expect(joined).toMatch(/RAG|Vector|Strategy|LLM|Memory/i);
  });

  test("Gate 8: Voice agent blueprint includes Retell channel", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("design-blueprint-gallery-toggle").click();
    await expect(page.getByTestId("design-blueprint-voice-agent")).toBeVisible();
    await page.getByTestId("design-blueprint-fork-voice-agent").click();
    await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='blanko-arch-node']").first()).toBeVisible({ timeout: 15000 });
    const joined = (await page.locator("[data-testid='blanko-arch-node']").allTextContents()).join(" ");
    expect(joined).toMatch(/Retell|Voice/i);
    expect(joined).toMatch(/Agent/i);
  });

  test("Gate 6: chat seeds mention trading / Retell / RAG", async ({ page }) => {
    await enterScratch(page);
    // Chat starts expanded on scratch — ensure history tray is open
    if (!(await page.getByTestId("blanko-chat-history").isVisible().catch(() => false))) {
      await page.getByTestId("blanko-chat-expand").click();
    }
    await expect(page.getByTestId("blanko-chat-history")).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/trading agent with RAG/i)).toBeVisible();
    await expect(page.getByText(/Retell as the voice channel/i)).toBeVisible();
    await expect(page.getByTestId("blanko-chat-input")).toHaveAttribute(
      "placeholder",
      /Brainstorm or ask something/i
    );
  });

  test("Gate 7+10: n8n import still opens workspace + Insights path", async ({ page }) => {
    const fixture = [
      path.resolve("fixtures/n8n/calendar-AEST.json"),
      path.resolve("fixtures/n8n/calendar-EST.json"),
    ].find((f) => fs.existsSync(f));
    test.skip(!fixture, "No n8n fixture");

    await page.goto("/");
    await page.getByTestId("landing-import-toggle").click();
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("landing-import-n8n").click(),
    ]);
    await fileChooser.setFiles(fixture!);
    await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 30000 });
    if (!(await page.getByTestId("blanko-insights").isVisible().catch(() => false))) {
      await page.getByTestId("blanko-rail-insights").click();
    }
    await expect(page.getByTestId("blanko-insights")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("blanko-insights")).toContainText(/where the agent system is broken|Findings/i);
  });
});
