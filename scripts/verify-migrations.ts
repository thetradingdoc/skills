#!/usr/bin/env npx tsx
/**
 * Verify that bump_violation, violation_policy_events, and violation_scans
 * are deployed in the target Supabase project.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/verify-migrations.ts
 *
 * Or run against local: npx supabase db remote status
 * Then: npx supabase db push (to apply migrations)
 */

const REQUIRED = [
  "bump_violation",
  "violation_policy_events",
  "violation_scans",
] as const;

async function main() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.warn(
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to verify. Exiting."
    );
    process.exit(0);
  }

  const results: Record<string, boolean> = {};
  for (const name of REQUIRED) {
    if (name === "bump_violation") {
      const r = await fetch(`${url}/rest/v1/rpc/bump_violation`, {
        method: "POST",
        headers: {
          "apikey": key,
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({
          p_workspace_id: "00000000-0000-0000-0000-000000000000",
          p_fingerprint: "verify",
          p_rules_version: "v1",
          p_type: "layer_violation",
          p_severity: "low",
          p_source_node_id: "a",
          p_target_node_id: "b",
          p_description: "verify",
          p_suggested_fix: "verify",
          p_now: new Date().toISOString(),
        }),
      });
      results[name] = r.status !== 404 && r.status !== 500;
    } else if (name === "violation_policy_events" || name === "violation_scans") {
      const table = name;
      const r = await fetch(`${url}/rest/v1/${table}?limit=0`, {
        headers: {
          "apikey": key,
          "Authorization": `Bearer ${key}`,
        },
      });
      results[table] = r.ok;
    }
  }

  const ok = Object.values(results).every(Boolean);
  console.log(
    ok ? "All migrations verified" : "Some migrations missing",
    results
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
