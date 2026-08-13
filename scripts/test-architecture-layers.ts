/**
 * P3 unit checks — layer rollup state, unconnected detection heuristics,
 * evalExercisesAgent-style import matching, memory method-name fallback shape.
 *
 * Run: npx tsx scripts/test-architecture-layers.ts
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  _testDetectState,
  detectBuiltUnconnected,
  buildArchitectureLayersDoc,
  loadApplicability,
  saveApplicability,
} from "./architecture-layers";
import { buildRepoGraph, clearLayerIndexCache } from "./agent-layers";

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

function withTempRepo(fn: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arch-layers-"));
  try {
    clearLayerIndexCache();
    fn(root);
  } finally {
    clearLayerIndexCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("architecture-layers checks");

ok("filled rollup → working", _testDetectState("filled", 0) === "working");
ok("thin rollup → working", _testDetectState("thin", 0) === "working");
ok("mixed rollup → working", _testDetectState("mixed", 0) === "working");
ok("empty rollup → absent", _testDetectState("empty", 0) === "absent");
ok("empty + unconnected → built_unconnected", _testDetectState("empty", 1) === "built_unconnected");
ok("unsearched rollup → absent", _testDetectState("unsearched", 0) === "absent");

withTempRepo((root) => {
  // Built capability with deps, zero callers
  fs.writeFileSync(
    path.join(root, "vector-retriever.js"),
    `const pinecone = require('@pinecone-database/pinecone');\nmodule.exports = { retrieve() {} };\n`
  );
  // A normal file that is imported by an entry (should NOT be unconnected)
  fs.writeFileSync(path.join(root, "db.js"), `module.exports = {};\n`);
  fs.writeFileSync(path.join(root, "app.js"), `const db = require('./db');\n`);

  const graph = buildRepoGraph(root);
  const unconnected = detectBuiltUnconnected(root, graph);
  ok(
    "detectBuiltUnconnected finds vector-retriever",
    unconnected.some((u) => u.file === "vector-retriever.js"),
    JSON.stringify(unconnected)
  );
  ok(
    "detectBuiltUnconnected does not flag reachable db.js",
    !unconnected.some((u) => u.file === "db.js")
  );
});

withTempRepo((root) => {
  saveApplicability(root, {
    version: 1,
    layers: {
      knowledge: { state: "not_applicable", reason: "No RAG in this product", updated_at: new Date().toISOString() },
    },
  });
  const loaded = loadApplicability(root);
  ok("applicability round-trip", loaded.layers.knowledge?.state === "not_applicable");
  ok("applicability reason preserved", loaded.layers.knowledge?.reason === "No RAG in this product");

  // Minimal agent with empty layers array shape for rollup
  const agents = [
    {
      file: "agent.js",
      kind: "agent" as const,
      loopKind: "tool-loop" as const,
      layers: [
        {
          id: "knowledge" as const,
          name: "Knowledge",
          question: "q",
          whyItMatters: "w",
          status: "empty" as const,
          scope: "system" as const,
          emptyReason: "none",
          components: [],
        },
      ],
    },
  ];
  // Write a tiny reference-model next to product — buildArchitectureLayersDoc loads from productRoot
  const productRoot = path.join(root, "_product");
  fs.mkdirSync(productRoot);
  fs.writeFileSync(
    path.join(productRoot, "reference-model.json"),
    JSON.stringify({
      version: 1,
      layers: [
        {
          id: "knowledge",
          name: "Knowledge",
          question: "q",
          whatFillsIt: "RAG",
          whyItMatters: "w",
          requirement: { whenSensitive: "essential", whenNotSensitive: "optional" },
        },
      ],
    })
  );
  // Copy apply file into "repo"
  const doc = buildArchitectureLayersDoc(root, agents as any, productRoot);
  const knowledge = doc.layers.find((l) => l.id === "knowledge");
  ok("declared N/A wins over detected absent", knowledge?.state === "not_applicable", knowledge?.state);
  ok("detected still recorded under detected.state", knowledge?.detected.state === "absent" || knowledge?.detected.state === "built_unconnected");
  ok("unconnected_modules array present", Array.isArray(doc.unconnected_modules));
});

// Memory method-name heuristic: simulate the regex used in agent-layers
{
  const agentText = `
    async function executeTurn() {
      const prior = await db.listTradingHistory(userId);
      return prior;
    }
  `;
  const hits = [...agentText.matchAll(/\bdb\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map((x) => x[1]);
  ok("memory regex finds listTradingHistory", hits.includes("listTradingHistory"));
  ok(
    "history-shaped method name matches fallback",
    hits.some((h) => /history|session|prior|conversation|memory|messages/i.test(h!))
  );
}

// Eval import matching (mirrors evalExercisesAgent pattern)
{
  const base = "execute-turn";
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const agentImportRe = new RegExp(
    `(?:require\\s*\\(\\s*['"\`][^'"\`]*${escapedBase}(?:\\.[cm]?[jt]sx?)?['"\`]\\s*\\)|from\\s+['"][^'"]*${escapedBase}(?:\\.[cm]?[jt]sx?)?['"])`
  );
  const harness = `const { executeTurn } = require('../src/execute-turn.js');\nassert(executeTurn);\n`;
  ok("eval harness require matches agent base", agentImportRe.test(harness));
  const soft =
    new RegExp(`\\b${escapedBase}\\b`).test(`describe('execute-turn', () => { expect(1).toBe(1) })`) &&
    /\b(assert|expect|describe|it\s*\(|test\s*\()/i.test(`describe('execute-turn', () => { expect(1).toBe(1) })`);
  ok("eval soft harness names agent + assert", soft);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
