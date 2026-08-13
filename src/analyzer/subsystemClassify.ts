/**
 * Core subsystem classification (host/scanner). Client mirror adds capability readiness UI helpers.
 */
import type { ArchNode, ArchGraph, NodeSubsystem } from "../types";

export type SubsystemConfidence = "high" | "medium" | "low";

export type SubsystemClassification = {
  subsystem: NodeSubsystem;
  confidence: SubsystemConfidence;
  reason: string;
};

const VALID: Set<string> = new Set([
  "ingress",
  "strategy",
  "risk_execution",
  "data_obs",
  "unclassified",
]);

const RULES: Array<{ subsystem: NodeSubsystem; patterns: string[]; confidence: SubsystemConfidence }> = [
  {
    subsystem: "strategy",
    patterns: [
      "services/strategy/",
      "/strategy/",
      "pead",
      "fda-supply",
      "fda-client",
      "signal-engine",
      "investment-agent",
      "generate_signal",
      "fda-shock",
    ],
    confidence: "high",
  },
  {
    subsystem: "risk_execution",
    patterns: [
      "services/policy/",
      "services/risk/",
      "services/execution/",
      "services/broker/",
      "policy-engine",
      "risk-engine",
      "execution-service",
      "paper-broker",
      "paper-wallet",
      "wallet-service",
      "reconcile",
      "alpaca",
      "kraken",
      "propose-only-guard",
    ],
    confidence: "high",
  },
  {
    subsystem: "ingress",
    patterns: [
      "telegram-bot",
      "telegram-auth",
      "telegram-paper",
      "trading-chat",
      "trading/chat",
      "unified-dashboard",
      "identity-service",
      "execute-turn",
      "/routes/",
      "caller.js",
      "middleware-platform/routes",
    ],
    confidence: "high",
  },
  {
    subsystem: "data_obs",
    patterns: [
      "market-data",
      "pinecone",
      "vector-",
      "embedding",
      "langsmith",
      "metrics-service",
      "metrics.js",
      "observability",
      "scheduler",
      "secure-logger",
      "logger.js",
      "knowledge-ingest",
      "text-chunking",
      "trade-reporting",
    ],
    confidence: "high",
  },
  {
    subsystem: "strategy",
    patterns: ["llm-router", "trading-tool-executor", "trading-turn-resolver", "trading-rails"],
    confidence: "medium",
  },
  {
    subsystem: "ingress",
    patterns: ["middleware/", "server.js"],
    confidence: "low",
  },
];

export function parseSubsystemOverride(raw: string | undefined | null): NodeSubsystem | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, NodeSubsystem> = {
    ingress: "ingress",
    interface: "ingress",
    strategy: "strategy",
    reasoning: "strategy",
    risk_execution: "risk_execution",
    risk: "risk_execution",
    execution: "risk_execution",
    data_obs: "data_obs",
    data: "data_obs",
    observability: "data_obs",
    unclassified: "unclassified",
  };
  return aliases[v] ?? (VALID.has(v) ? (v as NodeSubsystem) : undefined);
}

function blobFor(node: Pick<ArchNode, "id" | "path" | "label" | "suggestedLabel" | "files" | "tags">): string {
  return [
    node.id ?? "",
    node.path ?? "",
    node.label ?? "",
    node.suggestedLabel ?? "",
    ...(node.files ?? []),
    ...(node.tags ?? []).map(String),
  ]
    .join(" ")
    .replace(/\\/g, "/")
    .toLowerCase();
}

export function classifySubsystem(
  node: Pick<ArchNode, "id" | "path" | "label" | "suggestedLabel" | "files" | "tags" | "subsystem">,
  opts?: { contextSubsystem?: string | null }
): SubsystemClassification {
  const fromContext = parseSubsystemOverride(opts?.contextSubsystem ?? null);
  if (fromContext) {
    return { subsystem: fromContext, confidence: "high", reason: "context.md subsystem override" };
  }
  if (node.subsystem && VALID.has(node.subsystem)) {
    return { subsystem: node.subsystem, confidence: "high", reason: "existing node.subsystem" };
  }

  const blob = blobFor(node);
  const scores = new Map<NodeSubsystem, { score: number; confidence: SubsystemConfidence; hit: string }>();
  for (const rule of RULES) {
    for (const p of rule.patterns) {
      if (!blob.includes(p.toLowerCase())) continue;
      const weight = rule.confidence === "high" ? 3 : rule.confidence === "medium" ? 2 : 1;
      const prev = scores.get(rule.subsystem);
      if (!prev || weight > prev.score) {
        scores.set(rule.subsystem, { score: (prev?.score ?? 0) + weight, confidence: rule.confidence, hit: p });
      } else {
        scores.set(rule.subsystem, { ...prev, score: prev.score + weight });
      }
    }
  }
  if (scores.size === 0) {
    return { subsystem: "unclassified", confidence: "low", reason: "no rule matched" };
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const [topSub, topMeta] = ranked[0];
  // Mega-modules (e.g. services/) often hit multiple subsystems — prefer unclassified when close tie across 3+
  if (ranked.length >= 3 && ranked[1][1].score >= topMeta.score * 0.6) {
    return {
      subsystem: "unclassified",
      confidence: "low",
      reason: `multi-subsystem mega-module (top: ${ranked
        .slice(0, 3)
        .map(([s, m]) => `${s}:${m.score}`)
        .join(", ")})`,
    };
  }
  return {
    subsystem: topSub,
    confidence: topMeta.confidence,
    reason: `matched "${topMeta.hit}" (score ${topMeta.score})`,
  };
}

export function applySubsystemsToGraph(graph: ArchGraph): ArchGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const { subsystem } = classifySubsystem(n);
      return { ...n, subsystem };
    }),
  };
}
