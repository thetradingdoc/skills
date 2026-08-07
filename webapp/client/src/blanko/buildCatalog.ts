/**
 * Context-aware Components recommendations for the AI design canvas.
 */
import { DESIGN_PALETTE, type DesignPaletteItem } from "../greenfieldDesign";
import type { ArchNode } from "../types";
import { PROVIDER_CATALOG, type ProviderDef } from "../providerCatalog";

/** Extra integration palette entries (provider-backed) not in core DESIGN_PALETTE. */
export const INTEGRATION_PALETTE: (DesignPaletteItem & { providerId?: string })[] = [
  { id: "openai", label: "OpenAI", layer: "Reasoning", description: "Hosted LLM API.", group: "Brain", providerId: "openai" },
  { id: "anthropic", label: "Anthropic", layer: "Reasoning", description: "Claude models.", group: "Brain", providerId: "anthropic" },
  { id: "langchain", label: "LangChain", layer: "Reasoning", description: "LLM orchestration framework.", group: "Brain", providerId: "langchain" },
  { id: "langgraph", label: "LangGraph", layer: "Reasoning", description: "Graph-based agent orchestration.", group: "Brain", providerId: "langchain" },
  { id: "llamaindex", label: "LlamaIndex", layer: "Memory", description: "RAG / data framework for LLMs.", group: "Memory & RAG", providerId: "llamaindex" },
  { id: "pinecone", label: "Pinecone", layer: "Memory", techKind: "database", description: "Managed vector database.", group: "Memory & RAG", providerId: "pinecone" },
  {
    id: "retell",
    label: "Retell",
    layer: "Presentation",
    techKind: "external-saas",
    description: "Voice channel provider — bind for design & tracking.",
    group: "Channels",
    providerId: "retell",
  },
  { id: "azure", label: "Azure", layer: "Infrastructure", description: "Microsoft Azure cloud services.", group: "Ops", providerId: "azure" },
  { id: "gcp", label: "GCP", layer: "Infrastructure", description: "Google Cloud Platform.", group: "Ops", providerId: "gcp" },
  { id: "aws", label: "AWS", layer: "Infrastructure", description: "Amazon Web Services.", group: "Ops", providerId: "aws" },
  { id: "n8n", label: "n8n", layer: "External Services", techKind: "external-saas", description: "Workflow automation estate (import to debug).", group: "Ops", providerId: "n8n" },
  { id: "slack", label: "Slack", layer: "External Services", techKind: "external-saas", description: "Team messaging.", group: "Tools", providerId: "slack" },
  { id: "supabase", label: "Supabase", layer: "Data Access", techKind: "database", description: "Postgres + auth + storage BaaS.", group: "Data", providerId: "supabase" },
];

export type BuildItem = DesignPaletteItem & { providerId?: string; why?: string };

const BY_ID = new Map<string, BuildItem>([
  ...DESIGN_PALETTE.map((p) => [p.id, p as BuildItem] as const),
  ...INTEGRATION_PALETTE.map((p) => [p.id, p] as const),
]);

export function getBuildItem(id: string): BuildItem | undefined {
  return BY_ID.get(id);
}

export function allBuildItems(): BuildItem[] {
  return [...BY_ID.values()];
}

function isAgentLike(n: ArchNode): boolean {
  const label = (n.label ?? "").toLowerCase();
  const layer = String(n.layer ?? "");
  return n.kind === "agent" || /agent/.test(label) || layer.includes("Reasoning");
}

function isRagLike(n: ArchNode): boolean {
  const label = (n.label ?? "").toLowerCase();
  return /vector|rag|pinecone|embedding|memory/.test(label) || String(n.layer ?? "").includes("Memory");
}

function isChannelLike(n: ArchNode): boolean {
  const label = (n.label ?? "").toLowerCase();
  return /retell|voice|channel|webhook|frontend|api/.test(label) || String(n.layer ?? "").includes("Presentation");
}

