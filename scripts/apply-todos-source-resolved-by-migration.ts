/**
 * Apply todos source/resolved_by migration (blanko redesign v2 §1).
 *
 * Usage:
 *   SUPABASE_DB_PASSWORD='…' npx tsx scripts/apply-todos-source-resolved-by-migration.ts
 * or:
 *   DATABASE_URL='postgresql://…' npx tsx scripts/apply-todos-source-resolved-by-migration.ts
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const MIGRATION = "supabase/migrations/20260812180000_todos_source_resolved_by.sql";

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
  const sqlPath = path.join(root, MIGRATION);
  await client.query(fs.readFileSync(sqlPath, "utf8"));
  console.log("Applied", path.basename(sqlPath));

  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'todos' AND column_name IN ('source','resolved_by')
     ORDER BY column_name`
  );
  console.log(
    "columns:",
    cols.rows.map((r: { column_name: string }) => r.column_name).join(", ")
  );

  const idx = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'todos' AND indexname = 'todos_open_source_path_uniq'`
  );
  console.log("unique_index:", idx.rows.length > 0 ? "present" : "MISSING");

  const checks = await client.query(
    `SELECT conname FROM pg_constraint
     WHERE conrelid = 'todos'::regclass
       AND conname IN ('todos_resolved_by_check','todos_source_check')
     ORDER BY conname`
  );
  console.log(
    "checks:",
    checks.rows.map((r: { conname: string }) => r.conname).join(", ") || "(none)"
  );

  await client.end();
  console.log("ok: todos source/resolved_by migration");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
