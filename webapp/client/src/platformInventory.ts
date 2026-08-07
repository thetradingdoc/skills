/**
 * Derive platform inventory from a graph + optional agent inventory providers.
 * Pure — safe for unit tests and UI.
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

function nodeBindings(node: ArchNode): PlatformBinding[] {
  const out: PlatformBinding[] = [];
  if (Array.isArray(node.platformBindings)) {
    for (const b of node.platformBindings) {
      const id = canonicalizeProviderId(b.providerId);
      if (!id) continue;
      out.push({ ...b, providerId: id });
    }
  }
  // Detected from llmProvider / cloudProvider when no explicit binding yet
  const llm = canonicalizeProviderId(node.llmProvider);
  if (llm && !out.some((b) => b.providerId === llm)) {
    out.push({
      providerId: llm,
      status: "unknown",
      source: "detected",
      evidence: `llmProvider=${node.llmProvider}`,
    });
  }
  const cloud = canonicalizeProviderId(node.cloudProvider === "other" || node.cloudProvider === "unknown" ? null : node.cloudProvider);
  if (cloud && !out.some((b) => b.providerId === cloud)) {
    out.push({
      providerId: cloud,
      status: "unknown",
      source: "detected",
      evidence: `cloudProvider=${node.cloudProvider}`,
    });
  }
  return out;
}

export function bindingsForNode(node: ArchNode): PlatformBinding[] {
  return nodeBindings(node);
}

export function primaryBinding(node: ArchNode): PlatformBinding | null {
  const list = nodeBindings(node);
  return list.find((b) => b.source === "declared") ?? list[0] ?? null;
}

/** Upsert a declared binding on a node (immutable). */
export function setNodeProviderBinding(
  node: ArchNode,
  providerId: string | null,
  opts?: { accountLabel?: string; status?: BindingStatus }
): ArchNode {
  const existing = (node.platformBindings ?? []).filter((b) => b.source !== "declared");
  if (!providerId) {
    return {
      ...node,
      platformBindings: existing.length ? existing : undefined,
      llmProvider: node.llmProvider,
    };
  }
  const id = canonicalizeProviderId(providerId) ?? providerId;
  const binding: PlatformBinding = {
    providerId: id,
    accountLabel: opts?.accountLabel,
    status: opts?.status ?? "connected",
    source: "declared",
    evidence: "user-bound in canvas",
  };
  const def = getProvider(id);
  return {
    ...node,
    platformBindings: [...existing, binding],
    // Keep llmProvider in sync for LLM catalog entries so existing badges work
    llmProvider: def?.category === "llm" || def?.category === "framework" ? id : node.llmProvider,
    cloudProvider:
      def?.category === "cloud" && (id === "aws" || id === "gcp" || id === "azure")
        ? (id as ArchNode["cloudProvider"])
        : node.cloudProvider,
  };
}

export function buildPlatformInventory(
  graph: ArchGraph | null,
  detectedProviderIds: string[] = []
): InventoryRow[] {
  const byId = new Map<string, InventoryRow>();

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

  for (const raw of detectedProviderIds) {
    const id = canonicalizeProviderId(raw);
    if (!id) continue;
    const row = ensure(id);
    if (!row) continue;
    if (!row.sources.includes("detected")) row.sources.push("detected");
    if (row.status === "unbound") row.status = "unknown";
    row.evidence.push(`package/inventory: ${raw}`);
  }

  for (const node of graph?.nodes ?? []) {
    for (const b of nodeBindings(node)) {
      const row = ensure(b.providerId);
      if (!row) continue;
      if (!row.boundNodeIds.includes(node.id)) row.boundNodeIds.push(node.id);
      if (!row.sources.includes(b.source)) row.sources.push(b.source);
      if (b.accountLabel && !row.accountLabels.includes(b.accountLabel)) {
        row.accountLabels.push(b.accountLabel);
      }
      if (b.evidence) row.evidence.push(b.evidence);
      // Prefer connected > missing_credentials > unknown > unbound
      const rank: Record<BindingStatus, number> = {
        connected: 4,
        missing_credentials: 3,
        unknown: 2,
        unbound: 1,
      };
      if (rank[b.status] > rank[row.status]) row.status = b.status;
    }
  }

  // Critical catalog providers with zero evidence stay as unbound gaps
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

  return [...byId.values()].sort((a, b) => {
    const rank: Record<BindingStatus, number> = {
      unbound: 0,
      missing_credentials: 1,
      unknown: 2,
      connected: 3,
    };
    const d = rank[a.status] - rank[b.status];
    if (d !== 0) return d;
    return a.provider.name.localeCompare(b.provider.name);
  });
}

export function collectDetectedProvidersFromAgents(agents: Array<{ provider?: string | null }> | null | undefined): string[] {
  const out = new Set<string>();
  for (const a of agents ?? []) {
    const id = canonicalizeProviderId(a.provider ?? null);
    if (id) out.add(id);
  }
  return [...out];
}
