/**
 * Quant cockpit: classify ArchNodes into functional subsystems + trading capability readiness.
 * Keep RULES in sync with src/analyzer/subsystemClassify.ts.
 */
import type { ArchGraph, ArchNode, NodeSubsystem, TradingBuildStatus } from "./types";

export const SUBSYSTEM_ORDER: NodeSubsystem[] = [
  "ingress",
  "strategy",
  "risk_execution",
  "data_obs",
  "unclassified",
];

export const SUBSYSTEM_LABELS: Record<NodeSubsystem, string> = {
  ingress: "Ingress & interface",
  strategy: "Strategy & reasoning",
  risk_execution: "Risk & execution",
  data_obs: "Data & observability",
  unclassified: "Unclassified",
};

export type SubsystemConfidence = "high" | "medium" | "low";

export type SubsystemClassification = {
  subsystem: NodeSubsystem;
  confidence: SubsystemConfidence;
  reason: string;
};

export type TradingCapabilityStatus = Extract<
  TradingBuildStatus,
  "built" | "paper" | "stub" | "missing"
>;

const VALID: Set<string> = new Set(SUBSYSTEM_ORDER);

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

export type TradingCapability = {
  id: string;
  label: string;
  subsystem: NodeSubsystem;
  filePatterns: string[];
  status: TradingCapabilityStatus;
};

/** Seed map aligned with trading-agent docs/trading/LAYER_STATUS.md + spine bindings. */
export const TRADING_CAPABILITIES: TradingCapability[] = [
  {
    id: "pead",
    label: "PEAD",
    subsystem: "strategy",
    filePatterns: ["services/strategy/pead", "pead.js"],
    status: "paper",
  },
  {
    id: "fda-shock",
    label: "FDA-shock",
    subsystem: "strategy",
    filePatterns: ["services/strategy/fda-supply", "fda-client"],
    status: "paper",
  },
  {
    id: "signal-engine",
    label: "Signal engine",
    subsystem: "strategy",
    filePatterns: ["signal-engine"],
    status: "paper",
  },
  {
    id: "policy",
    label: "Policy",
    subsystem: "risk_execution",
    filePatterns: ["services/policy/", "policy-engine"],
    status: "built",
  },
  {
    id: "risk",
    label: "Risk",
    subsystem: "risk_execution",
    filePatterns: ["services/risk/", "risk-engine"],
    status: "built",
  },
  {
    id: "paper-execution",
    label: "Paper execution",
    subsystem: "risk_execution",
    filePatterns: ["services/execution/", "paper-broker", "execution-service"],
    status: "paper",
  },
  {
    id: "alpaca-live",
    label: "Alpaca live",
    subsystem: "risk_execution",
    filePatterns: ["services/broker/alpaca", "AlpacaBroker"],
    status: "stub",
  },
  {
    id: "telegram-wallet",
    label: "Telegram wallet",
    subsystem: "ingress",
    filePatterns: ["telegram-paper", "paper-wallet", "wallet-service"],
    status: "paper",
  },
  {
    id: "trading-chat",
    label: "Trading chat API",
    subsystem: "ingress",
    filePatterns: ["trading-chat", "execute-turn"],
    status: "stub",
  },
  {
    id: "scheduler",
    label: "Scheduler",
    subsystem: "data_obs",
    filePatterns: ["scheduler"],
    status: "missing",
  },
  {
    id: "market-data",
    label: "Market data",
    subsystem: "data_obs",
    filePatterns: ["market-data"],
    status: "paper",
  },
  {
    id: "identity",
    label: "Identity",
    subsystem: "ingress",
    filePatterns: ["identity-service", "telegram-auth"],
    status: "built",
  },
];

export function capabilitiesForSubsystem(subsystem: NodeSubsystem): TradingCapability[] {
  return TRADING_CAPABILITIES.filter((c) => c.subsystem === subsystem);
}

export function summarizeSubsystemReadiness(subsystem: NodeSubsystem): string {
  const caps = capabilitiesForSubsystem(subsystem);
  if (caps.length === 0) return SUBSYSTEM_LABELS[subsystem];
  const parts = caps.slice(0, 4).map((c) => `${c.label} ${c.status}`);
  return `${SUBSYSTEM_LABELS[subsystem]} · ${parts.join(" · ")}`;
}

export const SEQUENCE_HOP_SUBSYSTEM: Record<string, NodeSubsystem> = {
  ingress: "ingress",
  strategy: "strategy",
  policy: "risk_execution",
  risk: "risk_execution",
  execution: "risk_execution",
  broker: "risk_execution",
  agent: "strategy",
};
