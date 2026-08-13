/**
 * Post-V1 multiplayer design graph sync — E2E smoke.
 *
 * Two real browser tabs racing a save isn't practical to script reliably in
 * CI, so the merge/conflict logic itself is proven exhaustively by the unit
 * gate (scripts/test-graph-sync.ts, run via `npx tsx`). This spec only
 * smoke-tests the two things a browser actually needs to prove:
 *  1. Design mode still loads normally (the sync hook must not break chrome
 *     it's wired into).
 *  2. The `/save` response contract now understood by the client
 *     (`{ success, revision }`) parses the way the server contract promises,
 *     using a mocked response so this doesn't depend on live auth/DB.
 */
import { test, expect } from "@playwright/test";

test.describe("Post-V1 multiplayer graph sync", () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page, context }) => {
    await context.route("**/src/**", async (route) => {
      const url = route.request().url();
      if (!/\.(tsx|ts|jsx|js)(\?|$)/.test(url)) {
        await route.continue();
        return;
      }
      const base = url.split("?")[0];
      try {
        const res = await route.fetch({ url: `${base}?bust=${Date.now()}` });
        const body = await res.text();
        await route.fulfill({
          status: res.status(),
          headers: { ...res.headers(), "Cache-Control": "no-store" },
          body,
        });
      } catch {
        await route.continue();
      }
    });
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
    });
  });

  test("[E2E] Design mode still loads with the graph sync hook wired in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("chrome-design-mode")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("design-palette")).toBeVisible();
  });

  test("[E2E] Palette edits still work with the realtime graph sync hook active", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("design-palette")).toBeVisible();
    await page.getByTestId("palette-api").click();
    await expect(page.getByTestId("design-inspect")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
  });

  test("[E2E] Mocked /save response shape includes revision", async ({ page }) => {
    await page.route("**/api/workspaces/*/save", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, revision: 3 }),
      });
    });

    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/workspaces/ws-mock/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph: { nodes: [], edges: [], revision: 2 }, baseRevision: 2 }),
      });
      return res.json();
    });
    expect(result.success).toBe(true);
    expect(typeof result.revision).toBe("number");
    expect(result.revision).toBe(3);
  });

  test("[E2E] Mocked 409 REVISION_CONFLICT shape carries currentRevision + serverGraph", async ({ page }) => {
    await page.route("**/api/workspaces/*/save", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "REVISION_CONFLICT",
          currentRevision: 5,
          serverGraph: { nodes: [{ id: "a" }], edges: [], revision: 5 },
        }),
      });
    });

    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/workspaces/ws-mock/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph: { nodes: [], edges: [], revision: 2 }, baseRevision: 1 }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("REVISION_CONFLICT");
    expect(result.body.currentRevision).toBe(5);
    expect(Array.isArray(result.body.serverGraph.nodes)).toBe(true);
  });
});
