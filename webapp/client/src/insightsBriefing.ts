/**
 * Value copy for blanko Insights — architecture, workflow, tools, costs.
 * Pure helpers (no React) so unit tests can lock the narrative.
 */
import type { ArchGraph, ArchNode, AgentInventoryResult, NodeSubsystem } from "./types";
import { bindingsForNode, type InventoryRow } from "./platformInventory";
import { looksLikeTradingScan, spineMissing } from "./tradingSpine";
import {
  SUBSYSTEM_LABELS,
  classifySubsystem,
  summarizeSubsystemReadiness,
} from "./subsystemClassify";
import {
  type Severity,
  fromActionPriority,
  contributesToBadge,
  SEVERITY_RANK,
  toBadgeChromeSeverity,
} from "./severity";

export type WorkflowHop = {
  id: string;
  label: string;
  buildStatus: "planned" | "building" | "built" | "unknown";
  degree: number;
};

export type ToolBrief = {
  name: string;
  agentFile?: string;
};

export type NodeBrief = {
  role: string;
  moneyRule?: string;
  files: string[];
  providers: Array<{ id: string; status: string }>;
  tools: ToolBrief[];
  neighbours: string[];
  configHints: string[];
  /** Bound-file roles for shell / ingress modules. */
  fileRoles: BoundFileRole[];
  /** Priority next actions (chat / code / flow / task). */
  nextActions: NodeNextAction[];
  /** Short headline under the title (not a generic enricher sentence). */
  headline: string;
};

export type BoundFileRole = {
  path: string;
  role: string;
  check: string;
};

export type NodeNextAction = {
  id: string;
  title: string;
  detail: string;
  priority: "blocker" | "high" | "medium";
  /** Shared Blanko severity (D3 / Epic 1). Soft never badges. */
  severity: Severity;
  /** Primary destination */
  kind: "spine" | "flow" | "code" | "chat" | "task";
  filePath?: string;
  chatPrompt?: string;
  taskTitle?: string;
};

export type SubsystemModuleBrief = {
  id: string;
  label: string;
  buildStatus?: string;
  path?: string;
};

export type SubsystemBrief = {
  subsystem: NodeSubsystem;
  label: string;
  role: string;
  moneyRule?: string;
  readiness: string;
  modules: SubsystemModuleBrief[];
};

const SUBSYSTEM_ROLES: Record<NodeSubsystem, { role: string; moneyRule?: string }> = {
  ingress: {
    role: "How humans and surfaces talk to the agent — Telegram, Trading Chat, identity/allowlist gates.",
    moneyRule: "Ingress proposes and confirms; it never holds broker cash by itself.",
  },
  strategy: {
    role: "Reasoning and signal generation — investment agent, PEAD/FDA strategies, research helpers.",
    moneyRule: "Strategy outputs PROPOSED_ACTION only — never submits broker orders.",
  },
  risk_execution: {
    role: "Money controls and brokers — policy, risk, execution, wallets, Alpaca/Kraken adapters.",
    moneyRule: "Only this band may talk to brokers after human confirm + policy/risk ALLOW.",
  },
  data_obs: {
    role: "Market data, schedules, metrics, and observability that feed or watch the system.",
  },
  unclassified: {
    role: "Scan modules that have not been classified into a trading subsystem yet.",
  },
};

