/**
 * Diagnostic probe: Components drag/drop behavior + edge cases.
 * Run: npx playwright test scripts/blanko-components-dnd-probe.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

type GraphSnap = {
  nodes: Array<{
    id: string;
    label?: string;
    position?: { x: number; y: number };
    llmProvider?: string;
    platformBindings?: Array<{ providerId: string }>;
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

/** HTML5 palette drop at absolute client coords (avoids Playwright dragTo actionability under the dock). */
async function html5Drop(page: Page, paletteId: string, clientX: number, clientY: number) {
  await page.evaluate(
    ({ paletteId, clientX, clientY }) => {
      const mime = "application/x-littlelabs-design-palette";
      const el = document.querySelector(".react-flow");
      if (!el) throw new Error("no canvas");
      const dt = new DataTransfer();
      dt.setData(mime, paletteId);
      dt.setData("text/plain", paletteId);
      el.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          dataTransfer: dt,
        })
      );
      el.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          dataTransfer: dt,
        })
      );
    },
    { paletteId, clientX, clientY }
  );
}

async function startPaletteDrag(page: Page, itemTestId: string, paletteId: string) {
  await page.getByTestId(itemTestId).evaluate(
    (btn, id) => {
      const mime = "application/x-littlelabs-design-palette";
      const dt = new DataTransfer();
      dt.setData(mime, id);
      dt.setData("text/plain", id);
      btn.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    },
    paletteId
  );
  // Ensure dock pass-through even if React dragstart didn't attach (synthetic events).
  await page.evaluate(() => {
    (
      window as unknown as { __blankoE2E?: { setPaletteDragging: (v: boolean) => void } }
    ).__blankoE2E?.setPaletteDragging(true);
  });
  await page.waitForTimeout(50);
}

/** Clear palette drag pass-through without requiring the source button still be mounted. */
async function endPaletteDrag(page: Page) {
  await page.evaluate(() => {
    (
      window as unknown as { __blankoE2E?: { setPaletteDragging: (v: boolean) => void } }
    ).__blankoE2E?.setPaletteDragging(false);
    window.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
  });
  await page.waitForTimeout(30);
}

