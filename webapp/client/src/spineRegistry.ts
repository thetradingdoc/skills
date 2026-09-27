/**
 * Generalizes "Apply spine" beyond trading-agent. Trading keeps its rich,
 * curated implementation (file bindings, provider auto-bind, agent LLM
 * roles) in tradingSpine.ts. Every other blueprint gets a real spine too —
 * fork the blueprint's own base graph and re-bind scan files onto it by
 * keyword match — instead of silently defaulting to the trading pipeline.
 */
import type { ArchGraph } from "./types";
import { applyTradingSpine, type ApplyTradingSpineOpts } from "./tradingSpine";
import { forkBlueprint, DESIGN_BLUEPRINTS } from "./designBlueprints";

/** Blueprints with a hand-curated, richly-bound spine implementation. */
const RICH_SPINE_BLUEPRINTS = new Set<string>(["trading-agent"]);

const STOPWORDS = new Set(["frontend", "backend", "service", "external"]);

function collectScanFiles(graph: ArchGraph | null | undefined): string[] {
  if (!graph?.nodes) return [];
  const out: string[] = [];
  for (const n of graph.nodes) {
    for (const f of n.files ?? []) {
      if (typeof f === "string" && f.trim()) out.push(f.split("\\").join("/"));
    }
  }
  return out;
}

function keywordsForNode(label: string, id: string): string[] {
  const words = `${label} ${id}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

function applyGenericSpine(blueprintId: string, opts: ApplyTradingSpineOpts): ArchGraph | null {
  const base = forkBlueprint(blueprintId);
  if (!base) return null;
  const from = opts.from ?? null;
  const scanFiles = collectScanFiles(from);

  const nodes = base.nodes.map((n) => {
    const keywords = keywordsForNode(n.label ?? "", n.id ?? "");
    const matched = scanFiles.filter((f) => {
      const lower = f.toLowerCase();
      return keywords.some((k) => lower.includes(k));
    });
    const files = matched.length ? [...new Set([...(n.files ?? []), ...matched])] : n.files;
    const buildStatus = matched.length ? "built" : (n.buildStatus ?? "planned");
    return { ...n, files, buildStatus };
  });

  return {
    ...base,
    nodes,
    edges: base.edges,
    generatedAt: Date.now(),
    projectRoot: from?.projectRoot?.trim() ? from.projectRoot : "",
    projectName: from?.projectName?.trim() || base.projectName,
    architectureBoard: true,
    blueprintId,
    scannedCommit: from?.scannedCommit,
    agents: from?.agents,
    providers: from?.providers,
    revision: typeof from?.revision === "number" ? from.revision : undefined,
  };
}

/**
 * Apply the locked architecture-board spine for a specific blueprint.
 * Trading uses its curated, file/provider-bound implementation; every
 * other blueprint gets a generic fork + keyword file-binding pass so
 * "Apply spine" reflects whichever architecture the workspace is actually
 * on, not always trading-agent.
 */
export function applySpine(blueprintId: string, opts: ApplyTradingSpineOpts = {}): ArchGraph | null {
  if (RICH_SPINE_BLUEPRINTS.has(blueprintId)) {
    return applyTradingSpine(opts);
  }
  return applyGenericSpine(blueprintId, opts);
}

export function blueprintExists(id: string): boolean {
  return DESIGN_BLUEPRINTS.some((b) => b.id === id);
}
