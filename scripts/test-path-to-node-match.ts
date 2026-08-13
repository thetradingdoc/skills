/**
 * Unit checks for the GitHub → architecture path/node matcher (P2b).
 * Pure function, no network, no Supabase.
 * Run with: npx tsx scripts/test-path-to-node-match.ts
 */
import assert from "node:assert/strict";
import { matchChangedPathsToNodes } from "../webapp/server/src/githubArchEvents.ts";
import type { ArchNode } from "../src/types.ts";

function node(opts: { id: string; label: string; path?: string; files?: string[] }): ArchNode {
  return {
    id: opts.id,
    label: opts.label,
    path: opts.path ?? "",
    files: opts.files ?? [],
    semanticSignals: { exports: [], externalImports: [] },
    health: { hasDocs: false, hasTests: false, hasContext: false },
    status: "stable",
    isDrift: false,
  } as unknown as ArchNode;
}

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    throw err;
  }
}

// ── Empty inputs ────────────────────────────────────────────────────────

check("empty nodes returns no matches", () => {
  assert.deepEqual(matchChangedPathsToNodes([], ["src/auth/login.ts"]), []);
});

check("empty changed paths returns no matches", () => {
  const n = node({ id: "auth", label: "Auth Service", files: ["src/auth/login.ts"] });
  assert.deepEqual(matchChangedPathsToNodes([n], []), []);
});

// ── Matching by files ─────────────────────────────────────────────────────

check("matches when a changed path is exactly one of the node's files", () => {
  const n = node({ id: "auth", label: "Auth Service", files: ["src/auth/login.ts", "src/auth/session.ts"] });
  const matched = matchChangedPathsToNodes([n], ["src/auth/login.ts"]);
  assert.deepEqual(matched, ["auth"]);
});

check("matches when a changed path is nested under one of the node's files (treated as a dir)", () => {
  const n = node({ id: "api", label: "API", files: ["src/api"] });
  const matched = matchChangedPathsToNodes([n], ["src/api/routes/users.ts"]);
  assert.deepEqual(matched, ["api"]);
});

check("does not match an unrelated path", () => {
  const n = node({ id: "auth", label: "Auth Service", files: ["src/auth/login.ts"] });
  const matched = matchChangedPathsToNodes([n], ["src/billing/invoice.ts"]);
  assert.deepEqual(matched, []);
});

check("normalizes leading ./ and backslashes before comparing", () => {
  const n = node({ id: "auth", label: "Auth Service", files: ["src/auth/login.ts"] });
  const matched = matchChangedPathsToNodes([n], ["./src\\auth\\login.ts"]);
  assert.deepEqual(matched, ["auth"]);
});

// ── Matching by node.path (directory nodes) ────────────────────────────────

check("matches via node.path when files is empty", () => {
  const n = node({ id: "worker", label: "Background Worker", path: "src/worker" });
  const matched = matchChangedPathsToNodes([n], ["src/worker/jobs/sendEmail.ts"]);
  assert.deepEqual(matched, ["worker"]);
});

// ── Loose fallback: id/label as a path segment ─────────────────────────────

check("matches via node id appearing as a path segment when files/path are empty", () => {
  const n = node({ id: "billing", label: "Billing" });
  const matched = matchChangedPathsToNodes([n], ["services/billing/invoice.py"]);
  assert.deepEqual(matched, ["billing"]);
});

check("matches via a label word appearing as a path segment", () => {
  const n = node({ id: "n1", label: "Payment Gateway" });
  const matched = matchChangedPathsToNodes([n], ["src/gateway/stripe.ts"]);
  assert.deepEqual(matched, ["n1"]);
});

check("does not loosely match on short/common substrings", () => {
  // "db" as an id is too short to safely match "database.ts" via substring —
  // the matcher requires exact segment equality, not "contains".
  const n = node({ id: "db", label: "Database" });
  const matched = matchChangedPathsToNodes([n], ["src/somedbfile.ts"]);
  assert.deepEqual(matched, []);
});

// ── Multiple nodes / multiple paths ────────────────────────────────────────

check("matches multiple nodes from a multi-file push, each exactly once", () => {
  const auth = node({ id: "auth", label: "Auth", files: ["src/auth/login.ts"] });
  const billing = node({ id: "billing", label: "Billing", files: ["src/billing/invoice.ts"] });
  const unrelated = node({ id: "ui", label: "Frontend", files: ["src/ui/App.tsx"] });
  const matched = matchChangedPathsToNodes(
    [auth, billing, unrelated],
    ["src/auth/login.ts", "src/billing/invoice.ts", "README.md"]
  );
  assert.deepEqual([...matched].sort(), ["auth", "billing"]);
});

check("a single changed path can match more than one node", () => {
  const outer = node({ id: "outer", label: "Outer", path: "src" });
  const inner = node({ id: "inner", label: "Inner", files: ["src/inner/thing.ts"] });
  const matched = matchChangedPathsToNodes([outer, inner], ["src/inner/thing.ts"]);
  assert.deepEqual([...matched].sort(), ["inner", "outer"]);
});

console.log(`\n${passed} path-to-node match checks passed`);
