/**
 * Trading-agent architecture board: locked spine from the plan.
 * Scan graphs never invent these boxes — Apply spine / fork does.
 */
import type { ArchGraph, ArchNode } from "./types";
import { forkBlueprint } from "./designBlueprints";
import { TRADING_PIPELINE_SEED } from "./flowTradingSeed";

/** File path substrings (posix) bound onto spine node ids. */
export const SPINE_FILE_BINDINGS: Record<string, string[]> = {
  "bp-ta-telegram": ["telegram-bot.js", "telegram-paper-commands.js"],
  "bp-ta-identity": ["telegram-auth.js", "caller.js", "identity-service.js", "005_identity"],
  "bp-ta-payment": [
    "paper-wallet-writer.js",
    "telegram-paper-commands.js",
    "011_paper_wallets",
    "wallet-service.js",
  ],
  "bp-ta-agent": ["llm-router.js", "execute-turn.js", "trading-tool-executor.js", "propose-only-guard"],
  "bp-ta-strategy": ["services/strategy/", "signal-engine.js", "fda-client.js"],
  "bp-ta-policy": ["services/policy/", "policy-engine.js", "010_policy_trace"],
  "bp-ta-risk": ["services/risk/", "risk-engine.js"],
  "bp-ta-execution": ["services/execution/", "execution-service.js", "reconcile.js"],
  "bp-ta-alpaca": ["services/broker/alpaca", "paper-broker.js", "broker/"],
  "bp-ta-kraken": ["kraken"],
  "bp-ta-mobile": ["unified-dashboard", "mobile"],
};

/** Task sourcePath → spine node id for buildStatus. */
export const SPINE_TASK_NODE: Record<string, string> = {
  "trading-spine:p1-payment": "bp-ta-payment",
  "trading-spine:p2-broker": "bp-ta-alpaca",
  "trading-spine:p3-policy-risk": "bp-ta-policy",
  "trading-spine:p4-data": "bp-ta-strategy",
  "trading-spine:p5-strategy": "bp-ta-strategy",
  "trading-spine:p6-agent": "bp-ta-agent",
  "trading-spine:p7-execution": "bp-ta-execution",
  "trading-spine:p8-eval": "bp-ta-agent",
};

const BUILT_IF_ANY_FILE: Record<string, string[]> = {
  "bp-ta-payment": ["paper-wallet-writer.js", "011_paper_wallets"],
  "bp-ta-identity": ["telegram-auth.js"],
  "bp-ta-telegram": ["telegram-bot.js"],
  "bp-ta-policy": ["policy-engine.js", "services/policy/"],
  "bp-ta-risk": ["risk-engine.js", "services/risk/"],
  "bp-ta-execution": ["execution-service.js", "services/execution/"],
  "bp-ta-alpaca": ["paper-broker.js", "services/broker/"],
  "bp-ta-strategy": ["services/strategy/", "pead.js"],
  "bp-ta-agent": ["propose-only-guard.js", "llm-router.js"],
};

export function looksLikeTradingScan(graph: ArchGraph | null | undefined): boolean {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return false;
  const blob = [
    graph.projectName ?? "",
    graph.projectRoot ?? "",
    ...graph.nodes.map((n) => `${n.label ?? ""} ${n.id ?? ""} ${(n.files ?? []).join(" ")}`),
  ]
    .join(" ")
    .toLowerCase();
  const hits = [
    "trading-agent",
    "middleware-platform",
    "trading chat",
    "investment agent",
    "tradingbot",
    "paper_orders",
    "telegram-bot",
  ].filter((h) => blob.includes(h));
  return hits.length >= 1;
}

export function spineMissing(graph: ArchGraph | null | undefined): boolean {
  if (!graph?.nodes?.length) return true;
  const labels = graph.nodes.map((n) => (n.label ?? "").toLowerCase());
  const need = ["payment", "policy", "risk", "execution"];
  return need.some((k) => !labels.some((l) => l.includes(k)));
}

function collectScanFiles(graph: ArchGraph | null | undefined): string[] {
  if (!graph?.nodes) return [];
  const out: string[] = [];
  for (const n of graph.nodes) {
    for (const f of n.files ?? []) {
      if (typeof f === "string" && f.trim()) out.push(f.replace(/\\/g, "/"));
    }
  }
  return out;
}

function bindFiles(node: ArchNode, scanFiles: string[]): ArchNode {
  const patterns = SPINE_FILE_BINDINGS[node.id] ?? [];
  if (patterns.length === 0 || scanFiles.length === 0) return node;
  const matched = scanFiles.filter((f) =>
    patterns.some((p) => f.toLowerCase().includes(p.toLowerCase()))
  );
  if (matched.length === 0) return node;
  const uniq = [...new Set([...(node.files ?? []), ...matched])];
  return { ...node, files: uniq };
}

function inferBuildStatus(node: ArchNode, scanFiles: string[]): "planned" | "building" | "built" {
  const patterns = BUILT_IF_ANY_FILE[node.id];
  if (!patterns) return (node.buildStatus as "planned" | "building" | "built") ?? "planned";
  const hit = scanFiles.some((f) =>
    patterns.some((p) => f.toLowerCase().includes(p.toLowerCase()))
  );
  if (hit) return "built";
  return "planned";
}

export type ApplyTradingSpineOpts = {
  /** Existing workspace graph (often a scan). Files + projectRoot preserved when present. */
  from?: ArchGraph | null;
  /** Mark Payment-first pipeline nodes built when code is present. */
  inferBuilt?: boolean;
};

/**
 * Returns the locked trading spine as an architecture board.
 * Keeps projectRoot from `from` so Rescan still works; sets architectureBoard.
 */
export function applyTradingSpine(opts: ApplyTradingSpineOpts = {}): ArchGraph | null {
  const base = forkBlueprint("trading-agent");
  if (!base) return null;
  const from = opts.from ?? null;
  const scanFiles = collectScanFiles(from);
  const inferBuilt = opts.inferBuilt !== false;

  const nodes = base.nodes.map((n) => {
    let next = bindFiles(n, scanFiles);
    if (inferBuilt) {
      next = { ...next, buildStatus: inferBuildStatus(next, scanFiles) };
    } else if (!next.buildStatus) {
      next = { ...next, buildStatus: "planned" };
    }
    return next;
  });

  // Policy + Risk share task p3 — if policy built, mark risk built when risk files exist.
  const policy = nodes.find((n) => n.id === "bp-ta-policy");
  const risk = nodes.find((n) => n.id === "bp-ta-risk");
  if (policy?.buildStatus === "built" && risk) {
    const riskBuilt = inferBuildStatus(risk, scanFiles);
    if (riskBuilt === "built") risk.buildStatus = "built";
  }

  return {
    ...base,
    nodes,
    edges: base.edges,
    generatedAt: Date.now(),
    projectRoot: from?.projectRoot?.trim() ? from.projectRoot : "",
    projectName: from?.projectName?.trim() || base.projectName || "Trading agent",
    architectureBoard: true,
    scannedCommit: from?.scannedCommit,
    agents: from?.agents,
    revision: typeof from?.revision === "number" ? from.revision : undefined,
  };
}

export function tradingSpineSeedTitles(): string[] {
  return TRADING_PIPELINE_SEED.map((c) => c.title);
}
