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
import { randomUUID, createHash } from "crypto";
import { scanProject } from "../src/analyzer/scanner";
import { detectDrift } from "../src/analyzer/driftDetector";
import { enrichGraph } from "../src/ai/enricher-v2";
import { analyseGraph } from "../src/analysis/graphAnalyser";
import { getClonesDir, authUrl, cloneToStablePath, refreshStableClone } from "../webapp/server/src/cloneRepo.js";
import { buildAgentInventory } from "./agent-inventory";

/**
 * Agents that share an identical tool list (e.g. several Retell handlers routing
 * through one executor) each carried their own full copy, which dominated the
 * payload. Store each distinct list once and reference it by hash.
 */
function packToolCatalogs(inv: any) {
  if (!inv || !Array.isArray(inv.agents)) return inv;
  const toolCatalogs: Record<string, unknown[]> = {};
  const agents = inv.agents.map((a: any) => {
    if (!Array.isArray(a.tools) || a.tools.length === 0) return a;
    const id = createHash("sha1").update(JSON.stringify(a.tools)).digest("hex").slice(0, 12);
    toolCatalogs[id] = a.tools;
    const { tools, ...rest } = a;
    return { ...rest, catalogId: id };
  });
  return { ...inv, agents, toolCatalogs };
}

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
  // A path that already exists on disk is scanned in place, not cloned.
  const localPath = repoUrl.trim();
  const isLocal =
    !localPath.match(/^https?:/i) &&
    fs.existsSync(localPath) &&
    fs.statSync(localPath).isDirectory();
  if (isLocal) {
    dir = path.resolve(localPath);
  } else if (workspaceId) {
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
    // GitHub-backed scans: always refresh tip so Rescan sees pushes (Payment, etc.).
    // Local working trees are scanned in place — never reset the user's files.
    if (!isLocal) {
      if (branch) {
        await git.fetch(["origin", branch, "--depth", "1"]);
        await git.checkout(branch);
        await git.reset(["--hard", `origin/${branch}`]);
      } else {
        await refreshStableClone(absoluteCloneDir);
      }
    }

    let graph = await scanProject(absoluteCloneDir);
    graph = detectDrift(graph);
    graph = await enrichGraph(graph);
    graph = analyseGraph(graph);

    const agents = packToolCatalogs(buildAgentInventory(absoluteCloneDir));

    // Normalize for JSON output:
    // - projectRoot: absolute path to the cloned repo (server uses this as rootPath)
    // - node.files: always relative to projectRoot to avoid double-joining
    const out = {
      ...graph,
      projectRoot: absoluteCloneDir,
      agents,
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

    // Write the full graph to a temp file — stdout cannot carry multi-MB inventory
    // payloads (ENOBUFS / maxBuffer). Parent reads the file and deletes it.
    const outPath = path.join(tmpdir(), `arch-scan-out-${randomUUID()}.json`);
    const json = JSON.stringify(out);
    fs.writeFileSync(outPath, json, "utf8");
    const bytes = Buffer.byteLength(json, "utf8");
    console.log(JSON.stringify({ ok: true, path: outPath, bytes }));
  } finally {
    // never delete a local path: dir is the user's own working tree, not a
    // temporary clone, and removing it would destroy their work
    if (!isLocal && !workspaceId && !keepClone && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
