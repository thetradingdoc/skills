/**
 * P5 unit checks — pricing + rollup by node/@nick.
 * Run: npx tsx scripts/test-usage-attribution.ts
 */
import { estimateCostCents, pricingForModel, providerFromModel } from "../webapp/server/src/pricing";
import { rollupByNode, rollupByNick, periodStart, formatCents } from "../webapp/server/src/usage";

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

console.log("usage-attribution checks");

ok("claude-sonnet pricing found", pricingForModel("claude-sonnet-4-6").promptPer1kCents === 0.3);
ok("providerFromModel claude → anthropic", providerFromModel("claude-sonnet-4-6") === "anthropic");
ok("providerFromModel gpt → openai", providerFromModel("gpt-4o-mini") === "openai");
ok("estimateCostCents rounds up tiny burns", estimateCostCents(10, 10, "gpt-4o-mini") >= 1);
ok("estimateCostCents zero tokens → 0", estimateCostCents(0, 0) === 0);
ok("formatCents", formatCents(1234) === "$12.34");

const events = [
  { node_id: "auth", prompt_tokens: 1000, completion_tokens: 500, cost_cents: 40 },
  { node_id: "auth", prompt_tokens: 200, completion_tokens: 100, cost_cents: 10 },
  { node_id: "rag", prompt_tokens: 3000, completion_tokens: 1000, cost_cents: 90 },
  { node_id: null, prompt_tokens: 50, completion_tokens: 10, cost_cents: 1 },
];
const claims = [
  { target_id: "auth", claimer_id: "u1", nickname: "alice" },
  { target_id: "rag", claimer_id: "u2", nickname: "bob" },
];
const byNode = rollupByNode(events, claims);
ok("rollupByNode skips null node", byNode.length === 2);
ok("auth aggregates cost", byNode.find((n) => n.nodeId === "auth")?.costCents === 50);
ok("auth has @alice", byNode.find((n) => n.nodeId === "auth")?.claimerNickname === "alice");
ok("rag is top spender", byNode[0]?.nodeId === "rag");

const byNick = rollupByNick(byNode);
ok("rollupByNick has alice+bob", byNick.length === 2);
ok("bob has rag spend", byNick.find((n) => n.nickname === "bob")?.costCents === 90);
ok("alice nodeIds includes auth", byNick.find((n) => n.nickname === "alice")?.nodeIds.includes("auth") === true);

const unclaimed = rollupByNick([
  { nodeId: "x", promptTokens: 1, completionTokens: 1, costCents: 5, eventCount: 1, claimerId: null, claimerNickname: null },
]);
ok("unclaimed nick rollup key", unclaimed[0]?.userId === null && unclaimed[0]?.costCents === 5);

const week = periodStart("weekly", new Date("2026-08-05T12:00:00Z"));
ok("weekly period starts Monday UTC", week.getUTCDay() === 1 && week.getUTCDate() === 3, week.toISOString());
const month = periodStart("monthly", new Date("2026-08-05T12:00:00Z"));
ok("monthly period is Aug 1", month.getUTCDate() === 1 && month.getUTCMonth() === 7);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
