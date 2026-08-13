/**
 * P1 assisted design loop — workstream B: pure rule engine.
 *
 * Pure module: no network calls, no React, no DOM. Evaluates a design
 * ArchGraph against a fixed set of architecture heuristics and returns
 * plain-language findings a non-expert can act on. Some findings include a
 * one-click `fix` expressed as GraphCommand[] (create_node / connect only —
 * GraphCommand has no delete action, so fixes are additive).
 */

import type {
  ArchEdge,
  ArchGraph,
  ArchNode,
  EdgeRelation,
  GraphCommand,
  NodeLayer,
} from "./types";
import {
  type Severity,
  fromDesignFindingSeverity,
  toBadgeChromeSeverity,
} from "./severity";

// ── Public types ──────────────────────────────────────────────────────────

/** @deprecated Prefer Severity from severity.ts — mapped via fromDesignFindingSeverity. */
export type DesignFindingSeverity = "blocker" | "risk" | "suggestion";

export interface DesignFinding {
  id: string;
  ruleId: string;
  /** Legacy chrome severity; prefer `sharedSeverity`. */
  severity: DesignFindingSeverity;
  /** Shared Blanko severity (D3). */
  sharedSeverity: Severity;
  title: string;
  /** Plain language explanation for non-experts: why this matters. */
  whyItMatters: string;
  nodeIds: string[];
  edgeIds: string[];
  /** Optional one-click fix. Additive only (create_node / connect). */
  fix?: GraphCommand[];
  /** Remediation class: spine = Apply spine; code = Fix with agent / auto-enqueue. */
  remediation?: "spine" | "code" | "chat";
}

function finding(
  partial: Omit<DesignFinding, "sharedSeverity" | "remediation"> & {
    remediation?: DesignFinding["remediation"];
  }
): DesignFinding {
  return {
    ...partial,
    sharedSeverity: fromDesignFindingSeverity(partial.severity),
    remediation: partial.remediation ?? (partial.severity === "blocker" ? "code" : "chat"),
  };
}

type DraftFinding = Omit<DesignFinding, "sharedSeverity" | "remediation"> & {
  remediation?: DesignFinding["remediation"];
};

