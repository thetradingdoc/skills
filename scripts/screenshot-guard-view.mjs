/**
 * Screenshot the Guard view.
 * Usage: node scripts/screenshot-guard-view.mjs [graphJson] [outPath]
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const GRAPH_PATH = process.argv[2] || "/tmp/somo-reach-evidence-graph.json";
const OUT =
  process.argv[3] ||
  path.join(process.cwd(), "docs", "guard-view-somo.png");

async function main() {
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, "utf8"));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.route("**/api/scan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(graph),
    });
  });

  await page.goto("http://localhost:5174/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const scanBtn = page.getByRole("button", { name: /Scan repository/i });
  await scanBtn.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((x) => /Scan repository/i.test(x.textContent || ""));
    return b && !b.disabled;
  }, null, { timeout: 60000 });

  await page
    .locator('input[placeholder*="github" i]')
    .fill("https://github.com/richiejeremiah/somo-platform");
  await scanBtn.click();

  const guardBtn = page.getByRole("button", { name: "Guard", exact: true });
  await guardBtn.waitFor({ timeout: 60000 });
  await guardBtn.click();
  await page.waitForTimeout(1200);
  await page.getByText(/new failures would block|unevaluable|PASS|FAIL/i).first().waitFor({
    timeout: 15000,
  }).catch(() => {});

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, fullPage: false });
  console.log("wrote", OUT);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
