/**
 * P1 assisted design loop — E2E specs.
 *
 * Covers: relation picker + labelled edge, blocker fix/rewire, inspect
 * explain + usual neighbours, build-plan step marking a node built,
 * position persistence + auto arrange, anonymous draft survives reload,
 * blueprint fork, and scan reconciliation (matched/missing/unplanned).
 *
 * Follows scripts/greenfield-canvas.spec.ts conventions: cache-busted
 * source routes, cleared storage per test, and window.__ll* hooks preferred
 * over flaky drag/drop or thin SVG-path clicks.
 */
import { test, expect, type Page } from "@playwright/test";

async function nodeIds(page: Page): Promise<string[]> {
  return page
    .locator('.react-flow__node:not([data-id^="band:"])')
    .evaluateAll((els) => els.map((n) => n.getAttribute("data-id")).filter(Boolean) as string[]);
}

type DesignGraphSnapshot = {
  nodes: number;
  edges: number;
  nodeList: Array<{
    id: string;
    label: string;
    layer?: string;
    position?: { x: number; y: number };
    buildStatus?: "planned" | "building" | "built";
  }>;
  edgeList: Array<{ id: string; source: string; target: string; relation?: string }>;
};

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

// The bundled headless-shell binary SEGVs in this sandbox; force the full
// Chrome for Testing binary (still headless) instead.
test.use({ channel: "chrome-for-testing" });

