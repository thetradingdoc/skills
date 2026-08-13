/**
 * Post-V1 unit checks — deploy health aggregation.
 * Run: npx tsx scripts/test-deploy-health.ts
 */
import { buildDeployHealth, missingEnvForNode } from "../webapp/server/src/deployHealth";

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

console.log("deploy-health checks");

const now = new Date("2026-08-05T12:00:00Z");

// Healthy: CI success, no env gaps.
{
  const result = buildDeployHealth({
    nodes: [{ id: "api", label: "API", path: "src/api", files: ["src/api/index.ts"] }],
    ciByNode: { api: "success" },
    now,
  });
  const n = result.nodes.find((r) => r.nodeId === "api");
  ok("healthy status when CI success and no env gaps", n?.deployHealth.status === "healthy");
  ok("healthy has no missingEnv", (n?.deployHealth.missingEnv?.length ?? 0) === 0);
  ok("healthy not a hotspot", !result.hotspots.includes("api"));
  ok("checkedAt set", n?.deployHealth.checkedAt === now.toISOString());
}

// Degraded: requiredEnv intersects an env gap, CI unset/pending.
{
  const result = buildDeployHealth({
    nodes: [
      {
        id: "auth-svc",
        label: "Auth",
        path: "src/auth",
        files: ["src/auth/index.ts"],
        requiredEnv: ["AUTH_SECRET"],
      },
    ],
    envGaps: [{ varName: "AUTH_SECRET", files: ["src/other.ts"] }],
    ciByNode: { "auth-svc": "pending" },
    now,
  });
  const n = result.nodes.find((r) => r.nodeId === "auth-svc");
  ok("degraded when requiredEnv gap present", n?.deployHealth.status === "degraded");
  ok("missingEnv lists AUTH_SECRET", n?.deployHealth.missingEnv?.includes("AUTH_SECRET") === true);
  ok("degraded counts as hotspot", result.hotspots.includes("auth-svc"));
}

// Degraded via file/path match, even without requiredEnv declared.
{
  const missing = missingEnvForNode(
    { id: "billing", path: "src/billing", files: ["src/billing/stripe.ts"] },
    [{ varName: "STRIPE_SECRET_KEY", files: ["src/billing/stripe.ts"] }]
  );
  ok("file-match finds env gap without requiredEnv", missing.includes("STRIPE_SECRET_KEY"));
}

// Failed: CI failure takes priority over missing env, and over success.
{
  const result = buildDeployHealth({
    nodes: [
      { id: "n1", requiredEnv: ["FOO"] },
    ],
    envGaps: [{ varName: "FOO", files: [] }],
    ciByNode: { n1: "failure" },
    now,
  });
  const n = result.nodes.find((r) => r.nodeId === "n1");
  ok("ci failure -> failed status even with missing env", n?.deployHealth.status === "failed");
  ok("failed counts as hotspot", result.hotspots.includes("n1"));
}

// Unknown: no CI signal, no env gaps.
{
  const result = buildDeployHealth({
    nodes: [{ id: "n2" }],
    now,
  });
  const n = result.nodes.find((r) => r.nodeId === "n2");
  ok("unknown status with no signal", n?.deployHealth.status === "unknown");
  ok("unknown not a hotspot", !result.hotspots.includes("n2"));
}

// Hotspots list matches exactly the failed|degraded set.
{
  const result = buildDeployHealth({
    nodes: [
      { id: "healthy-node" },
      { id: "degraded-node", requiredEnv: ["X"] },
      { id: "failed-node" },
      { id: "unknown-node" },
    ],
    envGaps: [{ varName: "X", files: [] }],
    ciByNode: { "healthy-node": "success", "failed-node": "failure" },
    now,
  });
  ok(
    "hotspots contains only degraded and failed nodes",
    result.hotspots.length === 2 &&
      result.hotspots.includes("degraded-node") &&
      result.hotspots.includes("failed-node")
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