const SPINE_ROLES: Record<string, { role: string; moneyRule?: string }> = {
  "bp-ta-telegram": {
    role: "Human ingress (Telegram + Trading Chat HTTP). Commands enter here — never mutate cash alone.",
  },
  "bp-ta-identity": {
    role: "Allowlist / RBAC gate before payment or agent turns.",
  },
  "bp-ta-payment": {
    role: "Paper wallet SSOT for research cash (/fund → /confirm_fund).",
    moneyRule: "Only Telegram confirm + future execution fills mutate balance.",
  },
  "bp-ta-agent": {
    role: "LLM research + propose only. Outputs PROPOSED_ACTION — never submits broker orders.",
    moneyRule: "Hard rule: no LLM → tool → broker. Policy/Risk/Execution own money.",
  },
  "bp-ta-strategy": {
    role: "PEAD / FDA → structured PROPOSED_ACTION for policy.",
  },
  "bp-ta-policy": {
    role: "Permitted? ALLOW | REJECT | REQUIRE_HUMAN_CONFIRMATION.",
    moneyRule: "Blocks illegal or out-of-policy proposals before size.",
  },
  "bp-ta-risk": {
    role: "Size, exposure, penny/volume, kill-switch.",
    moneyRule: "Can shrink or kill a proposal before execution.",
  },
  "bp-ta-execution": {
    role: "Idempotent order state + reconcile DB ↔ broker.",
    moneyRule: "Only this service (after policy/risk) talks to brokers.",
  },
  "bp-ta-alpaca": {
    role: "Equities broker (paper then live). Truth for fills when connected.",
  },
  "bp-ta-kraken": {
    role: "Crypto exchange — isolated from equity funding path.",
  },
  "bp-ta-mobile": {
    role: "Optional phone / dashboard surface for status — not an execution authority.",
  },
};

const MONEY_PATH_IDS = [
  "bp-ta-telegram",
  "bp-ta-identity",
  "bp-ta-agent",
  "bp-ta-strategy",
  "bp-ta-policy",
  "bp-ta-risk",
  "bp-ta-execution",
  "bp-ta-alpaca",
] as const;

export function architectureBrief(graph: ArchGraph | null | undefined): string {
  if (!graph?.nodes?.length) return "Empty canvas — place or fork an architecture to start.";
  if (graph.architectureBoard || (!spineMissing(graph) && looksLikeTradingScan(graph))) {
    return "Money path: Telegram/Trading Chat → Identity → Agent (propose) → Strategy → Policy → Risk → Execution → Alpaca | Kraken. The LLM never submits orders — that saves blow-ups and wasted broker calls.";
  }
  if (looksLikeTradingScan(graph) && spineMissing(graph)) {
    return "Code map of scanned modules — not the money path yet. Apply the trading spine to place Payment → Policy → Risk → Execution and wire ingress into that board.";
  }
  return `Design board: ${graph.nodes.length} pieces, ${graph.edges.length} connections. Insights flags broken design; click a piece for role, tools, and cost.`;
}

