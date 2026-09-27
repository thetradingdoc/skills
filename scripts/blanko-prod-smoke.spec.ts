import { test, expect } from "@playwright/test";

/**
 * Smoke the deployed Blanko front door (APP_URL).
 * Example: APP_URL=https://blanko.web.app npx playwright test scripts/blanko-prod-smoke.spec.ts
 */
test.describe("Blanko production smoke", () => {
  test("health is ok", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/health`);
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  test("root serves the Blanko app shell (not Hosting stub)", async ({ page, baseURL }) => {
    const responses: { url: string; status: number }[] = [];
    page.on("response", (r) => {
      if (r.url().startsWith(String(baseURL))) {
        responses.push({ url: r.url(), status: r.status() });
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60_000 });

    const title = await page.title();
    expect(title, "should not be the Firebase stub").not.toBe("Blanko");
    expect(title.toLowerCase()).toContain("blanko");

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/Loading Blanko/i);

    // Landing / app should paint something interactive or branded
    await expect(page.locator("body")).not.toBeEmpty();

    const failed = responses.filter((r) => r.status >= 400);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  });

  test("client assets load from same origin", async ({ page, baseURL }) => {
    const assetFails: string[] = [];
    page.on("response", (r) => {
      const u = r.url();
      if (!u.startsWith(String(baseURL))) return;
      if (/\.(js|css|svg|png|woff2?)(\?|$)/i.test(u) && r.status() >= 400) {
        assetFails.push(`${r.status()} ${u}`);
      }
    });

    await page.goto("/", { waitUntil: "networkidle", timeout: 90_000 });
    expect(assetFails, assetFails.join("\n")).toEqual([]);
  });
});
