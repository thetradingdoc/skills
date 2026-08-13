/**
 * Unit tests: severity badge mapping + auto-enqueue dedupe / D1 guards.
 */
import assert from "node:assert/strict";
import type { Severity } from "../webapp/client/src/severity.ts";
import {
  contributesToBadge,
  fromDesignFindingSeverity,
  fromActionPriority,
} from "../webapp/client/src/severity.ts";
import {
  canAutoEnqueueForGraph,
  collectAutoEnqueueCandidates,
  newAutoEnqueueCandidates,
  selectAutoEnqueueFindings,
} from "../webapp/client/src/autoEnqueueFindings.ts";
import { evaluateDesign } from "../webapp/client/src/designRules.ts";
import { nodeActionBadgeMeta } from "../webapp/client/src/insightsBriefing.ts";
import type { ArchGraph } from "../webapp/client/src/types.ts";

/** Mirror of server normalizeTodoSource — keep unit test free of Express. */
function normalizeTodoSource(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "manual";
  const s = raw.trim();
  if (s === "trading-spine") return "seed_spine";
  if (s === "flow-path") return "import_from_path";
  if (s === "chat") return "manual";
  return s;
}

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log("ok:", name);
  } catch (e) {
    console.error("FAIL:", name, e);
    process.exitCode = 1;
  }
}

check("severity maps risk→warning, suggestion→soft", () => {
  assert.equal(fromDesignFindingSeverity("risk"), "warning");
  assert.equal(fromDesignFindingSeverity("suggestion"), "soft");
  assert.equal(fromActionPriority("medium"), "soft");
  assert.equal(contributesToBadge("soft"), false);
  assert.equal(contributesToBadge("blocker"), true);
});

check("soft-only node badge_count === 0", () => {
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
  assert.ok(!softMeta["greeting"] || softMeta["greeting"].badge_count === 0);
});

check("D1: missing_trading_spine never auto-enqueues", () => {
  const g: ArchGraph = {
    nodes: [
      {
        id: "trading-chat",
        label: "Trading Chat",
        path: "trading-chat",
        layer: "Presentation",
        files: ["trading-chat/index.js"],
      },
      {
        id: "middleware-platform",
        label: "Middleware",
        path: "middleware-platform",
        layer: "Data Access",
        files: ["middleware-platform/server.js"],
      },
    ],
    edges: [],
    generatedAt: 1,
    projectRoot: "/tmp/clone",
    projectName: "trading-agent",
  };
  const findings = evaluateDesign(g);
  assert.ok(findings.some((f) => f.ruleId === "missing_trading_spine"));
  const selected = selectAutoEnqueueFindings(findings);
  assert.ok(!selected.some((f) => f.ruleId === "missing_trading_spine"));
  const candidates = collectAutoEnqueueCandidates(g);
  assert.ok(!candidates.some((c) => c.ruleId === "missing_trading_spine"));
});

check("n8n / greenfield / no-root: zero auto-enqueue", () => {
  const base: ArchGraph = {
    nodes: [{ id: "a", label: "A", path: "a", layer: "Presentation", files: [] }],
    edges: [],
    generatedAt: 1,
  };
  assert.equal(canAutoEnqueueForGraph({ ...base, projectRoot: "" }), false);
  assert.equal(
    canAutoEnqueueForGraph({
      ...base,
      projectRoot: "/tmp/x",
      nodes: [{ ...base.nodes[0]!, importSource: "n8n" }],
    }),
    false
  );
  assert.equal(
    canAutoEnqueueForGraph({
      ...base,
      projectRoot: "/tmp/x",
      architectureBoard: true,
      nodes: [{ id: "a", label: "A", path: "a", layer: "Presentation", files: [] }],
    }),
    false
  );
  assert.equal(collectAutoEnqueueCandidates({ ...base, projectRoot: "" }).length, 0);
});

check("enqueue dedupe by source_path", () => {
  const candidates = [
    {
      title: "t",
      description: "d",
      source: "insights" as const,
      sourcePath: "insights:n1:r1",
      fileScope: [] as string[],
      agentFile: null,
      layerId: null,
      kind: "task" as const,
      context: "c",
      assigneeLabel: "Cursor" as const,
      ruleId: "r1",
      nodeId: "n1",
    },
  ];
  assert.equal(newAutoEnqueueCandidates(candidates, new Set(["insights:n1:r1"])).length, 0);
  assert.equal(newAutoEnqueueCandidates(candidates, new Set()).length, 1);
});

check("normalizeTodoSource maps legacy strings", () => {
  assert.equal(normalizeTodoSource("trading-spine"), "seed_spine");
  assert.equal(normalizeTodoSource("flow-path"), "import_from_path");
  assert.equal(normalizeTodoSource(null), "manual");
  assert.equal(normalizeTodoSource("insights"), "insights");
});

console.log("ok: severity + auto-enqueue unit suite");