test.describe("Components DnD probe", () => {
  test("A. View mode drop places node near drop point + flips Edit", async ({ page }) => {
    await enterScratch(page);
    await page.getByTestId("blanko-chrome-view").click();
    await openBuild(page);

    const canvas = page.locator(".react-flow").first();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    const target = { x: Math.floor(box!.width * 0.45), y: Math.floor(box!.height * 0.4) };
    await page.getByTestId("blanko-build-item-queue").dragTo(canvas, { targetPosition: target });

    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByTestId("blanko-chrome-edit")).toHaveAttribute("aria-pressed", "true");

    const g = await graphSnapshot(page);
    expect(g?.nodes.length).toBe(1);
    expect(g?.edges.length).toBe(0);
    const pos = g?.nodes[0]?.position;
    expect(pos).toBeTruthy();
    expect(Number.isFinite(pos!.x)).toBe(true);
    expect(Number.isFinite(pos!.y)).toBe(true);
    console.log("[probe A] drop target screen-rel", target, "→ node.position", pos);
  });

  test("B. Two drops → two nodes at distinct flow positions (no post-place fitView drift)", async ({
    page,
  }) => {
    await enterScratch(page);
    await openBuild(page);
    const canvas = page.locator(".react-flow").first();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    // Absolute screen drops via HTML5 DnD (avoids Playwright dragTo quirks)
    async function dropAt(paletteId: string, relX: number, relY: number) {
      await page.evaluate(
        ({ paletteId, clientX, clientY }) => {
          const mime = "application/x-littlelabs-design-palette";
          const el = document.querySelector(".react-flow");
          if (!el) throw new Error("no canvas");
          const dt = new DataTransfer();
          dt.setData(mime, paletteId);
          dt.setData("text/plain", paletteId);
          el.dispatchEvent(
            new DragEvent("dragover", {
              bubbles: true,
              cancelable: true,
              clientX,
              clientY,
              dataTransfer: dt,
            })
          );
          el.dispatchEvent(
            new DragEvent("drop", {
              bubbles: true,
              cancelable: true,
              clientX,
              clientY,
              dataTransfer: dt,
            })
          );
        },
        { paletteId, clientX: box!.x + relX, clientY: box!.y + relY }
      );
    }

    await dropAt("queue", 200, 180);
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1);
    await page.waitForTimeout(400);

    const vpAfterFirst = await page.evaluate(() => {
      const el = document.querySelector(".react-flow__viewport") as HTMLElement | null;
      return el?.getAttribute("transform") || getComputedStyle(el!).transform;
    });

    await openBuild(page);
    await dropAt("api", 420, 260);
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(2);

    const g = await graphSnapshot(page);
    expect(g?.nodes.length).toBe(2);
    expect(g?.edges.length).toBe(0);
    const p0 = g?.nodes[0]?.position;
    const p1 = g?.nodes[1]?.position;
    console.log("[probe B] vp after first", vpAfterFirst, "positions", p0, p1);

    // With viewport preserved, flow positions should track screen deltas (~220px apart).
    expect(Math.abs((p0?.x ?? 0) - 200)).toBeLessThan(40);
    expect(Math.abs((p1?.x ?? 0) - 420)).toBeLessThan(40);
    expect(Math.abs((p1?.x ?? 0) - (p0?.x ?? 0))).toBeGreaterThan(100);
  });

  test("C. Drag Anthropic onto canvas with agent selected → bind (no +node)", async ({ page }) => {
    await enterScratch(page);
    await openBuild(page);
    await page.getByTestId("blanko-build-item-agent").click();
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1);

    await openBuild(page);
    const before = await graphSnapshot(page);
    const canvas = page.locator(".react-flow").first();

    await page.getByTestId("blanko-build-item-anthropic").scrollIntoViewIfNeeded();
    await page.getByTestId("blanko-build-item-anthropic").dragTo(canvas, {
      targetPosition: { x: 300, y: 200 },
    });

    const after = await graphSnapshot(page);
    expect(after?.nodes.length).toBe(before?.nodes.length);
    expect(after?.edges.length).toBe(before?.edges.length);
    const n = after?.nodes[0];
    const bound =
      n?.llmProvider === "anthropic" ||
      n?.platformBindings?.some((b) => b.providerId === "anthropic");
    expect(bound).toBe(true);
    console.log("[probe C] bind-via-drag ok; llmProvider=", n?.llmProvider);
  });

  test("D. Drag Anthropic with no selection → toast, no node", async ({ page }) => {
    await enterScratch(page);
    await openBuild(page);
    await page.locator(".react-flow__pane").click({ position: { x: 30, y: 30 } });
    await openBuild(page);

    const before = await graphSnapshot(page);
    const canvas = page.locator(".react-flow").first();
    await page.getByTestId("blanko-build-item-anthropic").scrollIntoViewIfNeeded();
    await page.getByTestId("blanko-build-item-anthropic").dragTo(canvas, {
      targetPosition: { x: 280, y: 200 },
    });

    await expect(page.getByTestId("blanko-error-toast")).toContainText(/Select a module/i, {
      timeout: 5000,
    });
    const after = await graphSnapshot(page);
    expect(after?.nodes.length).toBe(before?.nodes.length ?? 0);
    console.log("[probe D] no-selection drag → toast, nodes unchanged");
  });

  test("E. Scan graph: drag should not place (items disabled + CTA)", async ({ page }) => {
    await enterScratch(page);
    await page.evaluate(() => {
      (
        window as unknown as {
          __blankoE2E: {
            loadScanGraph: (g: Record<string, unknown>) => void;
          };
        }
      ).__blankoE2E.loadScanGraph({
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
        projectRoot: "/tmp/e2e-dnd-scan",
        projectName: "e2e-dnd-scan",
      });
    });

    await openBuild(page);
    await expect(page.getByTestId("blanko-build-design-only-cta")).toBeVisible();

    const item = page.getByTestId("blanko-build-item-queue");
    await expect(item).toBeDisabled();
    const canvas = page.locator(".react-flow").first();
    const before = await graphSnapshot(page);

    await item.dragTo(canvas, { targetPosition: { x: 250, y: 200 }, force: true }).catch(() => {});
    await page.waitForTimeout(400);

    const after = await graphSnapshot(page);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    console.log("[probe E] scan drag blocked; CTA visible");
  });

  test("F. Second drop still places (+ no auto-edge)", async ({ page }) => {
    await enterScratch(page);
    await openBuild(page);
    const canvas = page.locator(".react-flow").first();

    await page.getByTestId("blanko-build-item-queue").dragTo(canvas, {
      targetPosition: { x: 160, y: 180 },
    });
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1);
    await page.waitForTimeout(400);

    await openBuild(page);
    await page.getByTestId("blanko-build-item-api").scrollIntoViewIfNeeded();
    await page.getByTestId("blanko-build-item-api").dragTo(canvas, {
      targetPosition: { x: 180, y: 400 },
    });
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(2, { timeout: 10000 });

    const g = await graphSnapshot(page);
    console.log("[probe F] positions", g?.nodes.map((n) => n.position), "edges", g?.edges.length);
    expect(g?.nodes.length).toBe(2);
    expect(g?.edges.length).toBe(0);
  });

  test("G. Dock pass-through: drop at ~92% width after Insights opens", async ({ page }) => {
    await enterScratch(page);
    await openBuild(page);
    const canvas = page.locator(".react-flow").first();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    await html5Drop(page, "queue", box!.x + 160, box!.y + 180);
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1);
    await expect(page.getByTestId("blanko-dock")).toBeVisible();

    await openBuild(page);
    const box2 = await canvas.boundingBox();
    expect(box2).toBeTruthy();
    const clientX = box2!.x + box2!.width * 0.92;
    const clientY = box2!.y + box2!.height * 0.45;

    await page.getByTestId("blanko-build-item-api").scrollIntoViewIfNeeded();
    await startPaletteDrag(page, "blanko-build-item-api", "api");
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-palette-pass-through", "true");

    const under = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        let n: Element | null = el;
        const path: string[] = [];
        while (n && path.length < 6) {
          path.push(
            n.getAttribute("data-testid") || n.className?.toString?.().slice(0, 40) || n.tagName
          );
          n = n.parentElement;
        }
        return path;
      },
      { x: clientX, y: clientY }
    );
    expect(under.some((p) => String(p).includes("react-flow") || p === "rf__wrapper")).toBe(true);

    await html5Drop(page, "api", clientX, clientY);
    await endPaletteDrag(page);
    await expect(page.getByTestId("blanko-dock")).toHaveAttribute("data-palette-pass-through", "false");

    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(2, { timeout: 10000 });
    const g = await graphSnapshot(page);
    const second = g?.nodes[1]?.position;
    const targetX = box2!.width * 0.92;
    console.log("[probe G] 92% drop →", second, "under", under);
    expect(g?.nodes.length).toBe(2);
    expect(Math.abs((second?.x ?? 0) - targetX)).toBeLessThan(80);
  });

  test("H. Click-place lands at viewport center (+ stack offset)", async ({ page }) => {
    await enterScratch(page);
    await openBuild(page);

    const getCenter = () =>
      page.evaluate(() => {
        const api = (
          window as unknown as {
            __blankoE2E?: { getFlowCenter: () => { x: number; y: number } | null };
          }
        ).__blankoE2E;
        return api?.getFlowCenter() ?? null;
      });

    const center0 = await getCenter();
    expect(center0).toBeTruthy();
    await page.getByTestId("blanko-build-item-queue").click();
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1);
    let g = await graphSnapshot(page);
    expect(Math.abs((g?.nodes[0]?.position?.x ?? 0) - center0!.x)).toBeLessThan(2);
    expect(Math.abs((g?.nodes[0]?.position?.y ?? 0) - center0!.y)).toBeLessThan(2);

    await openBuild(page);
    const center1 = await getCenter();
    expect(center1).toBeTruthy();
    await page.getByTestId("blanko-build-item-api").scrollIntoViewIfNeeded();
    await page.getByTestId("blanko-build-item-api").click();
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(2);
    g = await graphSnapshot(page);
    const p1 = g?.nodes[1]?.position;
    expect(Math.abs((p1?.x ?? 0) - (center1!.x + 24))).toBeLessThan(2);
    expect(Math.abs((p1?.y ?? 0) - (center1!.y + 24))).toBeLessThan(2);
    console.log("[probe H] click centers", { center0, center1 }, g?.nodes.map((n) => n.position));
  });

  test("I. Drop Anthropic on unselected agent → bind that node", async ({ page }) => {
    await enterScratch(page);
    await openBuild(page);
    const canvas = page.locator(".react-flow").first();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    await html5Drop(page, "agent", box!.x + 180, box!.y + 200);
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1);

    await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
    await openBuild(page);

    const before = await graphSnapshot(page);
    const agentId = before?.nodes[0]?.id;
    expect(agentId).toBeTruthy();
    const agentBox = await page.locator(`[data-id="${agentId}"]`).boundingBox();
    expect(agentBox).toBeTruthy();

    await page.getByTestId("blanko-build-item-anthropic").scrollIntoViewIfNeeded();
    await startPaletteDrag(page, "blanko-build-item-anthropic", "anthropic");
    await html5Drop(
      page,
      "anthropic",
      agentBox!.x + agentBox!.width / 2,
      agentBox!.y + agentBox!.height / 2
    );
    await endPaletteDrag(page);

    const after = await graphSnapshot(page);
    expect(after?.nodes.length).toBe(before?.nodes.length);
    expect(after?.edges.length).toBe(before?.edges.length);
    const n = after?.nodes.find((x) => x.id === agentId);
    expect(
      n?.llmProvider === "anthropic" || n?.platformBindings?.some((b) => b.providerId === "anthropic")
    ).toBe(true);
    console.log("[probe I] drop-on-node bind ok");
  });

  test("J. Structural drop on existing node → new node (+offset), no bind", async ({ page }) => {
    await enterScratch(page);
    await openBuild(page);
    const canvas = page.locator(".react-flow").first();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    await html5Drop(page, "agent", box!.x + 180, box!.y + 200);
    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(1);
    const before = await graphSnapshot(page);
    const agentId = before?.nodes[0]?.id!;
    const agentBox = await page.locator(`[data-id="${agentId}"]`).boundingBox();
    expect(agentBox).toBeTruthy();

    await openBuild(page);
    await page.getByTestId("blanko-build-item-queue").scrollIntoViewIfNeeded();
    await startPaletteDrag(page, "blanko-build-item-queue", "queue");
    await html5Drop(
      page,
      "queue",
      agentBox!.x + agentBox!.width / 2,
      agentBox!.y + agentBox!.height / 2
    );
    await endPaletteDrag(page);

    await expect(page.locator("[data-testid='blanko-arch-node']")).toHaveCount(2, { timeout: 10000 });

    const after = await graphSnapshot(page);
    expect(after?.nodes.length).toBe(2);
    expect(after?.edges.length).toBe(0);
    const agent = after?.nodes.find((n) => n.id === agentId);
    expect(agent?.llmProvider).toBeFalsy();
    const queue = after?.nodes.find((n) => n.id !== agentId);
    expect(queue?.position).toBeTruthy();
    expect((queue?.position?.x ?? 0) - (agent?.position?.x ?? 0)).toBeGreaterThan(20);
    console.log("[probe J] place-on-node", queue?.position, "agent", agent?.position);
  });
});
