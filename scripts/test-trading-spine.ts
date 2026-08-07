/**
 * Trading spine apply + scan detection (no browser).
 */
import assert from "node:assert/strict";
import { applyTradingSpine, looksLikeTradingScan, spineMissing } from "../webapp/client/src/tradingSpine.ts";
import type { ArchGraph } from "../webapp/client/src/types.ts";

const scanLike: ArchGraph = {
  nodes: [
    {
      id: "middleware-platform",
      label: "Middleware Platform",
      path: "middleware-platform",
      layer: "Data Access",
      files: ["middleware-platform/services/paper-wallet-writer.js", "middleware-platform/services/policy/policy-engine.js"],
    },
    {
      id: "trading-chat",
      label: "Trading Chat",
      path: "trading-chat",
      layer: "Presentation",
      files: [],
    },
  ],
  edges: [],
  generatedAt: 1,
  projectRoot: "/tmp/clone",
  projectName: "trading-agent",
};

assert.equal(looksLikeTradingScan(scanLike), true);
assert.equal(spineMissing(scanLike), true);

const applied = applyTradingSpine({ from: scanLike, inferBuilt: true });
assert.ok(applied);
assert.equal(applied!.architectureBoard, true);
assert.equal(applied!.projectRoot, "/tmp/clone");
const labels = applied!.nodes.map((n) => n.label);
assert.ok(labels.some((l) => /Payment/i.test(l)));
assert.ok(labels.some((l) => /Policy/i.test(l)));
assert.ok(labels.some((l) => /Risk/i.test(l)));
assert.ok(labels.some((l) => /Execution/i.test(l)));
assert.ok(labels.some((l) => /Alpaca/i.test(l)));

const payment = applied!.nodes.find((n) => n.id === "bp-ta-payment");
assert.ok(payment?.files?.some((f) => f.includes("paper-wallet-writer")));
assert.equal(payment?.buildStatus, "built");

assert.equal(spineMissing(applied!), false);
console.log("ok: trading spine apply + file bind + buildStatus");
