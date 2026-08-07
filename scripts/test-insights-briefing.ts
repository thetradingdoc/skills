/**
 * Insights briefing + inventory for trading boards (no browser).
 */
import assert from "node:assert/strict";
import { applyTradingSpine, spineWorkflowConnected } from "../webapp/client/src/tradingSpine.ts";
import { buildPlatformInventory } from "../webapp/client/src/platformInventory.ts";
import {
  architectureBrief,
  briefNode,
  workflowHops,
} from "../webapp/client/src/insightsBriefing.ts";
import type { ArchGraph } from "../webapp/client/src/types.ts";

const scanLike: ArchGraph = {
  nodes: [
    {
      id: "trading-chat",
      label: "Trading Chat",
      path: "trading-chat",
      layer: "Presentation",
      files: ["trading-chat/index.js", "middleware-platform/services/execute-turn.js"],
    },
    {
      id: "middleware-platform",
      label: "Middleware Platform",
      path: "middleware-platform",
      layer: "Data Access",
      files: [
        "middleware-platform/services/broker/paper-broker.js",
        "middleware-platform/services/policy/policy-engine.js",
      ],
    },
  ],
  edges: [],
  generatedAt: 1,
  projectRoot: "/tmp/clone",
  projectName: "trading-agent",
};

const applied = applyTradingSpine({ from: scanLike, inferBuilt: true });
assert.ok(applied);
assert.equal(spineWorkflowConnected(applied), true);
assert.ok(/Money path/i.test(architectureBrief(applied)));

const hops = workflowHops(applied);
assert.ok(hops.some((h) => /Telegram/i.test(h.label) && h.degree > 0));
assert.ok(hops.some((h) => /Policy/i.test(h.label)));

const inv = buildPlatformInventory(applied, [], { includeCriticalGaps: false });
const ids = inv.map((r) => r.provider.id);
assert.ok(ids.includes("alpaca"), `expected alpaca in ${ids.join(",")}`);
assert.ok(ids.includes("kraken"), `expected kraken in ${ids.join(",")}`);
assert.ok(!ids.includes("stripe"), "must not invent Stripe");
assert.ok(!ids.includes("openai"), "must not invent OpenAI without evidence");

const alpaca = applied!.nodes.find((n) => n.id === "bp-ta-alpaca")!;
const brief = briefNode(applied, alpaca);
assert.ok(/broker/i.test(brief.role));
assert.ok(brief.providers.some((p) => p.id === "alpaca"));
assert.ok(brief.neighbours.length > 0, "Alpaca must be edged into Execution");

const telegram = applied!.nodes.find((n) => n.id === "bp-ta-telegram")!;
assert.ok(/Trading Chat/i.test(telegram.label));
assert.ok((telegram.files ?? []).length > 0, "Trading Chat files bind onto ingress");

const spam = buildPlatformInventory(applied, [], { includeCriticalGaps: true });
assert.ok(spam.some((r) => r.provider.id === "openai"), "critical gaps still available when opted in");
assert.ok(spam.some((r) => r.provider.id === "anthropic"));

console.log("ok: insights briefing + brokers + connected workflow");
