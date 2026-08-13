/**
 * Apply workspaces.github_installation_id migration.
 *
 * Usage:
 *   npx tsx scripts/apply-github-installation-migration.ts
 * Loads SUPABASE_DB_PASSWORD from webapp/server/.env when unset.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const MIGRATION =
  "supabase/migrations/20260812220000_workspaces_github_installation_id.sql";

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
      console.error("Set SUPABASE_DB_PASSWORD or DATABASE_URL");
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
  await client.query(fs.readFileSync(path.join(root, MIGRATION), "utf8"));
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'workspaces' AND column_name = 'github_installation_id'`
  );
  console.log(
    "github_installation_id:",
    cols.rows.length ? "present" : "MISSING"
  );
  await client.end();
  console.log("ok: github_installation_id migration");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
