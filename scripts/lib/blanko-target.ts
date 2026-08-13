/**
 * Resolve trading-agent roots from repo-root `.blanko-target`.
 * SSOT for runtime / Part 1: `local` + PORT 4100 (see trading LOCAL_RUNTIME.md).
 * `scan-clone` is Blanko's sandbox under ~/.arch-viz/repos — keep for mutate/dogfood.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type BlankoTarget = {
  repo?: string;
  package?: string;
  local: string | null;
  scanClone: string | null;
  filePath: string;
};

function expand(p: string): string {
  let s = p.trim();
  if (s.startsWith("~/")) s = path.join(os.homedir(), s.slice(2));
  return path.resolve(s);
}

export function readBlankoTarget(cwd = process.cwd()): BlankoTarget {
  const filePath = path.join(cwd, ".blanko-target");
  const out: BlankoTarget = { local: null, scanClone: null, filePath };
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const m = line.match(/^([a-z-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();
    if (key === "repo") out.repo = val;
    if (key === "package") out.package = val;
    if (key === "local" && val) out.local = expand(val);
    if (key === "scan-clone" && val) out.scanClone = expand(val);
  }
  return out;
}

/** Runtime / Part 1 SSOT — prefer env, then local, then scan-clone. */
export function tradingLiveRoot(cwd = process.cwd()): string {
  const env = process.env.TRADING_LIVE_ROOT?.trim() || process.env.BLANKO_TARGET_LOCAL?.trim();
  if (env) return expand(env);
  const t = readBlankoTarget(cwd);
  if (t.local && fs.existsSync(t.local)) return t.local;
  if (t.scanClone && fs.existsSync(t.scanClone)) return t.scanClone;
  throw new Error(
    "No trading live root: set TRADING_LIVE_ROOT or local: in .blanko-target"
  );
}

/** Blanko sandbox clone — for dogfood/Approve isolation. */
export function tradingScanClone(cwd = process.cwd()): string {
  const env = process.env.BLANKO_TARGET_ROOT?.trim() || process.env.BLANKO_SCAN_CLONE?.trim();
  if (env) return expand(env);
  const t = readBlankoTarget(cwd);
  if (t.scanClone && fs.existsSync(t.scanClone)) return t.scanClone;
  if (t.local && fs.existsSync(t.local)) return t.local;
  throw new Error(
    "No scan-clone: set BLANKO_TARGET_ROOT or scan-clone: in .blanko-target"
  );
}

export function tradingApiUrl(): string {
  return process.env.TRADING_API_URL?.trim() || "http://127.0.0.1:4100";
}