/** Recommend next pieces from selected node — agent gaps first. */
export function recommendForSelection(
  selected: ArchNode | null,
  opts?: {
    findings?: Array<{ ruleId?: string; title?: string; nodeIds?: string[] }>;
    graphHasAuth?: boolean;
    graphNodes?: ArchNode[];
  }
): BuildItem[] {
  const ids: { id: string; why: string }[] = [];
  const nodes = opts?.graphNodes ?? [];
  const hasAgent = nodes.some(isAgentLike);
  const hasRag = nodes.some(isRagLike);
  const hasStrategy = nodes.some((n) => /strategy/i.test(n.label ?? ""));
  const hasChannel = nodes.some(isChannelLike);
  const hasMemory = nodes.some((n) => /memory/i.test(n.label ?? ""));
  const hasTool = nodes.some((n) => /tool/i.test(n.label ?? "") || n.techKind === "external-saas");

  if (!selected) {
    const starters: { id: string; why: string }[] = [
      { id: "agent", why: "Start with the agent that plans and acts" },
      { id: "vector-db", why: "Add RAG so the agent can retrieve knowledge" },
      { id: "strategy", why: "Name a strategy or playbook the agent uses" },
      { id: "retell-channel", why: "Or add a voice channel (Retell)" },
      { id: "llm", why: "Bind the model the agent reasons with" },
    ];
    if (!hasAgent) {
      /* keep agent first */
    } else if (!hasRag) {
      starters.unshift({ id: "vector-db", why: "Your agent has no RAG path yet" });
    }
    const out: BuildItem[] = [];
    for (const { id, why } of starters) {
      const item = BY_ID.get(id);
      if (item) out.push({ ...item, why });
    }
    return out;
  }

  const label = (selected.label ?? "").toLowerCase();
  const layer = String(selected.layer ?? "");

  if (isAgentLike(selected) || label.includes("agent")) {
    if (!hasMemory) ids.push({ id: "memory", why: "Agents need session/conversation memory" });
    if (!hasRag) ids.push({ id: "vector-db", why: "RAG lets the agent retrieve before answering" });
    if (!hasStrategy) ids.push({ id: "strategy", why: "Attach a strategy or playbook module" });
    if (!hasTool) ids.push({ id: "tool", why: "Give the agent tools it can call" });
    ids.push(
      { id: "llm", why: "Bind the model the agent reasons with" },
      { id: "eval", why: "Gate quality before you ship" },
      { id: "openai", why: "Or bind OpenAI as the brain" },
      { id: "langgraph", why: "Structure multi-step agent graphs" }
    );
  } else if (isRagLike(selected) || /vector|rag/.test(label)) {
    ids.push(
      { id: "agent", why: "Wire RAG into an agent that retrieves then acts" },
      { id: "llm", why: "Generation usually sits next to retrieval" },
      { id: "llamaindex", why: "Or use a RAG framework" },
      { id: "pinecone", why: "Managed vector index" }
    );
  } else if (isChannelLike(selected) || /retell|voice|channel/.test(label)) {
    ids.push(
      { id: "agent", why: "Channels need an agent behind them" },
      { id: "tool", why: "Tools the agent can call mid-conversation" },
      { id: "memory", why: "Remember caller context across turns" },
      { id: "strategy", why: "Policy for what to say / book / escalate" }
    );
  } else if (/strategy/.test(label)) {
    ids.push(
      { id: "agent", why: "Strategies are used by an agent" },
      { id: "vector-db", why: "Strategies often need market/docs context" },
      { id: "eval", why: "Score strategy outcomes" }
    );
  } else if (layer.includes("Data") || String(selected.techKind ?? "").includes("database")) {
    ids.push(
      { id: "agent", why: "Expose data to the agent via tools, not raw DB access" },
      { id: "tool", why: "Wrap data access as an agent tool" },
      { id: "api-channel", why: "Or expose a controlled API channel" }
    );
  } else {
    ids.push(
      { id: "agent", why: "Center the design on an agent" },
      { id: "vector-db", why: "Most agents need a RAG path" },
      { id: "retell-channel", why: "Or add a voice channel" },
      { id: "strategy", why: "Name how the agent decides" }
    );
  }

  if (!hasChannel && ids.every((x) => x.id !== "retell-channel")) {
    ids.push({ id: "retell-channel", why: "Optional: voice channel into this agent" });
  }
  if (!hasAgent && ids[0]?.id !== "agent") {
    ids.unshift({ id: "agent", why: "Every AI design canvas needs an agent" });
  }

  const out: BuildItem[] = [];
  const seen = new Set<string>();
  for (const { id, why } of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = BY_ID.get(id);
    if (item) out.push({ ...item, why });
  }
  return out;
}

export function providerForBuildItem(item: BuildItem): ProviderDef | undefined {
  if (item.providerId) return PROVIDER_CATALOG.find((p) => p.id === item.providerId);
  if (item.id === "retell-channel") return PROVIDER_CATALOG.find((p) => p.id === "retell");
  const match = PROVIDER_CATALOG.find(
    (p) => p.id === item.id || p.name.toLowerCase() === item.label.toLowerCase()
  );
  return match;
}
