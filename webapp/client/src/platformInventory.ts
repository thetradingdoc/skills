/**
 * Derive platform inventory from a graph + optional agent inventory providers.
 * Pure — safe for unit tests and UI.
 *
 * Insights must show what THIS architecture uses — not a generic SaaS wishlist.
 */
import type { ArchGraph, ArchNode } from "./types";
import {
  PROVIDER_CATALOG,
  type BindingStatus,
  type PlatformBinding,
  type ProviderDef,
  canonicalizeProviderId,
  getProvider,
} from "./providerCatalog";

export type InventoryRow = {
  provider: ProviderDef;
  status: BindingStatus;
  boundNodeIds: string[];
  sources: Array<"detected" | "declared">;
  accountLabels: string[];
  evidence: string[];
};

export type BuildInventoryOpts = {
  /**
   * When true, also list catalog `critical` providers with no evidence as unbound gaps.
   * Default false — Insights should not invent Stripe/AWS for a trading board.
   */
  includeCriticalGaps?: boolean;
};

function nodeBindings(node: ArchNode): PlatformBinding[] {
  const out: PlatformBinding[] = [];
  if (Array.isArray(node.platformBindings)) {
    for (const b of node.platformBindings) {
      const id = canonicalizeProviderId(b.providerId);
      if (!id || !getProvider(id)) continue;
      out.push({ ...b, providerId: id });
    }
  }
  const llm = canonicalizeProviderId(node.llmProvider);
  if (llm && getProvider(llm) && !out.some((b) => b.providerId === llm)) {
    out.push({
      providerId: llm,
      status: "unknown",
      source: "detected",
      evidence: `llmProvider=${node.llmProvider}`,
    });
  }
  const cloud = canonicalizeProviderId(
    node.cloudProvider === "other" || node.cloudProvider === "unknown" ? null : node.cloudProvider
  );
  if (cloud && getProvider(cloud) && !out.some((b) => b.providerId === cloud)) {
    out.push({
      providerId: cloud,
      status: "unknown",
      source: "detected",
      evidence: `cloudProvider=${node.cloudProvider}`,
    });
  }
  return out;
}

/** Infer provider from node label/id when no explicit binding (e.g. Alpaca box). */
function inferProvidersFromNode(node: ArchNode): PlatformBinding[] {
  const blob = `${node.label ?? ""} ${node.id ?? ""} ${(node.files ?? []).join(" ")}`.toLowerCase();
  const hits: Array<{ id: string; evidence: string }> = [];
  const tryHit = (id: string, needles: string[]) => {
    if (needles.some((n) => blob.includes(n))) hits.push({ id, evidence: `node:${node.label || node.id}` });
  };
  tryHit("alpaca", ["alpaca"]);
  tryHit("kraken", ["kraken"]);
  tryHit("openai", ["openai", "gpt-"]);
  tryHit("anthropic", ["anthropic", "claude"]);
  tryHit("stripe", ["stripe"]);
  // Trading Chat HTTP is the same human ingress family as Telegram on this product —
  // show Telegram on scan nodes even when only trading-chat.js is bound (no "telegram" string).
  tryHit("telegram", [
    "telegram",
    "telegram-bot",
    "telegraf",
    "trading-chat",
    "trading chat",
    "execute-turn",
  ]);
  return hits
    .map((h) => {
      const id = canonicalizeProviderId(h.id);
      if (!id || !getProvider(id)) return null;
      return {
        providerId: id,
        status: "connected" as const,
        source: "detected" as const,
        evidence: h.evidence,
      };
    })
    .filter(Boolean) as PlatformBinding[];
}

export function bindingsForNode(node: ArchNode): PlatformBinding[] {
  const explicit = nodeBindings(node);
  if (explicit.length) return explicit;
  return inferProvidersFromNode(node);
}

export function primaryBinding(node: ArchNode): PlatformBinding | null {
  const list = bindingsForNode(node);
  return list.find((b) => b.source === "declared") ?? list[0] ?? null;
}

