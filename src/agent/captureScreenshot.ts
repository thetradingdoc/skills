/**
 * Capture a full-page screenshot of the app at baseUrl — no Playwright spec required.
 * Used so the agent can run vision critique on every UI rail without human-authored specs.
 */

import * as path from "path";
import * as fs from "fs";
import type { RailId } from "./types";

export interface CaptureScreenshotOutput {
  screenshotPath: string;
  flowWidth: number;
  flowHeight: number;
  nodeCount: number;
  edgeCount: number;
  consoleErrors: string[];
  hasLegend: boolean;
  hasEmptyWorkspaceCard: boolean;
}

/** Launch headless Chromium, open baseUrl, wait for load, take full-page screenshot, and return UI stats. */
export async function captureScreenshot(
  baseUrl: string,
  sandboxPath: string,
  railId: RailId
): Promise<CaptureScreenshotOutput> {
  const { chromium } = await import("playwright");
  const dir = path.join(sandboxPath, ".arch-agent-staging", "traces");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const screenshotPath = path.join(dir, `rail-${railId}-ui.png`);
  const consoleErrors: string[] = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on("console", (msg) => {
      const type = msg.type();
      if (type === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(String(err));
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Wait for the ReactFlow surface to actually have dimensions; otherwise node queries can lie.
    try {
      await page.waitForFunction(
        () => {
          const el = document.querySelector(".react-flow") as HTMLElement | null;
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 20 && r.height > 20;
        },
        { timeout: 8_000 }
      );
    } catch {
      // best-effort: still take screenshot even if sizes never settle
    }
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {
      // Proceed anyway so we don't block on slow networks
    });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const stats = await page.evaluate(() => {
      const flow = document.querySelector(".react-flow") as HTMLElement | null;
      const rect = flow?.getBoundingClientRect();
      const flowWidth = rect?.width ?? 0;
      const flowHeight = rect?.height ?? 0;

      const nodeCount = document.querySelectorAll(".react-flow__node").length;
      // There are multiple ReactFlow edge sub-elements depending on theme; prefer generic edge wrappers.
      const edgeCount = document.querySelectorAll(".react-flow__edge, .react-flow__edge-path").length;

      const bodyText = (document.body?.innerText ?? "").toLowerCase();
      const hasLegend =
        bodyText.includes("click to highlight") ||
        bodyText.includes("layers") ||
        !!document.querySelector('[title*="highlight it on the graph"]');
      const hasEmptyWorkspaceCard = bodyText.includes("empty workspace");

      return { flowWidth, flowHeight, nodeCount, edgeCount, hasLegend, hasEmptyWorkspaceCard };
    });

    return {
      screenshotPath,
      flowWidth: Number(stats.flowWidth) || 0,
      flowHeight: Number(stats.flowHeight) || 0,
      nodeCount: Number(stats.nodeCount) || 0,
      edgeCount: Number(stats.edgeCount) || 0,
      consoleErrors,
      hasLegend: stats.hasLegend ?? false,
      hasEmptyWorkspaceCard: stats.hasEmptyWorkspaceCard ?? false,
    };
  } finally {
    await browser.close();
  }
}
