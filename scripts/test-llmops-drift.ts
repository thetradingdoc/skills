/**
 * P6 unit checks — agent shape drift.
 * Run: npx tsx scripts/test-llmops-drift.ts
 */
import { computeAgentShapeDrift, driftSummary } from "../webapp/server/src/llmopsDrift";

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

console.log("llmops-drift checks");

const nodes = [
  { id: "agent", label: "Trading Agent", kind: "agent", layer: "Reasoning" },
  { id: "mem", label: "Session Memory", layer: "Memory" },
  { id: "eval", label: "Eval Harness", layer: "Evaluation" },
  { id: "api", label: "API Gateway", layer: "Presentation" },
];

ok(
  "agent alone → warn missing memory+eval",
  (() => {
    const d = computeAgentShapeDrift([nodes[0]!], []);
    return d.length === 1 && d[0]!.severity === "warn" && d[0]!.reasons.length >= 2;
  })()
);

ok(
  "agent+memory+eval edges → warn when no eval runs yet",
  (() => {
    const d = computeAgentShapeDrift(nodes, [
      { source: "agent", target: "mem", relation: "reads" },
      { source: "agent", target: "eval", relation: "calls" },
    ]);
    return d[0]!.severity === "warn" && d[0]!.hasMemoryEdge && d[0]!.hasEvalEdge && d[0]!.latestEvalStatus === "none";
  })()
);

ok(
  "failing eval → fail severity",
  (() => {
    const d = computeAgentShapeDrift(
      nodes,
      [
        { source: "agent", target: "mem" },
        { source: "agent", target: "eval" },
      ],
      [{ node_id: "agent", status: "fail", created_at: "2026-08-05T00:00:00Z" }]
    );
    return d[0]!.severity === "fail" && d[0]!.latestEvalStatus === "fail";
  })()
);

ok(
  "trace errors → fail",
  (() => {
    const d = computeAgentShapeDrift(
      nodes,
      [
        { source: "agent", target: "mem" },
        { source: "agent", target: "eval" },
      ],
      [{ node_id: "agent", status: "pass", created_at: "2026-08-05T00:00:00Z" }],
      [
        { node_id: "agent", status: "ok" },
        { node_id: "agent", status: "error" },
      ]
    );
    return d[0]!.severity === "fail" && d[0]!.recentTraceErrors === 1;
  })()
);

ok(
  "non-agent nodes ignored",
  computeAgentShapeDrift([{ id: "api", label: "API", layer: "Presentation" }], []).length === 0
);

ok(
  "eval on linked eval node counts",
  (() => {
    const d = computeAgentShapeDrift(
      nodes,
      [
        { source: "agent", target: "mem" },
        { source: "agent", target: "eval" },
      ],
      [{ node_id: "eval", status: "pass", created_at: "2026-08-05T00:00:00Z" }]
    );
    return d[0]!.latestEvalStatus === "pass" && d[0]!.severity === "ok";
  })()
);

const summary = driftSummary([
  {
    nodeId: "a",
    label: "a",
    severity: "fail",
    reasons: [],
    hasMemoryEdge: false,
    hasEvalEdge: false,
    latestEvalStatus: "fail",
    recentTraceCount: 0,
    recentTraceErrors: 0,
  },
  {
    nodeId: "b",
    label: "b",
    severity: "warn",
    reasons: [],
    hasMemoryEdge: false,
    hasEvalEdge: true,
    latestEvalStatus: "none",
    recentTraceCount: 0,
    recentTraceErrors: 0,
  },
  {
    nodeId: "c",
    label: "c",
    severity: "ok",
    reasons: [],
    hasMemoryEdge: true,
    hasEvalEdge: true,
    latestEvalStatus: "pass",
    recentTraceCount: 1,
    recentTraceErrors: 0,
  },
]);
ok("driftSummary counts", summary.fail === 1 && summary.warn === 1 && summary.ok === 1);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
