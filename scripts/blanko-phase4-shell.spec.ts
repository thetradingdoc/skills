/**
 * Phase 4 gate — canvas-first shell: quiet chrome, control wall, chat Accept/Reject.
 */
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const API = process.env.API_URL ?? "http://localhost:4000";

const BLUE_CHROME = /rgb\(\s*(37,\s*99,\s*235|59,\s*130,\s*246|29,\s*78,\s*216|56,\s*189,\s*248)\s*\)/;

async function enterScratch(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
  });
  await page.goto("/");
  await page.getByTestId("design-from-scratch").click();
  await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 15000 });
}

async function openComponents(page: Page) {
  await page.getByTestId("blanko-rail-build").click();
  await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-dock-mode", "build");
  await expect(page.getByTestId("blanko-build")).toBeVisible();
}

test.describe("blanko Phase 4 shell", () => {
  test("backend health responds", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).ok).toBe(true);
  });

  test("scratch → quiet canvas; control wall; panels closed", async ({ page }) => {
    await enterScratch(page);

    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("blanko-chat-bar")).toBeVisible();
    await expect(page.getByTestId("blanko-chat-input")).toBeVisible();
    await expect(page.getByTestId("blanko-dock-rail")).toBeVisible();
    await expect(page.getByTestId("blanko-status-bar")).toHaveCount(0);
    await expect(page.getByTestId("blanko-dock")).toHaveCount(0);

    for (const mode of ["insights", "build", "agents", "workspace", "work", "view"] as const) {
      await expect(page.getByTestId(`blanko-rail-${mode}`)).toBeVisible();
    }
    await expect(page.getByTestId("blanko-rail-config")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-code")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-ops")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-tasks")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-inspect")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-evidence")).toHaveCount(0);
    await expect(page.getByTestId("blanko-rail-terminal")).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Assessment", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reach", exact: true })).toHaveCount(0);

    await openComponents(page);
    await expect(page.getByText(/Recommended to start/i)).toBeVisible();
  });

  test("n8n import → canvas open; Insights on demand", async ({ page }) => {
    const fixture = [
      path.resolve("fixtures/n8n/calendar-AEST.json"),
      path.resolve("fixtures/n8n/calendar-EST.json"),
    ].find((f) => fs.existsSync(f));
    test.skip(!fixture, "No n8n fixture available");

    await page.goto("/");
    await page.getByTestId("landing-import-toggle").click();
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("landing-import-n8n").click(),
    ]);
    await fileChooser.setFiles(fixture!);

    await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("blanko-dock")).toHaveCount(0);
    await page.getByTestId("blanko-rail-insights").click();
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-dock-mode", "insights");
    await expect(page.getByTestId("blanko-insights")).toBeVisible();
  });

  test("chat Accept applies create_node; Reject does not", async ({ page }) => {
    await enterScratch(page);
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(0);

    await page.evaluate(() => {
      const api = (
        window as unknown as {
          __blankoE2E?: {
            setPendingProposal: (cmds: unknown[]) => void;
          };
        }
      ).__blankoE2E;
      if (!api) throw new Error("E2E hook missing");
      api.setPendingProposal([
        {
          action: "create_node",
          id: "e2e-auth",
          label: "Auth",
          layer: "Safety",
          techKind: "auth",
        },
      ]);
    });

    await expect(page.getByTestId("blanko-proposed-changes")).toBeVisible();
    await page.getByTestId("blanko-propose-accept").click();
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1);
    await expect(page.getByTestId("blanko-proposed-changes")).toHaveCount(0);

    const beforeReject = await page.locator("[data-testid='blanko-arch-node']").count();
    await page.evaluate(() => {
      (
        window as unknown as {
          __blankoE2E: { setPendingProposal: (cmds: unknown[]) => void };
        }
      ).__blankoE2E.setPendingProposal([
        {
          action: "create_node",
          id: "e2e-db",
          label: "Database",
          layer: "Data Access",
          techKind: "database",
        },
      ]);
    });
    await expect(page.getByTestId("blanko-proposed-changes")).toBeVisible();
    await page.getByTestId("blanko-propose-reject").click();
    await expect(page.getByTestId("blanko-proposed-changes")).toHaveCount(0);
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(beforeReject);
  });

  test("empty graphCommands path shows chat-only notice", async ({ page }) => {
    await enterScratch(page);
    await page.evaluate(() => {
      (
        window as unknown as { __blankoE2E: { setChatOnlyNotice: () => void } }
      ).__blankoE2E.setChatOnlyNotice();
    });
    // Notice lives in expanded tray
    if (!(await page.getByTestId("blanko-chat-history").isVisible().catch(() => false))) {
      await page.getByTestId("blanko-chat-expand").click();
    }
    await expect(page.getByTestId("blanko-chat-only-notice")).toBeVisible();
    await expect(page.getByTestId("blanko-chat-only-notice")).toContainText(/chat only/i);
  });

  test("Agents rail opens Files | Terminal tabs", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-rail-agents").click();
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-dock-mode", "agents");
    await page.getByTestId("blanko-dock-tab-files").click();
    await expect(page.getByTestId("blanko-code-dock")).toBeVisible();
    await expect(page.getByTestId("blanko-dock-tab-files")).toBeVisible();
    await expect(page.getByTestId("blanko-dock-tab-terminal")).toBeVisible();
  });

  test("Agents Review tab; Components places node + Insights details", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-rail-agents").click();
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-dock-mode", "agents");
    await page.getByTestId("blanko-dock-tab-assessment").click();
    await expect(page.getByTestId("blanko-agents-dock")).toBeVisible();

    await openComponents(page);
    const item = page.locator("[data-testid^='blanko-build-item-']").first();
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-dock-mode", "insights");
    await expect(page.getByTestId("blanko-insights-node")).toBeVisible();
    await expect(page.getByTestId("design-inspect")).toBeVisible();
    await expect(page.getByTestId("node-llmops-panel")).toHaveCount(0);
    await expect(page.getByTestId("node-collab-meta")).toHaveCount(0);
  });

  test("View dock → 3D; Canvas chip returns", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-rail-view").click();
    await expect(page.getByTestId("blanko-view-dock")).toBeVisible();
    await page.getByTestId("blanko-view-3d").click();
    await expect(page.getByTestId("blanko-rail-back-canvas")).toBeVisible();
    await page.getByTestId("blanko-rail-back-canvas").click();
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("blanko-rail-back-canvas")).toHaveCount(0);
  });

  test("shell chrome has no blue leftover backgrounds", async ({ page }) => {
    await enterScratch(page);
    const workspace = page.getByTestId("blanko-workspace");
    const offenders = await workspace.evaluate((el, blueReSrc) => {
      const blueRe = new RegExp(blueReSrc);
      const bad: string[] = [];
      const check = (node: Element) => {
        const bg = getComputedStyle(node).backgroundColor;
        if (blueRe.test(bg)) bad.push(`${node.tagName}.${node.className}:${bg}`);
      };
      check(el);
      el.querySelectorAll("[data-testid^='blanko-']").forEach(check);
      return bad.slice(0, 8);
    }, BLUE_CHROME.source);
    expect(offenders).toEqual([]);
  });
});
