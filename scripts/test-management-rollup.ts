/**
 * P7 unit checks — management rollup aggregation.
 * Run: npx tsx scripts/test-management-rollup.ts
 */
import {
  buildManagementRollup,
  findingNodeId,
  formatRollupCents,
} from "../webapp/server/src/managementRollup";

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

console.log("management-rollup checks");

const nodes = [
  { id: "auth-svc", label: "Auth", domain: "auth", layer: "Safety", files: ["src/auth.ts"] },
  { id: "rag", label: "RAG", domain: "rag", layer: "Reasoning", files: ["src/rag.ts"] },
  { id: "api", label: "API", layer: "Presentation", files: ["src/api.ts"] },
];

const now = new Date("2026-08-05T12:00:00Z");

const rollup = buildManagementRollup({
  nodes,
  claims: [
    { kind: "node", target_id: "auth-svc", claimer_id: "u1", nickname: "alice" },
  ],
  findings: [
    {
      id: "f1",
      title: "Missing MFA",
      severity: "critical",
      state: "open",
      agent_file: "src/auth.ts",
      first_seen_at: "2026-07-01T00:00:00Z",
    },
    {
      id: "f2",
      title: "Slow RAG",
      severity: "high",
      state: "open",
      node_id: "rag",
      first_seen_at: "2026-08-04T00:00:00Z",
    },
    {
      id: "f3",
      title: "Resolved noise",
      severity: "critical",
      state: "resolved",
      node_id: "auth-svc",
      first_seen_at: "2026-06-01T00:00:00Z",
    },
  ],
  events: [
    {
      created_at: "2026-08-05T10:00:00Z",
      event_type: "push",
      author_login: "bob",
      matched_node_ids: ["auth-svc"],
      github_url: "https://github.com/x/y/commit/1",
      message: "fix auth",
    },
  ],
  usage: [
    { node_id: "auth-svc", cost_cents: 250 },
    { node_id: "rag", cost_cents: 100 },
  ],
  now,
  pastDueDays: 14,
});

ok("three sections (auth, rag, Presentation)", rollup.sections.length === 3, String(rollup.sections.map((s) => s.name)));
const auth = rollup.sections.find((s) => s.name === "auth");
ok("auth owned by @alice", auth?.owner?.nickname === "alice");
ok("node-derived owner claimKind is node", auth?.owner?.claimKind === "node");
ok("node-derived owner has no claimId without id", auth?.owner?.claimId == null);
ok("auth has 1 open critical", auth?.findings.open === 1 && auth?.findings.critical === 1);
ok("auth past-due counted", auth?.findings.pastDue === 1);
ok("auth spend $2.50", auth?.spend.costCents === 250);
ok("auth last change by bob", auth?.lastChange?.author === "bob");
ok("hotspots include auth and rag", rollup.hotspots.includes("section:auth") && rollup.hotspots.includes("section:rag"));
ok("unowned includes Presentation", rollup.unowned.includes("section:Presentation"));
ok("pastDueFindings lists Missing MFA", rollup.pastDueFindings.some((p) => p.title === "Missing MFA" && p.ageDays >= 14));
ok("resolved finding ignored in open count", auth?.findings.open === 1);
ok(
  "findingNodeId maps agent_file",
  findingNodeId({ id: "x", severity: "low", state: "open", agent_file: "src/auth.ts" }, nodes) === "auth-svc"
);
ok("formatRollupCents", formatRollupCents(250) === "$2.50");

// Section-level claim wins
const withSectionClaim = buildManagementRollup({
  nodes: [{ id: "n1", domain: "payments" }],
  claims: [
    {
      id: "claim-sec-1",
      kind: "section",
      target_id: "section:payments",
      claimer_id: "u2",
      nickname: "cara",
    },
    {
      id: "claim-node-1",
      kind: "node",
      target_id: "n1",
      claimer_id: "u9",
      nickname: "other",
    },
  ],
});
const payments = withSectionClaim.sections.find((s) => s.name === "payments");
ok("section id is section:payments", payments?.id === "section:payments");
ok("section claim sets owner", payments?.owner?.nickname === "cara");
ok("section claimKind is section", payments?.owner?.claimKind === "section");
ok("section claimId preserved for Release", payments?.owner?.claimId === "claim-sec-1");
ok("section claim wins over node claim", payments?.owner?.userId === "u2");

// Release eligibility helper: only section claims
function canReleaseFromRollup(owner: { claimKind: string; claimId: string | null; userId: string } | null, me: string) {
  return !!(owner && owner.userId === me && owner.claimKind === "section" && owner.claimId);
}
ok("Release allowed for own section claim", canReleaseFromRollup(payments?.owner ?? null, "u2"));
ok(
  "Release blocked for node-derived owner",
  !canReleaseFromRollup(auth?.owner ?? null, "u1")
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
