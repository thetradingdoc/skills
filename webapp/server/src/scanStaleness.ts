/**
 * Has the code changed since the scan you are looking at?
 *
 * Every view in this tool is a picture of a scan, and a scan is a moment. Work
 * on the repository afterwards and the picture quietly stops matching — the
 * dashboard shows agents that have moved, the assessment cites line numbers
 * that have shifted, and nothing anywhere says so.
 *
 * That happened all week: thirty new files were written into the clone and the
 * dashboard kept showing the scan from before they existed. Not a rendering
 * bug — the tool was faithfully displaying a stale graph, which is the worst
 * kind of wrong because it looks right.
 *
 * A webhook would only help for pushed commits, and the case that actually
 * bites is local editing. So this compares file modification times against the
 * scan's timestamp and reports what moved.
 */

import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import * as fs from "fs";
import * as path from "path";

const router = Router();

/** Directories whose churn says nothing about the architecture. */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
  '.agent', 'data', '.cache', 'tmp', '.turbo', 'out',
]);

/** Extensions the scanner actually reads. A changed README is not a changed graph. */
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.json']);

const MAX_FILES = 20000;

function walk(dir: string, since: number, acc: { changed: any[]; scanned: number }, root: string) {
  if (acc.scanned > MAX_FILES) return;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env.example') {
      if (IGNORE_DIRS.has(e.name)) continue;
    }
    if (IGNORE_DIRS.has(e.name)) continue;

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
          // A file created after the scan is a different thing from one edited
          // after it: the first means the graph is missing a node, the second
          // that a node's contents moved.
          isNew: st.birthtimeMs > since,
        });
      }
    } catch {
      // A file that cannot be stat'd is not evidence either way.
    }
  }
}

router.get('/scan-staleness', requireUser, (req, res) => {
  const projectRoot = String(req.query.projectRoot || '').trim();
  const since = Number(req.query.since || 0);

  if (!projectRoot) {
    res.status(400).json({ error: 'projectRoot is required' });
    return;
  }
  if (!since) {
    res.status(400).json({ error: 'since is required — the scan timestamp' });
    return;
  }

  const root = path.resolve(projectRoot);

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    // The clone is gone. Worth saying plainly rather than reporting no changes,
    // which would read as "nothing to do".
    res.json({
      available: false,
      reason: 'The scanned directory no longer exists. Scan again to recreate it.',
      changed: 0,
    });
    return;
  }

  type Changed = { path: string; modified: string; isNew: boolean };
  const acc: { changed: Changed[]; scanned: number } = { changed: [], scanned: 0 };

  try {
    walk(root, since, acc, root);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  // Most recent first — what changed last is usually what you were doing.
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
    summary:
      acc.changed.length === 0
        ? 'Nothing has changed since this scan.'
        : acc.changed.length +
          ' file' + (acc.changed.length === 1 ? '' : 's') +
          ' changed since this scan' +
          (added ? ', ' + added + ' of them new' : '') + '.',
  });
});

export { router as scanStalenessRoutes };
