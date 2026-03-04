/**
 * Load .env before any module that reads process.env (e.g. supabaseAdmin).
 * Must be imported first in index.ts - ESM hoists imports, so this runs before
 * routes (and thus requireUser -> supabaseAdmin) are initialized.
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPaths = [
    // Prefer server-local env when launched from repo root.
    path.resolve(__dirname, "../.env"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "../../../.env"),
    path.resolve(__dirname, "../../../webapp/server/.env"),
];
// Load all env files we can find (first wins for any given key).
for (const p of Array.from(new Set(envPaths))) {
    if (fs.existsSync(p)) {
        dotenv.config({ path: p, override: false });
    }
}
if (process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY.trim();
}
