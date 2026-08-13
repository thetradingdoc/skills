/**
 * B1-6 + B2 gate: n8n identity, mapper fidelity, pinData strip, sticky groups, branch labels.
 * Run: npx tsx scripts/test-n8n-mapper.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildExternalId,
  configDelta,
  detectVariantKey,
  hasPinData,
  mapWorkflow,
  mapWorkflowVariants,
  parseExternalId,
  sanitizeWorkflowRaw,
  toArchGraph,
} from "../webapp/server/src/n8n/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "../fixtures/n8n");

function load(name: string): unknown {
  return JSON.parse(readFileSync(join(FIX, name), "utf8"));
}

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    throw err;
  }
}

const aest = load("calendar-AEST.json") as {
  id: string;
  nodes: unknown[];
  pinData?: unknown;
  versionId: string;
};
const est = load("calendar-EST.json") as {
  id: string;
  nodes: unknown[];
  versionId: string;
};

console.log("\nn8n mapper / identity gates\n");

check("fixtures share the same n8n workflow id (the collision bug)", () => {
  assert.equal(aest.id, est.id);
  assert.equal(aest.id, "lNyRohsNFjJGS02f");
});

check("externalId includes variantKey — 3-part scheme would collide", () => {
  const nodeId = "006e6a96-22b5-4c12-bdd6-47891f68d73e";
  const a = buildExternalId(aest.id, "AEST", nodeId);
  const b = buildExternalId(est.id, "EST", nodeId);
  assert.notEqual(a, b);
  assert.equal(a, `n8n:${aest.id}:AEST:${nodeId}`);
  const parsed = parseExternalId(a);
  assert.equal(parsed?.variantKey, "AEST");
  assert.equal(parsed?.n8nNodeId, nodeId);
});

check("detectVariantKey distinguishes AEST vs EST", () => {
  assert.equal(detectVariantKey(aest), "AEST");
  assert.equal(detectVariantKey(est), "EST");
});

check("mapWorkflowVariants: only default/materialize variant emits nodes", () => {
  const results = mapWorkflowVariants(
    [
      { raw: aest, variantKey: "AEST" },
      { raw: est, variantKey: "EST" },
    ],
    "AEST"
  );
  assert.equal(results.length, 2);
  const mat = results.find((r) => r.variantKey === "AEST")!;
  const other = results.find((r) => r.variantKey === "EST")!;
  assert.equal(mat.materialize, true);
  assert.equal(other.materialize, false);
  assert.ok(mat.nodes.length > 0);
  assert.equal(other.nodes.length, 0);
  // No externalId collision across variants
  const ids = new Set(mat.nodes.map((n) => n.externalId));
  assert.equal(ids.size, mat.nodes.length);
  for (const n of mat.nodes) {
    assert.ok(n.externalId?.includes(":AEST:"));
    assert.equal(n.variantKey, "AEST");
    assert.equal(n.importSource, "n8n");
  }
});

check("B2 GATE: 36 functional nodes, 9 stickies as groups", () => {
  const m = mapWorkflow(aest, { variantKey: "AEST", materializeVariantKey: "AEST" });
  assert.equal(m.nodes.length, 36, `expected 36 nodes, got ${m.nodes.length}`);
  assert.equal(m.groups.length, 9, `expected 9 groups, got ${m.groups.length}`);
  assert.ok(m.groups.every((g) => g.source === "n8n-sticky" && g.width > 0 && g.height > 0));
  assert.ok(m.groups.some((g) => /Availability Handler/i.test(g.label)));
  assert.ok(m.groups.some((g) => /Creating a Booking/i.test(g.label)));
});

check("presentation fidelity: labels are verbatim n8n names", () => {
  const m = mapWorkflow(aest, { variantKey: "AEST", materializeVariantKey: "AEST" });
  assert.ok(m.nodes.some((n) => n.label === "Tool-Calendar-Webhook"));
  assert.ok(m.nodes.some((n) => n.label === "If Time Busy"));
  assert.ok(m.nodes.every((n) => n.properties?.n8nType));
});

check("integrations include calcom/twilio/airtable/slack", () => {
  const m = mapWorkflow(aest, { variantKey: "AEST", materializeVariantKey: "AEST" });
  const ids = new Set(m.integrations.map((i) => i.providerId));
  for (const need of ["calcom", "twilio", "airtable", "slack"]) {
    assert.ok(ids.has(need), `missing integration ${need}; have ${[...ids].join(",")}`);
  }
});

check("branch labels: if nodes get true/false", () => {
  const m = mapWorkflow(aest, { variantKey: "AEST", materializeVariantKey: "AEST" });
  const ifNode = m.nodes.find((n) => n.label === "If Time Busy");
  assert.ok(ifNode);
  const outs = m.edges.filter((e) => e.source === ifNode!.id);
  assert.ok(outs.length >= 2);
  const labels = new Set(outs.map((e) => e.label));
  assert.ok(labels.has("true"), `missing true; got ${[...labels]}`);
  assert.ok(labels.has("false"), `missing false; got ${[...labels]}`);
});

check("AEST/EST isomorphic with timezone-only param deltas", () => {
  const deltas = configDelta(aest, est);
  assert.equal(deltas.length, 11, `expected 11 param deltas, got ${deltas.length}`);
  const ma = mapWorkflow(aest, { variantKey: "AEST", materializeVariantKey: "AEST" });
  const me = mapWorkflow(est, { variantKey: "EST", materializeVariantKey: "EST" });
  assert.equal(ma.nodes.length, me.nodes.length);
  assert.equal(ma.edges.length, me.edges.length);
  assert.equal(ma.groups.length, me.groups.length);
});

check("b2-9: pinData stripped from sanitized raw", () => {
  const withPin = {
    ...aest,
    pinData: {
      "Tool-Calendar-Webhook": [{ json: { customerPhone: "+15551212", secret: "sk-live-ABCDEFGHIJKLMNOPQRSTUV" } }],
    },
  };
  assert.equal(hasPinData(withPin), true);
  const m = mapWorkflow(withPin, { variantKey: "AEST", materializeVariantKey: "AEST" });
  assert.equal("pinData" in m.sanitizedRaw, false);
  const again = sanitizeWorkflowRaw(withPin);
  assert.equal("pinData" in again, false);
  const blob = JSON.stringify(again);
  assert.ok(!blob.includes("customerPhone") || !blob.includes("+15551212"));
  // high-entropy secret redacted if it survived in parameters — pinData gone entirely
  assert.ok(!blob.includes("sk-live-ABCDEFGHIJKLMNOPQRSTUV"));
});

check("toArchGraph carries groups for canvas", () => {
  const m = mapWorkflow(aest, { variantKey: "AEST", materializeVariantKey: "AEST" });
  const g = toArchGraph(m);
  assert.equal(g.groups?.length, 9);
  assert.equal(g.nodes.length, 36);
});

console.log(`\n${passed} checks passed\n`);
