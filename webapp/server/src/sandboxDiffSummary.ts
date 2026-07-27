/**
 * Human-readable sandbox vs project root diff for Phase 1 trust loop.
 */

import * as fs from "fs";
import * as path from "path";
import { getSandboxPath } from "../../../src/agent/rail/sandbox.js";

export type FileDiffSummary = {
  path: string;
  added: number;
  removed: number;
  isNew: boolean;
};

export function computeSandboxDiffSummary(
  root: string,
  railId: string
): {
  changedFiles: number;
  totalBytes: number;
  files: FileDiffSummary[];
  summary: string;
} {
  const sandboxPath = getSandboxPath(root, railId);
  if (!fs.existsSync(sandboxPath)) {
    return { changedFiles: 0, totalBytes: 0, files: [], summary: "No sandbox changes." };
  }

  const files: FileDiffSummary[] = [];
  let totalBytes = 0;

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(sandboxPath, full).replace(/\\/g, "/");
      if (!rel) continue;
      const rootFile = path.join(root, rel);
      let before = "";
      let after = "";
      const isNew = !fs.existsSync(rootFile);
      try {
        if (!isNew && fs.statSync(rootFile).isFile()) {
          before = fs.readFileSync(rootFile, "utf-8");
        }
      } catch {
        // ignore
      }
      try {
        after = fs.readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      if (before === after) continue;
      const beforeLines = before ? before.split("\n").length : 0;
      const afterLines = after ? after.split("\n").length : 0;
      const added = Math.max(0, afterLines - beforeLines);
      const removed = Math.max(0, beforeLines - afterLines);
      files.push({ path: rel, added, removed, isNew });
      totalBytes += Buffer.byteLength(after, "utf-8");
    }
  };

  try {
    walk(sandboxPath);
  } catch {
    return { changedFiles: 0, totalBytes: 0, files: [], summary: "Could not read sandbox." };
  }

  const summary =
    files.length === 0
      ? "No file changes detected."
      : files
          .slice(0, 12)
          .map((f) =>
            f.isNew
              ? `${f.path} (new, ~${f.added} lines)`
              : `${f.path} (+${f.added} -${f.removed} lines)`
          )
          .join("; ") + (files.length > 12 ? ` … +${files.length - 12} more` : "");

  return { changedFiles: files.length, totalBytes, files, summary };
}
