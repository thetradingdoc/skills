#!/usr/bin/env npx tsx
/**
 * CLI: Clone a GitHub repo and output ArchGraph as JSON.
 * Usage: npx tsx scripts/scan-repo.ts <repo-url>
 * Example: npx tsx scripts/scan-repo.ts https://github.com/owner/repo
 *
 * For private repos: set GITHUB_TOKEN in .env (or environment).
 */

import "dotenv/config";
import { simpleGit } from "simple-git";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { scanProject } from "../src/analyzer/scanner";
import { detectDrift } from "../src/analyzer/driftDetector";
import { enrichGraph } from "../src/ai/enricher-v2";
import { analyseGraph } from "../src/analysis/graphAnalyser";
import { getClonesDir, authUrl, cloneToStablePath } from "../webapp/server/src/cloneRepo.js";

async function main() {
  const repoUrl = process.argv[2];
  if (!repoUrl) {
    console.error("Usage: npx tsx scripts/scan-repo.ts <repo-url>");
    process.exit(1);
  }

  const keepClone = process.argv.includes("--keep");
  const workspaceIdIdx = process.argv.indexOf("--workspace-id");
  const workspaceId =
    workspaceIdIdx >= 0 && process.argv[workspaceIdIdx + 1]
      ? process.argv[workspaceIdIdx + 1].trim()
      : null;
  const branchIdx = process.argv.indexOf("--branch");
  const branch =
    branchIdx >= 0 && process.argv[branchIdx + 1]
      ? process.argv[branchIdx + 1].trim()
      : null;

  let dir: string;
  if (workspaceId) {
    dir = await cloneToStablePath(repoUrl.trim(), workspaceId);
  } else {
    const cloneUrl = authUrl(repoUrl.trim());
    dir = path.join(tmpdir(), `arch-viz-${randomUUID()}`);
    fs.mkdirSync(dir, { recursive: true });
    await simpleGit().clone(cloneUrl, dir, ["--depth", "1"]);
  }

  try {
    const absoluteCloneDir = dir;
    const git = simpleGit(absoluteCloneDir);
    if (branch) {
      await git.fetch(["origin", branch]);
      await git.checkout(branch);
    }

    let graph = await scanProject(absoluteCloneDir);
    graph = detectDrift(graph);
    graph = await enrichGraph(graph);
    graph = analyseGraph(graph);

    // Normalize for JSON output:
    // - projectRoot: absolute path to the cloned repo (server uses this as rootPath)
    // - node.files: always relative to projectRoot to avoid double-joining
    const out = {
      ...graph,
      projectRoot: absoluteCloneDir,
      nodes: graph.nodes.map((n) => ({
        ...n,
        path: n.id,
        // Default archNodeId: normalized id (no leading ./), used to join logs/Jira ↔ graph.
        archNodeId: (n as any).archNodeId ?? n.id.replace(/^\.\//, ""),
        files: (n.files ?? []).map((f) =>
          path.isAbsolute(f) ? path.relative(absoluteCloneDir, f) : f
        ),
      })),
    };

    console.log(JSON.stringify(out));
  } finally {
    if (!workspaceId && !keepClone && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
