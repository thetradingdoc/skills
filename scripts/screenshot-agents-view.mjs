/**
 * Screenshot the Agents canvas view using a prebuilt graph JSON (bypasses scan limit).
 * Usage: node scripts/screenshot-agents-view.mjs [graphJson] [outPath]
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const GRAPH_PATH = process.argv[2] || "/tmp/somo-agents-graph.json";
const OUT =
  process.argv[3] ||
  path.join(process.cwd(), "docs", "agents-view-somo.png");

async function main() {
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, "utf8"));
  const agents = graph.agents?.agents ?? [];
  const kinds = {};
  for (const a of agents) {
    kinds[a.kind || "?"] = (kinds[a.kind || "?"] || 0) + 1;
  }
  console.log("inject surfaces", agents.length, kinds);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

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

  const agentsBtn = page.getByRole("button", { name: "Agents", exact: true });
  await agentsBtn.waitFor({ timeout: 60000 });
  await agentsBtn.click();
  await page.waitForTimeout(700);

  const kelly = page.getByRole("button", { name: /kelly-agent-service/i });
  if ((await kelly.count()) > 0) {
    await kelly.first().click();
    await page.waitForTimeout(500);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, fullPage: false });
  console.log("wrote", OUT);
  if (pageErrors.length) console.log("pageErrors", pageErrors.slice(0, 8));
  else console.log("no page errors");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
