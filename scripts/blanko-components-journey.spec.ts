/**
 * Components journey — Gate A/B/D: place from View (click+drag), bind, scan CTA.
 */
import { test, expect, type Page } from "@playwright/test";

type GraphSnap = {
  nodes: Array<{
    id: string;
    llmProvider?: string;
    platformBindings?: Array<{ providerId: string; status?: string }>;
  }>;
  edges: unknown[];
  projectRoot?: string;
};

async function enterScratch(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
  });
  await page.goto("/");
  await page.getByTestId("design-from-scratch").click();
  await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 15000 });
}

async function openBuild(page: Page) {
  if (!(await page.getByTestId("blanko-build").isVisible().catch(() => false))) {
    await page.getByTestId("blanko-rail-build").click();
  }
  await expect(page.getByTestId("blanko-build")).toBeVisible({ timeout: 10000 });
}

async function graphSnapshot(page: Page): Promise<GraphSnap | null> {
  return page.evaluate(() => {
    const api = (
      window as unknown as {
        __blankoE2E?: { getGraphSnapshot: () => GraphSnap | null };
      }
    ).__blankoE2E;
    return api?.getGraphSnapshot() ?? null;
  });
}

test.describe("Components journey fix", () => {
  test("1. Design View → click structural → +1 node, Edit active", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-chrome-view").click();
    await expect(page.getByTestId("blanko-chrome-view")).toHaveAttribute("aria-pressed", "true");

    await openBuild(page);
    const before = await graphSnapshot(page);
    expect(before?.nodes.length ?? 0).toBe(0);

    await page.getByTestId("blanko-build-item-queue").click();
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByTestId("blanko-chrome-edit")).toHaveAttribute("aria-pressed", "true");

    const after = await graphSnapshot(page);
    expect(after?.nodes.length).toBe(1);
    expect(after?.edges.length).toBe(0);
  });

  test("2. Design View → drag structural → +1 node, Edit active", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-chrome-view").click();
    await expect(page.getByTestId("blanko-chrome-view")).toHaveAttribute("aria-pressed", "true");

    await openBuild(page);
    const item = page.getByTestId("blanko-build-item-queue");
    const canvas = page.locator(".react-flow").first();
    await expect(canvas).toBeVisible();

    await item.dragTo(canvas, { targetPosition: { x: 280, y: 220 } });
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByTestId("blanko-chrome-edit")).toHaveAttribute("aria-pressed", "true");

    const after = await graphSnapshot(page);
    expect(after?.nodes.length).toBe(1);
    expect(after?.edges.length).toBe(0);
  });

  test("3. Design → bind Anthropic on selected agent → counts unchanged", async ({ page }) => {
    await enterScratch(page);
    await openBuild(page);
    await page.getByTestId("blanko-build-item-agent").click();
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1, { timeout: 10000 });

    // Re-open Components (place opens Insights)
    await openBuild(page);
    const before = await graphSnapshot(page);
    expect(before?.nodes.length).toBe(1);
    const edgeCount = before?.edges.length ?? 0;

    await page.getByTestId("blanko-build-item-anthropic").click();
    await expect(page.getByTestId("blanko-error-toast")).toHaveCount(0);

    const after = await graphSnapshot(page);
    expect(after?.nodes.length).toBe(1);
    expect(after?.edges.length).toBe(edgeCount);
    const n = after?.nodes[0];
    expect(n?.llmProvider === "anthropic" || n?.platformBindings?.some((b) => b.providerId === "anthropic")).toBe(
      true
    );
  });

  test("4. Design → bind with no selection → no mutation + toast", async ({ page }) => {
    await enterScratch(page);
    await openBuild(page);
    // Ensure nothing selected
    await page.locator(".react-flow__pane").click({ position: { x: 40, y: 40 } });
    await openBuild(page);

    const before = await graphSnapshot(page);
    const beforeJson = JSON.stringify(before);

    const anthropic = page.getByTestId("blanko-build-item-anthropic");
    await anthropic.scrollIntoViewIfNeeded();
    await anthropic.click();
    await expect(page.getByTestId("blanko-error-toast")).toContainText(/Select a module/i);

    const after = await graphSnapshot(page);
    expect(JSON.stringify(after)).toBe(beforeJson);
  });

  test("5. Scan workspace → Components CTA, graph unchanged", async ({ page }) => {
    await enterScratch(page);
    await page.evaluate(() => {
      const api = (
        window as unknown as {
          __blankoE2E: {
            loadScanGraph: (g: {
              nodes: Array<{ id: string; label: string; path: string; layer: string; files: string[]; status: string }>;
              edges: [];
              generatedAt: number;
              projectRoot: string;
              projectName: string;
            }) => void;
          };
        }
      ).__blankoE2E;
      api.loadScanGraph({
        nodes: [
          {
            id: "scan-svc",
            label: "Scanned Service",
            path: "svc",
            layer: "Business Logic",
            files: ["svc/index.ts"],
            status: "stable",
          },
        ],
        edges: [],
        generatedAt: Date.now(),
        projectRoot: "/tmp/e2e-scanned-repo",
        projectName: "e2e-scan",
      });
    });

    await openBuild(page);
    await expect(page.getByTestId("blanko-build-design-only-cta")).toBeVisible();
    await expect(page.getByTestId("blanko-build-design-only-cta")).toContainText(
      /Components are available on design boards/i
    );

    const before = await graphSnapshot(page);
    const beforeJson = JSON.stringify(before);

    // Disabled items should not mutate even if forced
    await page.getByTestId("blanko-build-item-queue").click({ force: true }).catch(() => {});
    await page.getByTestId("blanko-build-item-anthropic").click({ force: true }).catch(() => {});

    const after = await graphSnapshot(page);
    expect(JSON.stringify(after)).toBe(beforeJson);
    expect(after?.projectRoot).toBe("/tmp/e2e-scanned-repo");
    expect(after?.nodes.length).toBe(1);
  });

  test("Gate C: View → inject mutators → Accept applies + Edit", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-chrome-view").click();
    await expect(page.getByTestId("blanko-chrome-view")).toHaveAttribute("aria-pressed", "true");

    await page.evaluate(() => {
      (
        window as unknown as {
          __blankoE2E: { setPendingProposal: (cmds: unknown[]) => void };
        }
      ).__blankoE2E.setPendingProposal([
        {
          action: "create_node",
          id: "e2e-from-view",
          label: "From View",
          layer: "Presentation",
        },
      ]);
    });

    await expect(page.getByTestId("blanko-proposed-changes")).toBeVisible();
    await page.getByTestId("blanko-propose-accept").click();
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByTestId("blanko-chrome-edit")).toHaveAttribute("aria-pressed", "true");
  });
});
