/**
 * blanko Flow — Path under System; Tasks on its own rail.
 */
import { test, expect } from "@playwright/test";

test.describe("blanko Flow Tasks", () => {
  test("System Path + Tasks rail kanban", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
    });
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-canvas-shell").or(page.locator(".react-flow"))).toBeVisible({
      timeout: 20000,
    });

    await expect(page.getByTestId("blanko-rail-tasks")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-work")).toBeVisible();

    await page.getByTestId("blanko-rail-workspace").click();
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-dock-mode", "workspace");
    await page.getByTestId("blanko-dock-tab-path").click();
    await expect(page.getByTestId("blanko-workspace-breadcrumb")).toContainText(/Path/i);

    await page.getByTestId("blanko-rail-work").click();
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-dock-mode", "work");
    await expect(page.getByTestId("flow-tasks-board")).toBeVisible();
    // Kanban columns need a signed-in workspace; unsigned scratch still shows the board shell.
    await expect(page.getByTestId("flow-kanban-todo").or(page.getByText(/Sign in|To do|workspace/i).first())).toBeVisible();

    await page.goto("/");
    const toggle = page.getByTestId("design-blueprint-gallery-toggle");
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await expect(page.getByText(/Payment/i).first()).toBeVisible({ timeout: 10000 });
    }
  });
});