test.describe("P1 assisted design loop", () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page, context }) => {
    await context.route("**/src/**", async (route) => {
      const url = route.request().url();
      if (!/\.(tsx|ts|jsx|js)(\?|$)/.test(url)) {
        await route.continue();
        return;
      }
      const base = url.split("?")[0];
      const res = await route.fetch({ url: `${base}?bust=${Date.now()}` });
      const body = await res.text();
      await route.fulfill({
        response: res,
        body,
        headers: { ...res.headers(), "cache-control": "no-store" },
      });
    });
    // Note: deliberately NOT using page.addInitScript() to clear storage —
    // that re-runs on every navigation (including page.reload()), which
    // would wipe the very localStorage draft that reload-persistence tests
    // rely on. Clear once up front instead.
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

  // e2e-relation-picker-edge-label
  test("[E2E] Connect two nodes with a picked relation shows a labelled edge", async ({ page }) => {
    await startDesignFromScratch(page);
    await page.getByTestId("palette-api").click();
    await page.getByTestId("palette-db").click();
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(2, {
      timeout: 10000,
    });
    const ids = await nodeIds(page);
    expect(ids.length).toBe(2);

    await page.waitForFunction(() => typeof (window as any).__llDesignConnect === "function");
    await page.evaluate(
      ([fromId, toId]) => {
        (window as any).__llDesignConnect(fromId, toId, "reads");
      },
      [ids[0], ids[1]] as [string, string]
    );

    const label = page.getByTestId("design-edge-relation-label");
    await expect(label).toBeVisible({ timeout: 10000 });
    await expect(label).toHaveText("reads");

    const snapshot = await designGraph(page);
    expect(snapshot.edges).toBe(1);
    expect(snapshot.edgeList[0]?.relation).toBe("reads");
  });

  // e2e-blocker-fix-rewire
  test("[E2E] Frontend→DB direct raises a blocker; Fix it inserts an API and rewires", async ({
    page,
  }) => {
    await startDesignFromScratch(page);
    await page.getByTestId("palette-frontend").click();
    await page.getByTestId("palette-db").click();
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(2, {
      timeout: 10000,
    });
    const [frontendId, dbId] = await nodeIds(page);

    await page.waitForFunction(() => typeof (window as any).__llDesignConnect === "function");
    await page.evaluate(
      ([fromId, toId]) => {
        (window as any).__llDesignConnect(fromId, toId);
      },
      [frontendId, dbId] as [string, string]
    );

    // design-from-scratch lands on the Chat tab; switch to Dashboard to see review findings.
    await page.getByTestId("sidebar-tab-dashboard").click();
    await expect(page.getByTestId("design-review-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("design-finding-client_to_db")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("design-fix-client_to_db")).toBeVisible();

    const before = await designGraph(page);
    expect(before.nodes).toBe(2);
    expect(before.edges).toBe(1);

    await page.getByTestId("design-fix-client_to_db").click();

    await expect(page.getByText("API Gateway", { exact: true })).toBeVisible({ timeout: 10000 });
    await page.waitForFunction(
      () => ((window as any).__llGetDesignGraph?.().nodes ?? 0) >= 3,
      null,
      { timeout: 10000 }
    );

    const after = await designGraph(page);
    expect(after.nodes).toBe(3);
    expect(after.edges).toBe(3);
    const apiNode = after.nodeList.find((n) => n.label === "API Gateway");
    expect(apiNode).toBeTruthy();
    expect(
      after.edgeList.some((e) => e.source === frontendId && e.target === apiNode!.id && e.relation === "calls")
    ).toBe(true);
    expect(
      after.edgeList.some((e) => e.source === apiNode!.id && e.target === dbId && e.relation === "reads")
    ).toBe(true);
  });

  // e2e-inspect-explain-neighbours
  test("[E2E] Inspect shows an explanation; usual neighbours creates nodes", async ({ page }) => {
    await startDesignFromScratch(page);
    await page.getByTestId("palette-db").click();
    await expect(page.getByTestId("design-inspect")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("design-inspect-label")).toHaveValue(/Database/i);

    await expect(page.getByText("What this is")).toBeVisible();
    await expect(page.getByText("Why it's here")).toBeVisible();
    await expect(page.getByText("Usually connects to")).toBeVisible();
    await expect(page.getByText("What breaks without it")).toBeVisible();

    const before = await designGraph(page);
    expect(before.nodes).toBe(1);

    const addNeighbours = page.getByTestId("design-inspect-add-neighbours");
    await expect(addNeighbours).toBeVisible();
    await addNeighbours.click();

    await page.waitForFunction(() => ((window as any).__llGetDesignGraph?.().nodes ?? 0) >= 4, null, {
      timeout: 10000,
    });
    const after = await designGraph(page);
    expect(after.nodes).toBe(4);
    expect(after.edges).toBe(3);

    // Assert via the graph snapshot rather than page text — the palette
    // sidebar (always visible in design mode) repeats these same labels,
    // which makes plain getByText locators ambiguous.
    const labels = after.nodeList.map((n) => n.label);
    expect(labels).toContain("API / Gateway");
    expect(labels).toContain("Cache");
    expect(labels).toContain("Queue");
  });

  // e2e-plan-step-marks-built
  test("[E2E] Checking a plan step marks the node built on canvas", async ({ page }) => {
    await startDesignFromScratch(page);
    await page.evaluate(() => (window as any).__llForkBlueprint("web-auth-db"));
    await page.waitForFunction(() => ((window as any).__llGetDesignGraph?.().nodes ?? 0) === 5, null, {
      timeout: 10000,
    });

    await page.getByTestId("design-dashboard-tab-plan").click();
    await expect(page.getByTestId("design-build-plan-panel")).toBeVisible();

    // First step in dependency order is bp1-auth (no deps of its own).
    const stepId = "bp1-auth";
    const stepRow = page.getByTestId(`design-plan-step-${stepId}`);
    await expect(stepRow).toBeVisible();
    await expect(stepRow).toContainText("planned");
    await expect(
      page.locator(`.react-flow__node[data-id="${stepId}"]`)
    ).toHaveCount(1);

    const before = await designGraph(page);
    expect(before.nodeList.find((n) => n.id === stepId)?.buildStatus).toBe("planned");

    const checkbox = page.getByTestId(`design-plan-checkbox-${stepId}`);
    await checkbox.check();
    await expect(checkbox).toBeChecked();

    // The plan-step status tag flips from "planned" to "built" — a
    // dependency-order-agnostic, review-finding-agnostic signal that the
    // build plan step is wired to the same buildStatus field the canvas
    // node reads for its own rendering (see ArchCanvas buildStatusBorderCss).
    await expect(stepRow).toContainText("built");
    await expect(stepRow).not.toContainText("planned");

    await page.waitForFunction(
      (id) => (window as any).__llGetDesignGraph?.().nodeList.find((n: any) => n.id === id)?.buildStatus === "built",
      stepId,
      { timeout: 10000 }
    );
    const snapshot = await designGraph(page);
    expect(snapshot.nodeList.find((n) => n.id === stepId)?.buildStatus).toBe("built");
  });

  // e2e-position-persist-autoarrange
  test("[E2E] Dropped node keeps position across reload; Auto arrange moves it", async ({ page }) => {
    await startDesignFromScratch(page);
    await page.getByTestId("palette-api").click();
    await expect(page.getByTestId("design-inspect")).toBeVisible({ timeout: 10000 });
    // The canvas node paints a tick after the inspect panel opens (layout is
    // computed asynchronously), so wait for it explicitly before reading ids.
    await expect(page.locator('.react-flow__node:not([data-id^="band:"])')).toHaveCount(1, {
      timeout: 10000,
    });
    const [nodeId] = await nodeIds(page);
    expect(nodeId).toBeTruthy();

    await page.waitForFunction(() => typeof (window as any).__llSetDesignNodePosition === "function");
    await page.evaluate((id) => (window as any).__llSetDesignNodePosition(id, 777, 555), nodeId);
    await page.waitForFunction(
      (id) => (window as any).__llGetDesignGraph?.().nodeList.find((n: any) => n.id === id)?.position?.x === 777,
      nodeId,
      { timeout: 10000 }
    );

    // designGraph:draft is written synchronously on every graph change (no debounce).
    await page.waitForFunction(() => {
      try {
        const raw = localStorage.getItem("designGraph:draft");
        return !!raw && raw.includes('"x":777');
      } catch {
        return false;
      }
    });

    await page.reload();
    await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("chrome-design-mode")).toBeVisible({ timeout: 15000 });
    await page.waitForFunction(() => ((window as any).__llGetDesignGraph?.().nodes ?? 0) >= 1, null, {
      timeout: 10000,
    });

    const restored = await designGraph(page);
    expect(restored.nodeList.length).toBe(1);
    expect(restored.nodeList[0]?.id).toBe(nodeId);
    expect(restored.nodeList[0]?.position).toEqual({ x: 777, y: 555 });

    await page.getByTestId("design-auto-arrange").click();
    await page.waitForFunction(
      (id) => {
        const p = (window as any).__llGetDesignGraph?.().nodeList.find((n: any) => n.id === id)?.position;
        return !!p && (p.x !== 777 || p.y !== 555);
      },
      nodeId,
      { timeout: 10000 }
    );
    const rearranged = await designGraph(page);
    expect(rearranged.nodeList[0]?.position).not.toEqual({ x: 777, y: 555 });
  });

  // e2e-anon-draft-adopt
  test("[E2E] Anonymous draft survives reload via designGraph:draft localStorage", async ({ page }) => {
    await startDesignFromScratch(page);
    await page.getByTestId("palette-auth").click();
    await expect(page.getByTestId("design-inspect")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("design-inspect-label").fill("DraftPersistenceCheck123");
    await expect(page.getByText("DraftPersistenceCheck123", { exact: true })).toBeVisible({
      timeout: 10000,
    });

    await page.waitForFunction(() => {
      try {
        const raw = localStorage.getItem("designGraph:draft");
        return !!raw && raw.includes("DraftPersistenceCheck123");
      } catch {
        return false;
      }
    });

    await page.reload();
    await expect(page.getByTestId("design-from-scratch")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("chrome-design-mode")).toBeVisible({ timeout: 15000 });

    await expect(page.getByText("DraftPersistenceCheck123", { exact: true })).toBeVisible({
      timeout: 10000,
    });
  });

  // e2e-blueprint-fork
  test("[E2E] Blueprint fork produces nodes, a build plan, and findings", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("design-blueprint-gallery-toggle")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("design-blueprint-gallery-toggle").click();
    await expect(page.getByTestId("design-blueprint-fork-web-auth-db")).toBeVisible();
    await page.getByTestId("design-blueprint-fork-web-auth-db").click();

    // Forking lands on the Dashboard tab (not Chat), where "chrome-design-mode"
    // isn't rendered — "design-mode-badge" is the tab-independent indicator.
    await expect(page.getByTestId("design-mode-badge")).toBeVisible({ timeout: 15000 });
    await page.waitForFunction(() => ((window as any).__llGetDesignGraph?.().nodes ?? 0) === 5, null, {
      timeout: 10000,
    });
    const snapshot = await designGraph(page);
    expect(snapshot.nodes).toBe(5);
    expect(snapshot.edges).toBe(5);

    await expect(page.getByTestId("design-review-panel")).toBeVisible();
    await expect(page.getByTestId("design-finding-writes_no_queue")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("design-dashboard-tab-plan").click();
    await expect(page.getByTestId("design-build-plan-panel")).toBeVisible();
    await expect(page.locator('[data-testid^="design-plan-step-"]')).toHaveCount(5);
  });

  // e2e-reconcile-import
  test("[E2E] Scan reconciliation shows matched/missing/unplanned buckets", async ({ page, context }) => {
    await context.route("**/api/scan", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const mockGraph = {
        nodes: [
          {
            id: "scan-api",
            label: "API",
            path: "src/api.ts",
            files: ["src/api.ts"],
            health: { hasDocs: false, hasTests: false, hasContext: false },
            status: "stable",
            isDrift: false,
            layer: "Presentation",
          },
          {
            id: "scan-extra",
            label: "Unplanned Worker",
            path: "src/worker.ts",
            files: ["src/worker.ts"],
            health: { hasDocs: false, hasTests: false, hasContext: false },
            status: "stable",
            isDrift: false,
            layer: "Infrastructure",
          },
        ],
        edges: [],
        generatedAt: Date.now(),
        projectRoot: "/mock/repo",
        projectName: "mock-repo",
        persistError: "E2E mock scan — not persisted.",
        reconciliation: {
          matched: [
            { designNodeId: "design-api-1", scanNodeId: "scan-api", confidence: 1, method: "exact_id" },
          ],
          missing: [{ designNodeId: "design-db-1", label: "Database", layer: "Data Access" }],
          unplanned: [{ scanNodeId: "scan-extra", label: "Unplanned Worker", layer: "Infrastructure" }],
        },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockGraph),
      });
    });

    await page.goto("/");
    await page.getByPlaceholder("https://github.com/owner/repo").fill("https://github.com/mock-org/mock-repo");
    await page.getByTestId("landing-import-scan").click();

    const banner = page.getByTestId("design-reconciliation-banner");
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText("Matched 1");
    await expect(banner).toContainText("Missing 1");
    await expect(banner).toContainText("Unplanned 1");
  });
});
