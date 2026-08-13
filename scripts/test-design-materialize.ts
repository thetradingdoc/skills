/**
 * Unit checks for Post-V1 design-graph materialize path derivation.
 * Covers both the client helper (webapp/client/src/designMaterialize.ts) and
 * the server route's pure exports (webapp/server/src/designMaterialize.ts) —
 * they must agree on relPath derivation since the client preview should
 * match what the server actually writes to disk.
 * Run with: npx tsx scripts/test-design-materialize.ts
 */
import assert from "node:assert/strict";
import {
  relPathForDesignNode as clientRelPath,
  slug as clientSlug,
} from "../webapp/client/src/designMaterialize.ts";
import {
  relPathForDesignNode as serverRelPath,
  slug as serverSlug,
} from "../webapp/server/src/designMaterialize.ts";

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

for (const [impl, relPath, slugFn] of [
  ["client", clientRelPath, clientSlug],
  ["server", serverRelPath, serverSlug],
] as const) {
  check(`[${impl}] slug lowercases and hyphenates`, () => {
    assert.equal(slugFn("Payment Service"), "payment-service");
  });

  check(`[${impl}] slug strips non-alphanumeric runs to single hyphens`, () => {
    assert.equal(slugFn("API / Gateway!!"), "api-gateway");
  });

  check(`[${impl}] slug trims leading/trailing hyphens`, () => {
    assert.equal(slugFn("  -Redis Cache-  "), "redis-cache");
  });

  check(`[${impl}] slug falls back to "node" for empty/symbol-only input`, () => {
    assert.equal(slugFn(""), "node");
    assert.equal(slugFn("***"), "node");
  });

  check(`[${impl}] relPathForDesignNode falls back to src/<slug>/index.ts when no path`, () => {
    assert.equal(relPath({ id: "n1", label: "Payment Service" }), "src/payment-service/index.ts");
  });

  check(`[${impl}] relPathForDesignNode falls back to slugged id when label missing`, () => {
    assert.equal(relPath({ id: "worker-7" }), "src/worker-7/index.ts");
  });

  check(`[${impl}] relPathForDesignNode prefers a safe project-relative node.path`, () => {
    assert.equal(
      relPath({ id: "n1", label: "API", path: "src/api/handler.ts" }),
      "src/api/handler.ts"
    );
  });

  check(`[${impl}] relPathForDesignNode normalizes backslashes in node.path`, () => {
    assert.equal(relPath({ id: "n1", label: "API", path: "src\\api\\handler.ts" }), "src/api/handler.ts");
  });

  check(`[${impl}] relPathForDesignNode rejects absolute node.path (falls back to slug)`, () => {
    assert.equal(relPath({ id: "n1", label: "API", path: "/etc/passwd" }), "src/api/index.ts");
  });

  check(`[${impl}] relPathForDesignNode rejects traversal node.path (falls back to slug)`, () => {
    assert.equal(
      relPath({ id: "n1", label: "API", path: "../../etc/passwd" }),
      "src/api/index.ts"
    );
  });

  check(`[${impl}] relPathForDesignNode rejects Windows drive paths (falls back to slug)`, () => {
    assert.equal(relPath({ id: "n1", label: "API", path: "C:\\Windows\\system32" }), "src/api/index.ts");
  });
}

console.log(`\n${passed} check(s) passed.`);
