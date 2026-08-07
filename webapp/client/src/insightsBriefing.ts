/**
 * Value copy for blanko Insights — architecture, workflow, tools, costs.
 * Pure helpers (no React) so unit tests can lock the narrative.
 */
import type { ArchGraph, ArchNode, AgentInventoryResult } from "./types";
import { bindingsForNode, type InventoryRow } from "./platformInventory";
import { looksLikeTradingScan, spineMissing } from "./tradingSpine";

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
    return "You are looking at a code-scan layout (modules like Trading Chat). Those boxes do not show the money workflow. Apply the trading agent spine to see the locked architecture.";
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

export function briefNode(graph: ArchGraph | null | undefined, node: ArchNode): NodeBrief {
  const known = SPINE_ROLES[node.id];
  const providers = bindingsForNode(node).map((b) => ({ id: b.providerId, status: b.status }));
  const neighbourIds = new Set<string>();
  for (const e of graph?.edges ?? []) {
    if (e.source === node.id) neighbourIds.add(e.target);
    if (e.target === node.id) neighbourIds.add(e.source);
  }
  const neighbours = [...neighbourIds]
    .map((id) => graph?.nodes.find((n) => n.id === id)?.label ?? id)
    .slice(0, 8);

  const configHints: string[] = [
    "Config → Flow — full path / Tasks board",
    "Config → Agents — tool catalog & surfaces",
    "Config → Usage — token burn & budgets",
    "Config → Platforms — bind / credential status",
  ];
  if (neighbourIds.size === 0) {
    configHints.unshift("This piece has no edges — Apply trading spine if you still see scan modules.");
  }

  return {
    role:
      known?.role ||
      node.description ||
      `${node.layer ?? "Piece"} in this architecture — open Config → Flow to see how it connects.`,
    moneyRule: known?.moneyRule,
    files: (node.files ?? []).slice(0, 8),
    providers,
    tools: toolsForNode(graph, node),
    neighbours,
    configHints,
  };
}

export function inventoryHeadline(rows: InventoryRow[]): string {
  if (rows.length === 0) {
    return "No brokers/LLMs detected on this board yet. Apply the trading spine or bind Alpaca/Kraken on those nodes.";
  }
  const connected = rows.filter((r) => r.status === "connected" || r.status === "unknown");
  const names = connected.map((r) => r.provider.name).slice(0, 6);
  if (names.length) {
    return `In play: ${names.join(", ")}. Status reflects canvas bindings / detected providers — not live API health.`;
  }
  return "Providers listed below need binding or credentials before cost tracking is useful.";
}
