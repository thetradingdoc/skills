/**
 * Test Fix now and Track in Jira buttons on violations.
 *
 * Mocks: workspace load, violations, jira-status, chat-async, tasks, jira-violation.
 * Verifies both buttons trigger the correct API calls and update the UI.
 *
 * Run: npx playwright install  # first time
 *      APP_URL=http://localhost:5174 npm run test:playwright -- scripts/violation-buttons.spec.ts
 * Skips if not signed in (landing page). Sign in for full coverage.
 */
import { test, expect } from "@playwright/test";

const TEST_WS_ID = "test-ws-violation-buttons";
const MOCK_GRAPH = {
  nodes: [
    {
      id: "adapters/ap2-adapter",
      label: "ap2-adapter",
      path: "adapters/ap2-adapter",
      layer: "Service",
      files: ["adapters/ap2-adapter.js"],
    },
    {
      id: "middleware/auth",
      label: "Auth Middleware",
      path: "middleware/auth",
      layer: "Infrastructure",
      files: ["middleware/auth.js"],
    },
  ],
  edges: [],
  projectRoot: "/tmp/test-repo",
  projectName: "test-repo",
  generatedAt: Date.now(),
};

const MOCK_VIOLATIONS = [
  {
    id: "viol-1",
    type: "layer_violation",
    severity: "critical",
    sourceNodeId: "adapters/ap2-adapter",
    targetNodeId: "adapters/ap2-adapter",
    description: "The AP2 mandate verification functions are stubs.",
    suggestedFix: "Implement actual signature validation.",
  },
  {
    id: "viol-2",
    type: "circular_dep",
    severity: "critical",
    sourceNodeId: "middleware/auth",
    targetNodeId: "middleware/platform",
    description: "Circular reference detected with auth middleware.",
    suggestedFix: "Break the cycle.",
  },
];

test.describe("Violation buttons: Fix now and Track in Jira", () => {
  test("Fix now switches to chat and sends prompt", async ({ page }) => {
    const chatAsyncCalls: string[] = [];
    const taskIds: string[] = [];

    await page.route("**/api/workspaces/*/load", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          graph: MOCK_GRAPH,
          repoUrl: "https://github.com/test/repo",
          jiraProjectKey: "TEST",
        }),
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
    await page.route("**/api/jira-status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ configured: true, source: "db" }),
      });
    });
    await page.route("**/api/integrations", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ integrations: [{ provider: "jira", email: "test@example.com" }] }),
      });
    });
    await page.route("**/api/chat-async", async (route) => {
      const body = route.request().postDataJSON?.();
      chatAsyncCalls.push(body?.question ?? "");
      const taskId = `task-${Date.now()}`;
      taskIds.push(taskId);
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ taskId, status: "pending" }),
      });
    });
    await page.route("**/api/tasks/*", (route) => {
      const id = route.request().url().split("/").pop()?.replace(/\?.*/, "") ?? "";
      if (taskIds.includes(id)) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "completed",
            result: { answer: "Here is a fix plan...", violations: [] },
          }),
        });
      } else route.continue();
    });

    await page.goto(process.env.APP_URL ?? "http://localhost:5174");
    await page.waitForTimeout(2000);

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
    await page.waitForTimeout(3000);

    const fixNowBtn = page.getByRole("button", { name: /Fix now/i }).first();
    const hasFixBtn = await fixNowBtn.isVisible().catch(() => false);
    test.skip(!hasFixBtn, "Violations/Fix now not visible. Run with signed-in user.");
    if (!hasFixBtn) return;

    await fixNowBtn.click();
    await page.waitForTimeout(2500);

    expect(chatAsyncCalls.length).toBeGreaterThanOrEqual(1);
    expect(chatAsyncCalls.some((q) => q.includes("Fix this architecture violation"))).toBe(true);
  });

  test("Track in Jira creates ticket and shows Tracked as", async ({ page }) => {
    const jiraViolationCalls: unknown[] = [];

    await page.route("**/api/workspaces/*/load", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          graph: MOCK_GRAPH,
          repoUrl: "https://github.com/test/repo",
          jiraProjectKey: "TEST",
        }),
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
    await page.route("**/api/jira-status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ configured: true, source: "db" }),
      });
    });
    await page.route("**/api/integrations", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ integrations: [{ provider: "jira", email: "test@example.com" }] }),
      });
    });
    await page.route("**/api/jira-violation", async (route) => {
      const body = route.request().postDataJSON?.();
      jiraViolationCalls.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ key: "TEST-123", url: "https://jira.example/browse/TEST-123" }),
      });
    });

    await page.goto(process.env.APP_URL ?? "http://localhost:5174");
    await page.waitForTimeout(2000);

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
    await page.waitForTimeout(3000);

    const trackBtn = page.getByRole("button", { name: /Track in Jira/i }).first();
    const hasTrackBtn = await trackBtn.isVisible().catch(() => false);
    test.skip(!hasTrackBtn, "Track in Jira not visible. Run with signed-in user + Jira configured.");
    if (!hasTrackBtn) return;

    await trackBtn.click();
    await page.waitForTimeout(1500);

    expect(jiraViolationCalls.length).toBeGreaterThanOrEqual(1);
    const trackedText = page.locator("text=Tracked as TEST-123");
    await expect(trackedText.first()).toBeVisible({ timeout: 5000 });
  });
});
