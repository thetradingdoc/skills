/**
 * Screenshot Reach evidence panel on a patient cell.
 * Usage: node scripts/screenshot-reach-evidence.mjs [graphJson] [outPath]
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const GRAPH_PATH = process.argv[2] || "/tmp/somo-reach-evidence-graph.json";
const OUT =
  process.argv[3] ||
  path.join(process.cwd(), "docs", "reach-evidence-panel.png");

async function main() {
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, "utf8"));
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

  const reachBtn = page.getByRole("button", { name: "Reach", exact: true });
  await reachBtn.waitFor({ timeout: 60000 });
  await reachBtn.click();
  await page.waitForTimeout(800);

  // Find kelly section — click a reaches cell with digit (patient on query_patient_records)
  const qprRow = page.locator("tr", { hasText: "query_patient_records" }).first();
  await qprRow.waitFor({ timeout: 15000 });
  // patient is first sensitivity column after tool name — click first button in that row
  const cellBtn = qprRow.locator("button").first();
  await cellBtn.click();
  await page.waitForTimeout(600);

  // Evidence panel should show
  await page.getByText("Evidence").first().waitFor({ timeout: 5000 });
  await page.getByText(/patient_document_extracts|patient-records-query/i).first().waitFor({
    timeout: 5000,
  }).catch(() => {});

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
