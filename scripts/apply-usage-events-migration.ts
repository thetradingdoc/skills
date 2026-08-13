/**
 * Apply P5 usage_events + budgets (+ fuel source widen) to remote Supabase.
 *
 * Usage:
 *   SUPABASE_DB_PASSWORD='…' npx tsx scripts/apply-usage-events-migration.ts
 * or:
 *   DATABASE_URL='postgresql://…' npx tsx scripts/apply-usage-events-migration.ts
 *
 * Loads SUPABASE_DB_PASSWORD from webapp/server/.env when unset.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const MIGRATIONS = [
  "supabase/migrations/20260805190000_p5_usage_events_budgets.sql",
  "supabase/migrations/20260807120000_usage_trading_fuel_sources.sql",
];

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || !process.env[key]?.trim()) {
      process.env[key] = val;
    }
  }
}

async function main() {
  loadEnvFile(path.join(root, "webapp/server/.env"));
  loadEnvFile(path.join(root, ".env"));

  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  let connectionString = process.env.DATABASE_URL?.trim();
  const ref =
    process.env.SUPABASE_PROJECT_REF?.trim() ||
    fs.readFileSync(path.join(root, "supabase/.temp/project-ref"), "utf8").trim();

  if (!connectionString) {
    if (!password) {
      console.error(
        "Set SUPABASE_DB_PASSWORD (Project Settings → Database) or DATABASE_URL"
      );
      process.exit(1);
    }
    connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-us-west-2.pooler.supabase.com:6543/postgres`;
  }

  const requireFromServer = createRequire(
    path.join(root, "webapp/server/package.json")
  );
  const { Client } = requireFromServer("pg") as typeof import("pg");

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  for (const rel of MIGRATIONS) {
    const sqlPath = path.join(root, rel);
    await client.query(fs.readFileSync(sqlPath, "utf8"));
    console.log("Applied", path.basename(sqlPath));
  }

  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('usage_events','budgets')
     ORDER BY table_name`
  );
  console.log(
    "tables:",
    tables.rows.map((r: { table_name: string }) => r.table_name).join(", ") || "(none)"
  );

  await client.end();
  console.log("ok: usage_events + budgets migration");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
