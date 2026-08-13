/**
 * Dual audit evidence harness — trading-agent via Blanko + Blanko product.
 * Report-first: captures screenshots under docs/ops/blanko-dual-audit/ and writes findings JSON.
 * Does not assert perfection; records observations for TRADING_AGENT_VIA_BLANKO_AUDIT.md.
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

import { tradingLiveRoot, tradingScanClone } from "./lib/blanko-target";

const OUT = path.resolve("docs/ops/blanko-dual-audit");
/** Prefer live SSOT for architecture truth; override with BLANKO_TARGET_ROOT for sandbox-only. */
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

async function saveFindings() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify(findings, null, 2));
}

async function ensureEdit(page: Page) {
  const edit = page.getByTestId("chrome-mode-edit");
  if (await edit.isVisible().catch(() => false)) {
    const pressed = await edit.getAttribute("aria-pressed");
    if (pressed !== "true") await edit.click();
  } else {
    // Fallback: click Edit text in chrome
    const btn = page.getByRole("button", { name: /^Edit$/i });
    if (await btn.isVisible().catch(() => false)) await btn.click();
  }
}

test.describe.configure({ mode: "serial" });

test.describe("dual audit trading-agent + blanko", () => {
  test.afterAll(async () => {
    await saveFindings();
  });

  test("0 Blanko API health", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    const ok = res.ok();
    const body = await res.json().catch(() => ({}));
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "blanko-api-health.json"), JSON.stringify({ status: res.status(), body }, null, 2));
    if (!ok) {
      add({
        id: "BK-API-001",
        target: "blanko",
        layer: "backend",
        severity: "P0",
        area: "API/Scan",
        title: "Blanko /health not OK",
        expected: "200 ok:true",
        actual: `${res.status()} ${JSON.stringify(body)}`,
        evidence: "blanko-api-health.json",
      });
    }
    expect(ok).toBeTruthy();
  });

  test("1 Apply spine board + leave CTA + dock tabs", async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.addInitScript(() => {
      (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
    });
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: shot("01-scratch"), fullPage: true });

    await page.getByTestId("export-menu-toggle").click();
    await page.getByText(/Apply trading agent spine/i).click();
    await expect(page.getByText("Policy engine").first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: shot("02-spine-applied"), fullPage: true });

    const insights = page.getByTestId("blanko-insights");
    if (!(await insights.isVisible().catch(() => false))) {
      await page.getByTestId("blanko-rail-insights").click();
    }
    await expect(insights).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: shot("03-insights-board"), fullPage: true });

    const leaveCta = page.getByTestId("blanko-show-code-scan");
    const leaveVisible = await leaveCta.isVisible().catch(() => false);
    if (!leaveVisible) {
      add({
        id: "BK-SPINE-001",
        target: "blanko",
        layer: "ui",
        severity: "P1",
        area: "Spine",
        title: "Leave-spine CTA missing after Apply on scratch board",
        expected: "blanko-show-code-scan visible",
        actual: "not visible (blueprint/scratch may lack repoUrl)",
        evidence: "03-insights-board.png",
      });
    }

    // Payment narrative vs money path
    const bodyText = await insights.innerText();
    if (/Payment/i.test(bodyText) && /money.?path|Telegram.*Identity.*Payment/i.test(bodyText)) {
      add({
        id: "BK-SPINE-002",
        target: "blanko",
        layer: "ui",
        severity: "P2",
        area: "Spine",
        title: "Insights copy may imply Payment on locked money-path edges",
        expected: "Locked edges exclude Payment (EXPECTED_SPINE_EDGES)",
        actual: "Payment mentioned in Insights money-path narrative",
        evidence: "03-insights-board.png",
      });
    }

    // Node-by-node screenshot: click each arch node
    const nodes = page.locator("[data-testid='blanko-arch-node']");
    const n = await nodes.count();
    const labels: string[] = [];
    for (let i = 0; i < Math.min(n, 14); i++) {
      await nodes.nth(i).click({ force: true });
      await page.waitForTimeout(200);
      const label = (await nodes.nth(i).innerText().catch(() => "")).split("\n")[0]?.slice(0, 40) ?? `node-${i}`;
      labels.push(label);
      await page.screenshot({ path: shot(`04-node-${i}`), fullPage: true });
    }
    fs.writeFileSync(path.join(OUT, "spine-node-labels.json"), JSON.stringify({ count: n, labels }, null, 2));

    // Icons: provider-icon vs missing
    const icons = page.locator("[data-testid='provider-icon']");
    const iconCount = await icons.count();
    const genericHits: string[] = [];
    for (let i = 0; i < iconCount; i++) {
      const src = await icons.nth(i).getAttribute("src").catch(() => null);
      if (src && /generic\.svg/i.test(src)) genericHits.push(src);
    }
    fs.writeFileSync(
      path.join(OUT, "icons.json"),
      JSON.stringify({ iconCount, genericHits, nodeCount: n }, null, 2)
    );
    if (genericHits.length > 0) {
      add({
        id: "BK-ICON-001",
        target: "blanko",
        layer: "ui",
        severity: "P3",
        area: "Icons",
        title: "Provider icons fall back to generic.svg on spine board",
        expected: "Brand icons for Alpaca/Kraken/etc when catalogued",
        actual: `${genericHits.length} generic.svg usages (catalog intentionally uses generic for alpaca/kraken)`,
        evidence: "icons.json",
      });
    }

    // Dock tabs
    const rails = [
      ["blanko-rail-build", "05-dock-components"],
      ["blanko-rail-agents", "06-dock-agents"],
      ["blanko-rail-workspace", "07-dock-workspace"],
      ["blanko-rail-work", "08-dock-tasks"],
      ["blanko-rail-view", "09-dock-view"],
      ["blanko-rail-insights", "10-dock-insights"],
    ] as const;
    for (const [tid, name] of rails) {
      const rail = page.getByTestId(tid);
      if (await rail.isVisible().catch(() => false)) {
        await rail.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: shot(name), fullPage: true });
      } else {
        add({
          id: `BK-DOCK-${tid}`,
          target: "blanko",
          layer: "ui",
          severity: "P2",
          area: "Docks",
          title: `Rail ${tid} not visible`,
          expected: "visible",
          actual: "missing",
          evidence: name,
        });
      }
    }

    // Agents subtabs + contrast check
    if (await page.getByTestId("blanko-rail-agents").isVisible().catch(() => false)) {
      await page.getByTestId("blanko-rail-agents").click();
      await page.waitForTimeout(300);
      const agentTabs = ["Inventory", "Layers", "Reach", "Review", "Usage", "Guard"];
      for (const t of agentTabs) {
        const tab = page.getByRole("button", { name: t }).or(page.getByText(t, { exact: true }));
        if (await tab.first().isVisible().catch(() => false)) {
          await tab.first().click();
          await page.waitForTimeout(250);
          await page.screenshot({ path: shot(`06-agents-${t.toLowerCase()}`), fullPage: true });
        }
      }
      // llm-router contrast heuristic
      const darkCard = page.locator("text=llm-router").first();
      if (await darkCard.isVisible().catch(() => false)) {
        const contrast = await darkCard.evaluate((el) => {
          let n: HTMLElement | null = el as HTMLElement;
          for (let i = 0; i < 6 && n; i++) {
            const cs = getComputedStyle(n);
            const bg = cs.backgroundColor;
            const color = cs.color;
            if (bg && bg !== "rgba(0, 0, 0, 0)") return { bg, color, tag: n.tagName };
            n = n.parentElement;
          }
          return { bg: "unknown", color: getComputedStyle(el).color };
        });
        fs.writeFileSync(path.join(OUT, "llm-router-contrast.json"), JSON.stringify(contrast, null, 2));
        const darkBg = /rgb\(\s*(2[0-9]|3[0-9]|4[0-9]|5[0-9])\s*,/.test(contrast.bg || "");
        const darkFg = /rgb\(\s*(2[0-9]|3[0-9]|4[0-9]|5[0-9]|6[0-9]|7[0-9]|8[0-9])\s*,/.test(contrast.color || "");
        if (darkBg && darkFg) {
          add({
            id: "BK-A11Y-001",
            target: "blanko",
            layer: "ui",
            severity: "P2",
            area: "A11y",
            title: "Agents Inventory llm-router card low contrast",
            expected: "WCAG-readable text on card",
            actual: JSON.stringify(contrast),
            evidence: "06-agents-inventory.png / llm-router-contrast.json",
          });
        }
      }
    }

    // Workspace Platforms
    if (await page.getByTestId("blanko-rail-workspace").isVisible().catch(() => false)) {
      await page.getByTestId("blanko-rail-workspace").click();
      await page.waitForTimeout(300);
      const platforms = page.getByRole("button", { name: /Platforms/i }).or(page.getByText("Platforms", { exact: true }));
      if (await platforms.first().isVisible().catch(() => false)) await platforms.first().click();
      await page.screenshot({ path: shot("07-platforms"), fullPage: true });
      const wsText = await page.locator("[data-testid='blanko-dock'], [data-dock-mode]").first().innerText().catch(() => "");
      if (/Anthropic|Claude/i.test(wsText) && /not bound|detected/i.test(wsText)) {
        add({
          id: "TA-PROV-001",
          target: "trading-agent",
          layer: "ui+backend",
          severity: "P2",
          area: "Providers",
          title: "Anthropic/Claude detected but not bound on trading spine board",
          expected: "LLM provider bound to Agent node when Anthropic is in use",
          actual: "detected · not bound (or similar) in Workspace Platforms",
          evidence: "07-platforms.png",
        });
      }
      if (/Alpaca|Kraken/i.test(wsText) && /bound/i.test(wsText)) {
        add({
          id: "TA-PROV-002",
          target: "both",
          layer: "ui+backend",
          severity: "P1",
          area: "Providers",
          title: "Blanko shows brokers bound while runtime Alpaca/Kraken paths are NOT_WIRED stubs",
          expected: "Bound state reflects live wire readiness OR UI marks stub/NOT_WIRED",
          actual: "Platforms show bound; alpaca-broker.js throws NOT_WIRED",
          evidence: "07-platforms.png + middleware alpaca-broker.js",
        });
      }
    }
  });

  test("2 Components place + Edit move + connect", async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.addInitScript(() => {
      (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
    });
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 20000 });

    await page.getByTestId("blanko-rail-build").click();
    const item = page.locator("[data-testid^='blanko-build-item-']").first();
    await expect(item).toBeVisible({ timeout: 10000 });
    await item.click();
    await expect(page.locator("[data-testid='blanko-arch-node']").first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: shot("11-component-placed"), fullPage: true });

    await ensureEdit(page);
    const node = page.locator("[data-testid='blanko-arch-node']").first();
    const box1 = await node.boundingBox();
    if (!box1) {
      add({
        id: "BK-MOVE-000",
        target: "blanko",
        layer: "ui",
        severity: "P1",
        area: "Canvas",
        title: "Cannot measure node for drag",
        expected: "bounding box",
        actual: "null",
        evidence: "11-component-placed.png",
      });
      return;
    }
    await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
    await page.mouse.down();
    await page.mouse.move(box1.x + box1.width / 2 + 120, box1.y + box1.height / 2 + 80, { steps: 12 });
    await page.waitForTimeout(100);
    await page.screenshot({ path: shot("12-move-mid-drag") });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const box2 = await node.boundingBox();
    await page.screenshot({ path: shot("13-move-after"), fullPage: true });
    const dx = box2 && box1 ? Math.abs(box2.x - box1.x) : 0;
    const dy = box2 && box1 ? Math.abs(box2.y - box1.y) : 0;
    fs.writeFileSync(path.join(OUT, "move.json"), JSON.stringify({ box1, box2, dx, dy }, null, 2));
    if (dx < 40 && dy < 40) {
      add({
        id: "BK-MOVE-001",
        target: "blanko",
        layer: "ui",
        severity: "P1",
        area: "Canvas",
        title: "Node drag does not persist position (snap-back or non-draggable)",
        expected: "Node moves ≥40px after Edit drag",
        actual: `dx=${dx} dy=${dy}`,
        evidence: "12-move-mid-drag.png 13-move-after.png move.json",
      });
    }

    // Place second component and try connect
    await page.getByTestId("blanko-rail-build").click();
    const item2 = page.locator("[data-testid^='blanko-build-item-']").nth(1);
    if (await item2.isVisible().catch(() => false)) {
      await item2.click();
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: shot("14-two-nodes"), fullPage: true });
    const handles = page.locator(".react-flow__handle");
    const hc = await handles.count();
    fs.writeFileSync(path.join(OUT, "handles.json"), JSON.stringify({ handleCount: hc }, null, 2));
    if (hc >= 2) {
      const h0 = await handles.nth(0).boundingBox();
      const h1 = await handles.nth(Math.min(1, hc - 1)).boundingBox();
      if (h0 && h1) {
        await page.mouse.move(h0.x + h0.width / 2, h0.y + h0.height / 2);
        await page.mouse.down();
        await page.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        await page.screenshot({ path: shot("15-connect-attempt"), fullPage: true });
        const picker = page.getByTestId("design-relation-picker");
        if (await picker.isVisible().catch(() => false)) {
          await picker.locator("button").first().click().catch(() => {});
          await page.screenshot({ path: shot("16-connect-done"), fullPage: true });
        } else {
          add({
            id: "BK-CONN-001",
            target: "blanko",
            layer: "ui",
            severity: "P2",
            area: "Canvas",
            title: "Relation picker did not appear after handle drag",
            expected: "design-relation-picker visible",
            actual: "not visible",
            evidence: "15-connect-attempt.png",
          });
        }
      }
    }
  });

  test("3 Motion / epilepsy heuristics on spine", async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.addInitScript(() => {
      (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
    });
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("export-menu-toggle").click();
    await page.getByText(/Apply trading agent spine/i).click();
    await expect(page.getByText("Policy engine").first()).toBeVisible({ timeout: 15000 });

    const animReport = await page.evaluate(() => {
      const infinite: Array<{ sel: string; animation: string }> = [];
      document.querySelectorAll("*").forEach((el) => {
        const cs = getComputedStyle(el);
        const an = cs.animationName;
        const iter = cs.animationIterationCount;
        if (an && an !== "none" && (iter === "infinite" || Number(iter) > 3)) {
          infinite.push({
            sel: el.tagName + (el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""),
            animation: `${an} ${iter}`,
          });
        }
      });
      return { infiniteCount: infinite.length, sample: infinite.slice(0, 40) };
    });
    fs.writeFileSync(path.join(OUT, "motion.json"), JSON.stringify(animReport, null, 2));
    await page.locator("[data-testid='blanko-arch-node']").first().click({ force: true });
    await page.waitForTimeout(200);
    await page.screenshot({ path: shot("17-select-frame-a") });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("17-select-frame-b") });
    await page.mouse.move(400, 300);
    await page.waitForTimeout(100);
    await page.screenshot({ path: shot("17-hover-move") });

    if (animReport.infiniteCount > 0) {
      add({
        id: "BK-A11Y-002",
        target: "blanko",
        layer: "ui",
        severity: "P0",
        area: "A11y",
        title: "Infinite CSS animations present on canvas (epilepsy / vestibular risk)",
        expected: "No infinite high-contrast pulse/glow on default board; honor prefers-reduced-motion",
        actual: `${animReport.infiniteCount} infinite animations (see motion.json sample)`,
        evidence: "motion.json 17-select-frame-*.png",
      });
    }

    // reduced motion
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.getByTestId("design-from-scratch").click().catch(() => {});
    // After reload may already be in workspace — try export spine again if chrome present
    if (await page.getByTestId("blanko-chrome-bar").isVisible().catch(() => false)) {
      // already in
    } else if (await page.getByTestId("design-from-scratch").isVisible().catch(() => false)) {
      await page.getByTestId("design-from-scratch").click();
    }
    await page.waitForTimeout(800);
    const reduced = await page.evaluate(() => {
      let animated = 0;
      document.querySelectorAll("*").forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.animationName && cs.animationName !== "none" && cs.animationIterationCount === "infinite") animated++;
      });
      return animated;
    });
    fs.writeFileSync(path.join(OUT, "motion-reduced.json"), JSON.stringify({ infiniteAfterReduce: reduced }, null, 2));
    if (reduced > 0) {
      add({
        id: "BK-A11Y-003",
        target: "blanko",
        layer: "ui",
        severity: "P0",
        area: "A11y",
        title: "prefers-reduced-motion still leaves infinite animations",
        expected: "0 infinite animations when reduced-motion: reduce",
        actual: `${reduced} still infinite`,
        evidence: "motion-reduced.json",
      });
    }
  });

  test("4 Insights Ask chat prefill (Blanko product — not trading turn API)", async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.addInitScript(() => {
      (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
    });
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("export-menu-toggle").click();
    await page.getByText(/Apply trading agent spine/i).click();
    await expect(page.getByText(/Telegram|Trading Chat|Agent/i).first()).toBeVisible({ timeout: 15000 });
    await page.locator("[data-testid='blanko-arch-node']").first().click({ force: true });
    await page.waitForTimeout(400);
    if (!(await page.getByTestId("blanko-insights").isVisible().catch(() => false))) {
      await page.getByTestId("blanko-rail-insights").click();
    }
    await page.screenshot({ path: shot("18-insights-node"), fullPage: true });

    const ask = page.getByRole("button", { name: /Ask chat/i }).first();
    if (await ask.isVisible().catch(() => false)) {
      await ask.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: shot("19-ask-chat-prefill"), fullPage: true });
      const chatInput = page.locator("textarea, input[type='text']").filter({ hasText: "" }).first();
      // Look for chat bar value
      const prefilled = await page.evaluate(() => {
        const areas = Array.from(document.querySelectorAll("textarea, input"));
        return areas.map((a) => ({
          tag: a.tagName,
          testid: a.getAttribute("data-testid"),
          value: (a as HTMLInputElement).value?.slice(0, 200),
        }));
      });
      fs.writeFileSync(path.join(OUT, "ask-chat-prefill.json"), JSON.stringify(prefilled, null, 2));
      const anyPrompt = prefilled.some((p) => (p.value || "").length > 10);
      if (!anyPrompt) {
        add({
          id: "BK-CHAT-001",
          target: "blanko",
          layer: "ui",
          severity: "P1",
          area: "Chat/Memory",
          title: "Ask chat did not prefill ChatBar with node context prompt",
          expected: "Chat input contains Insights chatPrompt",
          actual: "no substantial input value found",
          evidence: "19-ask-chat-prefill.png ask-chat-prefill.json",
        });
      } else {
        // Try send if possible
        const send = page.getByTestId("blanko-chat-send");
        if (await send.isVisible().catch(() => false)) {
          // blanko-chat-plus often intercepts the Send hit-target (BK finding).
          try {
            await send.click({ timeout: 3000 });
          } catch {
            add({
              id: "BK-CHAT-003",
              target: "blanko",
              layer: "ui",
              severity: "P1",
              area: "Chat/Memory",
              title: "Chat Send click intercepted by blanko-chat-plus overlay",
              expected: "Send is clickable",
              actual: "pointer events intercepted by blanko-chat-plus",
              evidence: "19-ask-chat-prefill.png",
            });
            await send.click({ force: true });
          }
          await page.waitForTimeout(4000);
          await page.screenshot({ path: shot("20-ask-chat-response"), fullPage: true });
        }
      }
    } else {
      add({
        id: "BK-CHAT-002",
        target: "blanko",
        layer: "ui",
        severity: "P2",
        area: "Chat/Memory",
        title: "Ask chat button not found on Insights node view",
        expected: "Ask chat visible",
        actual: "missing",
        evidence: "18-insights-node.png",
      });
    }
  });

  test("5 Landing local path scan attempt (trading clone)", async ({ page, request }) => {
    fs.mkdirSync(OUT, { recursive: true });
    // Probe scan API shapes
    const attempts = [
      { url: SCAN_CLONE },
      { path: SCAN_CLONE },
      { repoUrl: SCAN_CLONE },
      { localPath: SCAN_CLONE },
    ];
    const results = [];
    for (const body of attempts) {
      const res = await request.post(`${API}/api/scan`, { data: body });
      results.push({ body, status: res.status(), text: (await res.text()).slice(0, 300) });
    }
    fs.writeFileSync(path.join(OUT, "scan-api-probes.json"), JSON.stringify(results, null, 2));

    await page.goto("/");
    await page.screenshot({ path: shot("21-landing"), fullPage: true });
    const input = page.getByPlaceholder(/github|path|repo|local/i).or(page.locator("input").first());
    if (await input.first().isVisible().catch(() => false)) {
      await input.first().fill(SCAN_CLONE);
      await page.screenshot({ path: shot("22-landing-filled"), fullPage: true });
      const scanBtn = page.getByRole("button", { name: /Scan|Import|Analyze/i }).first();
      if (await scanBtn.isVisible().catch(() => false)) {
        await scanBtn.click();
        await page.waitForTimeout(8000);
        await page.screenshot({ path: shot("23-scan-result"), fullPage: true });
        const err = await page.getByText(/error|limit|sign in|unauthorized|failed/i).first().isVisible().catch(() => false);
        if (err) {
          add({
            id: "BK-SCAN-001",
            target: "blanko",
            layer: "ui+backend",
            severity: "P1",
            area: "Scan",
            title: "Local trading-agent scan from landing showed error/auth/limit",
            expected: "Scan completes for local path with BILLING_DEV_UNLIMITED",
            actual: "error/auth/limit UI after scan click",
            evidence: "23-scan-result.png scan-api-probes.json",
          });
        }
      }
    }
  });
});
