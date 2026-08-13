/**
 * a11y-motion plan todo — film select/hover + force drift/pulse epilepsy path.
 * Evidence → docs/ops/blanko-dual-audit/a11y-*.png + video/ + a11y-motion-forced.json
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const OUT = path.resolve("docs/ops/blanko-dual-audit");

function shot(name: string) {
  return path.join(OUT, `${name}.png`);
}

async function e2eScratchSpine(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
  });
  await page.goto("/");
  await page.getByTestId("design-from-scratch").click();
  await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("export-menu-toggle").click();
  await page.getByText(/Apply trading agent spine/i).click();
  await expect(page.getByText(/Policy engine|Telegram|Agent/i).first()).toBeVisible({ timeout: 15000 });
}

/** Inject ArchCanvas keyframes onto live nodes to force the epilepsy-capable path. */
async function forceDriftPulse(page: Page) {
  return page.evaluate(() => {
    const styleId = "blanko-a11y-force-drift";
    if (!document.getElementById(styleId)) {
      const s = document.createElement("style");
      s.id = styleId;
      s.textContent = `
        @keyframes nodePulse  { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.35);opacity:0.6} }
        @keyframes driftGlow  { 0%,100%{box-shadow:0 0 0 1px #f85149,0 0 8px transparent} 50%{box-shadow:0 0 0 1px #f85149,0 0 24px #f8514966} }
        @keyframes edgeDriftDot { 0%,100%{opacity:0.4} 50%{opacity:1} }
        .a11y-force-pulse { animation: nodePulse 2s ease infinite !important; }
        .a11y-force-drift { animation: driftGlow 2s ease infinite !important; outline: 2px solid #f85149; }
        .a11y-force-edge { animation: edgeDriftDot 2s ease-in-out infinite !important; stroke: #f85149 !important; }
      `;
      document.head.appendChild(s);
    }
    const nodes = Array.from(document.querySelectorAll(".react-flow__node"));
    nodes.slice(0, 4).forEach((n, i) => {
      n.classList.add(i % 2 === 0 ? "a11y-force-pulse" : "a11y-force-drift");
    });
    const edges = Array.from(document.querySelectorAll(".react-flow__edge path, .react-flow__edge"));
    edges.slice(0, 6).forEach((e) => e.classList.add("a11y-force-edge"));

    const infinite: string[] = [];
    for (const el of document.querySelectorAll(".a11y-force-pulse, .a11y-force-drift, .a11y-force-edge")) {
      const cs = getComputedStyle(el);
      if (cs.animationIterationCount === "infinite" || /infinite/i.test(cs.animation)) {
        infinite.push(el.className);
      }
    }
    // Also count any pre-existing infinite animations in the document
    let preexisting = 0;
    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.animationIterationCount === "infinite" || /infinite/i.test(cs.animationName) && cs.animationDuration !== "0s") {
        if (cs.animationIterationCount === "infinite") preexisting++;
      }
    });
    return { forcedInfinite: infinite.length, preexistingInfinite: preexisting, nodeCount: nodes.length };
  });
}

async function countInfinite(page: Page) {
  return page.evaluate(() => {
    let n = 0;
    const samples: string[] = [];
    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.animationIterationCount === "infinite") {
        n++;
        if (samples.length < 8) samples.push(`${el.tagName}.${el.className}`.slice(0, 80));
      }
    });
    return { infinite: n, samples };
  });
}

test.describe.configure({ mode: "serial" });
test.use({
  video: { mode: "on", size: { width: 1280, height: 720 } },
  viewport: { width: 1280, height: 720 },
});

