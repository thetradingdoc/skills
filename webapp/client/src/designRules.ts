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

// ── Public types ──────────────────────────────────────────────────────────

export type DesignFindingSeverity = "blocker" | "risk" | "suggestion";

export interface DesignFinding {
  id: string;
  ruleId: string;
  severity: DesignFindingSeverity;
  title: string;
  /** Plain language explanation for non-experts: why this matters. */
  whyItMatters: string;
  nodeIds: string[];
  edgeIds: string[];
  /** Optional one-click fix. Additive only (create_node / connect). */
  fix?: GraphCommand[];
}

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

function ruleClientToDb(graph: ArchGraph): DesignFinding[] {
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

function ruleApiNoAuth(graph: ArchGraph): DesignFinding[] {
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

function ruleOrphanNode(graph: ArchGraph): DesignFinding[] {
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

function ruleLayerInversion(graph: ArchGraph): DesignFinding[] {
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

function ruleSingleExternalNoFallback(graph: ArchGraph): DesignFinding[] {
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

function ruleWritesNoQueue(graph: ArchGraph): DesignFinding[] {
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

function ruleNoObservability(graph: ArchGraph): DesignFinding[] {
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

function ruleNoConfigSecrets(graph: ArchGraph): DesignFinding[] {
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

function ruleLlmToBroker(graph: ArchGraph): DesignFinding[] {
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

function ruleMissingTradingSpine(graph: ArchGraph): DesignFinding[] {
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
  const need = ["payment", "policy", "risk", "execution"];
  const missing = need.filter((k) => !labels.some((l) => l.includes(k)));
  if (missing.length === 0) return [];
  return [
    {
      id: "missing_trading_spine",
      ruleId: "missing_trading_spine",
      severity: "blocker",
      title: "Trading scan is missing the architecture spine",
      whyItMatters:
        "This canvas looks like a code scan (modules), not Telegram → Identity → Payment → Policy → Risk → Execution. Use Export · Apply trading agent spine (or Insights CTA) to place the locked board.",
      nodeIds: graph.nodes.slice(0, 3).map((n) => n.id),
      edgeIds: [],
    },
  ];
}

// ── Engine ────────────────────────────────────────────────────────────────

type RuleFn = (graph: ArchGraph) => DesignFinding[];

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
  const findings: DesignFinding[] = [];
  for (const ruleId of RULE_IDS) {
    findings.push(...RULES[ruleId](graph));
  }
  return findings;
}

const SEVERITY_PENALTY: Record<DesignFindingSeverity, number> = {
  blocker: 25,
  risk: 10,
  suggestion: 4,
};

/** 0-100 design health score. Blockers hurt the most, suggestions the least. Floors at 0. */
export function designScore(findings: DesignFinding[]): number {
  let score = 100;
  for (const finding of findings) {
    score -= SEVERITY_PENALTY[finding.severity];
  }
  return Math.max(0, Math.min(100, score));
}
