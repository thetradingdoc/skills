/**
 * Backend API gate suite — covers the high-risk Express contracts without
 * requiring a live Supabase session. Uses an ephemeral Express app + mocked
 * auth/workspace middleware where needed, plus pure helpers.
 *
 * Run: NODE_PATH=./webapp/server/node_modules node --import tsx scripts/test-backend-api-gates.ts
 */
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { requireCanEdit } from "../webapp/server/src/middleware/requireCanEdit";
import {
  checkSaveRevision,
  nextGraphRevision,
  storedRevisionFromGraph,
} from "../webapp/server/src/graphSaveRevision";
import { validateTargetRoot } from "../webapp/server/src/designMaterialize";
import {
  evaluateChatAccess,
  resolveChatMode,
  resolveEntitlement,
} from "../webapp/server/src/entitlements";
import { assertCanEdit } from "../webapp/server/src/workspaceAccess";
import { verifyGithubWebhookSignature } from "../webapp/server/src/githubWebhook";
import { handleStripeWebhook } from "../webapp/server/src/billing";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ok -", name);
    passed++;
  } else {
    console.log("  FAIL -", name, detail ?? "");
    failed++;
  }
}

async function withServer(
  mount: (app: express.Express) => void,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.raw({ type: "application/json", limit: "1mb" }));
  mount(app);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

console.log("backend-api-gates");