test.describe("a11y motion drift/pulse", () => {
  test.afterAll(async () => {
    const tr = path.resolve("test-results");
    if (!fs.existsSync(tr)) return;
    const videoDir = path.join(OUT, "video");
    fs.mkdirSync(videoDir, { recursive: true });
    for (const dir of fs.readdirSync(tr)) {
      if (!dir.includes("a11y") && !dir.includes("blanko-a11y")) continue;
      const webm = path.join(tr, dir, "video.webm");
      if (fs.existsSync(webm)) fs.copyFileSync(webm, path.join(videoDir, `${dir}.webm`));
    }
    // also copy any blanko-a11y-motion paths
    for (const dir of fs.readdirSync(tr)) {
      if (!/a11y|motion|drift/i.test(dir)) continue;
      const webm = path.join(tr, dir, "video.webm");
      if (fs.existsSync(webm)) fs.copyFileSync(webm, path.join(videoDir, `${dir}.webm`));
    }
  });

  test("force drift/pulse + select/hover film + reduced-motion", async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    test.setTimeout(180_000);

    await e2eScratchSpine(page);
    await page.screenshot({ path: shot("a11y-00-spine-clean"), fullPage: true });

    const clean = await countInfinite(page);
    fs.writeFileSync(path.join(OUT, "a11y-motion-clean.json"), JSON.stringify(clean, null, 2));

    // Select / hover thrash film
    const nodes = page.locator("[data-testid='blanko-arch-node']");
    const n = await nodes.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(n, 5); i++) {
      await nodes.nth(i).hover({ force: true });
      await page.waitForTimeout(120);
      await page.screenshot({ path: shot(`a11y-01-hover-${i}`), fullPage: true });
      await nodes.nth(i).click({ force: true });
      await page.waitForTimeout(120);
      await page.screenshot({ path: shot(`a11y-02-select-${i}`), fullPage: true });
    }

    // Rapid hover thrash (epilepsy-ish opacity changes)
    for (let k = 0; k < 12; k++) {
      await nodes.nth(k % Math.min(n, 4)).hover({ force: true });
      await page.waitForTimeout(50);
    }
    await page.screenshot({ path: shot("a11y-03-hover-thrash"), fullPage: true });

    // Force drift + pulse path (same keyframes as ArchCanvas)
    const forced = await forceDriftPulse(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: shot("a11y-10-forced-drift-pulse"), fullPage: true });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: shot("a11y-11-forced-drift-pulse-t1"), fullPage: true });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: shot("a11y-12-forced-drift-pulse-t2"), fullPage: true });

    const forcedCount = await countInfinite(page);
    fs.writeFileSync(
      path.join(OUT, "a11y-motion-forced.json"),
      JSON.stringify({ forced, forcedCount, clean }, null, 2)
    );

    // Finding: infinite animations ARE present when drift/pulse classes apply
    const findings = [];
    if (forcedCount.infinite > 0) {
      findings.push({
        id: "BK-A11Y-004",
        target: "blanko",
        layer: "ui",
        severity: "P1",
        area: "A11y",
        title: "Forced driftGlow/nodePulse produce infinite CSS animations (epilepsy risk when isDrift)",
        expected: "No infinite high-contrast pulse, or respect reduced-motion always",
        actual: `infinite=${forcedCount.infinite} samples=${forcedCount.samples.join("|")}`,
        evidence: "a11y-10-forced-drift-pulse.png, a11y-11-forced-drift-pulse-t1.png, a11y-motion-forced.json, video/",
      });
    }

    // prefers-reduced-motion
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Re-apply force under reduced motion — check if browser/CSS still animates
    await forceDriftPulse(page);
    await page.waitForTimeout(500);
    const reduced = await countInfinite(page);
    await page.screenshot({ path: shot("a11y-20-reduced-motion-forced"), fullPage: true });
    fs.writeFileSync(path.join(OUT, "a11y-motion-reduced-forced.json"), JSON.stringify(reduced, null, 2));

    // Check if global CSS kills animations under prefers-reduced-motion
    const reducedHonored = await page.evaluate(() => {
      const styles = Array.from(document.styleSheets);
      let hasReduceRule = false;
      try {
        for (const sheet of styles) {
          const rules = sheet.cssRules;
          for (let i = 0; i < rules.length; i++) {
            const r = rules[i];
            if (r instanceof CSSMediaRule && /prefers-reduced-motion/i.test(r.conditionText)) {
              hasReduceRule = true;
            }
          }
        }
      } catch {
        /* cross-origin sheets */
      }
      return { hasReduceRule, infinite: (() => {
        let n = 0;
        document.querySelectorAll("*").forEach((el) => {
          if (getComputedStyle(el).animationIterationCount === "infinite") n++;
        });
        return n;
      })() };
    });

    if (reduced.infinite > 0 && !reducedHonored.hasReduceRule) {
      findings.push({
        id: "BK-A11Y-005",
        target: "blanko",
        layer: "ui",
        severity: "P0",
        area: "A11y",
        title: "Forced infinite animations still run under prefers-reduced-motion: reduce",
        expected: "0 infinite when reduced-motion preferred",
        actual: `infinite=${reduced.infinite}; hasReduceRule=${reducedHonored.hasReduceRule}`,
        evidence: "a11y-20-reduced-motion-forced.png, a11y-motion-reduced-forced.json",
      });
    } else if (reduced.infinite > 0) {
      findings.push({
        id: "BK-A11Y-005",
        target: "blanko",
        layer: "ui",
        severity: "P1",
        area: "A11y",
        title: "Infinite animations still countable under reduced-motion (forced classes may bypass global rule)",
        expected: "0 infinite",
        actual: `infinite=${reduced.infinite}`,
        evidence: "a11y-20-reduced-motion-forced.png, a11y-motion-reduced-forced.json",
      });
    } else {
      findings.push({
        id: "BK-A11Y-REDUCE-PASS",
        target: "blanko",
        layer: "ui",
        severity: "P3",
        area: "A11y",
        title: "Under reduced-motion, forced infinite count is 0",
        expected: "0",
        actual: "0",
        evidence: "a11y-20-reduced-motion-forced.png",
      });
    }

    fs.writeFileSync(path.join(OUT, "findings-a11y-motion.json"), JSON.stringify(findings, null, 2));
  });
});
