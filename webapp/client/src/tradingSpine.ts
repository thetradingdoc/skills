/**
 * Trading-agent architecture board: locked spine from the plan.
 * Scan graphs never invent these boxes — Apply spine / fork does.
 */
import type { ArchGraph, ArchNode } from "./types";
import { forkBlueprint } from "./designBlueprints";
import { TRADING_PIPELINE_SEED } from "./flowTradingSeed";
import { setNodeProviderBinding } from "./platformInventory";

/** File path substrings (posix) bound onto spine node ids. */
export const SPINE_FILE_BINDINGS: Record<string, string[]> = {
  "bp-ta-telegram": [
    "telegram-bot.js",
    "telegram-paper-commands.js",
    "trading-chat",
    "trading/chat",
    "handleTradingChat",
    "execute-turn.js",
  ],
  "bp-ta-identity": ["telegram-auth.js", "caller.js", "identity-service.js", "005_identity"],
  "bp-ta-payment": [
    "paper-wallet-writer.js",
    "telegram-paper-commands.js",
    "011_paper_wallets",
    "wallet-service.js",
  ],
  "bp-ta-agent": [
    "llm-router.js",
    "execute-turn.js",
    "trading-tool-executor.js",
    "propose-only-guard",
    "trading-chat",
    "investment-agent",
  ],
  "bp-ta-strategy": ["services/strategy/", "signal-engine.js", "fda-client.js", "pead"],
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
  "bp-ta-telegram": ["telegram-bot.js", "trading-chat", "execute-turn"],
  "bp-ta-policy": ["policy-engine.js", "services/policy/"],
  "bp-ta-risk": ["risk-engine.js", "services/risk/"],
  "bp-ta-execution": ["execution-service.js", "services/execution/"],
  "bp-ta-alpaca": ["paper-broker.js", "services/broker/"],
  "bp-ta-strategy": ["services/strategy/", "pead.js"],
  "bp-ta-agent": ["propose-only-guard.js", "llm-router.js", "execute-turn"],
  "bp-ta-kraken": ["kraken"],
};

const AUTO_BIND: Record<string, string> = {
  "bp-ta-alpaca": "alpaca",
  "bp-ta-kraken": "kraken",
  "bp-ta-telegram": "telegram",
};

function providerCredStatus(
  providers: ArchGraph["providers"] | undefined,
  providerId: string
): { status: "connected" | "missing_credentials" | "unknown"; accountLabel: string; evidence: string } {
  const row = providers?.providers?.find((p) => p.id === providerId);
  if (!row) {
    return {
      status: "unknown",
      accountLabel: `${providerId} — credentials unknown (no scan providers payload)`,
      evidence: "spine-auto-bind; no providers payload",
    };
  }
  if (row.hasCredential) {
    return {
      status: "connected",
      accountLabel: `${providerId} — configured in scanned repo .env (static)`,
      evidence: `scan-providers; keys=${row.configuredEnvKeys.join(",") || "set"}`,
    };
  }
  return {
    status: "missing_credentials",
    accountLabel: `${providerId} — NOT CONFIGURED in scanned repo .env (static)`,
    evidence: `scan-providers; detected=${row.detected}; empty credentialEnv`,
  };
}

/**
 * Bind LLM primary/fallback onto bp-ta-agent from Fix A providers payload.
 * Static only — not live :4100.
 */
function bindAgentLlmRoles(node: ArchNode, from: ArchGraph | null): ArchNode {
  const routing = from?.providers?.llmRouting;
  const primary = routing?.primary ?? "anthropic";
  const fallback = routing?.fallback ?? "groq";
  const sourceNote =
    routing?.source === "detected"
      ? routing.note
      : "Default Anthropic primary / Groq fallback (not detected from scanned tree).";

  const primaryCred = providerCredStatus(from?.providers, primary);
  const fallbackCred = providerCredStatus(from?.providers, fallback);

  let next = setNodeProviderBinding(node, primary, {
    role: "primary",
    status: primaryCred.status,
    accountLabel: `primary: ${primaryCred.accountLabel}`,
    evidence: `llm-role:primary; ${sourceNote}; ${primaryCred.evidence}`,
  });
  next = setNodeProviderBinding(next, fallback, {
    role: "fallback",
    status: fallbackCred.status,
    accountLabel: `fallback: ${fallbackCred.accountLabel}`,
    evidence: `llm-role:fallback; ${sourceNote}; ${fallbackCred.evidence}`,
  });
  return next;
}

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

