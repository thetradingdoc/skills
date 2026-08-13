/**
 * Live backend API smoke (optional). Skips cleanly when API is down.
 * Complements scripts/test-backend-api-gates.ts (always-run unit/HTTP harness).
 */
import { test, expect } from "@playwright/test";

const api = process.env.E2E_API_URL ?? "http://localhost:4000";

async function apiUp(): Promise<boolean> {
  try {
    const r = await fetch(`${api}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

test.describe("backend API live smoke", () => {
  test("[API] /health ok when server running", async ({ request }) => {
    test.skip(!(await apiUp()), `API not reachable at ${api}`);
    const r = await request.get(`${api}/health`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
  });

  test("[API] /billing/me requires auth", async ({ request }) => {
    test.skip(!(await apiUp()), `API not reachable at ${api}`);
    const r = await request.get(`${api}/api/billing/me`);
    expect([401, 403]).toContain(r.status());
  });

  test("[API] /design-materialize requires auth", async ({ request }) => {
    test.skip(!(await apiUp()), `API not reachable at ${api}`);
    const r = await request.post(`${api}/api/design-materialize`, {
      data: { targetRoot: "/tmp/x", nodes: [{ id: "a", label: "A" }] },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("[API] /chat-async requires auth", async ({ request }) => {
    test.skip(!(await apiUp()), `API not reachable at ${api}`);
    const r = await request.post(`${api}/api/chat-async`, {
      data: {
        question: "hi",
        mode: "greenfield",
        graph: { nodes: [], edges: [], generatedAt: Date.now(), projectRoot: "" },
      },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("[API] workspace save requires auth", async ({ request }) => {
    test.skip(!(await apiUp()), `API not reachable at ${api}`);
    const r = await request.post(`${api}/api/workspaces/00000000-0000-0000-0000-000000000000/save`, {
      data: { graph: { nodes: [], edges: [], generatedAt: 1, projectRoot: "" } },
    });
    expect([401, 403, 404]).toContain(r.status());
  });

  test("[API] billing webhook rejects missing signature when configured", async ({ request }) => {
    test.skip(!(await apiUp()), `API not reachable at ${api}`);
    const r = await request.post(`${api}/api/billing/webhook`, {
      data: {},
      headers: { "content-type": "application/json" },
    });
    // 400 missing/invalid sig, or 503 if Stripe env unset
    expect([400, 503]).toContain(r.status());
  });
});
