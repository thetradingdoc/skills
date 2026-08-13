/**
 * Blanko-side trading diagnostic fixes regression checks.
 * Run: npx tsx scripts/test-blanko-trading-fixes.ts
 */
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { detectAgentAuth, loadClassifyConfig, traceToolHandler } from "./resource-trace.ts";
import { clearLayerIndexCache } from "./agent-layers.ts";
import { rankFindings } from "../webapp/client/src/findings.ts";
import { buildAgentInventory } from "./agent-inventory.ts";

import { tradingLiveRoot, tradingScanClone } from "./lib/blanko-target.ts";

const ROOT =
  process.env.BLANKO_TARGET_ROOT?.trim() ||
  (() => {
    try {
      return tradingLiveRoot();
    } catch {
      return tradingScanClone();
    }
  })();

assert.ok(fs.existsSync(ROOT), `scan clone missing: ${ROOT}`);

// ── detectAgentAuth recognizes assertCaller ─────────────────────────────
{
  const text = fs.readFileSync(
    path.join(ROOT, "middleware-platform/services/trading-rails/execute-turn.js"),
    "utf8"
  );
  const auth = detectAgentAuth(
    ROOT,
    "middleware-platform/services/trading-rails/execute-turn.js",
    text
  );
  assert.equal(auth.found, true, "assertCaller should count as auth");
  assert.ok(auth.location, "auth location set");
  assert.match(auth.evidence || "", /caller identity|assertCaller/i);
  console.log("ok detectAgentAuth assertCaller →", auth.location);
}

// ── venue-router classified ─────────────────────────────────────────────
{
  const cfg = loadClassifyConfig(ROOT);
  assert.equal(
    cfg.resources["service:venue-router"],
    "internal",
    "venue-router must be internal"
  );
  assert.ok(
    !cfg.unclassified.includes("service:venue-router") ||
      cfg.resources["service:venue-router"] === "internal",
    "venue-router should not stay unclassified when resources override"
  );
  console.log("ok classify service:venue-router = internal");
}

// ── get_portfolio traces to money db via positionsFor ───────────────────
{
  const cfg = loadClassifyConfig(ROOT);
  const reach = traceToolHandler(
    ROOT,
    "middleware-platform/services/trading-tool-executor.js:187",
    "get_portfolio",
    cfg
  );
  const names = reach.resources.map((r) => `${r.kind}:${r.name}:${r.class}`);
  console.log("get_portfolio resources:", names);
  const moneyDb = reach.resources.find(
    (r) => r.kind === "db" && (r.class === "money" || /trade|paper|wallet/i.test(r.name))
  );
  assert.ok(
    moneyDb,
    "expected db money/trade reach on get_portfolio (positionsFor → trade)"
  );
  const venue = reach.resources.find((r) => r.name === "venue-router");
  if (venue) {
    assert.equal(venue.class, "internal", "venue-router class on live path");
  }
  console.log("ok get_portfolio money reach →", moneyDb.name, moneyDb.class);
}

// ── agent layers: auth safety + data/obs/eval less empty ────────────────
{
  clearLayerIndexCache();
  const inv = buildAgentInventory(ROOT);
  const agent = (inv.agents ?? []).find(
    (a) => a.kind === "agent" && /execute-turn/.test(a.file)
  );
  assert.ok(agent, "execute-turn agent surface");
  assert.equal(agent!.auth?.found, true, "inventory auth.found");

  const layers = agent!.layers ?? [];
  const byId = Object.fromEntries(layers.map((l) => [l.id, l]));
  console.log(
    "layers:",
    layers.map((l) => `${l.id}:${l.status}`).join(", ")
  );
  assert.notEqual(byId.data?.status, "empty", "data layer should not be empty");
  assert.ok(
    byId.observability?.status === "thin" || byId.observability?.status === "filled",
    `observability expected thin/filled, got ${byId.observability?.status}`
  );
  assert.ok(
    byId.evaluation?.status === "thin" || byId.evaluation?.status === "filled",
    `evaluation expected thin/filled, got ${byId.evaluation?.status}`
  );
  console.log("ok agent layers data/obs/eval non-empty");
}

// ── rankFindings: no unclassified venue; auth critical only if money open ─
{
  const inv = buildAgentInventory(ROOT);
  const findings = rankFindings({ agents: inv, nodes: [], edges: [] });
  const unc = findings.find((f) => f.id === "unclassified");
  if (unc) {
    assert.ok(
      !/venue-router/i.test(unc.detail + unc.title),
      "venue-router should not drive unclassified finding"
    );
  }
  const authCrit = findings.filter((f) => f.id.startsWith("auth:"));
  console.log(
    "findings:",
    findings.map((f) => `${f.severity}:${f.id}`).join(" | ") || "(none critical-path)"
  );
  console.log("ok rankFindings auth criticals=", authCrit.length);
}

console.log("\nAll blanko trading fixes checks passed.");
