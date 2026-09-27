/**
 * Parity test: chat-created nodes vs drag-placed nodes should get identical
 * catalog enrichment (techKind/icon, layer) for known DESIGN_PALETTE items.
 * Regression guard for the chat path silently dropping techKind/providerId
 * that the drag path (applyComponentToGraph) always applied.
 */
import { test, expect } from "@playwright/test";

test.describe("Chat vs Drag node parity", () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
    });
  });

  test("[E2E] Chat-created Postgres node matches drag-placed Postgres node's techKind", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("design-empty-canvas")).toBeVisible({ timeout: 15000 });

    // --- Step 1: Drag/click-place Postgres from Components palette ---
    await page.getByTestId("design-empty-open-build").click();
    await expect(page.getByTestId("blanko-build")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("blanko-build-item-postgres").click();

    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(1, {
      timeout: 10000,
    });
    const draggedNodeId = await page
      .locator('.react-flow__node:not([data-id^="band:"])')
      .first()
      .getAttribute("data-id");
    expect(draggedNodeId).toBeTruthy();

    const draggedIconTitle = await page
      .locator(`.react-flow__node[data-id="${draggedNodeId}"]`)
      .getByTestId("blanko-node-icon")
      .locator("span[title]")
      .first()
      .getAttribute("title");

    console.log(`[PARITY] Dragged node icon title: "${draggedIconTitle}"`);
    expect(draggedIconTitle).toBeTruthy();

    // --- Step 2: Simulate chat proposing + accepting a Postgres node ---
    // Mirrors the real accept path: applyDesignCommandsToGraph via the exact
    // window hook the live chat-accept flow calls into.
    await page.waitForFunction(() => typeof (window as any).__llApplyDesignCommands === "function");
    await page.evaluate(() => {
      (window as any).__llApplyDesignCommands([
        {
          action: "create_node",
          id: "chat-postgres-test",
          label: "Postgres",
          layer: "Data Access",
        },
      ]);
    });

    await expect(page.locator('.react-flow__node[data-id="chat-postgres-test"]')).toBeVisible({
      timeout: 10000,
    });

    const chatIconTitle = await page
      .locator('.react-flow__node[data-id="chat-postgres-test"]')
      .getByTestId("blanko-node-icon")
      .locator("span[title]")
      .first()
      .getAttribute("title");

    console.log(`[PARITY] Chat-created node icon title: "${chatIconTitle}"`);
    expect(chatIconTitle).toBeTruthy();

    // --- Step 3: Explicit parity assertion ---
    expect(chatIconTitle).toBe(draggedIconTitle);
  });

  test("[E2E] Chat-created OpenAI node gets platformBindings like drag-placed OpenAI node", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("design-empty-canvas")).toBeVisible({ timeout: 15000 });

    // --- Place an Agent node first, select it, then bind OpenAI onto it ---
    // (OpenAI is a bind-mode item — resolveApplyMode returns "bind" because its
    // provider category "llm" is in BIND_CATEGORIES, so it requires a selected
    // target node; clicking it on an empty canvas errors with no node created.)
    await page.getByTestId("design-empty-open-build").click();
    await expect(page.getByTestId("blanko-build")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("blanko-build-item-agent").click();

    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(1, {
      timeout: 10000,
    });
    const agentNodeId = await page
      .locator('.react-flow__node:not([data-id^="band:"])')
      .first()
      .getAttribute("data-id");
    expect(agentNodeId).toBeTruthy();

    // Note: placing the Agent node auto-selects it AND auto-opens Insights,
    // which closes the Components palette. Reopen it before binding OpenAI.
    if (!(await page.getByTestId("blanko-build").isVisible().catch(() => false))) {
      await page.getByTestId("blanko-rail-build").click().catch(async () => {
        await page.getByText("+ Components", { exact: false }).click();
      });
    }
    await expect(page.getByTestId("blanko-build")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("blanko-build-item-openai").click();

    const draggedNodeId = agentNodeId;
    const draggedBindStatusCount = await page
      .locator(`.react-flow__node[data-id="${draggedNodeId}"]`)
      .getByTestId("blanko-bind-status")
      .count();

    console.log(`[PARITY] Bound OpenAI (drag path) bind-status elements: ${draggedBindStatusCount}`);

    // --- Chat-create the same OpenAI node ---
    await page.waitForFunction(() => typeof (window as any).__llApplyDesignCommands === "function");
    await page.evaluate(() => {
      (window as any).__llApplyDesignCommands([
        {
          action: "create_node",
          id: "chat-openai-test",
          label: "OpenAI",
          layer: "Reasoning",
        },
      ]);
    });

    await expect(page.locator('.react-flow__node[data-id="chat-openai-test"]')).toBeVisible({
      timeout: 10000,
    });

    const chatBindStatusCount = await page
      .locator('.react-flow__node[data-id="chat-openai-test"]')
      .getByTestId("blanko-bind-status")
      .count();

    console.log(`[PARITY] Chat-created OpenAI node bind-status elements: ${chatBindStatusCount}`);

    // True parity: both should behave identically (both >0, or matching counts).
    expect(chatBindStatusCount).toBe(draggedBindStatusCount);
    expect(chatBindStatusCount).toBeGreaterThan(0);
  });
});