/** Upsert a declared binding on a node (immutable). Keeps other declared bindings. */
export function setNodeProviderBinding(
  node: ArchNode,
  providerId: string | null,
  opts?: {
    accountLabel?: string;
    status?: BindingStatus;
    role?: PlatformBinding["role"];
    evidence?: string;
  }
): ArchNode {
  const nonDeclared = (node.platformBindings ?? []).filter((b) => b.source !== "declared");
  const otherDeclared = (node.platformBindings ?? []).filter((b) => b.source === "declared");
  if (!providerId) {
    return {
      ...node,
      platformBindings: nonDeclared.length ? nonDeclared : undefined,
      llmProvider: node.llmProvider,
    };
  }
  const id = canonicalizeProviderId(providerId) ?? providerId;
  const binding: PlatformBinding = {
    providerId: id,
    accountLabel: opts?.accountLabel,
    status: opts?.status ?? "connected",
    source: "declared",
    evidence: opts?.evidence ?? "user-bound in canvas",
    role: opts?.role,
  };
  const declared = [...otherDeclared.filter((b) => b.providerId !== id), binding];
  const def = getProvider(id);
  const primaryLlm =
    opts?.role === "primary" && (def?.category === "llm" || def?.category === "framework")
      ? id
      : def?.category === "llm" || def?.category === "framework"
        ? id
        : node.llmProvider;
  return {
    ...node,
    platformBindings: [...nonDeclared, ...declared],
    llmProvider:
      opts?.role === "primary"
        ? id
        : opts?.role === "fallback"
          ? node.llmProvider || primaryLlm
          : primaryLlm,
    cloudProvider:
      def?.category === "cloud" && (id === "aws" || id === "gcp" || id === "azure")
        ? (id as ArchNode["cloudProvider"])
        : node.cloudProvider,
  };
}

export function buildPlatformInventory(
  graph: ArchGraph | null,
  detectedProviderIds: string[] = [],
  opts: BuildInventoryOpts = {}
): InventoryRow[] {
  const byId = new Map<string, InventoryRow>();
  const includeCriticalGaps = opts.includeCriticalGaps === true;

  const ensure = (id: string): InventoryRow | null => {
    const provider = getProvider(id);
    if (!provider) return null;
    let row = byId.get(provider.id);
    if (!row) {
      row = {
        provider,
        status: "unbound",
        boundNodeIds: [],
        sources: [],
        accountLabels: [],
        evidence: [],
      };
      byId.set(provider.id, row);
    }
    return row;
  };

  const absorb = (node: ArchNode, b: PlatformBinding) => {
    const row = ensure(b.providerId);
    if (!row) return;
    if (!row.boundNodeIds.includes(node.id)) row.boundNodeIds.push(node.id);
    if (!row.sources.includes(b.source)) row.sources.push(b.source);
    if (b.accountLabel && !row.accountLabels.includes(b.accountLabel)) {
      row.accountLabels.push(b.accountLabel);
    }
    if (b.evidence) row.evidence.push(b.evidence);
    const rank: Record<BindingStatus, number> = {
      connected: 4,
      missing_credentials: 3,
      unknown: 2,
      unbound: 1,
    };
    if (rank[b.status] > rank[row.status]) row.status = b.status;
  };

  for (const raw of detectedProviderIds) {
    const id = canonicalizeProviderId(raw);
    if (!id || !getProvider(id)) continue;
    const row = ensure(id);
    if (!row) continue;
    if (!row.sources.includes("detected")) row.sources.push("detected");
    if (row.status === "unbound") row.status = "unknown";
    row.evidence.push(`package/inventory: ${raw}`);
  }

  for (const node of graph?.nodes ?? []) {
    const bindings = nodeBindings(node);
    const list = bindings.length ? bindings : inferProvidersFromNode(node);
    for (const b of list) absorb(node, b);
  }

  if (includeCriticalGaps) {
    for (const p of PROVIDER_CATALOG) {
      if (!p.critical) continue;
      if (!byId.has(p.id)) {
        byId.set(p.id, {
          provider: p,
          status: "unbound",
          boundNodeIds: [],
          sources: [],
          accountLabels: [],
          evidence: [],
        });
      }
    }
  }

  return [...byId.values()].sort((a, b) => {
    const rank: Record<BindingStatus, number> = {
      unbound: 0,
      missing_credentials: 1,
      unknown: 2,
      connected: 3,
    };
    // Prefer showing connected brokers first for value.
    const d = rank[b.status] - rank[a.status];
    if (d !== 0) return d;
    return a.provider.name.localeCompare(b.provider.name);
  });
}

export function collectDetectedProvidersFromAgents(
  agents: Array<{ provider?: string | null }> | null | undefined
): string[] {
  const out = new Set<string>();
  const list = Array.isArray(agents) ? agents : [];
  for (const a of list) {
    const id = canonicalizeProviderId(a?.provider ?? null);
    if (id && getProvider(id)) out.add(id);
  }
  return [...out];
}
