/**
 * Dump trading-agent ArchNodes + subsystem proposals for SUBSYSTEM_CLASSIFICATION.md
 * Run: npx tsx scripts/dump-subsystem-nodes.ts
 */
import fs from "fs";
import path from "path";
import { scanProject } from "../src/analyzer/scanner.ts";
import { enrichGraph } from "../src/ai/enricher-v2.ts";
import { classifySubsystem } from "../src/analyzer/subsystemClassify.ts";
import { buildSystemModel } from "../webapp/server/src/systemModel.ts";

async function main() {
  const root =
    process.env.BLANKO_TARGET_ROOT?.trim() ||
    path.join(process.env.HOME || "", ".arch-viz/repos/21a6c9c0-4774-4a8c-9cac-128919b48170");
  console.log("scanning", root);
  let g = await scanProject(root);
  g = await enrichGraph(g);
  const sm = buildSystemModel(g);
  const rows = sm.nodes.map((n) => {
    const c = classifySubsystem(n);
    return {
      id: n.id,
      label: n.suggestedLabel ?? n.label,
      layer: n.layer,
      kind: n.kind,
      techKind: n.techKind,
      tags: n.tags,
      domain: n.domain,
      tier: n.tier,
      subsystem: n.subsystem ?? c.subsystem,
      confidence: c.confidence,
      reason: c.reason,
      files: (n.files ?? []).slice(0, 5),
    };
  });
  const outDir = path.join(process.cwd(), "docs/ops");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "_subsystem_nodes.json"), JSON.stringify(rows, null, 2));
  const by: Record<string, number> = {};
  for (const r of rows) by[r.subsystem] = (by[r.subsystem] || 0) + 1;
  console.log("nodes", rows.length, by);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
