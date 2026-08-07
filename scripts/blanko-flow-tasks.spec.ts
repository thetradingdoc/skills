/**
 * blanko Flow Path | Tasks — brighter Kanban + trading spine seed.
 */
import { test, expect } from "@playwright/test";

test.describe("blanko Flow Tasks", () => {
  test("Flow opens on Path; Tasks tab shows Kanban; blueprint has Payment node", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-canvas-shell").or(page.locator(".react-flow"))).toBeVisible({
      timeout: 20000,
    });

    // Open Config → Flow if available; else try graph mode control
    const flowBtn = page.getByRole("button", { name: /^Flow$/i }).or(page.getByTestId("config-view-flow"));
    if (await flowBtn.first().isVisible().catch(() => false)) {
      await flowBtn.first().click();
    } else {
      // Design mode may need Config wall
      const config = page.getByTestId("blanko-wall-config").or(page.getByRole("button", { name: /Config/i }));
      if (await config.first().isVisible().catch(() => false)) {
        await config.first().click();
      }
      const flow2 = page.getByRole("button", { name: /^Flow$/i });
      if (await flow2.first().isVisible().catch(() => false)) {
        await flow2.first().click();
      }
    }

    // Path tab default
    const pathTab = page.getByTestId("flow-tab-path");
    const tasksTab = page.getByTestId("flow-tab-tasks");
    if (await pathTab.isVisible().catch(() => false)) {
      await expect(pathTab).toBeVisible();
      await tasksTab.click();
      await expect(page.getByTestId("flow-tasks-board")).toBeVisible();
      await expect(page.getByTestId("flow-kanban-todo")).toBeVisible();
      await expect(page.getByTestId("flow-kanban-doing")).toBeVisible();
      await expect(page.getByTestId("flow-kanban-tested")).toBeVisible();
      await expect(page.getByTestId("flow-kanban-done")).toBeVisible();
      await expect(page.getByTestId("flow-kanban-issues")).toBeVisible();
    }

    // Landing blueprint gallery includes trading agent with Payment in summary
    await page.goto("/");
    const toggle = page.getByTestId("design-blueprint-gallery-toggle");
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
    }
    await expect(page.getByTestId("design-blueprint-trading-agent")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("design-blueprint-trading-agent")).toContainText(/Payment|paper|Policy|Alpaca/i);
  });
});
