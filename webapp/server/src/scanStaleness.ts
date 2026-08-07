/**
 * Has the code changed since the scan you are looking at?
 *
 * Prefer git tip (scannedCommit) when provided; fall back to mtime with noise filters.
 */

import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const router = Router();

/** Directories whose churn says nothing about the architecture. */
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".agent",
  "data",
  ".cache",
  "tmp",
  ".turbo",
  "out",
  "__tests__",
  "test-results",
  "playwright-report",
]);

/** Extensions the scanner actually reads. A changed README is not a changed graph. */
const CODE_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".json"]);

const IGNORE_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".gc-stamp",
]);

const MAX_FILES = 20000;

/** Grace so files touched during the scan itself don't immediately look "changed". */
const GRACE_MS = 5000;

function walk(dir: string, since: number, acc: { changed: any[]; scanned: number }, root: string) {
  if (acc.scanned > MAX_FILES) return;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".env.example") {
      if (IGNORE_DIRS.has(e.name)) continue;
    }
    if (IGNORE_DIRS.has(e.name)) continue;
    if (IGNORE_FILES.has(e.name)) continue;

    const full = path.join(dir, e.name);

    if (e.isDirectory()) {
      walk(full, since, acc, root);
      continue;
    }

    if (!CODE_EXT.has(path.extname(e.name))) continue;

    acc.scanned += 1;

    try {
      const st = fs.statSync(full);
      if (st.mtimeMs > since) {
        acc.changed.push({
          path: path.relative(root, full),
          modified: new Date(st.mtimeMs).toISOString(),
          isNew: st.birthtimeMs > since,
        });
      }
    } catch {
      /* ignore */
    }
  }
}

function gitHead(root: string): string | null {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

router.get("/scan-staleness", requireUser, (req, res) => {
  const projectRoot = String(req.query.projectRoot || "").trim();
  const since = Number(req.query.since || 0);
  const scannedCommit =
    typeof req.query.scannedCommit === "string" ? req.query.scannedCommit.trim() : "";

  if (!projectRoot) {
    res.status(400).json({ error: "projectRoot is required" });
    return;
  }
  if (!since) {
    res.status(400).json({ error: "since is required — the scan timestamp" });
    return;
  }

  const root = path.resolve(projectRoot);

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    res.json({
      available: false,
      reason: "The scanned directory no longer exists. Scan again to recreate it.",
      changed: 0,
    });
    return;
  }

  const head = gitHead(root);
  if (scannedCommit && head && scannedCommit === head) {
    res.json({
      available: true,
      scanned: 0,
      changed: 0,
      added: 0,
      edited: 0,
      since: new Date(since).toISOString(),
      files: [],
      truncated: false,
      scannedCommit: head,
      summary: "Clone tip matches this scan (up to date).",
    });
    return;
  }

  type Changed = { path: string; modified: string; isNew: boolean };
  const acc: { changed: Changed[]; scanned: number } = { changed: [], scanned: 0 };
  const cutoff = since + GRACE_MS;

  try {
    walk(root, cutoff, acc, root);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  acc.changed.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

  const added = acc.changed.filter((c) => c.isNew).length;

  res.json({
    available: true,
    scanned: acc.scanned,
    changed: acc.changed.length,
    added,
    edited: acc.changed.length - added,
    since: new Date(since).toISOString(),
    files: acc.changed.slice(0, 12),
    truncated: acc.changed.length > 12,
    scannedCommit: head ?? undefined,
    summary:
      acc.changed.length === 0
        ? "Nothing has changed since this scan."
        : `${acc.changed.length} file${acc.changed.length === 1 ? "" : "s"} changed since this scan.`,
  });
});

export { router as scanStalenessRoutes };
