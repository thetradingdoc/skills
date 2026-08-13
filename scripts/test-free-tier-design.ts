/**
 * V1 launch gate — free design allowance vs Pro analysis agent.
 * Run: node --import tsx scripts/test-free-tier-design.ts
 */
import {
  evaluateChatAccess,
  resolveChatMode,
  resolveEntitlement,
} from "../webapp/server/src/entitlements";

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

console.log("free-tier-design checks");

const freeOk = resolveEntitlement({
  status: "free",
  plan: "free",
  scanCredits: 5,
  designMessageCredits: 20,
});
ok("free can design", freeOk.canUseDesignChat === true);
ok("free cannot use analysis agent", freeOk.canUseAiAgent === false);
ok("free design remaining 20", freeOk.designMessagesRemaining === 20);

const freeExhausted = resolveEntitlement({
  status: "free",
  plan: "free",
  scanCredits: 5,
  designMessageCredits: 0,
});
ok("exhausted free cannot design", freeExhausted.canUseDesignChat === false);
ok("exhausted free still no agent", freeExhausted.canUseAiAgent === false);

const pro = resolveEntitlement({
  status: "active",
  plan: "pro",
  scanCredits: 100,
  designMessageCredits: 0,
});
ok("pro can design even at 0 design credits", pro.canUseDesignChat === true);
ok("pro can use agent", pro.canUseAiAgent === true);

const pastDue = resolveEntitlement({
  status: "past_due",
  plan: "pro",
  scanCredits: 50,
  designMessageCredits: 10,
});
ok("past_due blocks design", pastDue.canUseDesignChat === false);
ok("past_due blocks agent", pastDue.canUseAiAgent === false);
ok("past_due code", pastDue.code === "PAST_DUE");

const unlimited = resolveEntitlement({ unlimited: true });
ok("unlimited both", unlimited.canUseAiAgent && unlimited.canUseDesignChat);

ok(
  "greenfield allowed for free",
  evaluateChatAccess(freeOk, "greenfield").allowed === true
);
ok(
  "analysis blocked for free",
  evaluateChatAccess(freeOk, "analysis").allowed === false &&
    (evaluateChatAccess(freeOk, "analysis") as { body: { code: string } }).body.code ===
      "UPGRADE_REQUIRED"
);
ok(
  "greenfield blocked when exhausted",
  evaluateChatAccess(freeExhausted, "greenfield").allowed === false
);
ok(
  "analysis allowed for pro",
  evaluateChatAccess(pro, "analysis").allowed === true
);

ok(
  "resolveChatMode explicit greenfield",
  resolveChatMode("greenfield", { nodes: [{ id: "a" }], projectRoot: "/repo" }) === "greenfield"
);
ok(
  "resolveChatMode empty → greenfield",
  resolveChatMode(undefined, { nodes: [], projectRoot: "" }) === "greenfield"
);
ok(
  "resolveChatMode scanned → analysis",
  resolveChatMode(undefined, { nodes: [{ id: "a" }], projectRoot: "/repo" }) === "analysis"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
