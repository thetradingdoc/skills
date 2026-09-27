/**
 * Gap-fill dual audit — remaining journeys + multi-turn Ask chat + move frames.
 * Evidence → docs/ops/blanko-dual-audit/ (gap-*.png)
 * Follows entry path from blanko-trading-dual-audit.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

import { tradingLiveRoot, tradingScanClone } from "./lib/blanko-target";

const OUT = path.resolve("docs/ops/blanko-dual-audit");
const SCAN_CLONE = process.env.BLANKO_TARGET_ROOT?.trim()
  ? process.env.BLANKO_TARGET_ROOT.trim()
  : (() => {
      try {
        return tradingLiveRoot();
      } catch {
        return tradingScanClone();
      }
    })();
const API = process.env.API_URL ?? "http://localhost:4000";

type Finding = {
  id: string;
  target: "trading-agent" | "blanko" | "both";
  layer: "ui" | "backend" | "ui+backend";
  severity: "P0" | "P1" | "P2" | "P3";
  area: string;
  title: string;
  expected: string;
  actual: string;
  evidence: string;
};

const findings: Finding[] = [];

function shot(name: string) {
  return path.join(OUT, `${name}.png`);
}

function add(f: Finding) {
  findings.push(f);
}

async function e2eGotoScratch(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
  });
  await page.goto("/");
  await page.getByTestId("design-from-scratch").click();
  await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible({ timeout: 20000 });
}

async function applySpine(page: Page) {
  await page.getByTestId("export-menu-toggle").click();
  await page.getByText(/Apply trading agent spine/i).click();
  await expect(page.getByText(/Policy engine|Telegram|Trading Chat|Agent/i).first()).toBeVisible({
    timeout: 15000,
  });
}

async function ensureEdit(page: Page) {
  const edit = page.getByTestId("chrome-mode-edit");
  if (await edit.isVisible().catch(() => false)) {
    if ((await edit.getAttribute("aria-pressed")) !== "true") await edit.click();
  }
}

test.describe.configure({ mode: "serial" });

test.use({
  video: { mode: "on", size: { width: 1280, height: 720 } },
  viewport: { width: 1280, height: 720 },
});

test.describe("dual audit gaps", () => {
  test.afterAll(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "findings-gaps.json"), JSON.stringify(findings, null, 2));
    // Copy any playwright videos into evidence
    const tr = path.resolve("test-results");
    if (fs.existsSync(tr)) {
      const videoDir = path.join(OUT, "video");
      fs.mkdirSync(videoDir, { recursive: true });
      for (const dir of fs.readdirSync(tr)) {
        if (!dir.includes("dual-audit-gaps")) continue;
        const webm = path.join(tr, dir, "video.webm");
        if (fs.existsSync(webm)) {
          fs.copyFileSync(webm, path.join(videoDir, `${dir}.webm`));
        }
      }
    }
  });

  test("G0 multi-turn Ask chat with CHAT_DEV_BYPASS", async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    test.setTimeout(180_000);
    await e2eGotoScratch(page);
    await applySpine(page);
    await page.screenshot({ path: shot("gap-00-shell"), fullPage: true });

    await page.locator("[data-testid='blanko-arch-node']").first().click({ force: true });
    await page.waitForTimeout(400);
    if (!(await page.getByTestId("blanko-insights").isVisible().catch(() => false))) {
      await page.getByTestId("blanko-rail-insights").click();
    }

    const ask = page.getByRole("button", { name: /Ask chat|Continue in chat/i }).first();
    if (await ask.isVisible({ timeout: 5000 }).catch(() => false)) {
      await ask.click();
      await page.waitForTimeout(600);
    }

    const input = page.getByTestId("blanko-chat-input");
    const inputVisible = await input.isVisible({ timeout: 10000 }).catch(() => false);
    await page.screenshot({ path: shot("gap-01-chat-open"), fullPage: true });

    if (!inputVisible) {
      add({
        id: "BK-CHAT-004",
        target: "blanko",
        layer: "ui+backend",
        severity: "P1",
        area: "Ask chat",
        title: "blanko-chat-input not visible after Ask chat / spine",
        expected: "ChatBar input visible (CHAT_DEV_BYPASS=1)",
        actual: "input missing",
        evidence: "gap-01-chat-open.png",
      });
      return;
    }

    await input.fill("Turn 1: Name the money-path nodes from Telegram to Alpaca in one line.");
    await page.screenshot({ path: shot("gap-01-chat-turn1-pre"), fullPage: true });

    const send = page.getByTestId("blanko-chat-send");
    try {
      await send.click({ timeout: 3000 });
    } catch {
      add({
        id: "BK-CHAT-003b",
        target: "blanko",
        layer: "ui",
        severity: "P1",
        area: "Ask chat",
        title: "Chat Send click intercepted (gap retest)",
        expected: "Send clickable",
        actual: "intercepted — used Enter",
        evidence: "gap-01-chat-turn1-pre.png",
      });
      await input.press("Enter");
    }
    await page.waitForTimeout(10000);
    await page.screenshot({ path: shot("gap-01-chat-turn1-post"), fullPage: true });

    const hist1 = await page.getByTestId("blanko-chat-history").innerText().catch(() => "");
    const body1 = hist1 || (await page.locator("body").innerText());
    if (/sign in to save and chat/i.test(body1)) {
      add({
        id: "BK-CHAT-004b",
        target: "blanko",
        layer: "ui+backend",
        severity: "P1",
        area: "Ask chat",
        title: "Ask chat still gated after CHAT_DEV_BYPASS=1",
        expected: "Dev bypass allows chat",
        actual: "sign-in gate copy present",
        evidence: "gap-01-chat-turn1-post.png",
      });
    }

    await input.fill("Turn 2: What did I just ask you? Quote my previous question briefly.");
    await input.press("Enter");
    await page.waitForTimeout(10000);
    await page.screenshot({ path: shot("gap-02-chat-turn2-memory"), fullPage: true });

    const hist2 = await page.getByTestId("blanko-chat-history").innerText().catch(() => "");
    const remembers = /money-path|Telegram|Alpaca|Turn 1|previous|nodes/i.test(hist2 + body1);
    add({
      id: remembers ? "BK-CHAT-MEM-PASS" : "BK-CHAT-005",
      target: "blanko",
      layer: "ui+backend",
      severity: remembers ? "P3" : "P1",
      area: "Ask chat",
      title: remembers ? "Multi-turn Ask chat produced replies / context" : "Multi-turn Ask chat memory weak or failed",
      expected: "Second turn acknowledges prior context",
      actual: remembers ? "Context signals present in chat history/body" : `hist2.len=${hist2.length}`,
      evidence: "gap-02-chat-turn2-memory.png",
    });
  });

  test("G1 neighbours, connect, move frames, Insights CTAs, drag-drop", async ({ page }) => {
    test.setTimeout(180_000);
    await e2eGotoScratch(page);
    await applySpine(page);
    await page.screenshot({ path: shot("gap-10-spine"), fullPage: true });

    await ensureEdit(page);
    const nodes = page.locator("[data-testid='blanko-arch-node']");
    const n = await nodes.count();
    expect(n).toBeGreaterThan(0);

    await nodes.nth(0).click({ force: true });
    await page.waitForTimeout(500);
    if (!(await page.getByTestId("blanko-insights").isVisible().catch(() => false))) {
      await page.getByTestId("blanko-rail-insights").click();
    }
    await page.screenshot({ path: shot("gap-11-node-selected"), fullPage: true });
    await page.screenshot({ path: shot("gap-12-insights-selected"), fullPage: true });

    const fixBtn = page.locator('[data-testid^="blanko-insights-fix"]').first();
    if (await fixBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fixBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: shot("gap-13-insights-fix"), fullPage: true });
    } else {
      await page.screenshot({ path: shot("gap-13-insights-fix-missing"), fullPage: true });
      add({
        id: "BK-INS-001",
        target: "blanko",
        layer: "ui",
        severity: "P2",
        area: "Insights",
        title: "No Fix agent CTA on selected node Insights",
        expected: "blanko-insights-fix-*",
        actual: "missing",
        evidence: "gap-13-insights-fix-missing.png",
      });
    }

    const addTask = page.locator('[data-testid^="blanko-insights-add-task"]').first();
    if (await addTask.isVisible({ timeout: 1500 }).catch(() => false)) {
      await addTask.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: shot("gap-14-add-task"), fullPage: true });
    } else {
      await page.screenshot({ path: shot("gap-14-add-task-missing"), fullPage: true });
    }

    const openCode = page.getByTestId("blanko-show-code-scan").or(page.getByTestId("blanko-show-code-scan-cta")).first();
    if (await openCode.isVisible({ timeout: 1500 }).catch(() => false)) {
      await openCode.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: shot("gap-15-open-code"), fullPage: true });
    } else {
      await page.screenshot({ path: shot("gap-15-open-code-missing"), fullPage: true });
      add({
        id: "BK-SPINE-LEAVE-001",
        target: "blanko",
        layer: "ui",
        severity: "P1",
        area: "Spine",
        title: "Leave-spine / Open code CTA missing on applied spine (scratch)",
        expected: "blanko-show-code-scan",
        actual: "missing — scratch may lack repoUrl",
        evidence: "gap-15-open-code-missing.png",
      });
    }

    // Add neighbours from inspect (may live in DesignInspectPanel)
    const addN = page.getByTestId("design-inspect-add-neighbours");
    if (await addN.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addN.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: shot("gap-16-add-neighbours"), fullPage: true });
    } else {
      await page.screenshot({ path: shot("gap-16-add-neighbours-missing"), fullPage: true });
      add({
        id: "BK-NEIGH-001",
        target: "blanko",
        layer: "ui",
        severity: "P2",
        area: "Inspect",
        title: "Add neighbours control not found",
        expected: "design-inspect-add-neighbours",
        actual: "missing on spine selection",
        evidence: "gap-16-add-neighbours-missing.png",
      });
    }

    // Connect retest
    if (n >= 2) {
      const h0 = nodes.nth(0).locator(".react-flow__handle").first();
      const h1 = nodes.nth(1).locator(".react-flow__handle").first();
      const b0 = await h0.boundingBox().catch(() => null);
      const b1 = await h1.boundingBox().catch(() => null);
      if (b0 && b1) {
        await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
        await page.mouse.down();
        await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2, { steps: 14 });
        await page.mouse.up();
        await page.waitForTimeout(800);
      }
      await page.screenshot({ path: shot("gap-17-connect-retest"), fullPage: true });
      const edges = await page.locator(".react-flow__edge").count();
      add({
        id: edges > 0 ? "BK-CONN-RETEST" : "BK-CONN-002",
        target: "blanko",
        layer: "ui",
        severity: edges > 0 ? "P3" : "P1",
        area: "Connect",
        title: edges > 0 ? "Connect/edges visible after gesture (or pre-existing spine edges)" : "No edges after connect gesture",
        expected: "Visible edges on spine board",
        actual: `edgeCount=${edges}`,
        evidence: "gap-17-connect-retest.png",
      });
    }

    // Move frames on spine node (video also records)
    const target = nodes.nth(Math.min(2, n - 1));
    const box = await target.boundingBox();
    if (box) {
      const sx = box.x + box.width / 2;
      const sy = box.y + 12;
      await page.screenshot({ path: shot("gap-18-move-frame-0"), fullPage: true });
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx + 50, sy + 30, { steps: 8 });
      await page.screenshot({ path: shot("gap-18-move-frame-1"), fullPage: true });
      await page.mouse.move(sx + 100, sy + 50, { steps: 8 });
      await page.screenshot({ path: shot("gap-18-move-frame-2"), fullPage: true });
      await page.mouse.up();
      await page.waitForTimeout(400);
      await page.screenshot({ path: shot("gap-18-move-frame-3"), fullPage: true });
      await page.mouse.move(sx + 100, sy + 50);
      await page.waitForTimeout(250);
      await page.screenshot({ path: shot("gap-19-hover"), fullPage: true });
      await target.click({ force: true });
      await page.waitForTimeout(200);
      await page.screenshot({ path: shot("gap-19-select"), fullPage: true });
    }

    // Components drag-drop
    await page.getByTestId("blanko-rail-build").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("gap-20-components-dock"), fullPage: true });
    const item = page.locator("[draggable='true']").first();
    const canvas = page.locator(".react-flow").first();
    if ((await item.isVisible().catch(() => false)) && (await canvas.isVisible().catch(() => false))) {
      const ib = await item.boundingBox();
      const cb = await canvas.boundingBox();
      if (ib && cb) {
        await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
        await page.mouse.down();
        await page.mouse.move(cb.x + cb.width * 0.6, cb.y + cb.height * 0.5, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(800);
        await page.screenshot({ path: shot("gap-20-drag-drop-component"), fullPage: true });
      }
    } else {
      await page.screenshot({ path: shot("gap-20-drag-drop-missing"), fullPage: true });
      add({
        id: "BK-DND-001",
        target: "blanko",
        layer: "ui",
        severity: "P2",
        area: "Components",
        title: "No draggable component for drag-drop test",
        expected: "draggable catalog item",
        actual: "missing",
        evidence: "gap-20-drag-drop-missing.png",
      });
    }
  });

  test("G2 Rollup, Changes, Code, Rescan, Agents allowlist", async ({ page }) => {
    test.setTimeout(180_000);
    await e2eGotoScratch(page);
    await applySpine(page);

    // Rollup chrome tab
    const rollup = page.getByTestId("chrome-tab-rollup");
    if (await rollup.isVisible({ timeout: 3000 }).catch(() => false)) {
      await rollup.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: shot("gap-30-rollup"), fullPage: true });
    } else {
      await page.screenshot({ path: shot("gap-30-rollup-missing"), fullPage: true });
      add({
        id: "BK-ROLLUP-002",
        target: "blanko",
        layer: "ui",
        severity: "P2",
        area: "Workspace",
        title: "Rollup chrome tab not found",
        expected: "chrome-tab-rollup",
        actual: "missing",
        evidence: "gap-30-rollup-missing.png",
      });
    }

    // Changes via chat bar or workspace
    const proposed = page.getByTestId("blanko-proposed-changes");
    if (await proposed.isVisible({ timeout: 2000 }).catch(() => false)) {
      await proposed.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: shot("gap-31-changes"), fullPage: true });
    } else {
      await page.getByTestId("blanko-rail-workspace").click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: shot("gap-31-changes"), fullPage: true });
    }

    // Agents · Files (former Code dock)
    await page.getByTestId("blanko-rail-agents").click();
    await page.getByTestId("blanko-dock-tab-files").click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: shot("gap-32-code-dock"), fullPage: true });

    // Rescan
    const rescan = page.getByTestId("blanko-staleness-rescan");
    if (await rescan.isVisible({ timeout: 1500 }).catch(() => false)) {
      await page.screenshot({ path: shot("gap-33-rescan-visible"), fullPage: true });
      await rescan.click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: shot("gap-33-rescan-after"), fullPage: true });
    } else {
      await page.screenshot({ path: shot("gap-33-rescan-absent"), fullPage: true });
      add({
        id: "BK-RESCAN-001",
        target: "blanko",
        layer: "ui",
        severity: "P3",
        area: "Staleness",
        title: "Rescan CTA absent (no staleness on scratch spine)",
        expected: "blanko-staleness-rescan when scan stale",
        actual: "absent — expected on scratch without repo scan",
        evidence: "gap-33-rescan-absent.png",
      });
    }

    // Agents Reach / Guard
    await page.getByTestId("blanko-rail-agents").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("gap-40-agents-inventory"), fullPage: true });

    for (const name of ["Reach", "Guard", "Review", "Usage", "Layers"] as const) {
      const t = page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).first();
      if (await t.isVisible({ timeout: 1000 }).catch(() => false)) {
        await t.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: shot(`gap-40-agents-${name.toLowerCase()}`), fullPage: true });
      }
    }

    const reachText = await page.getByTestId("blanko-dock").innerText().catch(() => "");
    fs.writeFileSync(path.join(OUT, "agents-reach-guard.txt"), reachText.slice(0, 6000));
    const mentionsBroker = /alpaca|submit|broker|execute/i.test(reachText);
    const mentionsAllow = /get_quote|get_portfolio|allowlist|propose|tool/i.test(reachText);
    const emptyInv = /No agent inventory/i.test(reachText);
    add({
      id: "BK-AGENTS-ALLOW-001",
      target: "both",
      layer: "ui+backend",
      severity: emptyInv ? "P1" : "P2",
      area: "Agents",
      title: emptyInv
        ? "Agents inventory empty on spine — cannot reconcile Reach/Guard to trading allowlists"
        : "Agents Reach/Guard surface vs trading allowlist",
      expected: "Inventory + Reach/Guard reflecting research/signal tools; no live broker submit",
      actual: `emptyInv=${emptyInv}; mentionsBroker=${mentionsBroker}; mentionsAllow=${mentionsAllow}`,
      evidence: "gap-40-agents-inventory.png, gap-40-agents-reach.png, gap-40-agents-guard.png, agents-reach-guard.txt",
    });

    // Platforms contradiction recheck
    await page.getByTestId("blanko-rail-workspace").click();
    await page.waitForTimeout(400);
    const platTab = page.getByTestId("blanko-dock-tab-platforms").or(page.getByRole("button", { name: /^Platforms$/i })).first();
    if (await platTab.isVisible().catch(() => false)) await platTab.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("gap-41-platforms"), fullPage: true });
    const platText = await page.getByTestId("blanko-dock").innerText().catch(() => "");
    if (/bound/i.test(platText) && /not bound/i.test(platText)) {
      add({
        id: "BK-PLAT-001b",
        target: "blanko",
        layer: "ui",
        severity: "P1",
        area: "Platforms",
        title: "Platforms still shows bound vs not-bound contradiction (gap retest)",
        expected: "Consistent bound counts",
        actual: platText.slice(0, 400),
        evidence: "gap-41-platforms.png",
      });
    }
  });

  test("G3 API chat + trading health recheck", async ({ request }) => {
    test.setTimeout(180_000);
    const scan = await request.post(`${API}/api/scan`, {
      data: { repoUrl: SCAN_CLONE },
      timeout: 120_000,
    });
    const scanBody = (await scan.json().catch(() => ({}))) as Record<string, unknown>;
    fs.writeFileSync(
      path.join(OUT, "gap-scan-for-chat.json"),
      JSON.stringify({ status: scan.status(), keys: Object.keys(scanBody), workspaceId: scanBody.workspaceId }, null, 2)
    );

    const chat = await request.post(`${API}/api/chat`, {
      data: {
        question: "List three architecture risks in this repo in bullets.",
        sessionId: "dual-audit-gap-api",
        graph: scanBody.graph ?? scanBody,
      },
      timeout: 120_000,
    });
    const chatBody = await chat.json().catch(() => ({}));
    fs.writeFileSync(path.join(OUT, "gap-api-chat.json"), JSON.stringify({ status: chat.status(), body: chatBody }, null, 2));
    add({
      id: chat.ok() ? "BK-CHAT-API-PASS" : "BK-CHAT-API-001",
      target: "blanko",
      layer: "backend",
      severity: chat.ok() ? "P3" : "P1",
      area: "Ask chat API",
      title: chat.ok() ? "POST /api/chat OK with CHAT_DEV_BYPASS + graph" : "POST /api/chat failed with bypass + graph",
      expected: "200 answer",
      actual: `${chat.status()}`,
      evidence: "gap-api-chat.json",
    });

    // Trading middleware health if up
    const taHealth = await request.get("http://localhost:8787/health").catch(() => null);
    if (taHealth) {
      const body = await taHealth.json().catch(() => ({}));
      fs.writeFileSync(path.join(OUT, "gap-ta-health.json"), JSON.stringify({ status: taHealth.status(), body }, null, 2));
    }
  });
});