function enrichIngressLabel(node: ArchNode, scanFiles: string[]): ArchNode {
  if (node.id !== "bp-ta-telegram") return node;
  const hasChat = scanFiles.some((f) => /trading.?chat|execute-turn/i.test(f));
  if (!hasChat && !(node.files ?? []).some((f) => /trading.?chat|execute-turn/i.test(f))) {
    return node;
  }
  return {
    ...node,
    label: "Telegram / Trading Chat",
    description:
      "Human ingress — Telegram commands and HTTP Trading Chat. Always through Identity before Payment or Agent.",
  };
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
 * Auto-binds Alpaca/Kraken/Telegram so Insights shows real platforms, not Stripe wishlist.
 */
export function applyTradingSpine(opts: ApplyTradingSpineOpts = {}): ArchGraph | null {
  const base = forkBlueprint("trading-agent");
  if (!base) return null;
  const from = opts.from ?? null;
  const scanFiles = collectScanFiles(from);
  const inferBuilt = opts.inferBuilt !== false;

  let nodes = base.nodes.map((n) => {
    let next = bindFiles(n, scanFiles);
    next = enrichIngressLabel(next, scanFiles);
    if (inferBuilt) {
      next = { ...next, buildStatus: inferBuildStatus(next, scanFiles) };
    } else if (!next.buildStatus) {
      next = { ...next, buildStatus: "planned" };
    }
    const providerId = AUTO_BIND[next.id];
    if (providerId) {
      const cred = providerCredStatus(from?.providers, providerId);
      const fileBuilt = next.buildStatus === "built" || (next.files ?? []).length > 0;
      // Prefer credential truth from Fix A when available; else fall back to file-based connected/unknown.
      const status =
        from?.providers != null
          ? cred.status
          : fileBuilt
            ? "connected"
            : "unknown";
      next = setNodeProviderBinding(next, providerId, {
        status,
        accountLabel: from?.providers != null ? cred.accountLabel : undefined,
        evidence: from?.providers != null ? cred.evidence : "spine-auto-bind",
      });
    }
    if (next.id === "bp-ta-agent") {
      next = bindAgentLlmRoles(next, from);
    }
    return next;
  });

  // Policy + Risk share task p3 — if policy built, mark risk built when risk files exist.
  const policy = nodes.find((n) => n.id === "bp-ta-policy");
  const risk = nodes.find((n) => n.id === "bp-ta-risk");
  if (policy?.buildStatus === "built" && risk) {
    const riskBuilt = inferBuildStatus(risk, scanFiles);
    if (riskBuilt === "built") {
      nodes = nodes.map((n) => (n.id === "bp-ta-risk" ? { ...n, buildStatus: "built" } : n));
    }
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
    providers: from?.providers,
    revision: typeof from?.revision === "number" ? from.revision : undefined,
  };
}

export function tradingSpineSeedTitles(): string[] {
  return TRADING_PIPELINE_SEED.map((c) => c.title);
}

/**
 * Required Blanko edges for a connected trading spine (EXPECTED_SPINE).
 * Must stay in sync with runtime `services/trading-rails/expected-spine.js`.
 */
export const EXPECTED_SPINE_EDGES: ReadonlyArray<readonly [string, string, string]> = [
  ["bp-ta-telegram", "bp-ta-identity", "channel_to"],
  ["bp-ta-telegram", "bp-ta-agent", "invokes"],
  ["bp-ta-identity", "bp-ta-agent", "authorizes"],
  ["bp-ta-agent", "bp-ta-strategy", "uses"],
  ["bp-ta-strategy", "bp-ta-policy", "depends_on"],
  ["bp-ta-policy", "bp-ta-risk", "depends_on"],
  ["bp-ta-risk", "bp-ta-execution", "calls"],
  ["bp-ta-execution", "bp-ta-alpaca", "calls"],
] as const;

export const EXPECTED_SPINE_RUNTIME_HOPS = [
  "telegram_or_chat",
  "assertCaller",
  "execute_turn",
  "allowlisted_propose_only_tools",
  "generate_signal_selectors_only",
  "runStrategies",
  "PROPOSED_ACTION",
  "policy_risk",
  "no_broker_submit_from_agent",
] as const;

/** True when ingress reaches Agent→Strategy and the money path is edged. */
export function spineWorkflowConnected(graph: ArchGraph | null | undefined): boolean {
  if (!graph?.nodes?.length || !graph.edges?.length) return false;
  const ids = new Set(graph.nodes.map((n) => n.id));
  const need = [
    "bp-ta-telegram",
    "bp-ta-identity",
    "bp-ta-agent",
    "bp-ta-strategy",
    "bp-ta-policy",
    "bp-ta-risk",
    "bp-ta-execution",
    "bp-ta-alpaca",
  ];
  if (!need.every((id) => ids.has(id))) return false;
  const edgeKey = (s: string, t: string) => `${s}->${t}`;
  const edges = new Set(graph.edges.map((e) => edgeKey(e.source, e.target)));
  return EXPECTED_SPINE_EDGES.every(([s, t]) => edges.has(edgeKey(s, t)));
}
