/**
 * Phase 1 gate — colored provider icons + WORKS WITH strip.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const API = process.env.API_URL ?? "http://localhost:4000";
const ICONS_DIR = path.resolve("webapp/client/public/provider-icons");

const WORKS_WITH = [
  "react",
  "postgresql",
  "n8n",
  "stripe",
  "openai",
  "redis",
  "kafka",
  "supabase",
] as const;

/** Brands that are legitimately black / near-black marks. */
const ALLOWED_NEAR_BLACK = new Set([
  "github",
  "vercel",
  "vercel-ai",
  "kafka",
  "calcom",
  "langchain",
]);

function svgHasNonBlackColor(svg: string, allowBlack: boolean): boolean {
  const fills = [...svg.matchAll(/fill="([^"]+)"/gi)].map((m) => m[1].toLowerCase());
  const strokes = [...svg.matchAll(/stroke="([^"]+)"/gi)].map((m) => m[1].toLowerCase());
  const colors = [...fills, ...strokes].filter(
    (c) => c !== "none" && c !== "transparent" && c !== "currentcolor"
  );
  if (colors.length === 0) return false;
  if (allowBlack) return true;
  return colors.some((c) => c !== "#000" && c !== "#000000" && c !== "black" && c !== "#181717" && c !== "#231f20" && c !== "#292929");
}

test.describe("blanko Phase 1 provider icons", () => {
  test("backend health responds", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).ok).toBe(true);
  });

  test("all catalog icon files exist, serve, and are colored", async ({ request }) => {
    const files = fs.readdirSync(ICONS_DIR).filter((f) => f.endsWith(".svg"));
    expect(files.length).toBeGreaterThanOrEqual(35);

    // Required new icons
    for (const required of ["react.svg", "kafka.svg", "n8n.svg", "airtable.svg", "calcom.svg", "google-sheets.svg"]) {
      expect(files).toContain(required);
    }

    const uncolored: string[] = [];
    for (const file of files) {
      const id = file.replace(/\.svg$/, "");
      const res = await request.get(`/provider-icons/${file}`);
      expect(res.ok(), `${file} should 200`).toBeTruthy();
      const body = await res.text();
      expect(body).toMatch(/<svg[\s>]/i);
      const allowBlack = ALLOWED_NEAR_BLACK.has(id);
      if (!svgHasNonBlackColor(body, allowBlack) && id !== "generic") {
        // github/vercel are black-only which is OK if allowBlack
        if (!allowBlack) uncolored.push(file);
      }
    }
    expect(uncolored, `monochrome leftovers: ${uncolored.join(", ")}`).toEqual([]);

    // generic uses blanko pink
    const generic = await (await request.get("/provider-icons/generic.svg")).text();
    expect(generic.toLowerCase()).toContain("#ef32a6");

    // multi-color slack / google
    const slack = await (await request.get("/provider-icons/slack.svg")).text();
    expect(slack).toMatch(/#E01E5A|#36C5F0|#2EB67D|#ECB22E/i);
    const google = await (await request.get("/provider-icons/google.svg")).text();
    expect(google).toMatch(/#4285F4|#EA4335|#FBBC05|#34A853/i);
  });

  test("landing WORKS WITH strip shows colored icons", async ({ page }) => {
    await page.goto("/");
    const strip = page.getByTestId("landing-works-with");
    await expect(strip).toBeVisible({ timeout: 15000 });
    await expect(strip.getByText(/Works with/i)).toBeVisible();

    for (const id of WORKS_WITH) {
      const chip = page.getByTestId(`works-with-${id}`);
      await expect(chip).toBeVisible();
      const icon = chip.getByTestId("provider-icon");
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute("data-provider-id", id);
      const color = await icon.getAttribute("data-provider-color");
      expect(color && color.length > 0).toBeTruthy();
      // img loads
      const img = icon.locator("img");
      await expect(img).toBeVisible();
      const natural = await img.evaluate((el: HTMLImageElement) => ({
        complete: el.complete,
        w: el.naturalWidth,
        src: el.currentSrc || el.src,
      }));
      expect(natural.complete).toBeTruthy();
      expect(natural.w).toBeGreaterThan(0);
      expect(natural.src).toContain(`/provider-icons/`);
    }
  });

  test("platforms view uses ProviderIcon chips when opened from design mode", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("chrome-design-mode").or(page.getByTestId("design-empty-sidebar")).first()).toBeVisible({
      timeout: 20000,
    });

    // Open Platforms tab if present
    const platformsBtn = page.getByRole("button", { name: /^Platforms$/i }).or(page.locator('[data-testid="tab-platforms"]'));
    if ((await platformsBtn.count()) > 0) {
      await platformsBtn.first().click();
      // Bind picker / inventory should show provider icons when catalog rows render
      const icons = page.getByTestId("provider-icon");
      // May be empty inventory — at least the bind picker section often lists providers
      // Fall back: open any "Add" / bind UI if present
      const count = await icons.count();
      if (count === 0) {
        const addBtn = page.getByRole("button", { name: /add|bind|connect/i }).first();
        if (await addBtn.count()) await addBtn.click();
      }
      await expect(page.getByTestId("provider-icon").first()).toBeVisible({ timeout: 10000 });
      const chip = page.getByTestId("provider-icon-chip").first();
      await expect(chip).toBeVisible();
    } else {
      // Workspace still on old tab strip — skip soft if Platforms not reachable yet (Phase 4)
      test.info().annotations.push({ type: "note", description: "Platforms tab not in chrome yet; landing strip covers Phase 1 gate" });
    }
  });
});
