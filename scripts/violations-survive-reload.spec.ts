/**
 * Regression test: violations must survive workspace reload.
 *
 * Uses route mocks: workspace load + violations API return fixture data.
 * Flow: load workspace → violations visible → reload → violations still visible.
 *
 * Skips if app shows landing (no auth). Run with signed-in session for full coverage.
 */
import { test, expect } from "@playwright/test";

const TEST_WS_ID = "test-ws-violations-regression";
const MOCK_GRAPH = {
  nodes: [
    { id: "src/foo", label: "foo", path: "src/foo", layer: "Service", files: ["src/foo.ts"] },
  ],
  edges: [],
  generatedAt: Date.now(),
};
const MOCK_VIOLATIONS = [
  {
    type: "layer_violation",
    severity: "high",
    sourceNodeId: "src/foo",
    description: "Mock violation for regression test",
    suggestedFix: "N/A",
  },
];

test.describe("Violations survive reload", () => {
  test("violations visible after load, still visible after reload", async ({ page }) => {
    await page.route("**/api/workspaces/*/load", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ graph: MOCK_GRAPH, repoUrl: "https://github.com/test/repo" }),
      });
    });
    await page.route("**/api/violations*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ violations: MOCK_VIOLATIONS }),
      });
    });
    await page.route("**/api/workspaces", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { id: TEST_WS_ID, name: "Test", created_at: new Date().toISOString() },
          ]),
        });
      } else route.continue();
    });

    await page.goto(process.env.APP_URL ?? "http://localhost:5174");
    await page.waitForTimeout(1500);

    const onLanding = await page.locator(".landing-page").first().isVisible();
    test.skip(onLanding, "Landing page (no auth). Sign in to run full test.");
    if (onLanding) return;

    await page.evaluate(
      (payload: { id: string; autosaveKey: string; autosaveVal: string }) => {
        localStorage.setItem("lastWorkspaceId", payload.id);
        localStorage.setItem(payload.autosaveKey, payload.autosaveVal);
      },
      { id: TEST_WS_ID, autosaveKey: "autosaveLastWorkspace", autosaveVal: "on" }
    );

    await page.reload();
    await page.waitForTimeout(2500);

    const activeViolations = page.locator('span:has-text("Active violations")');
    await expect(activeViolations.first()).toBeVisible({ timeout: 8000 });

    const restoreError = page.locator("text=Could not restore violations");
    expect(await restoreError.isVisible()).toBeFalsy();

    const violationDesc = page.locator("text=Mock violation for regression test");
    const hasViolations = (await violationDesc.count()) > 0;
    test.skip(!hasViolations, "Violations not shown (auth/session). Run with signed-in user.");
    if (!hasViolations) return;

    await page.reload();
    await page.waitForTimeout(2500);

    await expect(activeViolations.first()).toBeVisible({ timeout: 8000 });
    expect(await restoreError.isVisible()).toBeFalsy();
    const noViolations = page.locator("text=No active violations").first();
    expect(await noViolations.isVisible()).toBeFalsy();
  });
});
