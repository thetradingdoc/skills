/**
 * B4 GATE: n8n rule engine — exactly 3 expected findings, stable fingerprints.
 * Run: npx tsx scripts/test-n8n-rules.ts
 */
import assert from "node:assert/strict";
import {
  evaluateN8nWorkflow,
  N8N_RULE_IDS,
  type N8nFinding,
} from "../webapp/server/src/rules/n8n/index.ts";

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

/** Fixture engineered to trip all three P0 rules. */
function badWorkflow() {
  return {
    id: "wf-rules-fixture",
    name: "Rules fixture",
    nodes: [
      {
        id: "n-trigger",
        name: "Webhook",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [0, 0],
        parameters: { path: "hook" },
      },
      {
        id: "n-batch",
        name: "Split In Batches",
        type: "n8n-nodes-base.splitInBatches",
        typeVersion: 3,
        position: [200, 0],
        parameters: { batchSize: 10 },
      },
      {
        id: "n-http",
        name: "Call API",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4,
        position: [400, 0],
        parameters: {
          method: "GET",
          url: "https://api.example.com/items",
          apiKey: "sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
        },
      },
      {
        id: "n-done",
        name: "Done",
        type: "n8n-nodes-base.noOp",
        typeVersion: 1,
        position: [200, 200],
        parameters: {},
      },
    ],
    connections: {
      Webhook: {
        main: [[{ node: "Split In Batches", type: "main", index: 0 }]],
      },
      "Split In Batches": {
        main: [
          [{ node: "Call API", type: "main", index: 0 }],
          [{ node: "Done", type: "main", index: 0 }],
        ],
      },
      "Call API": {
        main: [[{ node: "Split In Batches", type: "main", index: 0 }]],
      },
    },
  };
}

console.log("\nn8n rules gates\n");

check("RULE_IDS lists the 3 P0 rules", () => {
  assert.deepEqual([...N8N_RULE_IDS].sort(), [
    "batch_without_wait",
    "hardcoded_secret",
    "no_error_handling",
  ]);
});

check("fixture yields exactly the 3 expected findings", () => {
  const findings = evaluateN8nWorkflow(badWorkflow());
  const byRule = new Map<string, N8nFinding[]>();
  for (const f of findings) {
    const list = byRule.get(f.ruleId) ?? [];
    list.push(f);
    byRule.set(f.ruleId, list);
  }
  assert.equal(byRule.get("no_error_handling")?.length, 1);
  assert.equal(byRule.get("hardcoded_secret")?.length, 1);
  assert.equal(byRule.get("batch_without_wait")?.length, 1);
  assert.equal(findings.length, 3);
  // Never leak secret value into finding text
  const blob = JSON.stringify(findings);
  assert.ok(!blob.includes("sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"));
});

check("fingerprints stable across two runs", () => {
  const a = evaluateN8nWorkflow(badWorkflow());
  const b = evaluateN8nWorkflow(badWorkflow());
  assert.deepEqual(
    a.map((f) => f.fingerprint).sort(),
    b.map((f) => f.fingerprint).sort()
  );
});

check("hardcoded_secret records location only (node id + path)", () => {
  const secret = evaluateN8nWorkflow(badWorkflow()).find((f) => f.ruleId === "hardcoded_secret")!;
  assert.deepEqual(secret.nodeIds, ["n-http"]);
  assert.ok(secret.detail.includes("apiKey") || secret.detail.includes("parameters"));
  assert.equal(secret.severity, "blocker");
});

check("error trigger suppresses no_error_handling", () => {
  const wf = badWorkflow();
  wf.nodes.push({
    id: "n-err",
    name: "Error Trigger",
    type: "n8n-nodes-base.errorTrigger",
    typeVersion: 1,
    position: [0, 400],
    parameters: {},
  });
  const findings = evaluateN8nWorkflow(wf);
  assert.equal(findings.filter((f) => f.ruleId === "no_error_handling").length, 0);
  assert.equal(findings.length, 2);
});

check("Wait on loop path suppresses batch_without_wait", () => {
  const wf = badWorkflow();
  wf.nodes.push({
    id: "n-wait",
    name: "Wait",
    type: "n8n-nodes-base.wait",
    typeVersion: 1,
    position: [300, 0],
    parameters: { amount: 1 },
  });
  // Insert Wait between batch and http on loop output
  wf.connections["Split In Batches"] = {
    main: [
      [{ node: "Wait", type: "main", index: 0 }],
      [{ node: "Done", type: "main", index: 0 }],
    ],
  };
  wf.connections["Wait"] = {
    main: [[{ node: "Call API", type: "main", index: 0 }]],
  };
  const findings = evaluateN8nWorkflow(wf);
  assert.equal(findings.filter((f) => f.ruleId === "batch_without_wait").length, 0);
});

console.log(`\n${passed} checks passed\n`);
