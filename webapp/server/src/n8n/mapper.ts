/**
 * Pure n8n workflow → ArchGraph mapper (no Express, no DB).
 */

import type {
  ArchEdge,
  ArchGraph,
  ArchGraphGroup,
  ArchNode,
  NodeLayer,
  TechKind,
} from "../../../../src/types.js";
import {
  buildExternalId,
  DEFAULT_VARIANT_KEY,
  shouldMaterializeVariant,
} from "./identity.js";
import { deriveBranchLabel, switchOutputLabels } from "./branchLabels.js";
import { sanitizeWorkflowRaw } from "./sanitize.js";
import {
  isStickyType,
  isTriggerType,
  lookupTaxonomy,
  providerFromHttpUrl,
  shortType,
} from "./taxonomy.js";
import { detectVariantKey } from "./variants.js";

export type N8nRawNode = {
  id: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: [number, number] | number[];
  parameters?: Record<string, unknown>;
  credentials?: Record<string, { id?: string; name?: string }>;
  disabled?: boolean;
  notes?: string;
  notesInFlow?: boolean;
};

export type N8nConnectionTarget = {
  node: string;
  type?: string;
  index?: number;
};

export type N8nRawWorkflow = {
  id?: string;
  name?: string;
  versionId?: string;
  meta?: { instanceId?: string };
  nodes?: N8nRawNode[];
  connections?: Record<
    string,
    Record<string, N8nConnectionTarget[][] | undefined>
  >;
  pinData?: unknown;
  active?: boolean;
  settings?: unknown;
};

export type MappedIntegration = {
  providerId: string;
  authKind: "oauth2" | "apiKey" | "basic" | "header" | "none" | "unknown";
  status: "missing_credentials" | "connected" | "unknown";
  nodeIds: string[];
  evidence?: string;
};

export type MappedCostCenter = {
  kind: string;
  providerId?: string;
  nodeId: string;
};

export type MapWorkflowOptions = {
  /** Override auto-detected variant key. */
  variantKey?: string;
  /**
   * Only this variant materializes ArchNodes into the graph.
   * Other variants still return sanitized raw + metadata for storage.
   */
  materializeVariantKey?: string;
};

export type MapWorkflowResult = {
  workflowId: string;
  workflowName: string;
  versionId?: string;
  instanceId?: string;
  variantKey: string;
  materialize: boolean;
  nodes: ArchNode[];
  edges: ArchEdge[];
  groups: ArchGraphGroup[];
  integrations: MappedIntegration[];
  costCenters: MappedCostCenter[];
  unknownTypes: string[];
  /** Always pinData-stripped + secret-redacted. Safe to persist. */
  sanitizedRaw: Record<string, unknown>;
};

const STICKY_COLORS: Record<number, string> = {
  1: "rgba(255, 198, 92, 0.22)",
  2: "rgba(125, 211, 252, 0.22)",
  3: "rgba(134, 239, 172, 0.22)",
  4: "rgba(252, 165, 165, 0.22)",
  5: "rgba(196, 181, 253, 0.22)",
  6: "rgba(253, 186, 116, 0.22)",
  7: "rgba(165, 180, 252, 0.22)",
};

