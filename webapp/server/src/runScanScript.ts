/**
 * Run scripts/scan-repo.ts and load the graph from the temp file it writes.
 * Inventory payloads (~10–20MB) exceed stdout pipe/maxBuffer (ENOBUFS).
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const scanProjectRoot =
  process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, "../../..");

export function runScanScript(
  scanArgs: string[],
  cwd: string = scanProjectRoot
): { graph: unknown; bytes: number } {
  const result = execFileSync("npx", scanArgs, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env },
  });
  let meta: { ok?: boolean; path?: string; bytes?: number };
  try {
    meta = JSON.parse(result.trim().split("\n").filter(Boolean).pop() || "{}");
  } catch {
    throw new Error(`scan-repo returned non-JSON stub: ${result.slice(0, 200)}`);
  }
  if (!meta.path || typeof meta.path !== "string") {
    throw new Error(`scan-repo did not return an output path: ${result.slice(0, 200)}`);
  }
  const bytes =
    typeof meta.bytes === "number" ? meta.bytes : fs.statSync(meta.path).size;
  console.log(`[scan] graph payload bytes=${bytes} path=${meta.path}`);
  try {
    const raw = fs.readFileSync(meta.path, "utf8");
    return { graph: JSON.parse(raw), bytes };
  } finally {
    try {
      fs.unlinkSync(meta.path);
    } catch {
      /* ignore */
    }
  }
}
