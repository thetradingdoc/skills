/**
 * Trading spine apply + scan detection (no browser).
 */
import assert from "node:assert/strict";
import { applyTradingSpine, looksLikeTradingScan, spineMissing } from "../webapp/client/src/tradingSpine.ts";
import type { ArchGraph } from "../webapp/client/src/types.ts";
import { buildScanProvidersPayload } from "./lib/scanProviders.ts";

const tradingRoot = `${process.env.HOME}/Voice Agent/trading-agent`;
const liveProviders = buildScanProvidersPayload(tradingRoot);

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
  projectRoot: tradingRoot,
  projectName: "trading-agent",
  providers: liveProviders,
  agents: {
    agents: [
      {
        id: "llm-router",
        file: "middleware-platform/services/llm-router.js",
        provider: "custom",
        kind: "infrastructure",
        evidence: [],
        tools: [],
      },
      {
        id: "execute-turn",
        file: "middleware-platform/services/trading-rails/execute-turn.js",
        provider: "custom",
        kind: "agent",
        evidence: [],
        tools: [{ name: "quote", handler: null, description: null, params: [] }],
      },
    ],
  },
};

assert.equal(looksLikeTradingScan(scanLike), true);
assert.equal(spineMissing(scanLike), true);

const applied = applyTradingSpine({ from: scanLike, inferBuilt: true });
assert.ok(applied);
assert.equal(applied!.architectureBoard, true);
assert.equal(applied!.projectRoot, tradingRoot);
assert.ok(applied!.providers?.llmRouting);
// Fix D1: agents survive Apply spine when present on scan graph
assert.equal(applied!.agents?.agents?.length, 2);
assert.ok(applied!.agents?.agents?.some((a) => /llm-router/.test(a.file ?? "")));
assert.ok(applied!.agents?.agents?.some((a) => /execute-turn/.test(a.file ?? "")));
const labels = applied!.nodes.map((n) => n.label);
assert.ok(labels.some((l) => /Payment/i.test(l)));
assert.ok(labels.some((l) => /Policy/i.test(l)));
assert.ok(labels.some((l) => /Risk/i.test(l)));
assert.ok(labels.some((l) => /Execution/i.test(l)));
assert.ok(labels.some((l) => /Alpaca/i.test(l)));

const payment = applied!.nodes.find((n) => n.id === "bp-ta-payment");
assert.ok(payment?.files?.some((f) => f.includes("paper-wallet-writer")));
assert.equal(payment?.buildStatus, "built");

const agent = applied!.nodes.find((n) => n.id === "bp-ta-agent");
assert.ok(agent);
const roles = (agent!.platformBindings ?? []).filter((b) => b.source === "declared");
assert.ok(roles.some((b) => b.role === "primary" && b.providerId === liveProviders.llmRouting.primary));
assert.ok(roles.some((b) => b.role === "fallback" && b.providerId === liveProviders.llmRouting.fallback));
const primary = roles.find((b) => b.role === "primary")!;
assert.ok(
  primary.status === "connected" || primary.status === "missing_credentials",
  `primary status should reflect credentials, got ${primary.status}`
);
assert.match(primary.accountLabel ?? "", /primary:/i);

assert.equal(spineMissing(applied!), false);
console.log("ok: trading spine apply + file bind + buildStatus + LLM roles");
console.log(
  JSON.stringify(
    {
      llmRouting: liveProviders.llmRouting,
      agentBindings: roles.map((b) => ({
        id: b.providerId,
        role: b.role,
        status: b.status,
        accountLabel: b.accountLabel,
      })),
    },
    null,
    2
  )
);
