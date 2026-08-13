/**
 * Insights briefing + inventory for trading boards (no browser).
 */
import assert from "node:assert/strict";
import { applyTradingSpine, spineWorkflowConnected } from "../webapp/client/src/tradingSpine.ts";
import { buildPlatformInventory } from "../webapp/client/src/platformInventory.ts";
import {
  architectureBrief,
  briefNode,
  nodeActionBadgeMeta,
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
assert.ok(ids.includes("telegram"), `expected telegram in ${ids.join(",")}`);
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
assert.ok(
  (telegram.platformBindings ?? []).some((b) => b.providerId === "telegram"),
  "Telegram auto-bound on ingress"
);

const scanBrief = briefNode(scanLike, scanLike.nodes[0]!);
assert.ok(/ingress/i.test(scanBrief.role), "scan Trading Chat gets ingress copy, not generic piece");
assert.ok(scanBrief.configHints.some((h) => /spine|ingress/i.test(h)));
assert.ok(scanBrief.headline.length > 0);
assert.ok(scanBrief.nextActions.length > 0);

const shell = scanLike.nodes.find((n) => n.id === "middleware-platform")!;
const shellBrief = briefNode(scanLike, {
  ...shell,
  files: [
    "middleware-platform/server.js",
    "middleware-platform/database.js",
    "middleware-platform/jest.config.js",
  ],
});
assert.ok(/shell|server|database/i.test(shellBrief.role), "middleware gets shell copy");
assert.ok(/server \+ database/i.test(shellBrief.headline));
assert.ok(shellBrief.fileRoles.some((f) => f.role === "Server boot"));
assert.ok(shellBrief.fileRoles.some((f) => f.role === "Database"));
assert.ok(shellBrief.fileRoles.some((f) => f.role === "Test config"));
assert.ok(shellBrief.nextActions.some((a) => a.id === "audit-server"));
assert.ok(shellBrief.nextActions.some((a) => a.id === "audit-db"));
assert.ok(!shellBrief.configHints.some((h) => /Agents/i.test(h)), "shell should not push Agents");

const shellGraph: ArchGraph = {
  ...scanLike,
  nodes: [
    {
      ...shell,
      files: [
        "middleware-platform/server.js",
        "middleware-platform/database.js",
        "middleware-platform/jest.config.js",
      ],
    },
  ],
};
const badgeMeta = nodeActionBadgeMeta(shellGraph, []);
const shellBadge = badgeMeta["middleware-platform"];
assert.ok(shellBadge, "middleware shell must have badge meta");
assert.ok(
  shellBadge.count >= 2,
  `middleware shell badge count expected >= 2 (audit-server + audit-db), got ${shellBadge.count}`
);
assert.equal(shellBadge.severity, "risk", "audit tasks map high → risk");

const cleared = nodeActionBadgeMeta(shellGraph, [], {
  todoStatusBySourcePath: {
    "insights:middleware-platform:audit-server": "done",
    "insights:middleware-platform:audit-db": "done",
  },
});
assert.ok(!cleared["middleware-platform"], "done sourcePaths must clear badge");

// Soft-only node (no shell files) → badge_count === 0
const softOnly: ArchGraph = {
  nodes: [
    {
      id: "greeting",
      label: "Greeting Utility",
      path: "util",
      layer: "Utilities",
      files: ["middleware-platform/services/greeting.js"],
    },
  ],
  edges: [],
  generatedAt: 1,
  architectureBoard: true,
};
const softMeta = nodeActionBadgeMeta(softOnly, []);
assert.ok(
  !softMeta["greeting"] || softMeta["greeting"].badge_count === 0,
  "soft-only node must have badge_count 0"
);

const spam = buildPlatformInventory(applied, [], { includeCriticalGaps: true });
assert.ok(spam.some((r) => r.provider.id === "openai"), "critical gaps still available when opted in");
assert.ok(spam.some((r) => r.provider.id === "anthropic"));

console.log("ok: insights briefing + brokers + connected workflow");