function stickyTitle(content: unknown): string {
  if (typeof content !== "string" || !content.trim()) return "Group";
  const line = content.split("\n").find((l) => l.trim()) ?? "Group";
  return line.replace(/^#+\s*/, "").trim() || "Group";
}

function paramSubtitle(type: string, parameters: Record<string, unknown> | undefined): string | null {
  if (!parameters) return null;
  const s = shortType(type).toLowerCase();
  if (typeof parameters.mode === "string") return String(parameters.mode);
  if (s === "webhook" && typeof parameters.httpMethod === "string") {
    return `${parameters.httpMethod}${parameters.path ? ` /${String(parameters.path).replace(/^\//, "")}` : ""}`;
  }
  if (s === "httprequest") {
    const method = typeof parameters.method === "string" ? parameters.method : "GET";
    const url = typeof parameters.url === "string" ? parameters.url : "";
    try {
      const host = url ? new URL(url.includes("://") ? url : `https://${url}`).host : "";
      return host ? `${method} ${host}` : method;
    } catch {
      return method;
    }
  }
  if (s === "if") return "true / false";
  if (s === "switch") return "rules";
  if (s === "splitinbatches") return "batch loop";
  if (s === "set" && parameters.mode) return String(parameters.mode);
  if (s === "manualtrigger") return "manual";
  return null;
}

function extractHttpUrl(parameters: Record<string, unknown> | undefined): string | undefined {
  if (!parameters) return undefined;
  if (typeof parameters.url === "string") return parameters.url;
  // n8n expressions sometimes wrap url
  const opts = parameters.options as { url?: string } | undefined;
  if (opts && typeof opts.url === "string") return opts.url;
  return undefined;
}

function authKindFromCredentialKey(key: string): MappedIntegration["authKind"] {
  const k = key.toLowerCase();
  if (k.includes("oauth")) return "oauth2";
  if (k.includes("basic")) return "basic";
  if (k.includes("header")) return "header";
  if (k.includes("api") || k.includes("token") || k.includes("key")) return "apiKey";
  return "unknown";
}

function internalNodeId(workflowId: string, variantKey: string, n8nId: string): string {
  // Stable internal id derived from external identity (no Date.now).
  return buildExternalId(workflowId, variantKey, n8nId).replace(/[^a-zA-Z0-9:_-]/g, "_");
}

export function mapWorkflow(
  rawInput: unknown,
  opts: MapWorkflowOptions = {}
): MapWorkflowResult {
  const raw = (rawInput ?? {}) as N8nRawWorkflow;
  const sanitizedRaw = sanitizeWorkflowRaw(raw);
  const workflowId = String(raw.id ?? "unknown");
  const workflowName = String(raw.name ?? "Untitled workflow");
  const versionId = raw.versionId ? String(raw.versionId) : undefined;
  const instanceId = raw.meta?.instanceId ? String(raw.meta.instanceId) : undefined;
  const variantKey = opts.variantKey ?? detectVariantKey(raw);
  const materializeKey = opts.materializeVariantKey ?? DEFAULT_VARIANT_KEY;
  const materialize = shouldMaterializeVariant(variantKey, materializeKey);

  const empty: MapWorkflowResult = {
    workflowId,
    workflowName,
    versionId,
    instanceId,
    variantKey,
    materialize,
    nodes: [],
    edges: [],
    groups: [],
    integrations: [],
    costCenters: [],
    unknownTypes: [],
    sanitizedRaw,
  };

  if (!materialize) {
    return empty;
  }

  const n8nNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const unknownTypes: string[] = [];
  const nodes: ArchNode[] = [];
  const groups: ArchGraphGroup[] = [];
  const nameToArchId = new Map<string, string>();
  const integrationMap = new Map<string, MappedIntegration>();
  const costCenters: MappedCostCenter[] = [];

  for (const n of n8nNodes) {
    if (!n?.id || !n.type) continue;

    if (isStickyType(n.type)) {
      const [x, y] = Array.isArray(n.position) ? n.position : [0, 0];
      const w = Number(n.parameters?.width ?? 240) || 240;
      const h = Number(n.parameters?.height ?? 160) || 160;
      const colorIdx = Number(n.parameters?.color ?? 5) || 5;
      groups.push({
        id: `group:${workflowId}:${variantKey}:${n.id}`,
        label: stickyTitle(n.parameters?.content),
        x: Number(x) || 0,
        y: Number(y) || 0,
        width: w,
        height: h,
        color: colorIdx,
        workflowId,
        source: "n8n-sticky",
      });
      continue;
    }

    const tax = lookupTaxonomy(n.type);
    if (tax.layer === "Uncategorized" && tax.techKind === "unknown") {
      unknownTypes.push(n.type);
    }

    const archId = internalNodeId(workflowId, variantKey, n.id);
    const externalId = buildExternalId(workflowId, variantKey, n.id);
    nameToArchId.set(n.name, archId);

    const [px, py] = Array.isArray(n.position) ? n.position : [0, 0];
    const subtitle = paramSubtitle(n.type, n.parameters);
    let providerId = tax.providerId;
    const httpUrl = extractHttpUrl(n.parameters);
    if (!providerId && httpUrl) {
      providerId = providerFromHttpUrl(httpUrl);
    }

    const platformBindings: ArchNode["platformBindings"] = [];
    if (providerId) {
      platformBindings.push({
        providerId,
        status: n.credentials && Object.keys(n.credentials).length > 0
          ? "missing_credentials"
          : "unknown",
        source: "detected",
        evidence: n.type,
      });
    }
    if (n.credentials) {
      for (const [credKey, cred] of Object.entries(n.credentials)) {
        const pid = providerId ?? credKey.replace(/Api$/i, "").toLowerCase();
        const existing = integrationMap.get(pid);
        const authKind = authKindFromCredentialKey(credKey);
        if (existing) {
          existing.nodeIds.push(archId);
        } else {
          integrationMap.set(pid, {
            providerId: pid,
            authKind,
            status: "missing_credentials",
            nodeIds: [archId],
            evidence: cred?.name ?? credKey,
          });
        }
        if (!platformBindings.some((b) => b.providerId === pid)) {
          platformBindings.push({
            providerId: pid,
            accountLabel: cred?.name,
            status: "missing_credentials",
            source: "detected",
            evidence: credKey,
          });
        }
      }
    }

    if (tax.costCenterKind && tax.costCenterKind !== "unknown") {
      costCenters.push({
        kind: tax.costCenterKind,
        providerId,
        nodeId: archId,
      });
    }

    const properties: Record<string, string | number | boolean | null> = {
      n8nType: n.type,
      typeVersion: n.typeVersion ?? null,
    };
    if (subtitle) properties.subtitle = subtitle;
    if (httpUrl) {
      try {
        const u = new URL(httpUrl.includes("://") ? httpUrl : `https://${httpUrl}`);
        properties.httpHost = u.host;
        properties.httpPath = u.pathname;
      } catch {
        properties.httpUrl = httpUrl.slice(0, 200);
      }
    }
    if (n.notes) properties.notes = String(n.notes).slice(0, 500);

    const node: ArchNode = {
      id: archId,
      label: n.name, // verbatim — presentation fidelity
      path: `n8n/${workflowId}/${n.name}`,
      archNodeId: externalId,
      externalId,
      workflowId,
      variantKey,
      importSource: "n8n",
      layer: tax.layer as NodeLayer,
      techKind: tax.techKind as TechKind,
      kind: tax.kind,
      iconKey: tax.iconKey ?? providerId ?? shortType(n.type),
      llmProvider: tax.costCenterKind === "llm" ? providerId : undefined,
      tags: ["n8n", shortType(n.type)],
      summary: subtitle ?? undefined,
      description: n.notes || undefined,
      position: { x: Number(px) || 0, y: Number(py) || 0 },
      properties,
      platformBindings: platformBindings.length ? platformBindings : undefined,
      disabled: Boolean(n.disabled),
      isTrigger: isTriggerType(n.type, tax),
      isEntryPoint: isTriggerType(n.type, tax),
      files: [],
      semanticSignals: { exports: [], externalImports: [], fileCount: 0 },
      health: { hasDocs: false, hasTests: false, hasContext: false },
      status: n.disabled ? "deprecated" : "stable",
      isDrift: false,
    };
    nodes.push(node);
  }

  // Also register integrations discovered via http host mapping
  for (const node of nodes) {
    const hostProvider = node.properties?.httpHost
      ? providerFromHttpUrl(String(node.properties.httpHost))
      : undefined;
    const pid =
      hostProvider ??
      node.platformBindings?.[0]?.providerId ??
      (typeof node.iconKey === "string" &&
      ["calcom", "twilio", "airtable", "slack", "openai", "anthropic"].includes(node.iconKey)
        ? node.iconKey
        : undefined);
    if (!pid) continue;
    if (integrationMap.has(pid)) {
      const integ = integrationMap.get(pid)!;
      if (!integ.nodeIds.includes(node.id)) integ.nodeIds.push(node.id);
      continue;
    }
    // httpRequest to known SaaS without credentials block
    if (hostProvider) {
      integrationMap.set(pid, {
        providerId: pid,
        authKind: "unknown",
        status: "unknown",
        nodeIds: [node.id],
        evidence: String(node.properties?.httpHost ?? ""),
      });
    }
  }

  const edges: ArchEdge[] = [];
  const connections = raw.connections ?? {};
  for (const [sourceName, groupsOut] of Object.entries(connections)) {
    const sourceId = nameToArchId.get(sourceName);
    if (!sourceId) continue;
    const sourceNode = n8nNodes.find((n) => n.name === sourceName);
    const sourceType = sourceNode?.type ?? "";
    const switchLabels = switchOutputLabels(sourceNode?.parameters);

    for (const [outputGroup, outputs] of Object.entries(groupsOut ?? {})) {
      if (!Array.isArray(outputs)) continue;
      outputs.forEach((targets, outputIndex) => {
        if (!Array.isArray(targets)) return;
        for (const t of targets) {
          if (!t?.node) continue;
          const targetId = nameToArchId.get(t.node);
          if (!targetId) continue;
          const label = deriveBranchLabel({
            sourceType,
            outputGroup,
            outputIndex,
            switchOutputs: switchLabels,
          });
          const handle = `${outputGroup}:${outputIndex}`;
          edges.push({
            id: `e:${sourceId}:${handle}:${targetId}`,
            source: sourceId,
            target: targetId,
            type: "runtime",
            flowKind: "runtime_path",
            relation: "calls",
            isDrift: false,
            importance: "architectural",
            label,
            sourceHandle: handle,
          });
        }
      });
    }
  }

  return {
    workflowId,
    workflowName,
    versionId,
    instanceId,
    variantKey,
    materialize,
    nodes,
    edges,
    groups,
    integrations: [...integrationMap.values()],
    costCenters,
    unknownTypes: [...new Set(unknownTypes)],
    sanitizedRaw,
  };
}

/** Build a single ArchGraph from one or more mapped workflows (already filtered to materialize). */
export function toArchGraph(
  mapped: MapWorkflowResult | MapWorkflowResult[],
  projectName?: string
): ArchGraph {
  const list = Array.isArray(mapped) ? mapped : [mapped];
  const material = list.filter((m) => m.materialize);
  return {
    nodes: material.flatMap((m) => m.nodes),
    edges: material.flatMap((m) => m.edges),
    groups: material.flatMap((m) => m.groups),
    generatedAt: Date.now(),
    projectRoot: "",
    projectName: projectName ?? material[0]?.workflowName ?? "n8n import",
    revision: 1,
  };
}

/**
 * Map two variant exports of the same workflow: only the materialize key emits nodes;
 * the other is returned for storage without colliding externalIds.
 */
export function mapWorkflowVariants(
  variants: Array<{ raw: unknown; variantKey?: string }>,
  materializeVariantKey?: string
): MapWorkflowResult[] {
  const matKey =
    materializeVariantKey ??
    variants[0]?.variantKey ??
    detectVariantKey(variants[0]?.raw) ??
    DEFAULT_VARIANT_KEY;
  return variants.map((v) =>
    mapWorkflow(v.raw, {
      variantKey: v.variantKey ?? detectVariantKey(v.raw),
      materializeVariantKey: matKey,
    })
  );
}
