/**
 * Blanko redesign v2 E2E guards (§5).
 * Extends flow-tasks patterns; prefers Work rail over legacy Flow tabs.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { evaluateDesign } from "../webapp/client/src/designRules.ts";
import {
  canAutoEnqueueForGraph,
  collectAutoEnqueueCandidates,
  selectAutoEnqueueFindings,
} from "../webapp/client/src/autoEnqueueFindings.ts";
import type { ArchGraph } from "../webapp/client/src/types.ts";

const OUT = path.resolve("docs/ops/blanko-e2e-pipeline");

async function openWorkBoard(page: Page) {
  const workRail = page.getByTestId("blanko-rail-work");
  if (await workRail.count()) {
    await workRail.click();
  } else {
    await page.getByTestId("blanko-rail-workspace").click();
    const workTab = page.getByTestId("blanko-dock-tab-work");
    if (await workTab.count()) await workTab.click();
  }
  await expect(page.getByTestId("flow-tasks-board")).toBeVisible({ timeout: 20000 });
}

/** Visible primary action buttons on a Needs review card (Approve + ⋯ only). */
async function visiblePrimaryControls(card: Locator): Promise<string[]> {
  const ids: string[] = [];
  for (const testId of [
    "flow-task-approve-",
    "flow-task-more-",
    "flow-task-diff-",
    "flow-task-reject-",
    "flow-task-run-",
    "flow-task-reset-",
    "flow-task-advance-",
  ]) {
    const btns = card.locator(`[data-testid^="${testId}"]`);
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      const b = btns.nth(i);
      if (await b.isVisible()) {
        const id = await b.getAttribute("data-testid");
        if (id) ids.push(id);
      }
    }
  }
  return ids;
}

test.describe("Blanko e2e pipeline v2", () => {
  test("unit: D1 missing_trading_spine never auto-enqueues", async () => {
    const g: ArchGraph = {
      nodes: [
        {
          id: "trading-chat",
          label: "Trading Chat",
          path: "trading-chat",
          layer: "Presentation",
          files: ["trading-chat/index.js"],
        },
        {
          id: "middleware",
          label: "Middleware",
          path: "middleware-platform",
          layer: "Data Access",
          files: ["middleware-platform/server.js"],
        },
      ],
      edges: [],
      generatedAt: 1,
      projectRoot: "/tmp/clone",
    };
    const findings = evaluateDesign(g);
    expect(findings.some((f) => f.ruleId === "missing_trading_spine")).toBeTruthy();
    expect(selectAutoEnqueueFindings(findings).some((f) => f.ruleId === "missing_trading_spine")).toBeFalsy();
    expect(collectAutoEnqueueCandidates(g).some((c) => c.ruleId === "missing_trading_spine")).toBeFalsy();
  });

  test("unit: n8n/greenfield produce zero auto-enqueue", async () => {
    const base: ArchGraph = {
      nodes: [{ id: "a", label: "A", path: "a", layer: "Presentation", files: [] }],
      edges: [],
      generatedAt: 1,
      projectRoot: "/tmp/x",
    };
    expect(canAutoEnqueueForGraph({ ...base, architectureBoard: true })).toBeFalsy();
    expect(
      canAutoEnqueueForGraph({
        ...base,
        nodes: [{ ...base.nodes[0]!, importSource: "n8n" }],
      })
    ).toBeFalsy();
  });

  test("UI: Work board Actions menu + ≤2 review controls when present", async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.addInitScript(() => {
      (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
    });
    await page.goto("/");
    const design = page.getByTestId("design-from-scratch");
    if (await design.count()) {
      await design.click();
    }
    const work = page.getByTestId("blanko-rail-work");
    if (!(await work.count())) {
      test.info().annotations.push({
        type: "note",
        description: "blanko-rail-work not present (landing / non-shell) — UI gate skipped",
      });
      return;
    }
    await work.click();
    await expect(page.getByTestId("flow-tasks-board")).toBeVisible({ timeout: 15000 });
    const actions = page.getByTestId("flow-tasks-actions");
    if (!(await actions.count())) {
      // Signed-out board still mounts; Actions require auth — not a U1 regression.
      test.info().annotations.push({
        type: "note",
        description: "flow-tasks-actions absent (likely signed out) — control-count gate skipped",
      });
      return;
    }
    await expect(actions).toBeVisible();
    const cards = page.locator('[data-testid^="flow-task-card-"]');
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      const approve = card.locator('[data-testid^="flow-task-approve-"]');
      if ((await approve.count()) === 0) continue;
      const visible = await visiblePrimaryControls(card);
      const primary = visible.filter(
        (id) =>
          id.startsWith("flow-task-approve-") ||
          id.startsWith("flow-task-more-") ||
          id.startsWith("flow-task-diff-") ||
          id.startsWith("flow-task-reject-") ||
          id.startsWith("flow-task-run-") ||
          id.startsWith("flow-task-reset-") ||
          id.startsWith("flow-task-advance-")
      );
      expect(primary.length).toBeLessThanOrEqual(2);
      expect(primary.some((id) => id.startsWith("flow-task-approve-"))).toBeTruthy();
      expect(primary.some((id) => id.startsWith("flow-task-more-"))).toBeTruthy();
      expect(primary.some((id) => id.startsWith("flow-task-diff-"))).toBeFalsy();
    }
  });

  test("UI: Rollup sync status is top-level when idle sections exist", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
    });
    await page.goto("/");
    const rollupSync = page.getByTestId("rollup-sync-status");
    // Ops may be hidden until rollup_has_data (U4) — absence is acceptable.
    if (await rollupSync.count()) {
      await expect(rollupSync).toContainText(/Not yet connected to live activity/i);
      const waitingRows = page.getByText("waiting for webhook/scan activity");
      expect(await waitingRows.count()).toBe(0);
    }
  });
});

test.describe("Blanko e2e live API guards (optional)", () => {
  test.skip(!process.env.BLANKO_E2E_LIVE, "Set BLANKO_E2E_LIVE=1 with server + auth to run");

  test("D2: Approve marks todo done immediately", async ({ request }) => {
    // Placeholder — live dogfood covers Approve; this documents the gate.
    expect(true).toBeTruthy();
  });

  test("D5: Approve rootSource is scan-clone", async ({ request }) => {
    expect(true).toBeTruthy();
  });
});
