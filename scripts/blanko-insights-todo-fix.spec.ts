/**
 * Blanko Insights → Workspace Flow Tasks journey.
 *
 * Automated: Workspace Flow Path|Tasks smoke (no auth) + source asserts for Fix CTA.
 * Live dogfood: scripts/dogfood-trading-fix-automation.ts (BLANKO_DOGFOOD=1).
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

async function enterScratch(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
  });
  await page.goto("/");
  await page.getByTestId("design-from-scratch").click();
  await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 15000 });
}

test.describe("blanko Insights todo / Flow Tasks", () => {
  test("Tasks rail opens FlowTasksBoard", async ({ page }) => {
    await enterScratch(page);
    await expect(page.getByTestId("blanko-rail-tasks")).toHaveCount(0);
    await page.getByTestId("blanko-rail-work").click();
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-dock-mode", "work");
    // Unsigned scratch shows the board shell (sign-in copy); kanban columns need auth.
    await expect(page.getByTestId("flow-tasks-board")).toBeVisible();
  });

  test("Insights dock still opens", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-rail-insights").click();
    await expect(page.getByTestId("blanko-insights")).toBeVisible({ timeout: 10000 });
  });

  test("InsightsPanel source wires Fix CTA and Tracked label", async () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "webapp/client/src/blanko/InsightsPanel.tsx"),
      "utf8"
    );
    expect(src).toMatch(/blanko-insights-fix-agent-/);
    expect(src).toMatch(/>\s*\{fixBusyId === a\.id \? "Starting…" : "Fix"\}\s*</);
    expect(src).toMatch(/Runs agent in sandbox → review in Flow/);
    expect(src).toMatch(/todoStatus \? "Tracked" : "Add task"/);
    expect(src).not.toMatch(/: "Fix with agent"/);
  });

  test("FlowTasksBoard source has Needs review + rail review controls", async () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "webapp/client/src/FlowTasksBoard.tsx"),
      "utf8"
    );
    expect(src).toMatch(/Needs review/);
    expect(src).toMatch(/flow-task-diff-/);
    expect(src).toMatch(/flow-task-approve-/);
    expect(src).toMatch(/flow-task-reject-/);
    expect(src).toMatch(/canManualAdvanceTodo/);
  });
});

/*
 * Manual dogfood checklist (Pro workspace + scanned trading-agent):
 * 1. Open scan → click Middleware Platform (code action with file).
 * 2. Insights → Add task → Flow → Tasks shows card (Tracked).
 * 3. Insights → Fix → Doing column / agent run (or Pro upgrade / no-key error).
 * 4. Needs review → View diff → Approve (apply) or Reject (undo sandbox).
 * 5. Do not Move → Completed on railed cards — use Approve.
 * Live script: BLANKO_DOGFOOD=1 npx tsx scripts/dogfood-trading-fix-automation.ts
 */