export const RULE_IDS = [
  "client_to_db",
  "api_no_auth",
  "orphan_node",
  "layer_inversion",
  "single_external_no_fallback",
  "writes_no_queue",
  "no_observability",
  "no_config_secrets",
  "llm_to_broker",
  "missing_trading_spine",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

// ── Heuristic helpers ─────────────────────────────────────────────────────

function labelOf(node: ArchNode): string {
  return `${node.label ?? ""} ${node.role ?? ""} ${node.description ?? ""}`.toLowerCase();
}

function layerOf(node: ArchNode): string {
  return String(node.layer ?? "").toLowerCase();
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/** Frontend / client / web UI presentation node (the "browser" side, not an API). */
function isFrontendNode(node: ArchNode): boolean {
  const layer = layerOf(node);
  const label = labelOf(node);
  if (node.techKind === "web-ui" || node.techKind === "mobile-app") return true;
  if (layer !== "presentation") return false;
  if (includesAny(label, ["api", "gateway", "http-api", "endpoint"])) return false;
  return includesAny(label, ["frontend", "client", "web-ui", "web ui", "ui", "app", "browser"]);
}

/** API / gateway / http-api presentation node (public-facing surface). */
function isApiNode(node: ArchNode): boolean {
  const layer = layerOf(node);
  const label = labelOf(node);
  if (node.techKind === "http-api") return true;
  if (layer !== "presentation") return false;
  return includesAny(label, ["api", "gateway", "http-api", "endpoint", "backend"]);
}

/** Primary datastore: Data Access layer, or labeled database/postgres/mongo, or db techKind. */
function isDatastoreNode(node: ArchNode): boolean {
  const layer = layerOf(node);
  const label = labelOf(node);
  if (node.techKind === "database") return true;
  if (layer === "data access") return true;
  return includesAny(label, ["database", "postgres", "mongo", "mysql", "dynamo", "sql", " db", "db "]) || label === "db";
}

function isQueueOrWorkerNode(node: ArchNode): boolean {
  const label = labelOf(node);
  if (node.techKind === "queue" || node.techKind === "message-bus") return true;
  return includesAny(label, ["queue", "worker", "job", "kafka", "sqs", "rabbitmq", "pubsub", "pub/sub", "background"]);
}

function isAuthNode(node: ArchNode): boolean {
  const layer = layerOf(node);
  const label = labelOf(node);
  if (layer === "safety") return true;
  return includesAny(label, ["auth", "identity", "iam", "oidc", "oauth"]);
}

function isExternalServiceNode(node: ArchNode): boolean {
  const layer = layerOf(node);
  if (node.techKind === "external-saas") return true;
  return layer === "external services";
}

function isConfigurationNode(node: ArchNode): boolean {
  const layer = layerOf(node);
  const label = labelOf(node);
  if (layer === "configuration") return true;
  return includesAny(label, ["config", "secret", "vault", "env"]);
}

function isObservabilityNode(node: ArchNode): boolean {
  const label = labelOf(node);
  return includesAny(label, ["observability", "logging", "log", "metrics", "tracing", "trace", "monitor", "telemetry"]);
}

function isDataAccessOrDatastoreInfra(node: ArchNode): boolean {
  const layer = layerOf(node);
  if (isDatastoreNode(node)) return true;
  if (layer === "infrastructure") {
    const label = labelOf(node);
    return includesAny(label, ["datastore", "storage", "database"]);
  }
  return false;
}

function isPresentationNode(node: ArchNode): boolean {
  return layerOf(node) === "presentation";
}

function nodeById(graph: ArchGraph, id: string): ArchNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

function edgesFrom(graph: ArchGraph, nodeId: string): ArchEdge[] {
  return graph.edges.filter((e) => e.source === nodeId);
}

function edgesTo(graph: ArchGraph, nodeId: string): ArchEdge[] {
  return graph.edges.filter((e) => e.target === nodeId);
}

function isWriteRelation(relation: EdgeRelation | undefined): boolean {
  return relation === "writes";
}

// ── Fix builders ──────────────────────────────────────────────────────────

function makeCreateNode(
  id: string,
  label: string,
  layer: NodeLayer | string,
  description: string
): GraphCommand {
  return { action: "create_node", id, label, layer, description };
}

function makeConnect(fromId: string, toId: string, relation: EdgeRelation): GraphCommand {
  return { action: "connect", fromId, toId, relation };
}

// ── Rules ─────────────────────────────────────────────────────────────────

function ruleClientToDb(graph: ArchGraph): DraftFinding[] {
  const findings: DesignFinding[] = [];
  for (const edge of graph.edges) {
    const source = nodeById(graph, edge.source);
    const target = nodeById(graph, edge.target);
    if (!source || !target) continue;
    if (!isFrontendNode(source) || !isDatastoreNode(target)) continue;

    const apiId = `fix-api-for-${source.id}`;
    const apiExists = graph.nodes.some((n) => n.id === apiId);
    const fix: GraphCommand[] = [];
    if (!apiExists) {
      fix.push(
        makeCreateNode(apiId, "API Gateway", "Presentation", "Auto-added API layer between frontend and database.")
      );
    }
    fix.push(makeConnect(source.id, apiId, "calls"));
    fix.push(makeConnect(apiId, target.id, "reads"));

    findings.push({
      id: `client_to_db-${edge.id}`,
      ruleId: "client_to_db",
      severity: "blocker",
      title: "Frontend talks directly to the database",
      whyItMatters:
        "Your frontend runs in users' browsers, so if it can query the database directly, anyone can too — there's no place to check permissions, validate input, or hide credentials. Add an API in between, then remove this direct connection.",
      nodeIds: [source.id, target.id],
      edgeIds: [edge.id],
      fix,
    });
  }
  return findings;
}

function ruleApiNoAuth(graph: ArchGraph): DraftFinding[] {
  const findings: DesignFinding[] = [];
  const apiNodes = graph.nodes.filter(isApiNode);
  for (const api of apiNodes) {
    const connected = [...edgesFrom(graph, api.id), ...edgesTo(graph, api.id)];
    const hasAuthEdge = connected.some((e) => {
      if (e.relation !== "authenticates_via") return false;
      const other = nodeById(graph, e.source === api.id ? e.target : e.source);
      return other ? isAuthNode(other) : false;
    });
    if (hasAuthEdge) continue;

    const authId = `fix-auth-for-${api.id}`;
    const authExists = graph.nodes.some((n) => n.id === authId || isAuthNode(n));
    const existingAuth = graph.nodes.find(isAuthNode);
    const fix: GraphCommand[] = [];
    if (existingAuth) {
      fix.push(makeConnect(api.id, existingAuth.id, "authenticates_via"));
    } else if (!authExists) {
      fix.push(makeCreateNode(authId, "Auth", "Safety", "Auto-added authentication for a public-facing API."));
      fix.push(makeConnect(api.id, authId, "authenticates_via"));
    }

    findings.push({
      id: `api_no_auth-${api.id}`,
      ruleId: "api_no_auth",
      severity: "blocker",
      title: `"${api.label}" has no authentication`,
      whyItMatters:
        "This is a public-facing API with no authentication step. Without it, anyone on the internet can call it — there's no way to know who's making the request or block bad actors.",
      nodeIds: [api.id],
      edgeIds: [],
      fix: fix.length > 0 ? fix : undefined,
    });
  }
  return findings;
}

function ruleOrphanNode(graph: ArchGraph): DraftFinding[] {
  const findings: DesignFinding[] = [];
  for (const node of graph.nodes) {
    const hasEdge = graph.edges.some((e) => e.source === node.id || e.target === node.id);
    if (hasEdge) continue;
    findings.push({
      id: `orphan_node-${node.id}`,
      ruleId: "orphan_node",
      severity: "suggestion",
      title: `"${node.label}" isn't connected to anything`,
      whyItMatters:
        "This component doesn't send or receive anything from the rest of the system. Either connect it to show how it's used, or remove it if it's not part of the design yet.",
      nodeIds: [node.id],
      edgeIds: [],
    });
  }
  return findings;
}

function ruleLayerInversion(graph: ArchGraph): DraftFinding[] {
  const findings: DesignFinding[] = [];
  for (const edge of graph.edges) {
    const source = nodeById(graph, edge.source);
    const target = nodeById(graph, edge.target);
    if (!source || !target) continue;
    if (!isDataAccessOrDatastoreInfra(source) || !isPresentationNode(target)) continue;

    findings.push({
      id: `layer_inversion-${edge.id}`,
      ruleId: "layer_inversion",
      severity: "risk",
      title: "A data layer reaches back into the UI",
      whyItMatters:
        "Data flows the wrong way here: your data layer is pushing directly into the presentation layer. This usually means layers are tangled together, making the system harder to change safely later.",
      nodeIds: [source.id, target.id],
      edgeIds: [edge.id],
    });
  }
  return findings;
}

function ruleSingleExternalNoFallback(graph: ArchGraph): DraftFinding[] {
  const findings: DesignFinding[] = [];
  const externals = graph.nodes.filter(isExternalServiceNode);
  if (externals.length !== 1) return findings;
  const external = externals[0]!;
  const hasQueue = graph.nodes.some(isQueueOrWorkerNode);
  if (hasQueue) return findings;

  findings.push({
    id: `single_external_no_fallback-${external.id}`,
    ruleId: "single_external_no_fallback",
    severity: "risk",
    title: `"${external.label}" is a single point of failure`,
    whyItMatters:
      "This is your only external service and there's no queue or buffer in front of it. If it goes down or slows down, requests that depend on it will fail immediately with no way to retry later.",
    nodeIds: [external.id],
    edgeIds: [],
  });
  return findings;
}

function ruleWritesNoQueue(graph: ArchGraph): DraftFinding[] {
  const findings: DesignFinding[] = [];
  const hasQueue = graph.nodes.some(isQueueOrWorkerNode);
  if (hasQueue) return findings;

  for (const edge of graph.edges) {
    if (!isWriteRelation(edge.relation)) continue;
    const target = nodeById(graph, edge.target);
    const source = nodeById(graph, edge.source);
    if (!target || !source || !isDatastoreNode(target)) continue;

    const queueId = `fix-queue-for-${edge.id}`;
    const fix: GraphCommand[] = [
      makeCreateNode(queueId, "Queue", "Infrastructure", "Auto-added queue to buffer writes to the datastore."),
      makeConnect(source.id, queueId, "publishes"),
      makeConnect(queueId, target.id, "writes"),
    ];

    findings.push({
      id: `writes_no_queue-${edge.id}`,
      ruleId: "writes_no_queue",
      severity: "risk",
      title: "Writes go straight to the database with no queue",
      whyItMatters:
        "Writes happen directly to the datastore with nothing to smooth out spikes. A queue in front of writes protects your database from bursts of traffic and gives you retries if a write fails.",
      nodeIds: [source.id, target.id],
      edgeIds: [edge.id],
      fix,
    });
  }
  return findings;
}

function ruleNoObservability(graph: ArchGraph): DraftFinding[] {
  if (graph.nodes.length < 5) return [];
  const hasObservability = graph.nodes.some(isObservabilityNode);
  if (hasObservability) return [];

  return [
    {
      id: "no_observability-graph",
      ruleId: "no_observability",
      severity: "suggestion",
      title: "No logging, metrics, or tracing in this design",
      whyItMatters:
        "Your system is getting big enough that when something breaks, you'll want to know where and why. Without logging, metrics, or tracing, you're flying blind when debugging production issues.",
      nodeIds: [],
      edgeIds: [],
    },
  ];
}

function ruleNoConfigSecrets(graph: ArchGraph): DraftFinding[] {
  const needsConfig = graph.nodes.some(
    (n) => isAuthNode(n) || isExternalServiceNode(n) || isDatastoreNode(n)
  );
  if (!needsConfig) return [];
  const hasConfig = graph.nodes.some(isConfigurationNode);
  if (hasConfig) return [];

  const configId = "fix-config-for-graph";
  return [
    {
      id: "no_config_secrets-graph",
      ruleId: "no_config_secrets",
      severity: "suggestion",
      title: "No configuration / secrets layer",
      whyItMatters:
        "You have auth, external services, or a database, but nothing modeling where their credentials and settings live. Adding a Configuration layer makes it explicit where secrets are managed instead of hard-coded.",
      nodeIds: [],
      edgeIds: [],
      fix: [
        makeCreateNode(
          configId,
          "Configuration",
          "Configuration",
          "Auto-added configuration/secrets layer."
        ),
      ],
    },
  ];
}

function ruleLlmToBroker(graph: ArchGraph): DraftFinding[] {
  const isAgentish = (n: ArchNode) =>
    includesAny(labelOf(n), ["agent", "llm", "claude", "gpt", "model"]);
  const isBrokerish = (n: ArchNode) =>
    includesAny(labelOf(n), ["alpaca", "kraken", "broker", "brokerage"]);
  const findings: DesignFinding[] = [];
  for (const e of graph.edges) {
    const src = graph.nodes.find((n) => n.id === e.source);
    const tgt = graph.nodes.find((n) => n.id === e.target);
    if (!src || !tgt) continue;
    if (isAgentish(src) && isBrokerish(tgt) && (e.relation === "calls" || e.relation === "uses")) {
      findings.push({
        id: `llm_to_broker:${e.id}`,
        ruleId: "llm_to_broker",
        severity: "blocker",
        title: "Agent/LLM must not call the broker directly",
        whyItMatters:
          "Money moves must go Agent → Strategy → Policy → Risk → Execution → Broker. A direct LLM→broker edge means the model can effectively decide to send orders.",
        nodeIds: [src.id, tgt.id],
        edgeIds: [e.id],
      });
    }
  }
  return findings;
}

const TRADING_SPINE_KEYWORDS = ["payment", "policy", "risk", "execution"] as const;
const MISSING_SPINE_NODE_CAP = 12;

function nodeBlob(node: ArchNode): string {
  return `${node.label ?? ""} ${node.id ?? ""} ${(node.files ?? []).join(" ")}`.toLowerCase();
}

/** Human ingress: Telegram / Trading Chat / execute-turn, or Presentation that looks like chat UI. */
function looksLikeTradingIngress(node: ArchNode): boolean {
  const blob = nodeBlob(node);
  if (/telegram|trading.?chat|execute-turn|investment.?agent/.test(blob)) return true;
  if (isPresentationNode(node) && includesAny(blob, ["chat", "bot", "ingress", "ui", "dashboard"])) {
    return true;
  }
  return false;
}

function looksLikeMiddlewareShell(node: ArchNode): boolean {
  const id = (node.id ?? "").replace(/\\/g, "/").toLowerCase();
  const blob = nodeBlob(node);
  if (id === "middleware-platform" || id.endsWith("/middleware-platform")) return true;
  return includesAny(blob, ["middleware-platform", "middleware platform"]);
}

/** Scan modules that should hang off the spine (or already name a spine role). */
function looksLikeSpineRelatedModule(node: ArchNode, missingKeywords: string[]): boolean {
  const blob = nodeBlob(node);
  if (missingKeywords.some((k) => blob.includes(k))) return true;
  return includesAny(blob, [
    "payment",
    "policy",
    "risk",
    "execution",
    "identity",
    "wallet",
    "broker",
    "alpaca",
    "kraken",
    "strategy",
    "paper_orders",
    "paper-orders",
  ]);
}

function looksLikeTradingScanRelated(node: ArchNode): boolean {
  return (
    looksLikeTradingIngress(node) ||
    looksLikeMiddlewareShell(node) ||
    looksLikeSpineRelatedModule(node, []) ||
    includesAny(nodeBlob(node), ["trading", "middleware", "investment agent"])
  );
}

/** Prefer ingress + middleware shell + spine-gap modules; never arbitrary first-N. */
function selectMissingTradingSpineNodeIds(graph: ArchGraph, missingKeywords: string[]): string[] {
  const preferred = graph.nodes
    .filter(
      (n) =>
        looksLikeTradingIngress(n) ||
        looksLikeMiddlewareShell(n) ||
        looksLikeSpineRelatedModule(n, missingKeywords)
    )
    .map((n) => n.id);
  if (preferred.length > 0) return [...new Set(preferred)].slice(0, MISSING_SPINE_NODE_CAP);

  const tradingRelated = graph.nodes.filter(looksLikeTradingScanRelated).map((n) => n.id);
  if (tradingRelated.length > 0) return [...new Set(tradingRelated)].slice(0, MISSING_SPINE_NODE_CAP);

  return graph.nodes.map((n) => n.id).slice(0, MISSING_SPINE_NODE_CAP);
}

function ruleMissingTradingSpine(graph: ArchGraph): DraftFinding[] {
  // Pure heuristic: trading-ish scan without Payment/Policy/Risk/Execution boxes.
  if ((graph as { architectureBoard?: boolean }).architectureBoard) return [];
  const blob = [
    graph.projectName ?? "",
    graph.projectRoot ?? "",
    ...graph.nodes.map((n) => `${n.label ?? ""} ${n.id ?? ""}`),
  ]
    .join(" ")
    .toLowerCase();
  const tradingish = ["trading", "middleware-platform", "investment agent", "trading chat"].some((h) =>
    blob.includes(h)
  );
  if (!tradingish) return [];
  const labels = graph.nodes.map((n) => (n.label ?? "").toLowerCase());
  const missing = TRADING_SPINE_KEYWORDS.filter((k) => !labels.some((l) => l.includes(k)));
  if (missing.length === 0) return [];
  return [
    {
      id: "missing_trading_spine",
      ruleId: "missing_trading_spine",
      // Board setup gap — not a code defect (Insights shows SETUP, not dual BLOCKers).
      severity: "risk",
      title: "Trading money path not on canvas yet",
      whyItMatters:
        "This workspace is still a code-scan layout (modules). Apply the trading spine to place Payment, Policy, Risk, and Execution and wire ingress into that path.",
      nodeIds: selectMissingTradingSpineNodeIds(graph, missing),
      edgeIds: [],
      remediation: "spine",
    },
  ];
}

// ── Engine ────────────────────────────────────────────────────────────────

type RuleFn = (graph: ArchGraph) => DraftFinding[];

const RULES: Record<RuleId, RuleFn> = {
  client_to_db: ruleClientToDb,
  api_no_auth: ruleApiNoAuth,
  orphan_node: ruleOrphanNode,
  layer_inversion: ruleLayerInversion,
  single_external_no_fallback: ruleSingleExternalNoFallback,
  writes_no_queue: ruleWritesNoQueue,
  no_observability: ruleNoObservability,
  no_config_secrets: ruleNoConfigSecrets,
  llm_to_broker: ruleLlmToBroker,
  missing_trading_spine: ruleMissingTradingSpine,
};

export function evaluateDesign(graph: ArchGraph): DesignFinding[] {
  const out: DesignFinding[] = [];
  for (const ruleId of RULE_IDS) {
    for (const draft of RULES[ruleId](graph)) {
      const remediation: DesignFinding["remediation"] =
        draft.remediation ??
        (ruleId === "missing_trading_spine"
          ? "spine"
          : draft.severity === "blocker" || draft.severity === "risk"
            ? "code"
            : "chat");
      out.push(
        finding({
          ...draft,
          remediation,
        })
      );
    }
  }
  return out;
}

const SEVERITY_PENALTY: Record<DesignFindingSeverity, number> = {
  blocker: 25,
  risk: 10,
  suggestion: 4,
};

/** 0-100 design health score. Blockers hurt the most, suggestions the least. Floors at 0. */
export function designScore(findings: DesignFinding[]): number {
  let score = 100;
  for (const f of findings) {
    score -= SEVERITY_PENALTY[f.severity];
  }
  return Math.max(0, Math.min(100, score));
}

// Re-export for callers that only need mapping helpers
export { toBadgeChromeSeverity, fromDesignFindingSeverity };
export type { Severity };
