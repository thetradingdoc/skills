/**
 * Right-rail IA — Ops/Code folded into System/Agents; Tasks is its own rail.
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

test.describe("blanko right rail redesign", () => {
  test("rail order: Insights → Components → Agents → System → Tasks → Canvas", async ({ page }) => {
    await enterScratch(page);
    const ids = await page.locator("[data-testid^='blanko-rail-']").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-testid")).filter(Boolean)
    );
    const expected = [
      "blanko-rail-insights",
      "blanko-rail-build",
      "blanko-rail-agents",
      "blanko-rail-workspace",
      "blanko-rail-work",
      "blanko-rail-view",
    ];
    expect(ids.filter((id) => expected.includes(id!))).toEqual(expected);
    await expect(page.getByTestId("blanko-rail-config")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-code")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-ops")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-tasks")).toHaveCount(0);
  });

  test("Tasks rail opens kanban", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-rail-work").click();
    await expect(page.getByTestId("blanko-tasks-dock")).toBeVisible();
    await expect(page.getByTestId("flow-tasks-board")).toBeVisible();
  });

  test("System Path tab opens", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-rail-workspace").click();
    await page.getByTestId("blanko-dock-tab-path").click();
    await expect(page.getByTestId("blanko-workspace-dock")).toBeVisible();
    await expect(page.getByTestId("blanko-workspace-breadcrumb")).toContainText(/Path/i);
  });

  test("View dock explains chrome View/Edit vs destination", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-rail-view").click();
    await expect(page.getByTestId("blanko-view-dock")).toContainText(/View \/ Edit/i);
    await expect(page.getByTestId("blanko-view-canvas")).toBeVisible();
    await expect(page.getByTestId("blanko-view-3d")).toBeVisible();
  });

  test("Agents Files tab empty without project root", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-rail-agents").click();
    await page.getByTestId("blanko-dock-tab-files").click();
    await expect(page.getByTestId("blanko-code-dock")).toContainText(/No project root/i);
  });
});