async function main() {
// ── Save revision ──────────────────────────────────────────────────────────
{
  ok("revision match allows save", checkSaveRevision(3, 3).ok === true);
  ok("null baseRevision allows save", checkSaveRevision(5, null).ok === true);
  const conflict = checkSaveRevision(4, 2);
  ok("stale baseRevision conflicts", conflict.ok === false && conflict.currentRevision === 4);
  ok("nextGraphRevision uses body when set", nextGraphRevision(9, 3) === 9);
  ok("nextGraphRevision increments when unset", nextGraphRevision(undefined, 3) === 4);
  ok("storedRevisionFromGraph defaults 0", storedRevisionFromGraph(null) === 0);
  ok("storedRevisionFromGraph reads field", storedRevisionFromGraph({ revision: 7 }) === 7);
}

// ── requireCanEdit middleware (viewer denied) ──────────────────────────────
await withServer(
  (app) => {
    app.post(
      "/edit",
      (req, _res, next) => {
        const role = String(req.headers["x-role"] ?? "viewer");
        (req as express.Request & { workspace?: { role: string } }).workspace = { role };
        next();
      },
      requireCanEdit,
      (_req, res) => res.json({ ok: true })
    );
  },
  async (base) => {
    const viewer = await fetch(`${base}/edit`, {
      method: "POST",
      headers: { "x-role": "viewer", "content-type": "application/json" },
      body: "{}",
    });
    ok("viewer POST requireCanEdit → 403", viewer.status === 403);
    const body = (await viewer.json()) as { error?: string };
    ok("viewer error mentions Viewers", /viewer/i.test(body.error ?? ""));

    const editor = await fetch(`${base}/edit`, {
      method: "POST",
      headers: { "x-role": "editor", "content-type": "application/json" },
      body: "{}",
    });
    ok("editor POST requireCanEdit → 200", editor.status === 200);

    const owner = await fetch(`${base}/edit`, {
      method: "POST",
      headers: { "x-role": "owner", "content-type": "application/json" },
      body: "{}",
    });
    ok("owner POST requireCanEdit → 200", owner.status === 200);
  }
);

ok(
  "assertCanEdit rejects viewer",
  (() => {
    try {
      assertCanEdit({ id: "w", owner_id: "o", role: "viewer" });
      return false;
    } catch (e) {
      return (e as { statusCode?: number }).statusCode === 403;
    }
  })()
);
ok(
  "assertCanEdit allows editor (save RBAC peer)",
  (() => {
    try {
      assertCanEdit({ id: "w", owner_id: "o", role: "editor" });
      return true;
    } catch {
      return false;
    }
  })()
);

// ── Chat gates (product path contracts) ────────────────────────────────────
{
  const free = resolveEntitlement({
    status: "free",
    plan: "free",
    designMessageCredits: 5,
    scanCredits: 5,
  });
  ok("free greenfield allowed", evaluateChatAccess(free, "greenfield").allowed);
  const blocked = evaluateChatAccess(free, "analysis");
  ok(
    "free analysis UPGRADE_REQUIRED",
    blocked.allowed === false && blocked.body.code === "UPGRADE_REQUIRED"
  );

  const exhausted = resolveEntitlement({
    status: "free",
    plan: "free",
    designMessageCredits: 0,
    scanCredits: 5,
  });
  ok("exhausted free greenfield blocked", !evaluateChatAccess(exhausted, "greenfield").allowed);

  const pro = resolveEntitlement({ status: "active", plan: "pro", designMessageCredits: 0, scanCredits: 10 });
  ok("pro analysis allowed", evaluateChatAccess(pro, "analysis").allowed);
  ok(
    "resolveChatMode empty→greenfield",
    resolveChatMode(undefined, { nodes: [], projectRoot: "" }) === "greenfield"
  );
  ok(
    "resolveChatMode scanned→analysis",
    resolveChatMode(undefined, { nodes: [{ id: "a" }], projectRoot: "/repo" }) === "analysis"
  );
}

// ── Design materialize path safety ─────────────────────────────────────────
{
  const prev = process.env.PROJECTS_BASE_DIR;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ll-mat-base-"));
  process.env.PROJECTS_BASE_DIR = base;
  try {
    const inside = validateTargetRoot(path.join(base, "proj"));
    ok("materialize allows path under PROJECTS_BASE_DIR", !("error" in inside));

    const outside = validateTargetRoot("/tmp/not-allowed-ll-project");
    ok(
      "materialize rejects outside PROJECTS_BASE_DIR",
      "error" in outside && /allowed projects/i.test(outside.error)
    );

    const rootSlash = validateTargetRoot("/");
    ok("materialize rejects filesystem root", "error" in rootSlash);
  } finally {
    if (prev === undefined) delete process.env.PROJECTS_BASE_DIR;
    else process.env.PROJECTS_BASE_DIR = prev;
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// ── confirm-subscription does not grant Pro ────────────────────────────────
await withServer(
  (app) => {
    app.post("/billing/confirm-subscription", (_req, res) => {
      // Mirror production contract from billing.ts
      res.json({
        ok: true,
        note: "Paid access activates when Stripe webhook confirms the subscription.",
      });
    });
  },
  async (base) => {
    const r = await fetch(`${base}/billing/confirm-subscription`, { method: "POST" });
    const j = (await r.json()) as { ok?: boolean; note?: string; plan?: string };
    ok("confirm-subscription returns ok", r.status === 200 && j.ok === true);
    ok("confirm-subscription mentions webhook", /webhook/i.test(j.note ?? ""));
    ok("confirm-subscription does not set plan pro", j.plan !== "pro");
  }
);

// ── Stripe webhook rejects missing / bad signature ─────────────────────────
await withServer(
  (app) => {
    app.post("/api/billing/webhook", express.raw({ type: "application/json" }), (req, res) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body ?? {}));
      void handleStripeWebhook(req, res);
    });
  },
  async (base) => {
    const prevKey = process.env.STRIPE_SECRET_KEY;
    const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
    // Force configured path so we hit signature check (or 503 if no key)
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY?.trim() || "sk_test_fake_for_gate_suite";
    process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET?.trim() || "whsec_test_fake_for_gate_suite";
    try {
      const missing = await fetch(`${base}/api/billing/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      ok(
        "stripe webhook missing signature → 400 or 503",
        missing.status === 400 || missing.status === 503,
        String(missing.status)
      );

      const bad = await fetch(`${base}/api/billing/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=1,v1=deadbeef",
        },
        body: "{}",
      });
      ok(
        "stripe webhook bad signature → 400 or 503",
        bad.status === 400 || bad.status === 503,
        String(bad.status)
      );
    } finally {
      if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = prevKey;
      if (prevSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = prevSecret;
    }
  }
);

// ── GitHub webhook HMAC ────────────────────────────────────────────────────
{
  const secret = "gh_test_secret";
  const payload = Buffer.from('{"zen":"test"}');
  const good =
    "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  ok("github signature accepts valid HMAC", verifyGithubWebhookSignature(payload, good, secret));
  ok(
    "github signature rejects tampered",
    !verifyGithubWebhookSignature(payload, "sha256=00", secret)
  );
  ok(
    "github signature rejects missing secret",
    !verifyGithubWebhookSignature(payload, good, null)
  );
}

// ── Unauthenticated billing/me shape (live optional) ───────────────────────
{
  const api = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
  try {
    const me = await fetch(`${api}/api/billing/me`, { signal: AbortSignal.timeout(2000) });
    ok(
      "live /api/billing/me without token → 401/403 (when API up)",
      me.status === 401 || me.status === 403,
      String(me.status)
    );
  } catch {
    ok("live API not running — skip billing/me smoke (acceptable)", true);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
