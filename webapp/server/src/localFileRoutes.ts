/**
 * Reading a file out of the scanned repository.
 *
 * There is already a /file-content route, but it fetches from
 * raw.githubusercontent.com against a hardcoded main branch. That cannot show a
 * file the tool just wrote, a local-path scan, or anything on another branch —
 * and every one of those is the normal case here.
 *
 * The clone is on disk. Reading it there is faster, always current, and works
 * for repositories that are not on GitHub at all.
 */
import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import * as fs from "fs";
import * as path from "path";

const router = Router();

/** Beyond this a file is not something anyone reads in a panel. */
const MAX_BYTES = 1_000_000;

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip",
  ".gz", ".tar", ".mp4", ".mp3", ".woff", ".woff2", ".ttf", ".eot",
]);

router.post("/local-file", requireUser, (req, res) => {
  const { projectRoot, filePath } = req.body as {
    projectRoot?: string;
    filePath?: string;
  };

  if (!projectRoot || !filePath) {
    res.status(400).json({ error: "projectRoot and filePath are required" });
    return;
  }

  // The same guard the write path uses. A viewer that can read outside the
  // repository is a file-disclosure endpoint wearing a friendly name.
  if (path.isAbsolute(filePath) || filePath.split(/[/\\]/).includes("..")) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  const root = path.resolve(projectRoot);
  const abs = path.resolve(root, filePath);
  const rel = path.relative(root, abs);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    res.status(400).json({ error: "Path outside the project root" });
    return;
  }

  const base = path.basename(abs);
  if (base === ".env" || (base.startsWith(".env.") && !base.endsWith(".example"))) {
    res.status(403).json({ error: "Environment files are not readable" });
    return;
  }

  if (BINARY_EXT.has(path.extname(abs).toLowerCase())) {
    res.status(415).json({ error: "Not a text file" });
    return;
  }

  try {
    if (!fs.existsSync(abs)) {
      res.status(404).json({ error: "File not found: " + filePath });
      return;
    }

    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      res.status(400).json({ error: "Not a file" });
      return;
    }
    if (stat.size > MAX_BYTES) {
      res.status(413).json({
        error:
          "File is " +
          Math.round(stat.size / 1024) +
          "KB, too large to display. Open it in the terminal instead.",
      });
      return;
    }

    const content = fs.readFileSync(abs, "utf-8");
    res.json({
      path: filePath,
      content,
      lines: content.split("\n").length,
      bytes: stat.size,
      modified: stat.mtime.toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export { router as localFileRoutes };
