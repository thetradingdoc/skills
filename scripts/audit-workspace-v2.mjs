/**
 * Full Playwright audit of workspace-v2.html prototype.
 * Reports: missing UI, broken interactions, stub-only features, a11y holes.
 */
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

const HTML = process.argv[2] || "/Users/ojrichard/Downloads/workspace-v2.html";
const OUT = process.argv[3] || path.join(process.cwd(), "docs", "workspace-v2-audit.json");
const SHOT_DIR = path.join(process.cwd(), "docs", "workspace-v2-shots");

const issues = [];
function issue(severity, area, title, detail = "") {
  issues.push({ severity, area, title, detail });
  console.log(`[${severity}] ${area}: ${title}${detail ? " — " + detail : ""}`);
}

function startServer(file) {
  const body = fs.readFileSync(file);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

async function visibleText(page, sel) {
  const el = page.locator(sel).first();
  if ((await el.count()) === 0) return "";
  return ((await el.innerText().catch(() => "")) || "").trim();
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const { server, url } = await startServer(HTML);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // ========== LANDING ==========
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: path.join(SHOT_DIR, "01-landing.png") });

  const landingVisible = await page.locator("#landing:not(.hide)").count();
  if (!landingVisible) issue("blocker", "Landing", "Landing not visible on load");

  // Nav links are href="#"
  for (const name of ["Home", "About", "Contact"]) {
    const href = await page.locator(`.l-nav a:text-is("${name}")`).getAttribute("href");
    if (href === "#") {
      issue("medium", "Landing", `${name} nav link is a dead hash`, "href=# — no destination");
    }
  }

  // Decorative rings block the whole landing UI
  const signInBtn = page.getByRole("button", { name: "Sign in", exact: true }).first();
  let blockedByRings = false;
  try {
    await signInBtn.click({ timeout: 2500 });
  } catch {
    blockedByRings = true;
  }
  if (blockedByRings) {
    issue(
      "blocker",
      "Landing",
      ".l-rings decorative overlay intercepts all pointer events",
      "Sign in / Get started / possibly Scan card are unclickable without force"
    );
  }

  // Force through stubs for the rest of the audit
  await signInBtn.click({ force: true });
  await page.waitForTimeout(200);
  let toast = await visibleText(page, ".toast");
  if (!/Sign in/i.test(toast)) {
    issue("high", "Landing", "Sign in does not open auth", `toast="${toast}"`);
  } else {
    issue("high", "Landing", "Sign in is stub-only (toast)", toast);
  }

  await page.getByRole("button", { name: "Get started" }).click({ force: true });
  await page.waitForTimeout(200);
  toast = await visibleText(page, ".toast");
  if (/Get started/i.test(toast)) {
    issue("high", "Landing", "Get started is stub-only (toast)", toast);
  }

  // Can the scan card be clicked normally?
  let scanBlocked = false;
  try {
    await page.getByRole("button", { name: /Scan repository/i }).click({ timeout: 2000 });
  } catch {
    scanBlocked = true;
    await page.getByRole("button", { name: /Scan repository/i }).click({ force: true });
  }
  if (scanBlocked) {
    issue(
      "blocker",
      "Landing",
      "Scan repository button is also blocked by .l-rings overlay"
    );
  }
  // We may have started a scan with default somo URL — reload clean path below
  await page.waitForTimeout(500);
  // Abort whatever started; do controlled empty-repo path
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Empty repo input still scans?
  await page.locator("#repoIn").fill("");
  await page.getByRole("button", { name: /Scan repository/i }).click({ force: true });
  await page.waitForTimeout(400);
  const scanningNow = await page.locator("#scanning:not(.hide)").count();
  if (scanningNow) {
    // wait for no-agent path (empty url doesn't include somo)
    await page.waitForSelector("#app:not(.hide)", { timeout: 20000 });
    await page.screenshot({ path: path.join(SHOT_DIR, "02-no-agent.png") });
    const noAgent = await page.locator(".noagent").count();
    if (!noAgent) {
      issue("high", "No-agent", "Empty/non-somo URL did not show no-agent canvas");
    } else {
      const h = await visibleText(page, ".na-h");
      if (/unknown|No AI agent found in\s*$/i.test(h) || /found in\s*$/i.test(h)) {
        issue("medium", "No-agent", "Empty repo yields awkward title", h);
      }
    }
    // Point at a file stub
    await page.getByRole("button", { name: /Point at a file/i }).click();
    await page.waitForTimeout(200);
    toast = await visibleText(page, ".toast");
    if (/Point at a file/i.test(toast)) {
      issue("high", "No-agent", "Point at a file is stub-only", toast);
    }
  } else {
    issue("blocker", "Scan", "Scan did not start from empty input");
  }

  // Reload for happy path
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("#repoIn").fill("https://github.com/richiejeremiah/somo-platform");
  await page.getByRole("button", { name: /Scan repository/i }).click({ force: true });
  await page.waitForSelector("#app:not(.hide)", { timeout: 20000 });
  await page.screenshot({ path: path.join(SHOT_DIR, "03-app-layers.png") });

  if (pageErrors.length) {
    for (const e of pageErrors) issue("blocker", "Runtime", "Page error", e);
  }

  // ========== TOP BAR ==========
  const views = ["Agent Layers", "Reach", "Flow", "Standard", "Guard"];
  for (const v of views) {
    const btn = page.locator(`[data-view]`).filter({ hasText: new RegExp(`^${v}$`) });
    if ((await btn.count()) === 0) {
      issue("blocker", "Top bar", `Missing view tab: ${v}`);
      continue;
    }
    await btn.click();
    await page.waitForTimeout(250);
    const pressed = await btn.getAttribute("aria-pressed");
    if (pressed !== "true") {
      issue("high", "Top bar", `${v} tab did not become pressed`);
    }
    const canvasText = await visibleText(page, "#canvas");
    if (!canvasText || canvasText.length < 20) {
      issue("blocker", "Canvas", `${v} view rendered empty/near-empty canvas`);
    }
    // Check for missing product views from real app
    await page.screenshot({
      path: path.join(SHOT_DIR, `04-view-${v.toLowerCase()}.png`),
    });
  }

  // Missing Agents / Resources views from product
  for (const missing of ["Agents", "Resources"]) {
    const c = await page.getByRole("button", { name: missing, exact: true }).count();
    if (c === 0) {
      issue(
        "medium",
        "Top bar",
        `Product view "${missing}" not present in this prototype`,
        "workspace-v2 uses Layers/Reach/Flow/Standard/Guard only"
      );
    }
  }

  // 2D / 3D
  await page.locator('[data-view="layers"]').click();
  await page.locator('[data-dim="3d"]').click();
  await page.waitForTimeout(200);
  const iso = await page.locator("#canvas.iso").count();
  if (!iso) {
    issue("medium", "Dimension", "3D toggle did not add .iso class to canvas");
  } else {
    // 3D is CSS-only isometric — not a real 3D scene
    issue(
      "low",
      "Dimension",
      "3D is CSS isometric tilt only, not a real 3D graph",
      "functional but not true 3D"
    );
  }
  await page.locator('[data-dim="2d"]').click();

  // Overview / Deep dive
  await page.locator('[data-den="deep"]').click();
  await page.waitForTimeout(200);
  const deepX = await page.locator(".node-x").count();
  if (deepX === 0) {
    issue("high", "Density", "Deep dive did not reveal node detail text (.node-x)");
  }
  await page.locator('[data-den="over"]').click();

  // Search
  await page.locator("#search").fill("insurance");
  await page.waitForTimeout(200);
  const hits = await page.locator(".node.hit").count();
  const dims = await page.locator(".node.dim").count();
  if (hits === 0) {
    issue("high", "Search", "Search for 'insurance' produced no .hit nodes");
  }
  if (dims === 0) {
    issue("medium", "Search", "Search did not dim non-matching nodes");
  }
  // Search forces layers — intentional but may surprise
  const onLayers = await page.locator('[data-view="layers"]').getAttribute("aria-pressed");
  if (onLayers !== "true") {
    issue("medium", "Search", "Search did not switch back to Layers view");
  }
  await page.locator("#search").fill("");

  // Agent menu
  await page.locator(".agentsel").first().locator("button").first().click();
  await page.waitForTimeout(150);
  const menuOpen = await page.locator("#agentMenu:not(.hide)").count();
  if (!menuOpen) issue("blocker", "Agent selector", "Agent menu did not open");
  const agentBtns = page.locator("#agentMenu button");
  const agentCount = await agentBtns.count();
  if (agentCount < 4) {
    issue("medium", "Agent selector", `Expected 4 agents, found ${agentCount}`);
  }
  const agentNames = [];
  for (let i = 0; i < agentCount; i++) {
    agentNames.push(await agentBtns.nth(i).locator(".mn").innerText());
  }
  // Pick medical-coding and verify Reach empty-state
  await page.locator("#agentMenu button").filter({ hasText: "medical-coding" }).click();
  await page.waitForTimeout(200);
  await page.locator('[data-view="reach"]').click();
  await page.waitForTimeout(200);
  const reachNote = await visibleText(page, "#canvas");
  if (!/no path to patient|reach matrix/i.test(reachNote)) {
    issue(
      "medium",
      "Reach",
      "Non-kelly agent Reach message unexpected",
      reachNote.slice(0, 120)
    );
  }
  // Flow requires kelly
  await page.locator('[data-view="flow"]').click();
  await page.waitForTimeout(150);
  const flowNote = await visibleText(page, "#canvas");
  if (!/Switch to.*kelly-front-desk/i.test(flowNote)) {
    issue("medium", "Flow", "Non-kelly Flow should ask to switch to kelly-front-desk");
  }

  // Switch back to kelly
  await page.locator(".agentsel").first().locator("button").first().click();
  await page.locator("#agentMenu button").filter({ hasText: "kelly-front-desk" }).click();
  await page.locator('[data-view="layers"]').click();

  // Node select → inspect
  const node = page.locator(".node").first();
  if ((await node.count()) === 0) {
    issue("blocker", "Layers", "No component nodes on Layers canvas");
  } else {
    await node.click();
    await page.waitForTimeout(150);
    const inspect = await visibleText(page, "#inspect");
    if (/Select anything/i.test(inspect) || inspect.length < 10) {
      issue("high", "Inspect", "Clicking a node did not populate inspect panel");
    }
    // View source
    await page.getByRole("button", { name: "View source" }).click();
    await page.waitForTimeout(150);
    const codeTab = await page.locator('.tab[data-tab="code"]').getAttribute("aria-current");
    if (codeTab !== "true") {
      issue("high", "Code tab", "View source did not switch sidebar to Code");
    }
    const codeBody = await visibleText(page, "#sideBody");
    if (!/Source|fhir_patients|router/i.test(codeBody)) {
      issue("high", "Code tab", "Code panel empty after selection", codeBody.slice(0, 80));
    }
    // Fake path always routes/...
    if (/routes\/voice\/inbound\.js/i.test(codeBody) || /routes\//.test(codeBody)) {
      // path is fabricated as middleware-platform/routes/${node.t}.js
      issue(
        "medium",
        "Code tab",
        "Source path is fabricated (always routes/${tool}.js)",
        "Not real file paths from the scan"
      );
    }
    await page.getByRole("button", { name: "Open in VS Code" }).click();
    await page.waitForTimeout(200);
    toast = await visibleText(page, ".toast");
    if (/Opening in editor/i.test(toast)) {
      issue("high", "Code tab", "Open in VS Code is stub-only", toast);
    }
    await page.getByRole("button", { name: "Add rule" }).first().click();
    await page.waitForTimeout(200);
    toast = await visibleText(page, ".toast");
    if (/Added to reach.rules/i.test(toast)) {
      issue("high", "Inspect", "Add rule is stub-only (toast, no rules mutation)");
    }
  }

  // ========== SIDEBAR TABS ==========
  await page.locator('.tab[data-tab="dash"]').click();
  await page.waitForTimeout(150);
  const dash = await visibleText(page, "#sideBody");
  if (!/Agent coverage|What's missing|Canvas filters/i.test(dash)) {
    issue("high", "Dashboard", "Dashboard missing expected cards", dash.slice(0, 100));
  }
  // Gap / coverage bars are non-functional (code inspection + click)
  if ((await page.locator("#sideBody .gap").count()) > 0) {
    issue(
      "medium",
      "Dashboard",
      "Gap rows are buttons but do not navigate to the related layer/component",
      "click is a no-op beyond hover style"
    );
  }
  if ((await page.locator("#sideBody .bar").count()) > 0) {
    issue(
      "medium",
      "Dashboard",
      "Coverage bar buttons do not scroll/focus the matching Layers band"
    );
  }
  // Filters only toast
  const filter = page.locator("#sideBody .f").filter({ hasText: "Patient data" });
  if ((await filter.count()) > 0) {
    const before = await page.locator(".node").count();
    await filter.click();
    await page.waitForTimeout(200);
    toast = await visibleText(page, ".toast");
    const after = await page.locator(".node").count();
    if (/Filter applied/i.test(toast) && before === after) {
      issue(
        "high",
        "Dashboard",
        "Canvas filters are stub-only",
        "toast says applied but canvas node count unchanged"
      );
    }
  }

  // Chat gated
  await page.locator('.tab[data-tab="chat"]').click();
  await page.waitForTimeout(150);
  const chat = await visibleText(page, "#sideBody");
  if (!/Create account to use chat/i.test(chat)) {
    issue("medium", "Chat", "Unsigned chat gate missing");
  }
  // Suggest buttons call signIn — OK
  await page.getByRole("button", { name: /Create account to use chat/i }).click();
  await page.waitForTimeout(300);
  const chatAfter = await visibleText(page, "#sideBody");
  if (!/Which tools can reach patient/i.test(chatAfter)) {
    issue("high", "Chat", "After sign-in, chat transcript did not appear");
  }
  // Composer only toasts
  await page.locator(".composer input").fill("What is empty?");
  await page.locator(".composer .send").click();
  await page.waitForTimeout(200);
  toast = await visibleText(page, ".toast");
  if (/Sent/i.test(toast)) {
    issue(
      "high",
      "Chat",
      "Chat send is stub-only",
      "shows toast 'Sent' but does not append a message or call an API"
    );
  }
  // Gate bar should hide after sign-in
  const gateHidden = await page.locator("#gateBar.hide").count();
  if (!gateHidden) {
    issue("high", "Auth", "Gate bar still visible after signIn()");
  }

  // ========== EXPORT / WS MENUS ==========
  await page.getByRole("button", { name: /Export/i }).click();
  await page.waitForTimeout(100);
  if ((await page.locator("#exportMenu:not(.hide)").count()) === 0) {
    issue("high", "Export", "Export menu did not open");
  } else {
    await page.locator("#exportMenu button").first().click();
    await page.waitForTimeout(200);
    toast = await visibleText(page, ".toast");
    if (/done/i.test(toast)) {
      // signed in — still stub
      issue(
        "high",
        "Export",
        "Export actions are stub-only even when signed in",
        toast
      );
    }
  }

  await page.getByRole("button", { name: "⋮" }).click();
  await page.waitForTimeout(100);
  if ((await page.locator("#wsMenu:not(.hide)").count()) === 0) {
    issue("high", "Workspace menu", "⋮ menu did not open");
  } else {
    await page.locator("#wsMenu button").filter({ hasText: "Scan history" }).click();
    await page.waitForTimeout(200);
    toast = await visibleText(page, ".toast");
    if (/done|needs an account/i.test(toast)) {
      issue("high", "Workspace menu", "Scan history is stub-only", toast);
    }
  }

  // Rename
  await page.locator(".wname").click();
  await page.waitForTimeout(200);
  toast = await visibleText(page, ".toast");
  if (/Rename/i.test(toast)) {
    issue("high", "Top bar", "Rename workspace is stub-only", toast);
  }

  // Save / Share stubs
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(200);
  toast = await visibleText(page, ".toast");
  if (/Save/i.test(toast)) {
    issue("high", "Top bar", "Save is stub-only", toast);
  }

  // ========== SIDEBAR COLLAPSE ==========
  await page.getByRole("button", { name: "Hide panel" }).click();
  await page.waitForTimeout(200);
  const mini = await page.locator("#side.mini").count();
  if (!mini) issue("high", "Sidebar", "Hide panel did not collapse sidebar");
  await page.locator('.rail button[title="Dashboard"]').click();
  await page.waitForTimeout(150);
  const expanded = await page.locator("#side.mini").count();
  if (expanded) {
    issue("high", "Sidebar", "Rail Dashboard did not expand sidebar");
  }

  // ========== STANDARD / GUARD CONTENT CHECKS ==========
  await page.locator('[data-view="standard"]').click();
  await page.waitForTimeout(200);
  const std = await visibleText(page, "#canvas");
  if (!/Measured against the reference model/i.test(std)) {
    issue("blocker", "Standard", "Standard header missing");
  }
  if (!/high-risk profile|standard profile/i.test(std)) {
    issue("high", "Standard", "Calibration/profile line missing");
  }
  // Standard has no PASS/FAIL marks — only not found / found
  if (!/PASS|FAIL/i.test(std) && /not found|found/i.test(std)) {
    issue(
      "low",
      "Standard",
      "Scorecard shows found/not-found but no explicit PASS/FAIL marks",
      "prototype uses st-ok/st-no styling instead"
    );
  }
  // Count std rows
  const stdRows = await page.locator(".std-row").count();
  if (stdRows !== 11) {
    issue("high", "Standard", `Expected 11 layer rows, found ${stdRows}`);
  }

  await page.locator('[data-view="guard"]').click();
  await page.waitForTimeout(200);
  const guard = await visibleText(page, "#canvas");
  if (!/reach\.rules/i.test(guard)) {
    issue("blocker", "Guard", "reach.rules panel missing");
  }
  if (!/commented on #418/i.test(guard)) {
    issue("medium", "Guard", "PR comment demo block missing");
  }
  // Check now stub
  await page.getByRole("button", { name: "Check now" }).click();
  await page.waitForTimeout(200);
  toast = await visibleText(page, ".toast");
  if (/Checked against current code/i.test(toast)) {
    issue(
      "high",
      "Guard",
      "Check now is stub-only",
      "does not re-evaluate edited textarea against rules"
    );
  }
  // Editing rules doesn't update results
  await page.locator(".rules-ta").fill("agent x\n  must authenticate");
  await page.getByRole("button", { name: "Check now" }).click();
  await page.waitForTimeout(150);
  const stillFive = await page.locator(".vd-f").count();
  if (stillFive === 5) {
    issue(
      "high",
      "Guard",
      "Editing reach.rules textarea does not change FAIL/PASS results"
    );
  }

  // ========== LIVEKIT AGENT ==========
  await page.locator(".agentsel").first().locator("button").first().click();
  await page.locator("#agentMenu button").filter({ hasText: "livekit-transcription" }).click();
  await page.waitForTimeout(200);
  await page.locator('[data-view="standard"]').click();
  await page.waitForTimeout(200);
  const stdLive = await visibleText(page, "#canvas");
  if (!/standard profile|high-risk/i.test(stdLive)) {
    issue("medium", "Standard", "livekit agent profile text missing");
  }
  // livekit has tools:0 but still shows as agent in selector
  const toolsLabel = await visibleText(page, "#agentCt");
  if (toolsLabel === "0 tools") {
    issue(
      "low",
      "Agent selector",
      "livekit-transcription listed as agent with 0 tools",
      "copy itself says 'Not an agent' in Reasoning void"
    );
  }

  // ========== RESPONSIVE / INSPECT HIDDEN ==========
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.waitForTimeout(100);
  const inspectHidden = await page.locator(".inspect").evaluate((el) => {
    return getComputedStyle(el).display === "none";
  });
  if (inspectHidden) {
    issue(
      "medium",
      "Responsive",
      "Inspect panel hidden below 1280px with no alternate evidence UI",
      "@media (max-width:1280px){.inspect{display:none}}"
    );
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Landing Home links — already checked
  // Scan hardcodes "Reading somo-platform" even for other URLs
  await page.goto(url);
  await page.locator("#repoIn").fill("https://github.com/acme/widget");
  await page.getByRole("button", { name: /Scan repository/i }).click({ force: true });
  await page.waitForTimeout(400);
  const scanH = await visibleText(page, "#scanning .h");
  if (/somo-platform/i.test(scanH) && !/widget/i.test(scanH)) {
    issue(
      "medium",
      "Scanning",
      "Scan header hardcodes 'Reading somo-platform'",
      `shown while scanning other repo: "${scanH}"`
    );
  }
  await page.waitForSelector("#app:not(.hide)", { timeout: 20000 });

  // Close workspace reloads — loses state (expected for prototype)
  issue(
    "low",
    "Workspace menu",
    "Close workspace is location.reload() — fine for prototype, no confirm dialog"
  );

  // Fonts may fail offline
  if (consoleErrors.length) {
    for (const e of consoleErrors.slice(0, 8)) {
      issue("low", "Console", "Console error", e);
    }
  }

  // Completeness summary vs product
  issue(
    "info",
    "Scope",
    "This file is a static HTML prototype with hardcoded AGENTS/GAPS data — not wired to the real scanner"
  );

  // Learn mode missing vs product
  const learn = await page.getByRole("button", { name: /Learn/i }).count();
  if (!learn) {
    issue("low", "Top bar", "Learn density mode from product app is absent (Overview/Deep dive only)");
  }

  await browser.close();
  server.close();

  const summary = {
    file: HTML,
    issueCount: issues.length,
    bySeverity: issues.reduce((acc, i) => {
      acc[i.severity] = (acc[i.severity] || 0) + 1;
      return acc;
    }, {}),
    issues,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary.bySeverity, null, 2));
  console.log("wrote", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
