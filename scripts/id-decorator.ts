#!/usr/bin/env npx tsx
/**
 * id-decorator.ts
 *
 * Utility script to retrofit an existing repo with @archNodeId comments.
 *
 * It reads an ArchGraph JSON (from scan-repo or analyser output), then:
 * - walks all nodes
 * - for each file belonging to a node, ensures the file starts with:
 *     // @archNodeId: <archNodeId>
 *
 * Usage:
 *   # 1) Generate graph.json (or pipe from scan-repo)
 *   npx tsx scripts/scan-repo.ts <repo-url> --keep > graph.json
 *
 *   # 2) Run id-decorator against the cloned repo:
 *   npx tsx scripts/id-decorator.ts /path/to/cloned/repo graph.json
 */

import * as fs from "fs";
import * as path from "path";
import type { ArchGraph } from "../src/types";

function loadGraph(graphPath: string): ArchGraph {
  const raw = fs.readFileSync(graphPath, "utf8");
  const parsed = JSON.parse(raw) as ArchGraph;
  return parsed;
}

function ensureArchNodeIdComment(filePath: string, archNodeId: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
  const original = fs.readFileSync(filePath, "utf8");

  const lines = original.split(/\r?\n/);
  const header = `// @archNodeId: ${archNodeId}`;

  // If the first non-empty, non-shebang/comment line already has the header, do nothing.
  const existingHeaderIndex = lines.findIndex((l) =>
    l.trim().startsWith("// @archNodeId:")
  );
  if (existingHeaderIndex !== -1) {
    const existing = lines[existingHeaderIndex].trim();
    if (existing === header) {
      return; // Idempotent: header already matches
    }
    // Update mismatched header in-place.
    lines[existingHeaderIndex] = header;
    fs.writeFileSync(filePath, lines.join("\n"), "utf8");
    return;
  }

  // Insert header at the very top, keeping shebang line (e.g. #!/usr/bin/env node) if present.
  if (lines.length > 0 && lines[0].startsWith("#!")) {
    const shebang = lines[0];
    const rest = lines.slice(1);
    const updated = [shebang, header, ...rest];
    fs.writeFileSync(filePath, updated.join("\n"), "utf8");
  } else {
    const updated = [header, ...lines];
    fs.writeFileSync(filePath, updated.join("\n"), "utf8");
  }
}

async function main() {
  const repoRoot = process.argv[2];
  const graphPath = process.argv[3];

  if (!repoRoot || !graphPath) {
    console.error(
      "Usage: npx tsx scripts/id-decorator.ts <repo-root> <graph.json-from-scan-repo>"
    );
    process.exit(1);
  }

  const absRoot = path.resolve(repoRoot);
  const graph = loadGraph(graphPath);

  for (const node of graph.nodes) {
    const archNodeId = node.archNodeId || node.id.replace(/^\.\//, "");
    for (const rel of node.files ?? []) {
      const absFile = path.join(absRoot, rel);
      ensureArchNodeIdComment(absFile, archNodeId);
    }
  }

  console.log(
    `Decorated files in ${absRoot} with @archNodeId comments based on ${path.basename(
      graphPath
    )}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

