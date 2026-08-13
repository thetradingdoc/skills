/**
 * P6 LLMOps manage — E2E specs.
 *
 * Covers: agent wired to Memory+Eval shows a healthy (ok/warn-but-not-fail)
 * drift panel; an agent alone shows Memory/Eval warnings; and the design
 * chrome surfaces a one-line drift banner when any agent needs attention.
 *
 * Follows scripts/design-loop.spec.ts / collab-export.spec.ts conventions:
 * chrome-for-testing channel, cache-busted source routes, cleared storage
 * per test, and window.__ll* hooks preferred over flaky drag/drop.
 */
import { test, expect, type Page } from "@playwright/test";

type DesignGraphSnapshot = {
  nodes: number;
  edges: number;
  nodeList: Array<{ id: string; label: string; layer?: string }>;
  edgeList: Array<{ id: string; source: string; target: string; relation?: string }>;
};

async function nodeIds(page: Page): Promise<string[]> {
  return page
    .locator('.react-flow__node:not([data-id^="band:"])')
    .evaluateAll((els) => els.map((n) => n.getAttribute("data-id")).filter(Boolean) as string[]);
}

async function designGraph(page: Page): Promise<DesignGraphSnapshot> {
  return page.evaluate(() => (window as any).__llGetDesignGraph());
}

async function startDesignFromScratch(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("design-from-scratch").click();
  await expect(page.getByTestId("chrome-design-mode")).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => typeof (window as any).__llGetDesignGraph === "function", null, {
    timeout: 15000,
  });
}

test.use({ channel: "chrome-for-testing" });

test.describe("P6 LLMOps manage", () => {
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
          response: res,
          body,
          headers: { ...res.headers(), "cache-control": "no-store" },
        });
      } catch {
        await route.continue();
      }
    });
    await page.goto("/");
    await page.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
    });
    await page.reload();
  });

  // e2e-llmops-agent-wired-ok
  test("[E2E] Agent wired to Memory+Eval shows the LLMOps panel without a failing drift", async ({
    page,
  }) => {
    await startDesignFromScratch(page);
    await page.getByTestId("palette-agent").click();
    await page.getByTestId("palette-memory").click();
    await page.getByTestId("palette-eval").click();
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(3, {
      timeout: 10000,
    });

    const graphBefore = await designGraph(page);
    const agentId = graphBefore.nodeList.find((n) => n.label === "Agent")!.id;
    const memoryId = graphBefore.nodeList.find((n) => n.label === "Memory store")!.id;
    const evalId = graphBefore.nodeList.find((n) => n.label === "Eval harness")!.id;
    expect(agentId).toBeTruthy();
    expect(memoryId).toBeTruthy();
    expect(evalId).toBeTruthy();

    await page.waitForFunction(() => typeof (window as any).__llDesignConnect === "function");
    await page.evaluate(
      ([fromId, toId]) => {
        (window as any).__llDesignConnect(fromId, toId, "reads");
      },
      [agentId, memoryId] as [string, string]
    );
    await page.evaluate(
      ([fromId, toId]) => {
        (window as any).__llDesignConnect(fromId, toId, "calls");
      },
      [agentId, evalId] as [string, string]
    );
    await page.waitForFunction(() => ((window as any).__llGetDesignGraph?.().edges ?? 0) >= 2, null, {
      timeout: 10000,
    });

    await page.waitForFunction(() => typeof (window as any).__llSelectNode === "function");
    await page.evaluate((id) => (window as any).__llSelectNode(id), agentId);

    const panel = page.getByTestId("node-llmops-panel");
    await expect(panel).toBeVisible({ timeout: 10000 });

    const severity = page.getByTestId("llmops-drift-severity");
    await expect(severity).toBeVisible({ timeout: 10000 });
    await expect(severity).not.toHaveText(/fail/i);

    // No eval runs recorded yet in this anonymous session, so a "fail" would
    // only come from a bug in wiring — hasMemoryEdge+hasEvalEdge must hold.
    const reasons = page.getByTestId("llmops-drift-reasons");
    const reasonsVisible = await reasons.isVisible().catch(() => false);
    if (reasonsVisible) {
      await expect(reasons).not.toContainText("No Memory node connected");
      await expect(reasons).not.toContainText("No Eval node connected");
    }
  });

  // e2e-llmops-agent-alone-warns
  test("[E2E] Agent alone shows drift warnings about missing Memory/Eval", async ({ page }) => {
    await startDesignFromScratch(page);
    await page.getByTestId("palette-agent").click();
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(1, {
      timeout: 10000,
    });
    const [agentId] = await nodeIds(page);
    expect(agentId).toBeTruthy();

    await page.waitForFunction(() => typeof (window as any).__llSelectNode === "function");
    await page.evaluate((id) => (window as any).__llSelectNode(id), agentId);

    const panel = page.getByTestId("node-llmops-panel");
    await expect(panel).toBeVisible({ timeout: 10000 });

    const severity = page.getByTestId("llmops-drift-severity");
    await expect(severity).toBeVisible({ timeout: 10000 });
    await expect(severity).toHaveText(/warn/i);

    const reasons = page.getByTestId("llmops-drift-reasons");
    await expect(reasons).toBeVisible();
    await expect(reasons).toContainText("No Memory node connected");
    await expect(reasons).toContainText("No Eval node connected");
  });

  // e2e-llmops-drift-banner
  test("[E2E] Drift banner appears in design chrome when an agent needs Memory/Eval", async ({
    page,
  }) => {
    await startDesignFromScratch(page);
    await page.getByTestId("palette-agent").click();
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(1, {
      timeout: 10000,
    });

    const banner = page.getByTestId("llmops-drift-banner");
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText("LLMOps:");
    await expect(banner).toContainText("1 agent");
  });
});
