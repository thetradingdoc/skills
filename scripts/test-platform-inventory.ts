/**
 * P4 unit checks — catalog resolution, inventory rollup, bind helper.
 * Run: npx tsx scripts/test-platform-inventory.ts
 */
import {
  PROVIDER_CATALOG,
  canonicalizeProviderId,
  getProvider,
  providerIconSrc,
} from "../webapp/client/src/providerCatalog";
import {
  buildPlatformInventory,
  setNodeProviderBinding,
  primaryBinding,
  collectDetectedProvidersFromAgents,
} from "../webapp/client/src/platformInventory";
import { resolveNodeProviderId } from "../webapp/client/src/nodeProviderIcon";
import type { ArchGraph, ArchNode } from "../webapp/client/src/types";

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

console.log("platform-inventory checks");

ok("catalog has openai + anthropic + langchain + stripe + aws + telegram", 
  ["openai","anthropic","langchain","stripe","aws","telegram"].every((id) => !!getProvider(id)));
ok("claude alias → anthropic", canonicalizeProviderId("claude") === "anthropic");
ok("openai icon path", providerIconSrc("openai") === "/provider-icons/openai.svg");
ok("telegram icon path", providerIconSrc("telegram") === "/provider-icons/telegram.svg");
ok("unknown falls back to generic icon", providerIconSrc("not-a-real-provider") === "/provider-icons/generic.svg");
ok("catalog size >= 20", PROVIDER_CATALOG.length >= 20);

const tgNode: ArchNode = {
  id: "tg",
  label: "telegram-bot",
  path: "telegram-bot.js",
  files: ["middleware-platform/services/telegram-bot.js"],
  health: { hasDocs: false, hasTests: false, hasContext: false },
  status: "unknown",
  isDrift: false,
};
const tgGraph: ArchGraph = { nodes: [tgNode], edges: [] } as ArchGraph;
const tgInv = buildPlatformInventory(tgGraph, []);
ok(
  "detects telegram from telegram-bot file",
  tgInv.some((r) => r.provider.id === "telegram" && r.status === "connected")
);

const chatNode: ArchNode = {
  id: "unified-dashboard/trading",
  label: "Trading Chat",
  path: "unified-dashboard/trading",
  files: ["unified-dashboard/trading/trading-chat.js"],
  health: { hasDocs: false, hasTests: false, hasContext: false },
  status: "unknown",
  isDrift: false,
};
const chatInv = buildPlatformInventory({ nodes: [chatNode], edges: [] } as ArchGraph, []);
ok(
  "detects telegram from trading-chat.js (scan ingress)",
  chatInv.some((r) => r.provider.id === "telegram" && r.status === "connected")
);
ok(
  "Trading Chat primaryBinding is telegram",
  primaryBinding(chatNode)?.providerId === "telegram"
);
ok("Trading Chat canvas icon resolves to telegram", resolveNodeProviderId(chatNode) === "telegram");

const node: ArchNode = {
  id: "n1",
  label: "Agent",
  path: "a.ts",
  files: [],
  health: { hasDocs: false, hasTests: false, hasContext: false },
  status: "unknown",
  isDrift: false,
  llmProvider: "openai",
};

const bound = setNodeProviderBinding(node, "anthropic", {
  accountLabel: "prod-claude",
  status: "connected",
});
ok("bind sets declared platformBindings", bound.platformBindings?.[0]?.providerId === "anthropic");
ok("bind sets llmProvider for LLM", bound.llmProvider === "anthropic");
ok("primaryBinding prefers declared", primaryBinding(bound)?.source === "declared");

const unbound = setNodeProviderBinding(bound, null);
ok("clearing bind removes declared", !(unbound.platformBindings ?? []).some((b) => b.source === "declared"));

const graph: ArchGraph = {
  nodes: [bound, { ...node, id: "n2", llmProvider: "openai", label: "Other" }],
  edges: [],
  agents: [{ file: "a.ts", kind: "agent", provider: "openai" } as any],
} as ArchGraph;

const detected = collectDetectedProvidersFromAgents(graph.agents as any);
ok("collectDetectedProvidersFromAgents finds openai", detected.includes("openai"));

const inv = buildPlatformInventory(graph, detected);
const anth = inv.find((r) => r.provider.id === "anthropic");
const oai = inv.find((r) => r.provider.id === "openai");
ok("inventory includes bound anthropic as connected", anth?.status === "connected" && anth.boundNodeIds.includes("n1"));
ok("inventory includes detected openai", !!oai && (oai.boundNodeIds.length > 0 || oai.sources.includes("detected")));
const withGaps = buildPlatformInventory(graph, detected, { includeCriticalGaps: true });
ok(
  "critical unbound aws appears as gap",
  withGaps.some((r) => r.provider.id === "aws" && r.status === "unbound")
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
