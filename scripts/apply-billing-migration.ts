/**
 * Apply billing migration to remote Supabase.
 *
 * Usage:
 *   SUPABASE_DB_PASSWORD='…' npx tsx scripts/apply-billing-migration.ts
 *
 * Password: Supabase Dashboard → Project Settings → Database → Database password
 * (or set DATABASE_URL to a full postgres connection string).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sqlPath = path.join(
  root,
  "supabase/migrations/20260805120000_billing_subscriptions.sql"
);

async function main() {
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

  const sql = fs.readFileSync(sqlPath, "utf8");
  const requireFromServer = createRequire(
    path.join(root, "webapp/server/package.json")
  );
  const { Client } = requireFromServer("pg") as typeof import("pg");

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query(sql);
  await client.end();
  console.log("Applied", path.basename(sqlPath));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
