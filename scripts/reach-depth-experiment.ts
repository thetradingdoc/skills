/**
 * Depth experiment: compare reach cells at maxDepth 3, 5, 7.
 * Usage: npx tsx scripts/reach-depth-experiment.ts <repo-path>
 */
import * as fs from "fs";
import * as path from "path";
import { buildAgentInventory } from "./agent-inventory";
import {
  clearDatabaseCache,
  loadClassifyConfig,
  scrubExtractionNoise,
  traceToolHandler,
  writeClassifyConfig,
  RESOURCE_CLASSES,
  type ResourceClass,
  type ClassifyConfig,
} from "./resource-trace";

type CellKey = string;

function traceAll(
  repoRoot: string,
  agents: ReturnType<typeof buildAgentInventory>["agents"],
  maxDepth: number,
  cfg: ClassifyConfig
) {
  clearDatabaseCache();
  const t0 = Date.now();
  const reaches = new Set<CellKey>();
  const notTraced = new Set<CellKey>();
  const none = new Set<CellKey>();
  const reasons = new Map<string, number>();

  for (const a of agents.filter((x) => x.kind === "agent")) {
    for (const t of a.tools) {
      if (t.name === "(hosted)") continue;
      const reach = traceToolHandler(repoRoot, t.handler, t.name, cfg, maxDepth);
      for (const reason of reach.truncationReasons) {
        const kind = reason.split(":")[0] || reason.slice(0, 40);
        reasons.set(kind, (reasons.get(kind) || 0) + 1);
      }
      for (const cls of RESOURCE_CLASSES) {
        const key = `${a.file}|${t.name}|${cls}`;
        const cell = reach.cells[cls as ResourceClass];
        if (cell.state === "reaches") reaches.add(key);
        else if (cell.state === "not-traced") notTraced.add(key);
        else none.add(key);
      }
    }
  }
  return {
    reaches,
    notTraced,
    none,
    ms: Date.now() - t0,
    reasons: Object.fromEntries(reasons),
  };
}

function main() {
  const repo = process.argv[2];
  if (!repo || !fs.existsSync(repo)) {
    console.error("Usage: npx tsx scripts/reach-depth-experiment.ts <repo-path>");
    process.exit(1);
  }
  const root = path.resolve(repo);
  console.error("building inventory (handlers only pass)…");
  // One inventory build to discover surfaces+handlers; we'll re-trace at each depth.
  const inv = buildAgentInventory(root);
  const agents = inv.agents;

  const depths = [3, 5, 7] as const;
  const results: Record<number, ReturnType<typeof traceAll>> = {};
  for (const d of depths) {
    console.error(`re-tracing depth=${d}…`);
    const cfg = loadClassifyConfig(root);
    // Fresh guesses each run so counts are comparable
    cfg.guesses = {};
    cfg.unclassified = [];
    results[d] = traceAll(root, agents, d, cfg);
    if (d === 5) {
      scrubExtractionNoise(cfg);
      writeClassifyConfig(root, cfg);
    }
  }

  const at3 = results[3]!;
  const report = {
    depths: {} as Record<string, unknown>,
    kellyQueryPatientRecords: {} as Record<string, unknown>,
    recommendation: {
      defaultDepth: 5,
      why: "Depth 5 recovers hub (database.js cache) + QueryPlanner-style one-hop service paths that depth 3 still marks not-traced, with less cost than 7.",
    },
  };

  for (const d of depths) {
    const r = results[d]!;
    report.depths[d] = {
      reaches: r.reaches.size,
      none: r.none.size,
      notTraced: r.notTraced.size,
      ms: r.ms,
      newlyReachesVsDepth3: [...r.reaches].filter((k) => at3.notTraced.has(k)).length,
      truncationReasons: r.reasons,
    };
  }

  // Spot-check query_patient_records
  const kelly = agents.find((a) => a.file.includes("kelly-agent"));
  if (kelly) {
    for (const d of depths) {
      const cfg = loadClassifyConfig(root);
      clearDatabaseCache();
      const tool = kelly.tools.find((t) => t.name === "query_patient_records");
      if (!tool) continue;
      const reach = traceToolHandler(root, tool.handler, tool.name, cfg, d);
      report.kellyQueryPatientRecords[d] = {
        patient: reach.cells.patient.state,
        depth: reach.cells.patient.depth,
        path: reach.cells.patient.path,
        reason: reach.cells.patient.reason,
        resourceSample: reach.resources.slice(0, 5).map((r) => `${r.kind}:${r.name}`),
      };
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