export function workflowHops(graph: ArchGraph | null | undefined): WorkflowHop[] {
  if (!graph?.nodes?.length) return [];
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (graph.architectureBoard || graph.nodes.some((n) => n.id.startsWith("bp-ta-"))) {
    return MONEY_PATH_IDS.map((id) => {
      const n = byId.get(id);
      if (!n) {
        return { id, label: id, buildStatus: "unknown" as const, degree: 0 };
      }
      return {
        id,
        label: n.label,
        buildStatus: (n.buildStatus as WorkflowHop["buildStatus"]) || "planned",
        degree: degree.get(id) ?? 0,
      };
    }).filter((h) => byId.has(h.id));
  }
  // Scan / generic: top connected nodes
  return [...graph.nodes]
    .map((n) => ({
      id: n.id,
      label: n.label,
      buildStatus: (n.buildStatus as WorkflowHop["buildStatus"]) || "unknown",
      degree: degree.get(n.id) ?? 0,
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 8);
}

export function orphanPresentationNodes(graph: ArchGraph | null | undefined): ArchNode[] {
  if (!graph?.nodes?.length) return [];
  const connected = new Set<string>();
  for (const e of graph.edges) {
    connected.add(e.source);
    connected.add(e.target);
  }
  return graph.nodes.filter((n) => {
    if (connected.has(n.id)) return false;
    const label = (n.label ?? "").toLowerCase();
    return (
      label.includes("trading chat") ||
      label.includes("chat") ||
      n.layer === "Presentation"
    );
  });
}

function toolsFromInventory(agents: AgentInventoryResult | null | undefined, limit = 8): ToolBrief[] {
  if (!agents?.agents?.length) return [];
  const catalogs = agents.toolCatalogs ?? {};
  const out: ToolBrief[] = [];
  for (const a of agents.agents) {
    const tools = a.tools?.length
      ? a.tools
      : a.catalogId && catalogs[a.catalogId]
        ? catalogs[a.catalogId]
        : [];
    for (const t of tools ?? []) {
      const name = typeof t === "string" ? t : (t as { name?: string }).name;
      if (!name) continue;
      out.push({ name, agentFile: a.file });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function toolsForGraph(graph: ArchGraph | null | undefined): ToolBrief[] {
  return toolsFromInventory(graph?.agents ?? null);
}

export function toolsForNode(graph: ArchGraph | null | undefined, node: ArchNode): ToolBrief[] {
  const agents = graph?.agents;
  if (!agents?.agents?.length) return [];
  const catalogs = agents.toolCatalogs ?? {};
  const files = new Set((node.files ?? []).map((f) => f.replace(/\\/g, "/").toLowerCase()));
  const label = (node.label ?? "").toLowerCase();
  const out: ToolBrief[] = [];
  for (const a of agents.agents) {
    const file = (a.file ?? "").replace(/\\/g, "/").toLowerCase();
    const hit =
      (file && [...files].some((f) => f.includes(file) || file.includes(f))) ||
      (label.includes("agent") && (a.kind === "agent" || a.kind === "helper")) ||
      (label.includes("trading chat") && file.includes("trading"));
    if (!hit && node.id !== "bp-ta-agent" && node.id !== "bp-ta-telegram") continue;
    if (node.id === "bp-ta-agent" || node.id === "bp-ta-telegram" || hit) {
      const tools = a.tools?.length
        ? a.tools
        : a.catalogId && catalogs[a.catalogId]
          ? catalogs[a.catalogId]
          : [];
      for (const t of tools ?? []) {
        const name = typeof t === "string" ? t : (t as { name?: string }).name;
        if (!name) continue;
        out.push({ name, agentFile: a.file });
        if (out.length >= 10) return out;
      }
    }
  }
  // Fallback: show graph-level tools on agent/telegram nodes
  if (out.length === 0 && (node.id === "bp-ta-agent" || /agent|llm/i.test(node.label ?? ""))) {
    return toolsFromInventory(agents, 8);
  }
  return out;
}

function looksLikeTradingIngress(node: ArchNode): boolean {
  const blob = `${node.label ?? ""} ${node.id ?? ""} ${(node.files ?? []).join(" ")}`.toLowerCase();
  return /telegram|trading.?chat|execute-turn/.test(blob);
}

function looksLikeMiddlewareShell(node: ArchNode): boolean {
  const id = (node.id ?? "").replace(/\\/g, "/").toLowerCase();
  const files = (node.files ?? []).map((f) => f.replace(/\\/g, "/").toLowerCase());
  if (id === "middleware-platform" || id.endsWith("/middleware-platform")) return true;
  const hasServer = files.some((f) => /(^|\/)server\.js$/.test(f));
  const hasDb = files.some((f) => /(^|\/)database\.js$/.test(f));
  return hasServer && hasDb && files.length <= 8;
}

export function roleForBoundFile(filePath: string): BoundFileRole {
  const path = filePath.replace(/\\/g, "/");
  const base = path.split("/").pop() ?? path;
  const lower = path.toLowerCase();
  if (/(^|\/)server\.js$/.test(lower)) {
    return {
      path,
      role: "Server boot",
      check: "Port & env · global middleware (CORS, rate limit, JSON) · error handler (no stack leaks)",
    };
  }
  if (/(^|\/)database\.js$/.test(lower)) {
    return {
      path,
      role: "Database",
      check: "Where the DB file/URL comes from · env vs hardcoded secrets · timeouts / pool if any",
    };
  }
  if (/jest\.config/.test(lower)) {
    return {
      path,
      role: "Test config",
      check: "Coverage floor · testEnvironment (node) · setup files / env mocks",
    };
  }
  if (/telegram-bot/.test(lower)) {
    return {
      path,
      role: "Telegram bot",
      check: "Token present · allowlist · /stocks|/crypto · confirm_trade path",
    };
  }
  if (/routes\/trading-chat/.test(lower)) {
    return {
      path,
      role: "Trading Chat API",
      check: "POST /api/trading/chat/turn · research-only (no wallet)",
    };
  }
  if (/unified-dashboard\/.*trading-chat/.test(lower)) {
    return {
      path,
      role: "Trading Chat UI",
      check: "Browser session · points at API · cannot fund/trade",
    };
  }
  if (/trading-chat-service/.test(lower)) {
    return {
      path,
      role: "Chat service",
      check: "web: session namespace · agent enabled gate · no identity wallet",
    };
  }
  if (/identity-service/.test(lower)) {
    return {
      path,
      role: "Identity",
      check: "Email verify · asset_class / broker_driver · unlink clears path",
    };
  }
  if (/paper-broker|alpaca|kraken/.test(lower) && /broker/.test(lower)) {
    return {
      path,
      role: "Broker adapter",
      check: "Keys from env · paper vs live · balance/open/reconcile match the rail docs",
    };
  }
  if (/policy-engine|policy\//.test(lower)) {
    return {
      path,
      role: "Policy",
      check: "Allowlist · size caps · reject path before any broker call",
    };
  }
  return {
    path,
    role: base,
    check: "Open the file — confirm it belongs on this piece and has no secrets in source.",
  };
}

export function briefBoundFiles(node: ArchNode): BoundFileRole[] {
  return (node.files ?? []).slice(0, 10).map(roleForBoundFile);
}

function isSpineSetupFinding(f: {
  id?: string;
  title?: string;
  whyItMatters?: string;
  ruleId?: string;
}): boolean {
  const id = `${f.id ?? ""} ${f.ruleId ?? ""}`.toLowerCase();
  if (id.includes("missing_trading_spine")) return true;
  return /spine|money path not on canvas|trading agent spine|architecture spine/i.test(
    `${f.title ?? ""} ${f.whyItMatters ?? ""}`
  );
}

/** One board-setup CTA for spine gaps (dedupes missing_trading_spine + wire-ingress). */
export function buildBoardSetupAction(): NodeNextAction {
  return {
    id: "board-setup",
    title: "Switch to money-path board",
    detail:
      "This workspace is still a code map of modules. Apply the trading spine to place Payment, Policy, Risk, and Execution and wire ingress (Telegram / Trading Chat) into that path.",
    priority: "high",
    severity: "warning",
    kind: "spine",
    taskTitle: "Apply trading agent spine",
    chatPrompt:
      "Explain how to apply the trading agent spine so this workspace switches from a code-scan layout to the money-path board (Telegram → Identity → Agent → Strategy → Policy → Risk → Execution).",
  };
}

export function nextActionsForNode(
  graph: ArchGraph | null | undefined,
  node: ArchNode,
  findings: Array<{
    id: string;
    title: string;
    whyItMatters: string;
    severity: string;
    nodeIds: string[];
    ruleId?: string;
  }> = []
): NodeNextAction[] {
  const actions: NodeNextAction[] = [];
  const push = (a: Omit<NodeNextAction, "severity"> & { severity?: Severity }) => {
    const severity = a.severity ?? fromActionPriority(a.priority);
    actions.push({ ...a, severity });
  };

  const onNode = findings.filter((f) => f.nodeIds.includes(node.id));
  const spineFindingsOnNode = onNode.filter(isSpineSetupFinding);
  for (const f of onNode) {
    if (isSpineSetupFinding(f)) continue; // folded into single board-setup below
    if (f.severity !== "blocker" && f.severity !== "risk") continue;
    push({
      id: `finding-${f.id}`,
      title: f.title,
      detail: f.whyItMatters,
      priority: f.severity === "blocker" ? "blocker" : "high",
      severity: f.severity === "blocker" ? "blocker" : "warning",
      kind: "code",
      chatPrompt: `Help me fix: ${f.title}. ${f.whyItMatters}`,
      taskTitle: f.title,
    });
  }

  if (looksLikeMiddlewareShell(node)) {
    const server = (node.files ?? []).find((f) => /server\.js$/i.test(f));
    const db = (node.files ?? []).find((f) => /database\.js$/i.test(f));
    if (server) {
      push({
        id: "audit-server",
        title: "Review server boot",
        detail: "Port, env mode, CORS/rate-limit, error handling.",
        priority: "high",
        severity: "warning",
        kind: "code",
        filePath: server,
        chatPrompt: `Audit ${server}: list listen port, env mode, global middleware, and how errors are returned to clients.`,
        taskTitle: `Audit ${server} boot & middleware`,
      });
    }
    if (db) {
      push({
        id: "audit-db",
        title: "Review database wiring",
        detail: "Env credentials, path/URL, no secrets in source.",
        priority: "high",
        severity: "warning",
        kind: "code",
        filePath: db,
        chatPrompt: `Audit ${db}: how is the DB path/URL chosen, are credentials from env, any pool/timeout settings?`,
        taskTitle: `Audit ${db} credentials & connection`,
      });
    }
  }

  // Single SETUP card: graph-level board gap, attributed via ingress or spine finding on this node.
  if (
    spineMissing(graph ?? null) &&
    (looksLikeTradingIngress(node) || spineFindingsOnNode.length > 0)
  ) {
    push(buildBoardSetupAction());
  }

  const hasBadgeWorthy = actions.some((a) => contributesToBadge(a.severity));
  if (!hasBadgeWorthy && !actions.some((a) => a.id === "review-node")) {
    // Soft fallback — never badges (Epic 1).
    push({
      id: "review-node",
      title: "Review with agent",
      detail: "Open a sandbox Fix run for this piece — review in Tasks before Approve.",
      priority: "medium",
      severity: "soft",
      kind: "code",
      chatPrompt: `Review “${node.label}” on the trading money-path. List top risks and a concrete fix plan.`,
      taskTitle: `Review ${node.label}`,
    });
  }

  if (actions.length === 0) {
    push({
      id: "explain-node",
      title: "Explain this piece",
      detail: "Ask chat what it does and what to check next.",
      priority: "medium",
      severity: "soft",
      kind: "chat",
      chatPrompt: `Explain “${node.label}” in this architecture and list the top 3 checks I should make.`,
      taskTitle: `Review ${node.label}`,
    });
  }

  const order = { blocker: 0, high: 1, medium: 2 } as const;
  return actions.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 5);
}

/** Badge meta — badge_count excludes soft (Epic 1). */
export function nodeActionBadgeMeta(
  graph: ArchGraph | null | undefined,
  findings: Array<{ id: string; title: string; whyItMatters: string; severity: string; nodeIds: string[] }>,
  opts?: { todoStatusBySourcePath?: Record<string, string> }
): Record<string, { count: number; badge_count: number; severity: "blocker" | "risk" | "suggestion" }> {
  const map: Record<
    string,
    { count: number; badge_count: number; severity: "blocker" | "risk" | "suggestion" }
  > = {};
  if (!graph?.nodes?.length) return map;

  const todoStatus = opts?.todoStatusBySourcePath ?? {};

  for (const node of graph.nodes) {
    const actions = nextActionsForNode(graph, node, findings).filter((a) => {
      if (a.id === "explain-node") return false;
      const sp = `insights:${node.id}:${a.id}`;
      const st = todoStatus[sp];
      if (st === "done" || st === "completed") return false;
      return true;
    });
    const badgeActions = actions.filter((a) => contributesToBadge(a.severity));
    if (badgeActions.length === 0) continue;
    let sev: Severity = "soft";
    for (const a of badgeActions) {
      if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[sev]) sev = a.severity;
    }
    map[node.id] = {
      count: badgeActions.length,
      badge_count: badgeActions.length,
      severity: toBadgeChromeSeverity(sev),
    };
  }
  return map;
}

export function briefNode(
  graph: ArchGraph | null | undefined,
  node: ArchNode,
  findings: Array<{ id: string; title: string; whyItMatters: string; severity: string; nodeIds: string[] }> = []
): NodeBrief {
  const known = SPINE_ROLES[node.id];
  const ingress = !known && looksLikeTradingIngress(node);
  const shell = looksLikeMiddlewareShell(node);
  const providers = bindingsForNode(node).map((b) => ({ id: b.providerId, status: b.status }));
  const neighbourIds = new Set<string>();
  for (const e of graph?.edges ?? []) {
    if (e.source === node.id) neighbourIds.add(e.target);
    if (e.target === node.id) neighbourIds.add(e.source);
  }
  const neighbours = [...neighbourIds]
    .map((id) => graph?.nodes.find((n) => n.id === id)?.label ?? id)
    .slice(0, 8);

  const fileRoles = briefBoundFiles(node);
  const nextActions = nextActionsForNode(graph, node, findings);

  let role =
    known?.role ||
    (ingress
      ? "Human ingress (Telegram bot and/or Trading Chat HTTP). Commands enter here — never mutate cash alone."
      : null) ||
    (shell
      ? "Platform shell — HTTP server, SQLite DB, and process entry. Child folders (routes, services, migrations) are separate pieces."
      : null) ||
    node.description ||
    `${node.layer ?? "Piece"} in this architecture.`;

  const headline = shell
    ? "Server + database entry for the trading agent process"
    : ingress
      ? "Where humans talk to the agent"
      : known
        ? "Money-path piece"
        : (node.layer ?? "Module");

  const configHints: string[] = [];
  if (ingress) {
    configHints.push("Flow — wire ingress into money path");
  } else if (shell || /flow|spine|path|money/i.test(role)) {
    configHints.push("Flow — money path / tasks");
  }
  if (toolsForNode(graph, node).length > 0 || /agent/i.test(node.label ?? "")) {
    configHints.push("Agents — tool catalog");
  }

  return {
    role,
    moneyRule: known?.moneyRule,
    files: (node.files ?? []).slice(0, 8),
    providers,
    tools: toolsForNode(graph, node),
    neighbours,
    configHints,
    fileRoles,
    nextActions,
    headline,
  };
}

/** Auto brief for a colored cockpit box — what the band is + modules it currently holds. */
export function briefSubsystem(
  graph: ArchGraph | null | undefined,
  subsystem: NodeSubsystem
): SubsystemBrief {
  const nodes = (graph?.nodes ?? []).filter(
    (n) => (n.subsystem ?? classifySubsystem(n).subsystem) === subsystem
  );
  const modules: SubsystemModuleBrief[] = nodes
    .map((n) => ({
      id: n.id,
      label: n.label || n.id,
      buildStatus: n.buildStatus,
      path: n.path,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const known = SUBSYSTEM_ROLES[subsystem];
  return {
    subsystem,
    label: SUBSYSTEM_LABELS[subsystem],
    role: known.role,
    moneyRule: known.moneyRule,
    readiness: summarizeSubsystemReadiness(subsystem),
    modules,
  };
}

export function inventoryHeadline(rows: InventoryRow[]): string {
  if (rows.length === 0) {
    return "No brokers/LLMs/Telegram detected on this board yet. Apply the trading spine or bind Alpaca/Kraken/Telegram on those nodes.";
  }
  const connected = rows.filter((r) => r.status === "connected" || r.status === "unknown");
  const names = connected.map((r) => r.provider.name).slice(0, 6);
  if (names.length) {
    return `In play: ${names.join(", ")}. Status reflects canvas bindings / detected providers — not live API health.`;
  }
  return "Providers listed below need binding or credentials before cost tracking is useful.";
}
