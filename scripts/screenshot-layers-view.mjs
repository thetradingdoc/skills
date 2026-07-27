/**
 * Screenshot Layers canvas for kelly-agent-service.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const GRAPH_PATH = process.argv[2] || "/tmp/somo-layers-graph.json";
const OUT =
  process.argv[3] ||
  path.join(process.cwd(), "docs", "layers-kelly-somo.png");

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

  // Default should be Layers after scan — wait for band
  await page.getByText("Ingress", { exact: true }).first().waitFor({ timeout: 30000 }).catch(async () => {
    await page.getByRole("button", { name: "Layers", exact: true }).click();
  });
  await page.waitForTimeout(500);

  // Select kelly if dropdown present
  const select = page.locator("select").first();
  if ((await select.count()) > 0) {
    const opts = await select.locator("option").allTextContents();
    const kelly = opts.findIndex((t) => /kelly-agent-service/i.test(t));
    if (kelly >= 0) await select.selectOption({ index: kelly });
  }
  await page.waitForTimeout(600);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, fullPage: false });
  console.log("wrote", OUT);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
