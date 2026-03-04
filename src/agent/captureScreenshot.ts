/**
 * Capture a full-page screenshot of the app at baseUrl — no Playwright spec required.
 * Used so the agent can run vision critique on every UI rail without human-authored specs.
 */

import * as path from "path";
import * as fs from "fs";
import type { RailId } from "./types";

/** Launch headless Chromium, open baseUrl, wait for load, take full-page screenshot, return path. */
export async function captureScreenshot(
  baseUrl: string,
  sandboxPath: string,
  railId: RailId
): Promise<string> {
  const { chromium } = await import("playwright");
  const dir = path.join(sandboxPath, ".arch-agent-staging", "traces");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const screenshotPath = path.join(dir, `rail-${railId}-ui.png`);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {
      // Proceed anyway so we don't block on slow networks
    });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  } finally {
    await browser.close();
  }
}
