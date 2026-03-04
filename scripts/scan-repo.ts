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

/** Inject token into HTTPS GitHub URL for private repo access. */
function authUrl(url: string): string {
  const trimmed = url.trim();
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN;
  if (!token) return trimmed;
  // https://github.com/owner/repo or https://github.com/owner/repo.git
  const match = trimmed.match(/^(https?:\/\/)(github\.com\/[\w.-]+\/[\w.-]+?)(\.git)?\/?$/i);
  if (!match) return trimmed;
  const [, scheme, repoPath] = match;
  return `${scheme}${token}@${repoPath}`;
}

async function main() {
  const repoUrl = process.argv[2];
  if (!repoUrl) {
    console.error("Usage: npx tsx scripts/scan-repo.ts <repo-url>");
    process.exit(1);
  }

  const keepClone = process.argv.includes("--keep");

  const dir = path.join(tmpdir(), `arch-viz-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });

  const cloneUrl = authUrl(repoUrl);

  try {
    const git = simpleGit();
    await git.clone(cloneUrl, dir, ["--depth", "1"]);

    const absoluteCloneDir = dir;

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
    if (!keepClone && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
